import { invoke, isTauri } from '@tauri-apps/api/core';
import { openDB, type DBSchema } from 'idb';
import { defaultToolIds, getTool } from '@xtools/tool-manifest';
import type { HostBridge, Settings, Snapshot, ToolId } from '@xtools/tool-sdk';
import { downloadTool } from './market';
import { assignToolGroup, groupName } from './groups';

export const desktopMode = isTauri();
const emptySnapshot = (): Snapshot => ({
  groups: [],
  installed: [],
  tasks: [],
  settings: { theme: 'light', confirmUninstall: true },
});
interface ToolDatabase extends DBSchema {
  state: { key: string; value: Snapshot };
  packages: { key: string; value: { html: string; sha256: string } };
}

async function digest(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function officialPackage() {
  const [packageResponse, integrityResponse] = await Promise.all([
    fetch('/runtime/tool.html'), fetch('/runtime/integrity.json'),
  ]);
  if (!packageResponse.ok || !integrityResponse.ok) throw new Error('官方工具包不可用，请先运行 pnpm build:tools');
  const html = await packageResponse.text();
  const integrity = await integrityResponse.json() as { sha256: string; apiVersion: number };
  if (integrity.apiVersion !== 1 || await digest(html) !== integrity.sha256) throw new Error('工具包完整性校验失败');
  return { html, sha256: integrity.sha256 };
}

function browserBridge(): HostBridge {
  const database = openDB<ToolDatabase>('xtools-v1', 1, {
    upgrade(db) { db.createObjectStore('state'); db.createObjectStore('packages'); },
  });
  let initialization: Promise<void> | undefined;
  function ready(): Promise<void> {
    initialization ??= initialize().catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });
    return initialization;
  }
  async function initialize() {
    const db = await database;
    const migration = db.transaction('state', 'readwrite');
    const existing = await migration.store.get('app');
    if (existing && !existing.groups) {
      existing.groups = [];
      await migration.store.put(existing, 'app');
    }
    await migration.done;
    if (existing) return;
    const bundle = await officialPackage();
    const tx = db.transaction(['state', 'packages'], 'readwrite');
    if (!await tx.objectStore('state').get('app')) {
      const state = emptySnapshot();
      for (const id of defaultToolIds) {
        state.installed.push({ id, version: getTool(id).version, installedAt: Date.now(), lastOpenedAt: null, favorite: id === 'json', enabled: true });
        await tx.objectStore('packages').put(bundle, id);
      }
      await tx.objectStore('state').put(state, 'app');
    }
    await tx.done;
  }

  async function mutate(callback: (state: Snapshot) => void): Promise<Snapshot> {
    await ready();
    const db = await database;
    const tx = db.transaction('state', 'readwrite');
    const state = (await tx.store.get('app'))!;
    callback(state);
    await tx.store.put(state, 'app');
    await tx.done;
    return state;
  }

  return {
    createGroup: (name) => mutate((state) => {
      if (state.groups.length >= 100) throw new Error('最多创建 100 个分组');
      state.groups.push({ id: crypto.randomUUID(), name: groupName(name, state.groups) });
    }),
    renameGroup: (id, name) => mutate((state) => {
      const group = state.groups.find((item) => item.id === id);
      if (!group) throw new Error('分组不存在');
      group.name = groupName(name, state.groups, id);
    }),
    deleteGroup: (id) => mutate((state) => {
      if (!state.groups.some((group) => group.id === id)) throw new Error('分组不存在');
      state.groups = state.groups.filter((group) => group.id !== id);
      for (const tool of state.installed) if (tool.groupId === id) tool.groupId = null;
    }),
    setToolGroup: (ids, groupId) => mutate((state) => assignToolGroup(state, ids, groupId)),
    async snapshot() {
      await ready();
      return (await (await database).get('state', 'app'))!;
    },
    async install(id) {
      await ready();
      try {
        const bundle = await downloadTool(id);
        const db = await database;
        const tx = db.transaction(['state', 'packages'], 'readwrite');
        const state = (await tx.objectStore('state').get('app'))!;
        if (!state.installed.some((tool) => tool.id === id)) {
          await tx.objectStore('packages').put({ html: bundle.html, sha256: bundle.sha256 }, id);
          state.installed.push({ id, version: bundle.release.manifest.version, manifest: bundle.release.manifest, installedAt: Date.now(), lastOpenedAt: null, favorite: false, enabled: true });
          state.tasks.unshift({ id: crypto.randomUUID(), toolId: id, toolName: bundle.release.manifest.name, action: 'install', status: 'completed', createdAt: Date.now(), message: '市场签名和工具包校验通过，工具已安装' });
          state.tasks = state.tasks.slice(0, 100);
          await tx.objectStore('state').put(state, 'app');
        }
        await tx.done;
        return state;
      } catch (error) {
        await mutate((state) => {
          state.tasks.unshift({ id: crypto.randomUUID(), toolId: id, action: 'install', status: 'failed', createdAt: Date.now(), message: error instanceof Error ? error.message : '安装失败' });
          state.tasks = state.tasks.slice(0, 100);
        });
        throw error;
      }
    },
    async uninstall(id) {
      await ready();
      const db = await database;
      const tx = db.transaction(['state', 'packages'], 'readwrite');
      const state = (await tx.objectStore('state').get('app'))!;
      if (state.installed.some((tool) => tool.id === id)) {
        const name = state.installed.find((tool) => tool.id === id)?.manifest?.name;
        state.installed = state.installed.filter((tool) => tool.id !== id);
        await tx.objectStore('packages').delete(id);
        state.tasks.unshift({ id: crypto.randomUUID(), toolId: id, toolName: name, action: 'uninstall', status: 'completed', createdAt: Date.now(), message: '工具包及偏好已移除' });
        state.tasks = state.tasks.slice(0, 100);
        await tx.objectStore('state').put(state, 'app');
      }
      await tx.done;
      return state;
    },
    setFavorite: (id, favorite) => mutate((state) => {
      const tool = state.installed.find((item) => item.id === id);
      if (!tool) throw new Error('请先安装工具');
      tool.favorite = favorite;
    }),
    setEnabled: (id, enabled) => mutate((state) => {
      const tool = state.installed.find((item) => item.id === id);
      if (!tool) throw new Error('请先安装工具');
      tool.enabled = enabled;
    }),
    async openTool(id) {
      await ready();
      const db = await database;
      const bundle = await db.get('packages', id);
      if (!bundle || await digest(bundle.html) !== bundle.sha256) throw new Error('工具包缺失或已损坏，请卸载后重新安装');
      const snapshot = await mutate((state) => {
        const tool = state.installed.find((item) => item.id === id);
        if (!tool || !tool.enabled) throw new Error('工具未安装或已停用');
        tool.lastOpenedAt = Date.now();
      });
      return { html: bundle.html, snapshot };
    },
    saveSettings: (settings) => mutate((state) => { state.settings = settings; }),
    clearTasks: () => mutate((state) => { state.tasks = []; }),
  };
}

function tauriBridge(): HostBridge {
  return {
    createGroup: (name) => invoke('create_group', { name }),
    renameGroup: (id, name) => invoke('rename_group', { id, name }),
    deleteGroup: (id) => invoke('delete_group', { id }),
    setToolGroup: (ids, groupId) => invoke('set_tool_group', { ids, groupId }),
    snapshot: () => invoke('snapshot'),
    install: async (id) => {
      const { html, envelope } = await downloadTool(id);
      return invoke('install_tool', { id, html, envelope });
    },
    uninstall: (id) => invoke('uninstall_tool', { id }),
    setFavorite: (id, favorite) => invoke('set_favorite', { id, favorite }),
    setEnabled: (id, enabled) => invoke('set_enabled', { id, enabled }),
    openTool: (id) => invoke('open_tool', { id }),
    saveSettings: (settings: Settings) => invoke('save_settings', { settings }),
    clearTasks: () => invoke('clear_tasks'),
  };
}

export const bridge = desktopMode ? tauriBridge() : browserBridge();
