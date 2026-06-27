/**
 * Regression test for the network error humanizer.
 * Run with: npx tsx tests/network-error-humanize.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirror humanizeError from archive-auto-panel.tsx
const NETWORK_PATTERNS = [
  'networkerror',
  'network error',
  'fetch failed',
  'failed to fetch',
  'connection reset',
  'connection aborted',
  'econnreset',
  'etimedout',
  'enetunreach'
];

const TIMEOUT_PATTERNS = ['timeout', 'timed out'];

function humanizeError(raw: string, t: (k: string) => string): string {
  if (!raw) return t('unknown');
  const lowered = raw.toLowerCase();
  if (NETWORK_PATTERNS.some((p) => lowered.includes(p))) {
    return t('network');
  }
  if (lowered.includes('aborted') || lowered.includes('aborterror')) {
    return t('cancelled');
  }
  if (TIMEOUT_PATTERNS.some((p) => lowered.includes(p))) {
    return t('timeout');
  }
  return raw;
}

const dict = {
  network: 'ネットワーク接続が切断されました。',
  cancelled: 'キャンセルされました。',
  timeout: 'タイムアウトしました。',
  unknown: '不明なエラー'
};

test('classifies "network error" as network error', () => {
  assert.equal(humanizeError('network error', (k) => dict[k as keyof typeof dict]), 'ネットワーク接続が切断されました。');
  assert.equal(humanizeError('NetworkError', (k) => dict[k as keyof typeof dict]), 'ネットワーク接続が切断されました。');
});

test('classifies "fetch failed" as network error', () => {
  assert.equal(humanizeError('fetch failed', (k) => dict[k as keyof typeof dict]), 'ネットワーク接続が切断されました。');
  assert.equal(humanizeError('TypeError: fetch failed', (k) => dict[k as keyof typeof dict]), 'ネットワーク接続が切断されました。');
});

test('classifies "failed to fetch" as network error', () => {
  assert.equal(humanizeError('failed to fetch', (k) => dict[k as keyof typeof dict]), 'ネットワーク接続が切断されました。');
});

test('classifies connection errors as network error', () => {
  assert.equal(humanizeError('Connection reset by peer', (k) => dict[k as keyof typeof dict]), 'ネットワーク接続が切断されました。');
  assert.equal(humanizeError('Connection aborted', (k) => dict[k as keyof typeof dict]), 'ネットワーク接続が切断されました。');
});

test('classifies ECONNRESET/ETIMEDOUT/ENETUNREACH as network error', () => {
  assert.equal(humanizeError('read ECONNRESET', (k) => dict[k as keyof typeof dict]), 'ネットワーク接続が切断されました。');
  assert.equal(humanizeError('connect ETIMEDOUT', (k) => dict[k as keyof typeof dict]), 'ネットワーク接続が切断されました。');
  assert.equal(humanizeError('connect ENETUNREACH', (k) => dict[k as keyof typeof dict]), 'ネットワーク接続が切断されました。');
});

test('classifies AbortError as cancelled (not network error)', () => {
  assert.equal(humanizeError('AbortError', (k) => dict[k as keyof typeof dict]), 'キャンセルされました。');
  assert.equal(humanizeError('The user aborted a request', (k) => dict[k as keyof typeof dict]), 'キャンセルされました。');
});

test('classifies timeout as timeout (not network error)', () => {
  assert.equal(humanizeError('Pipeline timed out', (k) => dict[k as keyof typeof dict]), 'タイムアウトしました。');
  assert.equal(humanizeError('Request timeout', (k) => dict[k as keyof typeof dict]), 'タイムアウトしました。');
});

test('passes through other error messages unchanged', () => {
  assert.equal(humanizeError('Some weird error', (k) => dict[k as keyof typeof dict]), 'Some weird error');
  assert.equal(humanizeError('', (k) => dict[k as keyof typeof dict]), '不明なエラー');
});

test('network patterns are case-insensitive', () => {
  assert.equal(humanizeError('NETWORK ERROR', (k) => dict[k as keyof typeof dict]), 'ネットワーク接続が切断されました。');
  assert.equal(humanizeError('Fetch Failed', (k) => dict[k as keyof typeof dict]), 'ネットワーク接続が切断されました。');
});
