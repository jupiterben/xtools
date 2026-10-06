import type { Snapshot, ToolGroup } from '@xtools/tool-sdk';

export function groupName(value: string, groups: ToolGroup[], exceptId?: string): string {
  const name = value.trim();
  if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
    throw new Error('分组名称需为 1–40 个字符，且不能包含控制字符');
  }
  if (['全部工具', '未分组'].includes(name) || groups.some((group) => group.id !== exceptId && group.name === name)) {
    throw new Error('分组名称已存在或为保留名称');
  }
  return name;
}

export function assignToolGroup(state: Snapshot, ids: string[], groupId: string | null) {
  if (!ids.length || ids.length > 2000) throw new Error('请选择 1–2000 个工具');
  if (groupId !== null && !state.groups.some((group) => group.id === groupId)) throw new Error('分组不存在');
  const tools = ids.map((id) => {
    const tool = state.installed.find((item) => item.id === id);
    if (!tool) throw new Error('请先安装工具');
    return tool;
  });
  for (const tool of tools) tool.groupId = groupId;
}
