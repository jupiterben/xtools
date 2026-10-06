import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrent, onOpenUrl } from '../../apps/desktop/node_modules/@tauri-apps/plugin-deep-link/dist-js/index.js';
import { listenForInstallLinks, parseInstallLink } from '../../apps/desktop/src/lib/deep-link';

vi.mock('../../apps/desktop/node_modules/@tauri-apps/plugin-deep-link/dist-js/index.js', () => ({
  getCurrent: vi.fn(),
  onOpenUrl: vi.fn(),
}));

describe('external installation links', () => {
  it('accepts only a tool ID for the trusted market', () => {
    expect(parseInstallLink('xtools://install?id=json')).toBe('json');
    expect(parseInstallLink('xtools://install/?id=new-tool')).toBe('new-tool');
    for (const value of [
      '', 'invalid', 'https://install?id=json', 'xtools://open?id=json',
      'xtools://user@install?id=json', 'xtools://install:123?id=json',
      'xtools://install/path?id=json', 'xtools://install?id=json#other',
      'xtools://install', 'xtools://install?id=', 'xtools://install?id=../json',
      'xtools://install?id=json&id=hash', 'xtools://install?id=json&url=https://evil.test',
      'xtools://install?id=json&source=https://evil.test', 'xtools://install?id=JSON',
      'xtools://install?id=%00json', `xtools://install?id=${'a'.repeat(65)}`,
    ]) expect(parseInstallLink(value), value).toBeNull();
  });

  beforeEach(() => vi.resetAllMocks());

  it('handles cold startup and later links and exposes cleanup', async () => {
    const stop = vi.fn();
    vi.mocked(onOpenUrl).mockResolvedValue(stop);
    vi.mocked(getCurrent).mockResolvedValue(['xtools://install?id=json']);
    const receive = vi.fn();
    expect(await listenForInstallLinks(receive)).toBe(stop);
    expect(receive).toHaveBeenCalledWith(['xtools://install?id=json']);
    vi.mocked(onOpenUrl).mock.calls[0][0](['xtools://install?id=uuid']);
    expect(receive).toHaveBeenLastCalledWith(['xtools://install?id=uuid']);
  });

  it('does not replay an outdated startup link after a live event', async () => {
    vi.mocked(onOpenUrl).mockResolvedValue(vi.fn());
    vi.mocked(getCurrent).mockImplementation(async () => {
      vi.mocked(onOpenUrl).mock.calls[0][0](['xtools://install?id=uuid']);
      return ['xtools://install?id=json'];
    });
    const receive = vi.fn();
    await listenForInstallLinks(receive);
    expect(receive).toHaveBeenCalledExactlyOnceWith(['xtools://install?id=uuid']);
  });

  it('does nothing on ordinary startup and unsubscribes on startup failure', async () => {
    const stop = vi.fn();
    vi.mocked(onOpenUrl).mockResolvedValue(stop);
    vi.mocked(getCurrent).mockResolvedValue(null);
    const receive = vi.fn();
    await listenForInstallLinks(receive);
    expect(receive).not.toHaveBeenCalled();
    vi.mocked(getCurrent).mockRejectedValue(new Error('unavailable'));
    await expect(listenForInstallLinks(receive)).rejects.toThrow('unavailable');
    expect(stop).toHaveBeenCalledOnce();
  });
});
