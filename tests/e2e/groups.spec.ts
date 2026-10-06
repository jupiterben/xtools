import { expect, test, type Page } from '@playwright/test';

async function createGroup(page: Page, name: string) {
  await page.getByRole('button', { name: '管理分组', exact: true }).click();
  await page.getByLabel('新分组名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByRole('button', { name: `重命名${name}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
}

test('groups support batch moves, combined filters, rename, deletion, and persistence', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('card-json')).toBeVisible();
  await createGroup(page, '常用');
  await createGroup(page, '项目 A');
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await page.getByLabel('选择JSON 工作室', { exact: true }).check();
  await page.getByLabel('选择Base64 编解码', { exact: true }).check();
  await expect(page.getByLabel('选择当前结果')).toHaveJSProperty('indeterminate', true);
  await page.getByLabel('目标分组').selectOption({ label: '常用' });
  await page.getByRole('button', { name: '移动到分组', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已移动 2 个工具');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByLabel('工具分组').selectOption({ label: '常用 (2)' });
  await expect(page.locator('.tool-card')).toHaveCount(2);
  await page.getByLabel('搜索工具').fill('base64');
  await expect(page.locator('.tool-card')).toHaveCount(1);
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await page.getByRole('button', { name: '只看收藏' }).click();
  await expect(page.locator('.tool-card')).toHaveCount(1);
  await expect(page.getByTestId('card-json')).toBeVisible();
  await page.getByRole('button', { name: '只看收藏' }).click();
  await page.getByRole('button', { name: '打开JSON 工作室', exact: true }).click();
  await page.getByRole('button', { name: '返回工具列表' }).click();
  await expect(page.locator('.tool-card')).toHaveCount(2);
  await page.reload();
  await page.getByLabel('工具分组').selectOption({ label: '常用 (2)' });
  await expect(page.locator('.tool-card')).toHaveCount(2);

  await page.getByRole('button', { name: '管理分组', exact: true }).click();
  await page.getByLabel('新分组名称', { exact: true }).fill('常用');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('分组名称已存在');
  await page.getByRole('button', { name: '重命名常用', exact: true }).click();
  await page.getByRole('textbox', { name: '重命名常用', exact: true }).fill('开发');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByRole('button', { name: '重命名开发', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除开发', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '重命名开发', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除开发', exact: true }).click();
  await page.getByRole('button', { name: '确认删除分组', exact: true }).click();
  await expect(page.getByRole('button', { name: '重命名开发', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByLabel('工具分组')).toHaveValue('');
  await page.getByLabel('工具分组').selectOption('ungrouped');
  await expect(page.locator('.tool-card')).toHaveCount(3);
  await page.getByLabel('工具分组').selectOption({ label: '项目 A (0)' });
  await expect(page.getByRole('heading', { name: '此分组暂无工具' })).toBeVisible();
  await page.getByRole('button', { name: '重置筛选' }).click();
  await expect(page.locator('.tool-card')).toHaveCount(3);
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await page.getByLabel('搜索工具').fill('json');
  await page.getByLabel('选择当前结果').check();
  await page.getByLabel('目标分组').selectOption({ label: '项目 A' });
  await page.getByRole('button', { name: '移动到分组', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已移动 1 个工具');
  await page.reload();
  await page.getByLabel('工具分组').selectOption({ label: '项目 A (1)' });
  await expect(page.getByTestId('card-json')).toBeVisible();
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await page.getByLabel('选择当前结果').check();
  await page.getByLabel('目标分组').selectOption('');
  await page.getByRole('button', { name: '移动到分组', exact: true }).click();
  await expect(page.locator('.tool-card')).toHaveCount(0);
  await page.reload();
  await page.getByLabel('工具分组').selectOption('ungrouped');
  await expect(page.locator('.tool-card')).toHaveCount(3);
});

test('old browser state gains groups without replacing installed tools', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('card-json')).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('xtools-v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('state', 'readwrite');
        const get = tx.objectStore('state').get('app');
        get.onsuccess = () => {
          const state = get.result;
          delete state.groups;
          state.installed = state.installed.filter((tool: { id: string }) => tool.id !== 'json');
          tx.objectStore('state').put(state, 'app');
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(page.locator('.tool-card')).toHaveCount(2);
  await expect(page.getByTestId('card-json')).toHaveCount(0);
  await createGroup(page, '迁移后分组');
  await page.reload();
  await page.getByLabel('工具分组').selectOption({ label: '迁移后分组 (0)' });
  await expect(page.getByRole('heading', { name: '此分组暂无工具' })).toBeVisible();
});

test('group controls fit narrow windows and long group names', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('card-json')).toBeVisible();
  await createGroup(page, '很长的项目分组名称'.repeat(4));
  for (const width of [320, 520, 768, 1320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: '管理', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.logs/groups-manage-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('button', { name: '管理分组', exact: true }).click();
    expect(await page.getByRole('dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    await page.screenshot({ path: `.logs/groups-dialog-${width}.png` });
    await page.keyboard.press('Escape');
  }
});
