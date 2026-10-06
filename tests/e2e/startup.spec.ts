import { expect, test } from '@playwright/test';

test('shows startup content before application modules load, then removes it', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/src/App.svelte', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#startup')).toBeVisible();
    await expect(page.locator('#startup-message')).toHaveText('正在启动...');
    await page.screenshot({ path: 'test-results/startup-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#startup')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/startup-mobile.png' });
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { name: '我的工具', exact: true })).toBeVisible();
  await expect(page.locator('#startup')).toHaveCount(0);
});

test('offers reload when application modules fail and recovers', async ({ page }) => {
  await page.route('**/src/App.svelte', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#startup-message')).toHaveText('启动失败，请重新加载');
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible();
  await page.unroute('**/src/App.svelte');
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByRole('heading', { name: '我的工具', exact: true })).toBeVisible();
  await expect(page.locator('#startup')).toHaveCount(0);
});

test('offers reload when the entry script never starts', async ({ page }) => {
  await page.clock.install();
  await page.route('**/src/main.ts', (route) => route.abort());
  await page.goto('/');
  await page.clock.fastForward(15000);
  await expect(page.locator('#startup-message')).toHaveText('启动时间较长，请稍候或重新加载');
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible();
});
