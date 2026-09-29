import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';

const directory = await mkdtemp(join(tmpdir(), 'xtools-smoke-'));
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});
const executable = resolve('apps/desktop/src-tauri/target/debug/xtools.exe');
const process = spawn(executable, [], {
  windowsHide: true,
  stdio: 'pipe',
  env: {
    ...globalThis.process.env,
    XTOOLS_TEST_DATA_DIR: directory,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
});
let browser;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (process.exitCode !== null) throw new Error(`Desktop exited with code ${process.exitCode}`);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  assert(browser, 'WebView2 debugging endpoint did not start');
  let page;
  for (let attempt = 0; attempt < 40; attempt++) {
    page = browser.contexts().flatMap((context) => context.pages()).find((page) => !page.url().startsWith('devtools:'));
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(page, 'No WebView2 page found');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: '我的工具', exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole('navigation', { name: '应用导航' }).getByRole('button', { name: '设置' }).click();
  await expect(page.getByTestId('runtime-mode')).toContainText('桌面版');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的工具' }).click();
  await page.getByTestId('card-json').getByRole('button', { name: /^打开/ }).click();
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('输出', { exact: true }).waitFor();
  await expect(frame.getByLabel('输出', { exact: true })).toHaveValue(/"project": "XTools"/);
  await page.getByRole('button', { name: '返回工具列表' }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '工具市场' }).click();
  await page.getByTestId('card-hash').getByRole('button', { name: '安装', exact: true }).click();
  await page.getByTestId('card-hash').getByRole('button', { name: /^打开/ }).click();
  await frame.getByLabel('输入', { exact: true }).fill('abc');
  await frame.getByRole('button', { name: '运行', exact: true }).click();
  await expect(frame.getByLabel('输出', { exact: true })).toHaveValue('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  await mkdir('.logs', { recursive: true });
  await page.screenshot({ path: '.logs/native-hash.png' });
  assert.deepEqual(errors, []);
  console.log('Native smoke passed: embedded UI, SQLite install, sandboxed JSON and SHA-256, no page errors.');
  console.log(`Isolated test database: ${directory}`);
} finally {
  if (browser) await browser.close();
  process.kill();
}
