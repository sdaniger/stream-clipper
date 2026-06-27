/**
 * Regression test for the concurrency limiter.
 * Run with: npx tsx tests/concurrency.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLimiter } from '../lib/concurrency';

test('runs tasks sequentially when concurrency=1', async () => {
  const limit = createLimiter(1);
  const order: number[] = [];
  const tasks = [0, 1, 2, 3].map((i) =>
    limit(async () => {
      order.push(i);
      await new Promise((r) => setTimeout(r, 5));
    })
  );
  await Promise.all(tasks);
  assert.deepEqual(order, [0, 1, 2, 3]);
});

test('respects concurrency limit', async () => {
  const limit = createLimiter(2);
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 6 }, () =>
    limit(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
    })
  );
  await Promise.all(tasks);
  assert.ok(peak <= 2, `peak concurrency ${peak} should be <= 2`);
  assert.ok(peak >= 1, 'should have at least 1 active task');
});

test('propagates errors without leaking slots', async () => {
  const limit = createLimiter(2);
  const tasks: Array<Promise<unknown>> = [
    limit(async () => {
      throw new Error('boom');
    }),
    limit(async () => 1),
    limit(async () => 2),
  ];
  const results = await Promise.allSettled(tasks);
  assert.equal(results[0].status, 'rejected');
  assert.equal((results[0] as PromiseRejectedResult).reason.message, 'boom');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(results[2].status, 'fulfilled');
});

test('throws on invalid concurrency', () => {
  assert.throws(() => createLimiter(0), /concurrency must be >= 1/);
  assert.throws(() => createLimiter(-1), /concurrency must be >= 1/);
});

test('queues and drains correctly when overloaded', async () => {
  const limit = createLimiter(2);
  let inFlight = 0;
  let maxInFlight = 0;
  const tasks = Array.from({ length: 20 }, (_, i) =>
    limit(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      return i;
    })
  );
  const results = await Promise.all(tasks);
  assert.equal(results.length, 20);
  assert.ok(maxInFlight <= 2);
  assert.equal(inFlight, 0, 'all tasks should be drained');
});
