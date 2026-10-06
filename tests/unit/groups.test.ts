import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../packages/tool-sdk/src';
import { assignToolGroup, groupName } from '../../apps/desktop/src/lib/groups';

describe('tool grouping', () => {
  it('validates names consistently, including Unicode and duplicates', () => {
    const groups = [{ id: 'g', name: '常用' }];
    expect(groupName('  开发  ', groups)).toBe('开发');
    expect(groupName('常用', groups, 'g')).toBe('常用');
    expect(groupName('😀'.repeat(40), [])).toHaveLength(80);
    for (const name of ['', '  ', '常用', '全部工具', '未分组', 'x'.repeat(41), 'a\nb', 'a\u0085b']) {
      expect(() => groupName(name, groups)).toThrow();
    }
  });
  it('validates the entire batch before changing assignments', () => {
    const state: Snapshot = {
      groups: [{ id: 'g', name: '开发' }], tasks: [],
      installed: [{ id: 'json', version: '1.0.0', installedAt: 0, lastOpenedAt: null, favorite: true, enabled: false }],
      settings: { theme: 'light', confirmUninstall: true },
    };
    expect(() => assignToolGroup(state, ['json', 'missing'], 'g')).toThrow('请先安装');
    expect(state.installed[0].groupId).toBeUndefined();
    expect(() => assignToolGroup(state, ['json'], 'missing')).toThrow('分组不存在');
    expect(() => assignToolGroup(state, [], 'g')).toThrow();
    assignToolGroup(state, ['json'], 'g');
    expect(state.installed[0]).toMatchObject({ groupId: 'g', favorite: true, enabled: false });
    assignToolGroup(state, ['json'], null);
    expect(state.installed[0].groupId).toBeNull();
  });
});
