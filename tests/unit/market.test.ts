import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { latestReleases, marketResourceUrl, verifyCatalog } from '../../apps/desktop/src/lib/market';

const envelope = JSON.parse(readFileSync('tests/fixtures/market/catalog.json', 'utf8'));
describe('market trust contract', () => {
  it('keeps GitHub Pages repository paths with or without a trailing slash', () => {
    for (const base of ['https://jupiterben.github.io/xtools-market', 'https://jupiterben.github.io/xtools-market/']) {
      expect(marketResourceUrl(base, 'catalog.json').href).toBe('https://jupiterben.github.io/xtools-market/catalog.json');
      const path = `packages/${'a'.repeat(64)}.xtool`;
      expect(marketResourceUrl(base, path).href).toBe(`https://jupiterben.github.io/xtools-market/${path}`);
    }
    expect(marketResourceUrl('http://127.0.0.1:1430/nested', 'catalog.json').href).toBe('http://127.0.0.1:1430/nested/catalog.json');
  });
  it('rejects untrusted transport, absolute paths, traversal and credentials', () => {
    for (const path of ['../catalog.json', '/catalog.json', 'https://other.example/catalog.json', 'packages/bad.xtool']) {
      expect(() => marketResourceUrl('https://example.com/market/', path)).toThrow();
    }
    for (const base of ['http://example.com/', 'https://user:password@example.com/', 'https://example.com/?token=x', 'https://example.com/#x']) {
      expect(() => marketResourceUrl(base, 'catalog.json')).toThrow();
    }
  });
  it('verifies the independent service catalog', () => {
    expect(latestReleases(verifyCatalog(envelope).catalog)).toHaveLength(8);
  });
  it('rejects changed metadata even if the package hash has not changed', () => {
    expect(() => verifyCatalog({ ...envelope, payload: envelope.payload.replace('JSON 工作室', 'Untrusted') })).toThrow('签名');
  });
  it('selects versions numerically, including multi-digit majors', () => {
    const { catalog } = verifyCatalog(envelope);
    const base = catalog.releases[0];
    const releases = ['2.0.0', '10.0.0', '1.0.0'].map((version) => ({ ...base, manifest: { ...base.manifest, version } }));
    expect(latestReleases({ ...catalog, releases })[0].manifest.version).toBe('10.0.0');
  });
});
