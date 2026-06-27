/**
 * Regression test for the candidate-storage helper.
 * Run with: node tests/candidate-storage.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

class MemoryStorage {
  constructor() { this.store = new Map(); }
  getItem(key) { return this.store.get(key) ?? null; }
  setItem(key, value) { this.store.set(key, String(value)); }
  removeItem(key) { this.store.delete(key); }
  clear() { this.store.clear(); }
  get length() { return this.store.size; }
  key(index) { return Array.from(this.store.keys())[index] ?? null; }
}

const memStore = new MemoryStorage();
globalThis.window = { localStorage: memStore };
globalThis.localStorage = memStore;

// Compile the storage TS to JS in-memory by using a quick transpile via Node 22's built-in TS support
const storage = await import('../lib/candidate-storage.ts');
const { loadCandidates, saveCandidates, clearCandidates, getStorageMeta } = storage;

function makeCandidate(id, title) {
  return {
    id, title,
    status: 'pending', streamer: 'test', archiveTitle: 'archive',
    detectedAt: '00:00', duration: '00:30', confidence: 90, summary: '',
    whyDetected: [], tags: [],
    chat: { messages: 0, peakPerMinute: 0, topPhrases: [], sentiment: '' },
    peak: { offset: '00:00', label: '', intensity: 50, sparkline: [] },
    transcript: [], transcriptSegments: [], representativeComments: [],
    detectionReasons: [], warnings: [],
    notes: { editPlan: '', titleIdea: '', thumbnailIdea: '', uploadText: '' },
    markers: [], variants: [], selectedVariantId: '', visualTone: ''
  };
}

beforeEach(() => { memStore.clear(); });

test('loadCandidates returns null when storage is empty', () => {
  assert.equal(loadCandidates(), null);
});

test('saveCandidates then loadCandidates round-trips identical data', () => {
  const list = [makeCandidate('c1', 'First'), makeCandidate('c2', 'Second')];
  const result = saveCandidates(list);
  assert.equal(result.ok, true);
  const loaded = loadCandidates();
  assert.deepEqual(loaded, list);
});

test('loadCandidates returns null for mismatched version', () => {
  memStore.setItem('stream-clipper:candidates:v1',
    JSON.stringify({ version: 999, candidates: [makeCandidate('c1', 'x')] }));
  assert.equal(loadCandidates(), null);
});

test('loadCandidates returns null for corrupted JSON', () => {
  memStore.setItem('stream-clipper:candidates:v1', '{not valid json');
  assert.equal(loadCandidates(), null);
});

test('loadCandidates returns null for missing candidates array', () => {
  memStore.setItem('stream-clipper:candidates:v1', JSON.stringify({ version: 1 }));
  assert.equal(loadCandidates(), null);
});

test('saveCandidates caps at MAX_CANDIDATES', () => {
  const meta = getStorageMeta();
  const huge = Array.from({ length: meta.maxCandidates + 100 }, (_, i) =>
    makeCandidate(`c${i}`, `T${i}`));
  saveCandidates(huge);
  const loaded = loadCandidates();
  assert.equal(loaded?.length, meta.maxCandidates);
});

test('clearCandidates removes the storage key', () => {
  saveCandidates([makeCandidate('c1', 'x')]);
  assert.notEqual(memStore.getItem('stream-clipper:candidates:v1'), null);
  clearCandidates();
  assert.equal(memStore.getItem('stream-clipper:candidates:v1'), null);
  assert.equal(loadCandidates(), null);
});

test('saveCandidates returns ok=false on storage failure (quota exceeded)', () => {
  const origSetItem = memStore.setItem.bind(memStore);
  memStore.setItem = () => { throw new Error('QuotaExceededError: storage full'); };
  try {
    const result = saveCandidates([makeCandidate('c1', 'x')]);
    assert.equal(result.ok, false);
    assert.match(result.reason, /Quota/);
  } finally {
    memStore.setItem = origSetItem;
  }
});

test('getStorageMeta exposes the storage key and version', () => {
  const meta = getStorageMeta();
  assert.equal(meta.key, 'stream-clipper:candidates:v1');
  assert.equal(typeof meta.version, 'number');
  assert.ok(meta.maxCandidates > 0);
});

test('saveCandidates handles empty array', () => {
  const result = saveCandidates([]);
  assert.equal(result.ok, true);
  assert.deepEqual(loadCandidates(), []);
});

test('subsequent save overrides previous data', () => {
  saveCandidates([makeCandidate('c1', 'A')]);
  saveCandidates([makeCandidate('c2', 'B')]);
  const loaded = loadCandidates();
  assert.equal(loaded?.length, 1);
  assert.equal(loaded?.[0].id, 'c2');
});
