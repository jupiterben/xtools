import { readFile, appendFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function releaseVersion() {
  const root = JSON.parse(await readFile('package.json', 'utf8'));
  const desktop = JSON.parse(await readFile('apps/desktop/package.json', 'utf8'));
  const tauri = JSON.parse(await readFile('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
  const cargo = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml'], { encoding: 'utf8' }));
  const rust = cargo.packages.find((pkg) => pkg.name === 'xtools');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(root.version)) throw new Error('Expected a stable x.y.z version in package.json');
  if (![desktop.version, tauri.version, rust?.version].every((value) => value === root.version)) {
    throw new Error('Root package, desktop package, Tauri and Cargo versions must agree');
  }
  return root.version;
}

export function validateTag(tag, version) {
  if (tag !== `v${version}`) throw new Error(`Release tag must be v${version}, received ${tag}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { 'require-tag': { type: 'boolean', default: false } } });
  const version = await releaseVersion();
  const tag = process.env.RELEASE_TAG || `v${version}`;
  validateTag(tag, version);
  if (values['require-tag']) {
    const tagCommit = execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' }).trim();
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (tagCommit !== head) throw new Error('Checked-out commit differs from the release tag');
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\n`);
  console.log(`Release version verified: ${tag}`);
}
