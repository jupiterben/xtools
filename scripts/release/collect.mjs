import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { releaseVersion } from './version.mjs';
import { artifactNames, platforms } from './artifacts.mjs';

const [platform, target] = process.argv.slice(2);
const targets = { windows: 'x86_64-pc-windows-msvc', macos: 'universal-apple-darwin', linux: 'x86_64-unknown-linux-gnu' };
if (!platforms[platform] || target !== targets[platform]) throw new Error('Unsupported platform/target pair');
const version = await releaseVersion();
const names = artifactNames(version, platform);
const root = join('apps/desktop/src-tauri/target', target, 'release/bundle');
await mkdir('release-artifacts', { recursive: true });
for (const [index, format] of platforms[platform].formats.entries()) {
  const directory = join(root, format.directory);
  const files = (await readdir(directory)).filter((name) => name.endsWith(format.extension));
  if (files.length !== 1) throw new Error(`Expected one ${format.extension} in ${directory}, found ${files.length}`);
  const source = join(directory, files[0]);
  if ((await stat(source)).size < 1000) throw new Error(`Invalid installer: ${source}`);
  await copyFile(source, join('release-artifacts', names[index]));
  console.log(`Collected ${names[index]}`);
}
