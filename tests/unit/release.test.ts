import { describe, expect, it } from 'vitest';
import { artifactNames, validateAssets } from '../../scripts/release/artifacts.mjs';
import { validateTag } from '../../scripts/release/version.mjs';

describe('release safeguards', () => {
  it('requires all six installers across three platforms', () => {
    const files = ['windows', 'macos', 'linux'].flatMap((platform) => artifactNames('0.1.0', platform));
    expect(validateAssets(files, '0.1.0')).toHaveLength(6);
    expect(() => validateAssets(files.slice(1), '0.1.0')).toThrow('six installers');
    expect(() => validateAssets([...files, 'unexpected.exe'], '0.1.0')).toThrow();
    expect(files).toContain('XTools-0.1.0-macos-universal.dmg');
  });
  it('rejects mismatched tags, versions and unsupported platforms', () => {
    expect(() => validateTag('v0.1.0', '0.1.0')).not.toThrow();
    expect(() => validateTag('v0.2.0', '0.1.0')).toThrow();
    expect(() => artifactNames('../escape', 'windows')).toThrow();
    expect(() => artifactNames('0.1.0', 'unknown')).toThrow();
  });
});
