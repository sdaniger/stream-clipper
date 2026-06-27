import { test, expect } from '@playwright/test';

test('network error mid-stream shows a friendly Japanese message', async ({ page }) => {
  // Stub the SSE endpoint so the stream opens and then the connection
  // is aborted, simulating a real "network error" mid-pipeline.
  await page.route('**/api/archive/analyze/stream', async (route) => {
    const body = JSON.stringify({
      stage: 'chat',
      status: 'running',
      message: 'Fetching chat... 100 / 5000 messages'
    });
    // Open a stream-like response, send one event, then close abruptly.
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      },
      body: `event: progress\ndata: ${body}\n\n`
    });
  });

  // Also intercept the analyze endpoint to short-circuit to a network error
  await page.route('**/api/archive/analyze/stream', async (route) => {
    await route.abort('failed');
  }, { times: 1 });

  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('button:has-text("パイプラインを開く")').click();
  await page.locator('input[placeholder*="twitch"]').fill('https://www.twitch.tv/videos/2802697956');
  await page.locator('button:has-text("パイプライン実行")').click();

  // The friendly Japanese network error message should be shown — never
  // the raw "network error" or "fetch failed" from the browser.
  await expect(page.getByText('ネットワーク接続が切断されました')).toBeVisible({ timeout: 15000 });
  // The raw "network error" / "fetch failed" string should NOT be shown
  await expect(page.locator('text=/^network error$/i')).toHaveCount(0);
  await expect(page.locator('text=/^TypeError: fetch failed$/i')).toHaveCount(0);
});
