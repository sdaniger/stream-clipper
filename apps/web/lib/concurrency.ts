/**
 * Minimal concurrency limiter (no external deps).
 *
 * Usage:
 *   const limit = createLimiter(2);
 *   await Promise.all(tasks.map((t) => limit(() => t())));
 *
 * `limit(fn)` returns a Promise that resolves once `fn` is run and finishes.
 * At most `concurrency` callbacks run at the same time; the rest are queued.
 */
export type Limit = <T>(fn: () => Promise<T>) => Promise<T>;

export function createLimiter(concurrency: number): Limit {
  if (concurrency < 1) {
    throw new Error(`createLimiter: concurrency must be >= 1, got ${concurrency}`);
  }
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (!job) return;
    active += 1;
    job();
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active -= 1;
          next();
        });
      });
      next();
    });
  };
}
