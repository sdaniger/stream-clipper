import { test, expect } from '@playwright/test';

test('candidate list modal opens without crash (Rules of Hooks regression)', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 });

  await page.locator('button:has-text("取り込みを開く")').click();
  await expect(page.locator('button:has-text("チャットを解析して候補を追加")')).toBeVisible();

  await page.locator('button:has-text("チャットを解析して候補を追加")').click();

  // Wait for a Preview button to appear in the grid (proves a candidate was added).
  const previewBtn = page.locator('button[aria-label^="Preview"]').first();
  await expect(previewBtn).toBeVisible({ timeout: 5000 });
  await previewBtn.click();

  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  await expect(dialog.locator('button:has-text("閉じる")')).toBeVisible();

  const reactErrors = pageErrors.filter((e) =>
    /Rendered fewer hooks|hooks than expected|hook order|invalid hook call/i.test(e)
  );
  expect(reactErrors, `Rules of Hooks errors: ${JSON.stringify(reactErrors)}`).toEqual([]);

  expect(pageErrors, `Page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);

  await dialog.screenshot({ path: 'tests/modal-after-import.png' });

  console.log(`Captured ${pageErrors.length} pageerror(s), ${consoleErrors.length} console error(s)`);
  if (pageErrors.length > 0) {
    console.log('Page errors:', JSON.stringify(pageErrors, null, 2));
  }
  if (consoleErrors.length > 0) {
    console.log('Console errors:', JSON.stringify(consoleErrors.slice(0, 5), null, 2));
  }
});
