/**
 * Integration test: real analyzeChatEntries with percentile threshold
 * Verifies the actual fix using the real module via tsx.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChatEntries, type ChatLogEntry } from '../lib/chat-analysis';

// Suppress the [chat-analysis] debug log inside this test (it's noisy in TAP output).
(process.env as Record<string, string>).NODE_ENV = "test";

function makeEntriesForBucket(startSec: number, count: number, msg = "草草草"): ChatLogEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp_seconds: startSec + i % 30,
    author_name: `user${i}`,
    message: msg
  }));
}

test('real analyzeChatEntries: high-baseline stream now produces candidates', () => {
  // 480 buckets (4 hours), baseline 50-80/30s, two spikes at bucket 150 and 300
  const entries: ChatLogEntry[] = [];
  for (let b = 0; b < 480; b++) {
    const count = 50 + Math.floor(((b * 7) % 31)); // 50-80
    entries.push(...makeEntriesForBucket(b * 30, count, "ｗｗ"));
  }
  // Spike 1
  entries.push(...makeEntriesForBucket(150 * 30, 250, "草草草草草草"));
  // Spike 2
  entries.push(...makeEntriesForBucket(300 * 30, 200, "草草草草草草"));

  const result = analyzeChatEntries(entries, "test");
  console.log(`  Real test: analyzed ${result.summary.analyzedMessages} msgs, found ${result.summary.candidateCount} candidates`);
  console.log(`  Baseline: ${result.summary.baselinePerMinute}/min, Peak: ${result.summary.peakPerMinute}/min`);

  assert.equal(result.summary.analyzedMessages, entries.length);
  assert.ok(result.candidates.length > 0, 'should find at least one candidate in high-baseline stream with real spikes');
  assert.ok(result.candidates.length <= 6, 'should not exceed MAX_CANDIDATES (6)');
});

test('real analyzeChatEntries: low-activity stream still catches bursts', () => {
  // 480 buckets, mostly empty, two small bursts
  const entries: ChatLogEntry[] = [];
  for (let b = 0; b < 480; b++) {
    if (Math.random() < 0.05) {
      entries.push(...makeEntriesForBucket(b * 30, 1, "草"));
    }
  }
  // Add 15-msg burst at bucket 100
  entries.push(...makeEntriesForBucket(100 * 30, 15, "草草草草草草"));

  const result = analyzeChatEntries(entries, "test");
  console.log(`  Low-activity real test: ${result.summary.analyzedMessages} msgs, ${result.summary.candidateCount} candidates`);

  assert.ok(result.candidates.length > 0, 'should catch the 15-msg burst in quiet stream');
});

test('real analyzeChatEntries: empty input still returns 0 candidates (no crash)', () => {
  const result = analyzeChatEntries([], "test");
  assert.equal(result.candidates.length, 0);
  assert.equal(result.summary.candidateCount, 0);
});
