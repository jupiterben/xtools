import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateAssets } from './artifacts.mjs';
import { validateTag } from './version.mjs';

export async function publishRelease({ github, context, core }) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const tag = process.env.RELEASE_TAG;
  validateTag(tag, version);
  const files = validateAssets((await readdir('release-artifacts')).filter((name) => name !== 'SHA256SUMS.txt'), version);
  const checksums = await readFile('release-artifacts/SHA256SUMS.txt', 'utf8');
  for (const name of files) {
    const sha = createHash('sha256').update(await readFile(`release-artifacts/${name}`)).digest('hex');
    if (!checksums.split('\n').includes(`${sha}  ${name}`)) throw new Error(`Checksum verification failed for ${name}`);
  }
  const body = `## XTools ${version}

| Platform | Architecture | Installers |
| --- | --- | --- |
| Windows | x64 | EXE (NSIS), MSI |
| macOS | Universal: Apple Silicon + Intel | DMG |
| Linux | x64 | AppImage, DEB, RPM |

The desktop app uses the official signed marketplace at https://jupiterben.github.io/xtools-market/.

### Security and compatibility
- These preview installers are not signed with a trusted Windows publisher certificate. macOS uses an ad-hoc signature and is not Apple-notarized; operating systems may warn or block installation.
- macOS minimum version: 11.0. Linux packages are built on Ubuntu 24.04 and require a compatible WebKitGTK 4.1 runtime; they are not guaranteed to work on older distributions.
- Verify downloads against SHA256SUMS.txt. This checksum file is not a publisher code signature.
- Tool-package signature verification is separate from operating-system code signing.
`;
  const releases = await github.paginate(github.rest.repos.listReleases, { ...context.repo, per_page: 100 });
  let release = releases.find((item) => item.tag_name === tag);
  if (release && !release.draft) {
    const assets = await github.paginate(github.rest.repos.listReleaseAssets, { ...context.repo, release_id: release.id, per_page: 100 });
    const expected = [...files, 'SHA256SUMS.txt'];
    if (expected.every((name) => assets.some((asset) => asset.name === name))) {
      core.notice(`Release ${tag} is already published; refusing to overwrite immutable assets.`);
      return;
    }
    throw new Error(`Published release ${tag} is incomplete; refusing to overwrite it`);
  }
  if (!release) {
    release = (await github.rest.repos.createRelease({
      ...context.repo, tag_name: tag, name: `XTools ${tag}`, body,
      draft: true, prerelease: true, make_latest: 'false',
    })).data;
  }
  const existing = await github.paginate(github.rest.repos.listReleaseAssets, { ...context.repo, release_id: release.id, per_page: 100 });
  for (const name of [...files, 'SHA256SUMS.txt']) {
    const duplicate = existing.find((asset) => asset.name === name);
    if (duplicate) await github.rest.repos.deleteReleaseAsset({ ...context.repo, asset_id: duplicate.id });
    await github.rest.repos.uploadReleaseAsset({
      ...context.repo, release_id: release.id, name,
      data: await readFile(`release-artifacts/${name}`),
      headers: { 'content-type': 'application/octet-stream' },
    });
  }
  await github.rest.repos.updateRelease({
    ...context.repo, release_id: release.id, body, draft: false, prerelease: true, make_latest: 'false',
  });
  await core.summary.addHeading('Published installers').addLink(`XTools ${tag}`, release.html_url).addList(files).write();
}
