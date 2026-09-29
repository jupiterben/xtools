import { Box, Braces, Binary, Link2, Clock3, Fingerprint, Hash, Regex, FileDiff } from 'lucide-svelte';
const icons: Record<string, typeof Box> = { json: Braces, base64: Binary, url: Link2, timestamp: Clock3, uuid: Fingerprint, hash: Hash, regex: Regex, diff: FileDiff };
export const toolIcons = new Proxy(icons, { get: (target, id: string) => target[id] ?? Box });
