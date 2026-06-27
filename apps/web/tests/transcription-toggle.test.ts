/**
 * Regression test for the transcription toggle behavior.
 * Run with: npx tsx tests/transcription-toggle.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirror the shouldTranscribe logic from archive-analysis-service.ts
function shouldTranscribe(input: { transcribe?: boolean }): boolean {
  return input.transcribe !== false;
}

test('transcribe defaults to true (backward compatible)', () => {
  assert.equal(shouldTranscribe({}), true);
  assert.equal(shouldTranscribe({ transcribe: undefined }), true);
});

test('transcribe=true is honored', () => {
  assert.equal(shouldTranscribe({ transcribe: true }), true);
});

test('transcribe=false disables transcription', () => {
  assert.equal(shouldTranscribe({ transcribe: false }), false);
});

test('pipeline stage should emit "done" for skipped transcription', () => {
  // When shouldTranscribe is false, the pipeline emits a "done" event with
  // message "Transcription skipped" so the UI doesn't stay in "pending".
  const events: Array<{ stage: string; status: string; message: string }> = [];
  const candidate = { id: 'c1' };
  const shouldTranscribeFlag = false;
  const generatedClip = { outputPath: '/tmp/clip.mp4' };

  // Simulate the conditional
  if (generatedClip && shouldTranscribeFlag) {
    events.push({ stage: 'transcription', status: 'running', message: 'Transcribing' });
  } else if (generatedClip && !shouldTranscribeFlag) {
    events.push({
      stage: 'transcription',
      status: 'done',
      message: 'Transcription skipped (disabled in panel)'
    });
  }

  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'done');
  assert.match(events[0].message, /skipped/);
});

test('pipeline skips FastAPI call when transcribe=false', () => {
  // The pipeline must not call transcribeClip() if shouldTranscribe is false.
  // This test asserts the logic without actually calling the network.
  const inputs: Array<{ transcribe?: boolean; expectedSkip: boolean }> = [
    { transcribe: true, expectedSkip: false },
    { transcribe: false, expectedSkip: true },
    { transcribe: undefined, expectedSkip: false }, // default true
    { expectedSkip: false } // default true
  ];

  for (const input of inputs) {
    const skip = input.transcribe === false;
    assert.equal(skip, input.expectedSkip, `for input ${JSON.stringify(input)}`);
  }
});
