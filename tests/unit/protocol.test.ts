import { describe, expect, it } from 'vitest';
import { isToolResult } from '../../packages/tool-sdk/src';
import { catalog, getTool } from '../../packages/tool-manifest/src';

describe('tool protocol and catalog', () => {
  const message = { type: 'xtools:result', protocol: 1, session: 'session', output: 'ok' };
  it('requires the matching session and version', () => {
    expect(isToolResult(message, 'session')).toBe(true);
    expect(isToolResult(message, 'other')).toBe(false);
    expect(isToolResult({ ...message, protocol: 2 }, 'session')).toBe(false);
    expect(isToolResult({ ...message, output: {} }, 'session')).toBe(false);
    expect(isToolResult(null, 'session')).toBe(false);
  });
  it('rejects oversized messages', () => {
    expect(isToolResult({ ...message, output: 'x'.repeat(1_000_001) }, 'session')).toBe(false);
  });
  it('contains unique known tool ids only', () => {
    expect(new Set(catalog.map((tool) => tool.id)).size).toBe(catalog.length);
    expect(catalog.every((tool) => tool.permissions.length === 0)).toBe(true);
    expect(() => getTool('../../unknown')).toThrow('未知工具');
  });
});
