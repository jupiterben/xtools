import { chromium, expect } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
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
const execFileAsync = promisify(execFile);
const process = spawn(executable, ['xtools://install?id=uuid'], {
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
  const detail = page.getByRole('dialog');
  await expect(detail).toContainText('UUID 生成器', { timeout: 20000 });
  await expect(detail.getByRole('button', { name: '安装工具', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的工具' }).click();
  await expect(page.getByTestId('card-uuid')).toHaveCount(0);
  await page.getByRole('navigation', { name: '应用导航' }).getByRole('button', { name: '设置' }).click();
  await expect(page.getByTestId('runtime-mode')).toContainText('桌面版');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的工具' }).click();
  await page.getByRole('button', { name: '管理分组', exact: true }).click();
  await page.getByLabel('新分组名称', { exact: true }).fill('原生分组');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByRole('button', { name: '重命名原生分组', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await page.getByLabel('选择JSON 工作室', { exact: true }).check();
  await page.getByLabel('选择Base64 编解码', { exact: true }).check();
  await page.getByLabel('目标分组').selectOption({ label: '原生分组' });
  await page.getByRole('button', { name: '移动到分组', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已移动 2 个工具');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByLabel('工具分组').selectOption({ label: '原生分组 (2)' });
  await expect(page.locator('.tool-card')).toHaveCount(2);
  await page.getByRole('button', { name: '管理分组', exact: true }).click();
  await page.getByRole('button', { name: '重命名原生分组', exact: true }).click();
  await page.getByRole('textbox', { name: '重命名原生分组', exact: true }).fill('常用工具');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await page.getByRole('button', { name: '删除常用工具', exact: true }).click();
  await page.getByRole('button', { name: '确认删除分组', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除常用工具', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.tool-card')).toHaveCount(3);
  await page.getByTestId('card-json').getByRole('button', { name: /^打开/ }).click();
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('输出', { exact: true }).waitFor();
  await expect(frame.getByLabel('输出', { exact: true })).toHaveValue(/"project": "XTools"/);
  await page.getByRole('button', { name: '返回工具列表' }).click();
  await execFileAsync(executable, ['xtools://install?id=hash&source=https://evil.test'], { windowsHide: true, timeout: 10000 });
  await expect(page.getByRole('alert')).toContainText('无效的工具安装链接');
  await expect(detail).toHaveCount(0);
  await execFileAsync(executable, ['xtools://install?id=not-in-catalog'], { windowsHide: true, timeout: 10000 });
  await expect(page.getByRole('alert')).toContainText('工具不在受信任的市场目录中');
  await expect(detail).toHaveCount(0);
  // Exercise the actual Windows protocol association and warm single-instance delivery.
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Start-Process 'xtools://install?id=hash'"], { windowsHide: true, timeout: 10000 });
  await expect(detail).toContainText('哈希', { timeout: 20000 });
  await detail.getByRole('button', { name: '安装工具', exact: true }).click();
  await detail.getByRole('button', { name: '打开工具', exact: true }).click();
  await frame.getByLabel('输入', { exact: true }).fill('abc');
  await frame.getByRole('button', { name: '运行', exact: true }).click();
  await expect(frame.getByLabel('输出', { exact: true })).toHaveValue('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  await mkdir('.logs', { recursive: true });
  await page.screenshot({ path: '.logs/native-hash.png' });
  assert.deepEqual(errors, []);
  console.log('Native smoke passed: group CRUD and batch moves via SQLite, cold/warm deep links, Windows protocol registration, invalid links rejected, explicit install confirmation, SQLite install, sandboxed JSON and SHA-256, no page errors.');
  console.log(`Isolated test database: ${directory}`);
} finally {
  if (browser) await browser.close();
  process.kill();
}
