/**
 * Regression test for the yt-dlp progress regex.
 * Run with: npx tsx tests/yt-dlp-progress-regex.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirror the regex in apps/web/lib/server/yt-dlp-service.ts
const PROGRESS_RE = /\[download\]\s+([\d.]+)%\s+of\s+~?\s*(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)/;

const FIXTURES: Array<{ line: string; expected: { percent: string; total: string; speed: string; eta: string } | null }> = [
  {
    // Most common: estimate + space + size
    line: '[download]   0.0% of ~ 141.05MiB at    3.08KiB/s ETA Unknown (frag 0/402)',
    expected: { percent: '0.0', total: '141.05MiB', speed: '3.08KiB/s', eta: 'Unknown' }
  },
  {
    // No tilde (exact known size)
    line: '[download]  50.0% of  100.00MiB at  1.00MiB/s ETA 00:30',
    expected: { percent: '50.0', total: '100.00MiB', speed: '1.00MiB/s', eta: '00:30' }
  },
  {
    // 100% done
    line: '[download] 100.0% of   50.00MiB at  2.00MiB/s ETA 00:00',
    expected: { percent: '100.0', total: '50.00MiB', speed: '2.00MiB/s', eta: '00:00' }
  },
  {
    // Tilde directly attached to number (older format)
    line: '[download]  50.0% of ~50.00MiB at 1.00MiB/s ETA 00:30',
    expected: { percent: '50.0', total: '50.00MiB', speed: '1.00MiB/s', eta: '00:30' }
  },
  {
    // Real output with frag info appended
    line: '[download]   0.3% of ~ 140.73MiB at  773.56KiB/s ETA Unknown (frag 1/402)',
    expected: { percent: '0.3', total: '140.73MiB', speed: '773.56KiB/s', eta: 'Unknown' }
  },
  {
    // Non-matching line (no [download] prefix)
    line: '[info] v1234: Downloading 1 format(s): 160p',
    expected: null
  }
];

test('PROGRESS_RE matches all real yt-dlp output variations', () => {
  for (const fixture of FIXTURES) {
    const match = fixture.line.match(PROGRESS_RE);
    if (fixture.expected === null) {
      assert.equal(match, null, `expected no match for: ${fixture.line}`);
    } else {
      assert.notEqual(match, null, `expected match for: ${fixture.line}`);
      assert.equal(match![1], fixture.expected.percent, `percent mismatch: ${fixture.line}`);
      assert.equal(match![2], fixture.expected.total, `total mismatch: ${fixture.line}`);
      assert.equal(match![3], fixture.expected.speed, `speed mismatch: ${fixture.line}`);
      assert.equal(match![4], fixture.expected.eta, `eta mismatch: ${fixture.line}`);
    }
  }
});
