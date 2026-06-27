import { test, expect } from '@playwright/test';

test('archive panel shows cancel button while pipeline runs', async ({ page }) => {
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 });

  // Expand the archive panel
  await page.locator('button:has-text("パイプラインを開く")').click();

  // Confirm the new "maxMessages" select is present with the unlimited option
  const maxMessagesSelect = page.locator('select').filter({ hasText: '無制限' });
  await expect(maxMessagesSelect).toBeVisible();

  // Confirm the "auto open preview" checkbox is present
  const autoOpenCheckbox = page.locator('input[type="checkbox"]').nth(2);
  await expect(autoOpenCheckbox).toBeChecked();

  // Enter a URL and start the pipeline
  await page.locator('input[placeholder*="twitch"]').fill('https://www.twitch.tv/videos/2805967936');
  await page.locator('button:has-text("パイプライン実行")').click();

  // The cancel button should appear within a few seconds
  const cancelBtn = page.locator('button:has-text("キャンセル")');
  await expect(cancelBtn).toBeVisible({ timeout: 10000 });

  // Cancel the pipeline
  await cancelBtn.click();

  // The cancel-related status should be shown (either "cancelled" or "error" stage)
  await expect(page.locator('text=キャンセル').or(page.locator('text=キャンセルされました'))).toBeVisible({ timeout: 30000 });
});
