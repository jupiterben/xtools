export const platforms = {
  windows: { architecture: 'x64', formats: [{ directory: 'nsis', extension: '.exe', suffix: '-setup.exe' }, { directory: 'msi', extension: '.msi', suffix: '.msi' }] },
  macos: { architecture: 'universal', formats: [{ directory: 'dmg', extension: '.dmg', suffix: '.dmg' }] },
  linux: { architecture: 'x64', formats: [{ directory: 'appimage', extension: '.AppImage', suffix: '.AppImage' }, { directory: 'deb', extension: '.deb', suffix: '.deb' }, { directory: 'rpm', extension: '.rpm', suffix: '.rpm' }] },
};

export function artifactNames(version, platform) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid version');
  const spec = platforms[platform];
  if (!spec) throw new Error('Unsupported platform');
  return spec.formats.map(({ suffix }) => `XTools-${version}-${platform}-${spec.architecture}${suffix}`);
}

export function validateAssets(files, version) {
  const expected = Object.keys(platforms).flatMap((platform) => artifactNames(version, platform)).sort();
  if (JSON.stringify([...files].sort()) !== JSON.stringify(expected)) {
    throw new Error(`Expected exactly these six installers: ${expected.join(', ')}`);
  }
  return expected;
}
