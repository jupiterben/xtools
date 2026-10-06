import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';

export function parseInstallLink(value: string): string | null {
  if (value.length > 256) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'xtools:' || url.hostname !== 'install'
      || url.username || url.password || url.port || url.hash
      || (url.pathname !== '' && url.pathname !== '/')) return null;
    const entries = [...url.searchParams];
    if (entries.length !== 1 || entries[0][0] !== 'id') return null;
    return /^[a-z][a-z0-9-]{0,63}$/.test(entries[0][1]) ? entries[0][1] : null;
  } catch { return null; }
}

export async function listenForInstallLinks(onUrls: (urls: string[]) => void): Promise<() => void> {
  // Subscribe first so a link arriving during startup cannot be lost.
  let received = false;
  const unlisten = await onOpenUrl((urls) => {
    received = true;
    onUrls(urls);
  });
  try {
    const current = await getCurrent();
    if (!received && current?.length) onUrls(current);
    return unlisten;
  } catch (error) {
    unlisten();
    throw error;
  }
}
