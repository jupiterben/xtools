import { describe, expect, it } from 'vitest';
import { transform, type ToolInput } from '../../tools/src/transforms';

const run = (id: ToolInput['id'], input: string, options: Partial<ToolInput> = {}) =>
  transform({ id, input, secondary: '', mode: '', option: '', ...options });

describe('official tool transformations', () => {
  it('formats and minifies JSON, including primitive values', async () => {
    expect(await run('json', '{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(await run('json', '{ "a": 1 }', { mode: 'compact' })).toBe('{"a":1}');
    expect(await run('json', 'null')).toBe('null');
    await expect(run('json', '{broken')).rejects.toThrow();
  });
  it('round-trips multilingual Base64', async () => {
    const input = '中文 🔧 \n test';
    const encoded = await run('base64', input);
    expect(await run('base64', encoded, { mode: 'decode' })).toBe(input);
    await expect(run('base64', '???', { mode: 'decode' })).rejects.toThrow();
    await expect(run('base64', '/w==', { mode: 'decode' })).rejects.toThrow();
  });
  it('round-trips URL components and rejects malformed percent encoding', async () => {
    const input = '查询?q=a&b=中文';
    expect(await run('url', await run('url', input), { mode: 'decode' })).toBe(input);
    await expect(run('url', '%ZZ', { mode: 'decode' })).rejects.toThrow();
  });
  it('accepts zero and negative timestamps in explicit units', async () => {
    expect(await run('timestamp', '0')).toContain('1970-01-01T00:00:00.000Z');
    expect(await run('timestamp', '-1')).toContain('1969-12-31T23:59:59.000Z');
    expect(await run('timestamp', '1000', { option: 'milliseconds' })).toContain('1970-01-01T00:00:01.000Z');
    await expect(run('timestamp', 'no date')).rejects.toThrow();
    await expect(run('timestamp', '')).rejects.toThrow();
  });
  it('generates bounded unique UUID v4 values', async () => {
    const values = (await run('uuid', '100')).split('\n');
    expect(new Set(values).size).toBe(100);
    expect(values.every((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))).toBe(true);
    await expect(run('uuid', '101')).rejects.toThrow();
    await expect(run('uuid', '1.5')).rejects.toThrow();
  });
  it('matches the SHA-256 known vector', async () => {
    expect(await run('hash', 'abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('returns regex captures and handles empty-width matches', async () => {
    const result = JSON.parse(await run('regex', 'a1 b2', { secondary: '([a-z])(\\d)', option: 'g' }));
    expect(result).toEqual([{ index: 0, match: 'a1', groups: ['a', '1'] }, { index: 3, match: 'b2', groups: ['b', '2'] }]);
    expect(JSON.parse(await run('regex', 'abc', { secondary: '(?:)', option: 'g' }))).toHaveLength(4);
    await expect(run('regex', 'a', { secondary: '[' })).rejects.toThrow();
  });
  it('identifies line differences with the diff library', async () => {
    const output = await run('diff', 'a\nb\n', { secondary: 'a\nc\n' });
    expect(output).toContain('- b');
    expect(output).toContain('+ c');
    expect(await run('diff', 'same', { secondary: 'same' })).toBe('两段文本完全一致');
  });
  it('bounds tool input sizes', async () => {
    await expect(run('json', 'a'.repeat(200_001))).rejects.toThrow('200,000');
  });
});
