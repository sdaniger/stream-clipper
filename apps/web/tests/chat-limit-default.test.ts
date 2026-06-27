/**
 * Regression test for the chat limit default calculation.
 * Run with: npx tsx tests/chat-limit-default.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirror defaultChatLimitForDuration from chat-downloader-service.ts:56-62
const PRACTICAL_MESSAGE_CAP = 100_000;
function defaultChatLimitForDuration(durationSeconds: number | null | undefined): number {
  if (!durationSeconds || durationSeconds <= 0) return 5000;
  const estimated = Math.ceil(durationSeconds * 7);
  return Math.max(1000, Math.min(PRACTICAL_MESSAGE_CAP, estimated));
}

test('defaultChatLimitForDuration returns 5000 for unknown duration', () => {
  assert.equal(defaultChatLimitForDuration(null), 5000);
  assert.equal(defaultChatLimitForDuration(undefined), 5000);
  assert.equal(defaultChatLimitForDuration(0), 5000);
  assert.equal(defaultChatLimitForDuration(-1), 5000);
});

test('defaultChatLimitForDuration respects the 1000-message floor', () => {
  // A 30-second VOD should still get at least 1000 messages.
  assert.equal(defaultChatLimitForDuration(30), 1000);
  assert.equal(defaultChatLimitForDuration(60), 1000);
});

test('defaultChatLimitForDuration scales linearly with duration', () => {
  // 1 hour = 3600s → 3600 * 7 = 25200
  assert.equal(defaultChatLimitForDuration(3600), 25200);
  // 30 minutes = 1800s → 1800 * 7 = 12600
  assert.equal(defaultChatLimitForDuration(1800), 12600);
});

test('defaultChatLimitForDuration caps at PRACTICAL_MESSAGE_CAP (100K)', () => {
  // 4 hours = 14400s → 100800 > 100K, must cap.
  assert.equal(defaultChatLimitForDuration(14400), PRACTICAL_MESSAGE_CAP);
  // 24 hours → still 100K
  assert.equal(defaultChatLimitForDuration(86400), PRACTICAL_MESSAGE_CAP);
});

test('defaultChatLimitForDuration returns an integer', () => {
  for (const d of [10, 100, 1000, 3600, 7200]) {
    const v = defaultChatLimitForDuration(d);
    assert.ok(Number.isInteger(v), `expected integer for duration=${d}, got ${v}`);
  }
});
