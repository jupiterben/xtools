import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.route('https://jupiterben.github.io/xtools-market/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/xtools-market/catalog.json') {
      return route.fulfill({ contentType: 'application/json', body: await readFile('tests/fixtures/market/catalog.json', 'utf8') });
    }
    const sha = path.replace('/xtools-market/packages/', '').replace(/\.xtool$/, '');
    if (/^[a-f0-9]{64}$/.test(sha)) {
      return route.fulfill({ contentType: 'application/octet-stream', body: await readFile(`tests/fixtures/market/packages/${sha}.html`) });
    }
    return route.fulfill({ status: 404 });
  });
});

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '我的工具', exact: true })).toBeVisible();
}
async function install(page: Page, id: string) {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '工具市场' }).click();
  await page.getByTestId(`card-${id}`).getByRole('button', { name: '安装', exact: true }).click();
  await expect(page.getByTestId(`card-${id}`).getByRole('button', { name: /^打开/ })).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('installs, executes in a sandbox, persists, disables, and uninstalls a tool', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await install(page, 'uuid');
  await page.getByTestId('card-uuid').getByRole('button', { name: /^打开/ }).click();
  const frame = page.frameLocator('iframe');
  await expect(frame.getByLabel('输出', { exact: true })).toHaveValue(/[0-9a-f]{8}-/);
  await frame.getByLabel('输入', { exact: true }).fill('3');
  await frame.getByRole('button', { name: '运行', exact: true }).click();
  await expect(frame.getByLabel('输出', { exact: true })).toHaveValue(/^[^\n]+\n[^\n]+\n[^\n]+$/);
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
  const child = page.frames().find((item) => item.parentFrame());
  expect(await child!.evaluate(() => {
    try { void parent.document.body; return false; } catch { return true; }
  })).toBe(true);
  await page.reload();
  await expect(page.getByTestId('card-uuid')).toBeVisible();
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await page.getByLabel('启用UUID 生成器').uncheck();
  const row = page.getByTestId('card-uuid');
  await expect(row.getByRole('button', { name: /^打开/ })).toBeDisabled();
  await page.getByRole('button', { name: '卸载UUID 生成器' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认卸载' }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('card-uuid')).toHaveCount(0);
  await page.getByRole('navigation', { name: '应用导航' }).getByRole('button', { name: '任务记录' }).click();
  await expect(page.locator('.task-row')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('JSON formatting and error recovery work inside the isolated runtime', async ({ page }) => {
  await ready(page);
  await page.getByTestId('card-json').getByRole('button', { name: /^打开/ }).click();
  const frame = page.frameLocator('iframe');
  await expect(frame.getByLabel('输出', { exact: true })).toHaveValue(/"project": "XTools"/);
  await frame.getByLabel('输入', { exact: true }).fill('{"hello":"world"}');
  await frame.getByRole('button', { name: '运行', exact: true }).click();
  await expect(frame.getByLabel('输出', { exact: true })).toHaveValue('{\n  "hello": "world"\n}');
  await frame.getByLabel('输入', { exact: true }).fill('{broken');
  await frame.getByRole('button', { name: '运行', exact: true }).click();
  await expect(frame.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '复制结果' })).toBeDisabled();
  await frame.getByRole('button', { name: '载入示例' }).click();
  await expect(frame.getByRole('alert')).toBeHidden();
  await expect(frame.getByLabel('输出', { exact: true })).toHaveValue(/"project": "XTools"/);
});

test('search, favorites, themes, and mobile layout', async ({ page }) => {
  await ready(page);
  await page.getByLabel('搜索工具').fill('not-found');
  await expect(page.getByRole('heading', { name: '没有找到匹配的工具' })).toBeVisible();
  await page.getByRole('button', { name: '重置筛选' }).click();
  await page.getByRole('button', { name: '收藏Base64 编解码', exact: true }).click();
  await page.getByRole('button', { name: '只看收藏' }).click();
  await expect(page.locator('.tool-card')).toHaveCount(2);
  await page.getByRole('navigation', { name: '应用导航' }).getByRole('button', { name: '设置' }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('card-json')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('rejects a corrupted installed package without executing it', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('xtools-v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction('packages', 'readwrite');
        tx.objectStore('packages').put({ html: '<script>throw new Error("unsafe")</script>', sha256: 'wrong' }, 'json');
        tx.oncomplete = () => { request.result.close(); resolve(); };
      };
    });
  });
  await page.getByTestId('card-json').getByRole('button', { name: /^打开/ }).click();
  await expect(page.getByRole('alert')).toContainText('损坏');
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('regex time limit leaves the host responsive', async ({ page }) => {
  await ready(page);
  await install(page, 'regex');
  await page.getByTestId('card-regex').getByRole('button', { name: /^打开/ }).click();
  const frame = page.frameLocator('iframe');
  await expect(frame.getByLabel('输出', { exact: true })).not.toHaveValue('');
  await frame.getByLabel('表达式', { exact: true }).fill('(a+)+$');
  await frame.getByLabel('输入', { exact: true }).fill(`${'a'.repeat(40)}!`);
  await frame.getByRole('button', { name: '运行', exact: true }).click();
  await expect(frame.getByRole('alert')).toContainText('处理超时', { timeout: 5000 });
  await page.getByRole('button', { name: '返回工具列表' }).click();
  await expect(page.getByRole('heading', { name: '工具市场' })).toBeVisible();
});

test('all remaining tools process their sample inputs', async ({ page }) => {
  await ready(page);
  for (const id of ['base64', 'timestamp', 'url', 'hash', 'diff']) {
    if (!['base64', 'timestamp'].includes(id)) {
      await install(page, id);
      await page.getByTestId(`card-${id}`).getByRole('button', { name: /^打开/ }).click();
    } else {
      await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的工具', exact: true }).click();
      await page.getByTestId(`card-${id}`).getByRole('button', { name: /^打开/ }).click();
    }
    const frame = page.frameLocator('iframe');
    await expect(frame.getByLabel('输出', { exact: true })).not.toHaveValue('');
    await expect(frame.getByRole('alert')).toBeHidden();
    if (id === 'hash') {
      await frame.getByLabel('输入', { exact: true }).fill('abc');
      await frame.getByRole('button', { name: '运行', exact: true }).click();
      await expect(frame.getByLabel('输出', { exact: true })).toHaveValue('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    }
    await page.getByRole('button', { name: '返回工具列表' }).click();
  }
});

test('recovers from first-run package failure and records failed installs', async ({ page }) => {
  await page.route('**/runtime/tool.html', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '工作空间未能载入' })).toBeVisible();
  await page.unroute('**/runtime/tool.html');
  await page.getByRole('button', { name: '重新尝试' }).click();
  await expect(page.getByRole('heading', { name: '我的工具', exact: true })).toBeVisible();
  await page.route('**/packages/*.xtool', (route) => route.fulfill({ status: 200, body: 'corrupt bundle' }));
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '工具市场' }).click();
  await page.getByTestId('card-hash').getByRole('button', { name: '安装', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('完整性校验失败');
  await page.getByRole('navigation', { name: '应用导航' }).getByRole('button', { name: '任务记录' }).click();
  await expect(page.locator('.task-row')).toHaveCount(1);
  await expect(page.locator('.task-row')).toContainText('失败');
});

test('market outage keeps installed tools available and signed cache visible', async ({ page }) => {
  await ready(page);
  await install(page, 'uuid');
  await page.route('https://jupiterben.github.io/xtools-market/**', (route) => route.abort());
  await page.reload();
  await expect(page.getByTestId('card-uuid')).toBeVisible();
  await page.getByRole('button', { name: '打开UUID 生成器' }).click();
  await expect(page.frameLocator('iframe').getByLabel('输出', { exact: true })).toHaveValue(/[0-9a-f]{8}-/);
  await page.getByRole('button', { name: '返回工具列表' }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '工具市场' }).click();
  await expect(page.locator('.market-error')).toContainText('缓存目录');
  await expect(page.getByTestId('card-hash')).toBeVisible();
});

test('rejects unsigned market metadata', async ({ page }) => {
  await ready(page);
  await page.route('**/xtools-market/catalog.json', (route) => route.fulfill({
    json: { payload: '{"schemaVersion":1,"releases":[]}', signature: '0'.repeat(128) },
  }));
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '工具市场' }).click();
  await expect(page.locator('.market-error')).toContainText('签名验证失败');
  await expect(page.locator('.tool-card')).toHaveCount(0);
});

test('minimal navigation, keyboard open and return preserve the search', async ({ page }) => {
  await ready(page);
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button')).toHaveCount(2);
  await expect(page.locator('.sidebar, .overview-strip, .workspace-bottom')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await expect(page.getByLabel('搜索工具')).toBeFocused();
  await page.getByLabel('搜索工具').fill('json');
  await page.keyboard.press('Enter');
  await expect(page.frameLocator('iframe').getByLabel('输出', { exact: true })).toHaveValue(/"project": "XTools"/);
  await page.getByRole('button', { name: '返回工具列表' }).click();
  await expect(page.getByLabel('搜索工具')).toHaveValue('json');
  await expect(page.getByRole('button', { name: '打开JSON 工作室' })).toBeFocused();
});

test('market category and detail views, safe uninstall cancellation', async ({ page }) => {
  await ready(page);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '工具市场' }).click();
  await page.getByLabel('工具分类').selectOption('文本工具');
  await expect(page.locator('.tool-card')).toHaveCount(2);
  await page.getByRole('button', { name: '正则表达式详情', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('无需系统权限');
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的工具' }).click();
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await page.getByRole('button', { name: '卸载JSON 工作室' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByTestId('card-json')).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '卸载JSON 工作室' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开JSON 工作室' })).toBeEnabled();
});

test('card grids, market and management fit narrow and desktop windows', async ({ page }) => {
  await ready(page);
  for (const [width, expectedColumns] of [[320, 1], [390, 1], [520, 2], [600, 2], [768, 3], [1024, 4], [1320, 5], [1440, 5], [1920, 6]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的工具' }).click();
    await expect(page.getByTestId('card-json')).toBeVisible();
    const columns = await page.locator('.tool-grid').evaluate((grid) =>
      getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(expectedColumns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.logs/ux-library-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '管理', exact: true }).click();
    await expect(page.getByRole('button', { name: '卸载JSON 工作室' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '工具市场' }).click();
    await expect(page.getByTestId('card-url').getByRole('button', { name: '安装', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overlapping = await page.locator('.tool-card').evaluateAll((cards) => cards.some((card) => {
      const main = card.querySelector('.tool-main')!.getBoundingClientRect();
      const actions = card.querySelector('.tool-actions')!.getBoundingClientRect();
      return main.right > actions.left + 1 && main.bottom > actions.top + 1;
    }));
    expect(overlapping).toBe(false);
    await page.screenshot({ path: `.logs/ux-market-${width}.png`, fullPage: true });
  }
});

test('compact grid fits a large library and keeps card geometry stable', async ({ page }) => {
  await ready(page);
  const envelope = JSON.parse(await readFile('tests/fixtures/market/catalog.json', 'utf8'));
  const { releases } = JSON.parse(envelope.payload);
  await page.evaluate(async (manifests) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('xtools-v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('state', 'readwrite');
        const store = tx.objectStore('state');
        const stateRequest = store.get('app');
        stateRequest.onsuccess = () => {
          const state = stateRequest.result;
          state.installed = Array.from({ length: 36 }, (_, index) => {
            const original = manifests[index % manifests.length];
            const manifest = { ...original, id: `${original.id}-fixture-${index}`, name: `${original.name} ${index + 1}` };
            return { id: manifest.id, version: manifest.version, manifest, installedAt: index, lastOpenedAt: null, favorite: false, enabled: true };
          });
          store.put(state, 'app');
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }, releases.map((release: { manifest: Record<string, unknown> }) => release.manifest));
  await page.setViewportSize({ width: 1320, height: 900 });
  await page.reload();
  await expect(page.locator('.tool-card')).toHaveCount(36);
  const geometry = () => page.locator('.tool-card').evaluateAll((cards) => cards.map((card) => {
    const { x, y, width, height, bottom } = card.getBoundingClientRect();
    return { x, y, width, height, bottom };
  }));
  const before = await geometry();
  expect(before.filter((card) => card.y >= 0 && card.bottom <= 900).length).toBeGreaterThanOrEqual(20);
  expect(Math.max(...before.map((card) => card.height))).toBeLessThanOrEqual(140);
  await page.locator('.tool-main').first().hover();
  expect(await geometry()).toEqual(before);
  await page.screenshot({ path: '.logs/density-library-36-light.png' });
  await page.getByRole('button', { name: '管理', exact: true }).click();
  expect((await geometry()).map(({ width, height }) => ({ width, height }))).toEqual(before.map(({ width, height }) => ({ width, height })));
  await page.locator('.tool-actions .toggle input').first().uncheck();
  await expect(page.locator('.tool-main').first()).toBeDisabled();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('navigation', { name: '应用导航' }).getByRole('button', { name: '设置' }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的工具' }).click();
  await page.screenshot({ path: '.logs/density-library-36-dark.png' });
  await page.getByLabel('搜索工具').fill('UUID');
  await expect(page.locator('.tool-card')).toHaveCount(4);
  await page.getByRole('button', { name: '清除搜索' }).click();
  await expect(page.locator('.tool-card')).toHaveCount(36);
});

test('long names wrap and full descriptions remain available in compact cards', async ({ page }) => {
  await ready(page);
  const name = 'VeryLongUnbrokenToolName'.repeat(3);
  const description = '完整工具描述，包含用途和处理限制。'.repeat(20);
  const envelope = JSON.parse(await readFile('tests/fixtures/market/catalog.json', 'utf8'));
  const manifest = { ...JSON.parse(envelope.payload).releases[0].manifest, name, description };
  await page.evaluate(async (manifest) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('xtools-v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('state', 'readwrite');
        const store = tx.objectStore('state');
        const stateRequest = store.get('app');
        stateRequest.onsuccess = () => {
          const state = stateRequest.result;
          state.installed[0].manifest = { ...manifest, id: state.installed[0].id };
          store.put(state, 'app');
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }, manifest);
  await page.reload();
  for (const width of [320, 520, 768, 1320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.tool-copy strong').first()).toHaveText(name);
    expect(await page.locator('.tool-card').first().evaluate((card) => {
      return [...card.querySelectorAll('.tool-copy, strong, .tool-actions')].every((element) =>
        element.scrollWidth <= element.clientWidth);
    })).toBe(true);
    await page.getByRole('button', { name: `${name}详情`, exact: true }).click();
    await expect(page.locator('.detail-description')).toHaveText(description);
    expect(await page.getByRole('dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
  }
});
