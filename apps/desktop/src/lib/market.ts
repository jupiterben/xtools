import { invoke, isTauri } from '@tauri-apps/api/core';
import { ed25519 } from '@noble/curves/ed25519.js';
import { marketPublicKey } from '@xtools/tool-manifest';
import type { MarketCatalog, MarketEnvelope, MarketRelease, ToolManifest } from '@xtools/tool-sdk';

export const marketUrl = import.meta.env.VITE_MARKET_URL || 'https://jupiterben.github.io/xtools-market/';
const MAX_BYTES = 2_000_000;
const hex = (value: string) => Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const validCategories = ['数据处理', '编码转换', '开发辅助', '文本工具'];
const validColors = ['amber', 'blue', 'cyan', 'rose', 'teal', 'violet', 'orange', 'green'];
export function validManifest(value: unknown): value is ToolManifest {
  if (!value || typeof value !== 'object') return false;
  const item = value as ToolManifest;
  return typeof item.id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(item.id)
    && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 80
    && typeof item.subtitle === 'string' && item.subtitle.length <= 80
    && typeof item.description === 'string' && item.description.length <= 400
    && typeof item.version === 'string' && versionPattern.test(item.version)
    && validCategories.includes(item.category) && validColors.includes(item.color)
    && Array.isArray(item.tags) && item.tags.length <= 10 && item.tags.every((tag) => typeof tag === 'string' && tag.length <= 40)
    && Array.isArray(item.permissions) && item.permissions.length === 0;
}
export function verifyCatalog(value: unknown): { envelope: MarketEnvelope; catalog: MarketCatalog } {
  const envelope = value as MarketEnvelope;
  if (!envelope || typeof envelope.payload !== 'string' || envelope.payload.length > MAX_BYTES
    || typeof envelope.signature !== 'string' || !/^[a-f0-9]{128}$/.test(envelope.signature)
    || !ed25519.verify(hex(envelope.signature), new TextEncoder().encode(envelope.payload), hex(marketPublicKey))) {
    throw new Error('市场目录签名验证失败');
  }
  const catalog = JSON.parse(envelope.payload) as MarketCatalog;
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.releases) || catalog.releases.length > 2000
    || !catalog.releases.every((release) => validManifest(release.manifest)
      && release.apiVersion === 1 && /^[a-f0-9]{64}$/.test(release.sha256)
      && Number.isInteger(release.bytes) && release.bytes > 0 && release.bytes <= MAX_BYTES)) {
    throw new Error('市场目录格式或插件 API 版本不兼容');
  }
  const keys = catalog.releases.map(({ manifest }) => `${manifest.id}@${manifest.version}`);
  if (new Set(keys).size !== keys.length) throw new Error('市场目录存在重复版本');
  return { envelope, catalog };
}
export function latestReleases(catalog: MarketCatalog): MarketRelease[] {
  const latest = new Map<string, MarketRelease>();
  for (const release of catalog.releases) {
    const previous = latest.get(release.manifest.id);
    const compare = previous ? release.manifest.version.split('.').map(Number)
      .map((part, index) => part - Number(previous.manifest.version.split('.')[index])).find((part) => part !== 0) ?? 0 : 1;
    if (compare > 0) latest.set(release.manifest.id, release);
  }
  return [...latest.values()];
}
export function marketResourceUrl(source: string, path: string): URL {
  if (path !== 'catalog.json' && !/^packages\/[a-f0-9]{64}\.xtool$/.test(path)) {
    throw new Error('不允许的市场路径');
  }
  const base = new URL(source);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) {
    throw new Error('市场源必须使用 HTTPS（本机开发除外）');
  }
  if (base.username || base.password || base.search || base.hash) throw new Error('市场源地址不能包含凭据、查询参数或片段');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(path, base);
}
async function request(path: string): Promise<string> {
  const url = marketResourceUrl(marketUrl, path);
  if (isTauri()) return invoke('market_request', { path });
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000), redirect: 'error',
    cache: path === 'catalog.json' ? 'no-cache' : 'default',
  });
  if (!response.ok || !response.body) throw new Error(`市场请求失败 (${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error('市场响应超过大小限制');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function fetchCatalog() {
  const result = verifyCatalog(JSON.parse(await request('catalog.json')));
  try { localStorage.setItem(`xtools-market:${marketUrl}`, JSON.stringify(result.envelope)); } catch { /* Cache is optional. */ }
  return result;
}
export function cachedCatalog(): MarketCatalog | null {
  try { return verifyCatalog(JSON.parse(localStorage.getItem(`xtools-market:${marketUrl}`) ?? 'null')).catalog; }
  catch { return null; }
}
export async function downloadTool(id: string) {
  // Refresh the signed release list before installing; a cached listing alone never authorizes a download.
  const { envelope, catalog } = await fetchCatalog();
  const release = latestReleases(catalog).find((item) => item.manifest.id === id);
  if (!release) throw new Error('工具不在市场目录中');
  const html = await request(`packages/${release.sha256}.xtool`);
  const bytes = new TextEncoder().encode(html);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== release.bytes || sha256 !== release.sha256) throw new Error('工具包完整性校验失败');
  return { html, sha256, release, envelope };
}
