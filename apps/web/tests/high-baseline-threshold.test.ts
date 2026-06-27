/**
 * Regression test for the percentile-based highlight detection threshold.
 * Run with: npx tsx tests/high-baseline-threshold.test.ts
 *
 * The OLD logic was `max(6, median*2.2, avg*1.6)` which broke for streams
 * with consistent high chat activity (e.g. 28K messages / 4 hours): the
 * threshold would balloon to 130+ msg/30s, requiring 260+ msg/min spikes
 * to trigger — which essentially never happens in real streams.
 *
 * The NEW logic uses the 90th percentile of bucket counts, which auto-adapts
 * to any chat density.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ----- Mirror of the relevant logic in chat-analysis.ts -----
// We only test the threshold + highlight filter, not the full pipeline.
const WINDOW_SECONDS = 30;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

type Bucket = { entries: { message: string }[]; signalScore: number };

function computeThresholds(buckets: Bucket[]) {
  const counts = buckets.map((b) => b.entries.length);
  const sortedCounts = [...counts].sort((a, b) => a - b);
  const p90Index = Math.floor(sortedCounts.length * 0.9);
  const volumeThreshold = Math.max(4, sortedCounts[p90Index] ?? 0);
  const sortedSignals = buckets.map((b) => b.signalScore).sort((a, b) => a - b);
  const p90SignalIndex = Math.floor(sortedSignals.length * 0.9);
  const reactionThreshold = Math.max(10, sortedSignals[p90SignalIndex] ?? 0);
  return { volumeThreshold, reactionThreshold };
}

function oldThreshold(buckets: Bucket[]): number {
  const counts = buckets.map((b) => b.entries.length);
  return Math.max(6, median(counts) * 2.2, average(counts) * 1.6);
}

// Build synthetic buckets: high-baseline stream with two genuine spikes
function makeHighBaselineStream(): Bucket[] {
  // 480 buckets, baseline 50-80 msg/30s, two big spikes
  const buckets: Bucket[] = new Array(480).fill(0).map(() => {
    const count = 50 + Math.floor(Math.random() * 30);
    return {
      entries: Array.from({ length: count }, () => ({ message: "ｗｗ" })),
      signalScore: count * 1.5
    };
  });
  buckets[150] = { entries: Array.from({ length: 250 }, () => ({ message: "草草草" })), signalScore: 500 };
  buckets[300] = { entries: Array.from({ length: 200 }, () => ({ message: "草草草" })), signalScore: 400 };
  return buckets;
}

// Build synthetic buckets: low-activity stream with quiet periods and a small burst
function makeLowActivityStream(): Bucket[] {
  const buckets: Bucket[] = new Array(480).fill(0).map(() => {
    const count = Math.random() < 0.1 ? 1 : 0;
    return { entries: Array.from({ length: count }, () => ({ message: "草" })), signalScore: count };
  });
  buckets[100] = { entries: Array.from({ length: 15 }, () => ({ message: "草草草" })), signalScore: 30 };
  buckets[300] = { entries: Array.from({ length: 8 }, () => ({ message: "草草草" })), signalScore: 16 };
  return buckets;
}

test('regression: high-baseline stream with 28K messages no longer returns 0 candidates', () => {
  const buckets = makeHighBaselineStream();
  const totalMessages = buckets.reduce((s, b) => s + b.entries.length, 0);
  assert.ok(totalMessages > 10000, 'should have high message count');

  const oldT = oldThreshold(buckets);
  const { volumeThreshold: newT } = computeThresholds(buckets);

  // OLD threshold: would be ~130+ msg/30s, both spikes (200, 250) would still
  // be caught because they're extreme. But for many real streams the
  // threshold is unreachable — that's the bug.
  console.log(`  High-baseline: total=${totalMessages} msgs, OLD threshold=${oldT.toFixed(1)}, NEW threshold=${newT}`);

  // NEW threshold should be much lower and reachable
  assert.ok(newT < 100, `new threshold should be below 100, got ${newT}`);
  assert.ok(newT >= 4, `new threshold should be at least 4 (minimum), got ${newT}`);

  // Both spike buckets (200, 250) should be highlighted
  const spike150 = buckets[150].entries.length;
  const spike300 = buckets[300].entries.length;
  assert.ok(spike150 >= newT, `spike at 150 (${spike150}) should be >= new threshold (${newT})`);
  assert.ok(spike300 >= newT, `spike at 300 (${spike300}) should be >= new threshold (${newT})`);
});

test('regression: low-activity stream still catches small spikes', () => {
  const buckets = makeLowActivityStream();
  const totalMessages = buckets.reduce((s, b) => s + b.entries.length, 0);
  assert.ok(totalMessages < 1000, 'should have low message count');

  const { volumeThreshold: newT } = computeThresholds(buckets);
  console.log(`  Low-activity: total=${totalMessages} msgs, NEW threshold=${newT}`);

  // The minimum is 4, so a spike of 15 will easily exceed it
  const spike100 = buckets[100].entries.length;
  assert.ok(spike100 >= newT, `spike at 100 (${spike100}) should be >= new threshold (${newT})`);
});

test('percentile threshold auto-adapts to distribution', () => {
  // Stream with moderate chat (avg 10/30s)
  const buckets: Bucket[] = new Array(480).fill(0).map(() => {
    const count = 5 + Math.floor(Math.random() * 10); // 5-15
    return { entries: Array.from({ length: count }, () => ({ message: "w" })), signalScore: count };
  });
  buckets[200] = { entries: Array.from({ length: 50 }, () => ({ message: "w" })), signalScore: 100 };

  const { volumeThreshold: newT } = computeThresholds(buckets);
  console.log(`  Moderate: NEW threshold=${newT}, spike bucket size=${buckets[200].entries.length}`);

  // Should be roughly the 90th percentile (around 13-15)
  assert.ok(newT >= 10, `moderate stream threshold should be >= 10, got ${newT}`);
  assert.ok(newT <= 20, `moderate stream threshold should be <= 20, got ${newT}`);
  assert.ok(buckets[200].entries.length >= newT, 'spike should be caught');
});

test('minimum threshold of 4 prevents detection collapse on mostly-empty streams', () => {
  // Stream where 95% of buckets are empty
  const buckets: Bucket[] = new Array(480).fill(0).map(() => ({
    entries: [],
    signalScore: 0
  }));
  buckets[100] = { entries: Array.from({ length: 3 }, () => ({ message: "草" })), signalScore: 6 };

  const { volumeThreshold: newT } = computeThresholds(buckets);
  console.log(`  Mostly-empty: NEW threshold=${newT}`);

  // p90 would be 0 but min is 4, so 3-msg spike won't trigger (correct: too small to be a highlight)
  assert.equal(newT, 4, 'minimum should be 4 for mostly-empty streams');
});
