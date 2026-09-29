import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateAssets } from './artifacts.mjs';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const files = validateAssets((await readdir('release-artifacts')).filter((name) => name !== 'SHA256SUMS.txt'), version);
const lines = [];
for (const name of files) {
  if ((await stat(`release-artifacts/${name}`)).size < 1000) throw new Error(`Empty installer ${name}`);
  lines.push(`${createHash('sha256').update(await readFile(`release-artifacts/${name}`)).digest('hex')}  ${name}`);
}
await writeFile('release-artifacts/SHA256SUMS.txt', `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
