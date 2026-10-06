export const PROTOCOL_VERSION = 1;
export const MAX_PAYLOAD_SIZE = 1_000_000;
export type ToolId = string;
export type Category = '全部工具' | '数据处理' | '编码转换' | '开发辅助' | '文本工具';
export interface ToolManifest {
  id: ToolId;
  name: string;
  subtitle: string;
  description: string;
  category: Exclude<Category, '全部工具'>;
  version: string;
  color: string;
  tags: string[];
  permissions: string[];
}
export interface InstalledTool {
  id: ToolId;
  version: string;
  installedAt: number;
  lastOpenedAt: number | null;
  favorite: boolean;
  enabled: boolean;
  manifest?: ToolManifest;
  groupId?: string | null;
}
export interface ToolGroup { id: string; name: string }
export interface MarketRelease {
  manifest: ToolManifest;
  apiVersion: 1;
  sha256: string;
  bytes: number;
}
export interface MarketEnvelope { payload: string; signature: string }
export interface MarketCatalog { schemaVersion: 1; generatedAt: string; releases: MarketRelease[] }
export interface TaskRecord {
  id: string;
  toolId: ToolId;
  action: 'install' | 'uninstall';
  status: 'completed' | 'failed';
  createdAt: number;
  message: string;
  toolName?: string;
}
export interface Settings {
  theme: 'light' | 'dark' | 'system';
  confirmUninstall: boolean;
}
export interface Snapshot {
  groups: ToolGroup[];
  installed: InstalledTool[];
  tasks: TaskRecord[];
  settings: Settings;
}
export interface HostBridge {
  createGroup(name: string): Promise<Snapshot>;
  renameGroup(id: string, name: string): Promise<Snapshot>;
  deleteGroup(id: string): Promise<Snapshot>;
  setToolGroup(ids: ToolId[], groupId: string | null): Promise<Snapshot>;
  snapshot(): Promise<Snapshot>;
  install(id: ToolId): Promise<Snapshot>;
  uninstall(id: ToolId): Promise<Snapshot>;
  setFavorite(id: ToolId, favorite: boolean): Promise<Snapshot>;
  setEnabled(id: ToolId, enabled: boolean): Promise<Snapshot>;
  openTool(id: ToolId): Promise<{ html: string; snapshot: Snapshot }>;
  saveSettings(settings: Settings): Promise<Snapshot>;
  clearTasks(): Promise<Snapshot>;
}
export interface ToolResult {
  type: 'xtools:result';
  protocol: typeof PROTOCOL_VERSION;
  session: string;
  output: string;
}
export function isToolResult(value: unknown, session: string): value is ToolResult {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return message.type === 'xtools:result' && message.protocol === PROTOCOL_VERSION
    && message.session === session && typeof message.output === 'string'
    && message.output.length <= MAX_PAYLOAD_SIZE;
}
