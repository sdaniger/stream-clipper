import { test, expect } from '@playwright/test';

// Clear any saved candidates before each test so results are deterministic.
test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.localStorage.removeItem('stream-clipper:candidates:v1'));
});

test('candidates persist across page reload', async ({ page }) => {
  // Open the chat JSON import panel
  await page.locator('button:has-text("取り込みを開く")').click({ timeout: 15000 });
  await expect(page.locator('button:has-text("チャットを解析して候補を追加")')).toBeVisible({ timeout: 10000 });

  // Import the bundled sample chat JSON — this adds candidates and triggers
  // the "新規" badge animation on the imported cards.
  await page.locator('button:has-text("チャットを解析して候補を追加")').click();

  // The "新規" badge appears for 6s after import, which is plenty of time
  // to use it as a "we just imported" signal.
  await expect(page.locator('text=新規').first()).toBeVisible({ timeout: 10000 });

  // Pull the truth from localStorage directly: that's the source of truth
  // we care about, not the filtered DOM count.
  await page.waitForTimeout(2000);
  const storedBefore = await page.evaluate(() => window.localStorage.getItem('stream-clipper:candidates:v1'));
  expect(storedBefore).not.toBeNull();
  const parsedBefore = JSON.parse(storedBefore!);
  expect(parsedBefore.version).toBe(1);
  expect(parsedBefore.candidates.length).toBeGreaterThan(0);
  const savedCount = parsedBefore.candidates.length;

  // Reload the page
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Wait for the page to mount and restore the saved list
  await expect(page.locator('button[aria-label^="Preview"]').first()).toBeVisible({ timeout: 10000 });

  // After reload, the storage payload should be byte-identical (it isn't
  // mutated just by rendering). This is the strongest persistence guarantee:
  // whatever we saved is what comes back.
  const storedAfter = await page.evaluate(() => window.localStorage.getItem('stream-clipper:candidates:v1'));
  expect(storedAfter).toBe(storedBefore);
  const parsedAfter = JSON.parse(storedAfter!);
  expect(parsedAfter.candidates.length).toBe(savedCount);
});

test('storage key is present and well-formed after import', async ({ page }) => {
  await page.locator('button:has-text("取り込みを開く")').click({ timeout: 15000 });
  await page.locator('button:has-text("チャットを解析して候補を追加")').click();
  await page.waitForTimeout(2000);

  const stored = await page.evaluate(() => window.localStorage.getItem('stream-clipper:candidates:v1'));
  expect(stored).not.toBeNull();

  const parsed = JSON.parse(stored!);
  expect(parsed).toHaveProperty('version', 1);
  expect(parsed).toHaveProperty('savedAt');
  expect(parsed).toHaveProperty('candidates');
  expect(new Date(parsed.savedAt).toString()).not.toBe('Invalid Date');
});

test('Reset button clears saved candidates', async ({ page }) => {
  // Auto-confirm the native confirm() dialog
  page.on('dialog', (dialog) => dialog.accept());

  // Import something first
  await page.locator('button:has-text("取り込みを開く")').click({ timeout: 15000 });
  await page.locator('button:has-text("チャットを解析して候補を追加")').click();
  await page.waitForTimeout(2000);

  // Confirm storage has data
  const before = await page.evaluate(() => window.localStorage.getItem('stream-clipper:candidates:v1'));
  expect(before).not.toBeNull();

  // Click Reset
  await page.locator('button:has-text("保存データを消去")').click();
  await page.waitForTimeout(500);

  // Storage should be cleared
  const after = await page.evaluate(() => window.localStorage.getItem('stream-clipper:candidates:v1'));
  expect(after).toBeNull();
});

