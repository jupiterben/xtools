import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const runtime = await readFile(new URL('../tools/dist/index.html', import.meta.url));
const directory = new URL('../apps/desktop/public/runtime/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('tool.html', directory), runtime);
await writeFile(new URL('integrity.json', directory), JSON.stringify({
  sha256: createHash('sha256').update(runtime).digest('hex'),
  bytes: runtime.length,
  apiVersion: 1,
}, null, 2));
console.log(`Prepared official tool bundle (${runtime.length} bytes): ${fileURLToPath(directory)}`);
