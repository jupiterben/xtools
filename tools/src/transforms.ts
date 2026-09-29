import { diffLines } from 'diff';
import { v4 as uuid } from 'uuid';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { ToolId } from '@xtools/tool-sdk';

export interface ToolInput {
  id: ToolId;
  input: string;
  secondary: string;
  mode: string;
  option: string;
}

export async function transform({ id, input, secondary, mode, option }: ToolInput): Promise<string> {
  if (input.length > 200_000 || secondary.length > 200_000) throw new Error('单次输入不能超过 200,000 个字符');
  switch (id) {
    case 'json': {
      const value: unknown = JSON.parse(input);
      return JSON.stringify(value, null, mode === 'compact' ? undefined : Number(option || 2));
    }
    case 'base64':
      if (mode === 'decode') {
        const bytes = Uint8Array.from(atob(input.replace(/\s/g, '')), (character) => character.charCodeAt(0));
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      }
      return btoa(Array.from(new TextEncoder().encode(input), (byte) => String.fromCharCode(byte)).join(''));
    case 'url':
      return mode === 'decode' ? decodeURIComponent(input) : encodeURIComponent(input);
    case 'timestamp': {
      const text = input.trim();
      if (!text) throw new Error('请输入时间戳或日期');
      const milliseconds = /^-?\d+(\.\d+)?$/.test(text)
        ? Number(text) * (option === 'milliseconds' ? 1 : 1000)
        : Date.parse(text);
      const date = new Date(milliseconds);
      if (Number.isNaN(date.getTime())) throw new Error('无法识别日期或时间戳');
      return [
        `Unix 秒       ${Math.floor(date.getTime() / 1000)}`,
        `Unix 毫秒     ${date.getTime()}`,
        `UTC           ${date.toISOString()}`,
        `本地时间      ${date.toLocaleString('zh-CN', { hour12: false })}`,
        `时区          ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
      ].join('\n');
    }
    case 'uuid': {
      const count = Number(input);
      if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('生成数量必须是 1 到 100 之间的整数');
      return Array.from({ length: count }, () => uuid()).join('\n');
    }
    case 'hash': {
      const algorithm = option || 'SHA-256';
      if (!['SHA-256', 'SHA-384', 'SHA-512'].includes(algorithm)) throw new Error('不支持的摘要算法');
      const digest = algorithm === 'SHA-384' ? sha384 : algorithm === 'SHA-512' ? sha512 : sha256;
      return bytesToHex(digest(new TextEncoder().encode(input)));
    }
    case 'regex': {
      if (!secondary) throw new Error('请输入正则表达式');
      const flags = option.includes('g') ? option : `${option}g`;
      const expression = new RegExp(secondary, flags);
      const matches = [];
      for (const match of input.matchAll(expression)) {
        matches.push({ index: match.index, match: match[0], groups: match.slice(1) });
        if (matches.length >= 1000) break;
      }
      return matches.length ? JSON.stringify(matches, null, 2) : '没有匹配结果';
    }
    case 'diff': {
      if (input === secondary) return '两段文本完全一致';
      const changes = diffLines(input, secondary, { timeout: 1000 });
      if (!changes) throw new Error('文本对比超时，请缩小输入范围');
      return changes.map((part) => part.value.split('\n')
        .filter((line, index, lines) => index !== lines.length - 1 || line !== '')
        .map((line) => `${part.added ? '+' : part.removed ? '-' : ' '} ${line}`).join('\n')).join('\n');
    }
    default:
      throw new Error('不支持的工具');
  }
}
