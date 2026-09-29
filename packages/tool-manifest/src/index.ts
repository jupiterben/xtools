import data from '../catalog.json';
import trust from '../market-trust.json';
import type { Category, ToolId, ToolManifest } from '@xtools/tool-sdk';

export const catalog = data as ToolManifest[];
export const marketPublicKey = trust.publicKey;
export const categories: Category[] = ['全部工具', '数据处理', '编码转换', '开发辅助', '文本工具'];
export const defaultToolIds: ToolId[] = ['json', 'base64', 'timestamp'];
export function getTool(id: string): ToolManifest {
  const tool = catalog.find((item) => item.id === id);
  if (!tool) throw new Error('未知工具');
  return tool;
}
