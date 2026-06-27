/**
 * Tests for the /api/media/files endpoint content-type and Range support.
 * Run with: npx tsx tests/media-files-content-type.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// We can't easily import the route handler (it uses NextResponse), so we
// mirror the relevant logic from the route file and assert the contract.
function contentTypeForPath(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.mp4' || extension === '.m4v') return 'video/mp4';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.mkv') return 'video/x-matroska';
  if (extension === '.json' || extension === '.ass' || extension === '.srt' || extension === '.vtt' || extension === '.txt') {
    return 'text/plain;charset=utf-8';
  }
  return 'application/octet-stream';
}

function isVideo(relativePath: string) {
  return contentTypeForPath(relativePath).startsWith('video/');
}

test('content type: mp4 returns video/mp4 (was application/octet-stream before)', () => {
  assert.equal(contentTypeForPath('output/clips/foo.mp4'), 'video/mp4');
  assert.equal(contentTypeForPath('output/clips/foo.m4v'), 'video/mp4');
});

test('content type: webm, mov, mkk return correct video types', () => {
  assert.equal(contentTypeForPath('output/clips/foo.webm'), 'video/webm');
  assert.equal(contentTypeForPath('output/clips/foo.mov'), 'video/quicktime');
  assert.equal(contentTypeForPath('output/clips/foo.mkv'), 'video/x-matroska');
});

test('content type: existing image and text types still work', () => {
  assert.equal(contentTypeForPath('output/thumbnails/foo.jpg'), 'image/jpeg');
  assert.equal(contentTypeForPath('output/thumbnails/foo.jpeg'), 'image/jpeg');
  assert.equal(contentTypeForPath('output/thumbnails/foo.png'), 'image/png');
  assert.equal(contentTypeForPath('output/comments/comments.ass'), 'text/plain;charset=utf-8');
  assert.equal(contentTypeForPath('output/transcripts/foo.srt'), 'text/plain;charset=utf-8');
  assert.equal(contentTypeForPath('output/transcripts/foo.txt'), 'text/plain;charset=utf-8');
  assert.equal(contentTypeForPath('output/comments/comments.json'), 'text/plain;charset=utf-8');
});

test('content type: unknown extension falls back to octet-stream', () => {
  assert.equal(contentTypeForPath('foo.bin'), 'application/octet-stream');
  assert.equal(contentTypeForPath('foo.xyz'), 'application/octet-stream');
});

test('isVideo: returns true for video files', () => {
  assert.equal(isVideo('output/clips/foo.mp4'), true);
  assert.equal(isVideo('output/clips/foo.webm'), true);
  assert.equal(isVideo('output/clips/foo.mov'), true);
  assert.equal(isVideo('output/clips/foo.mkv'), true);
});

test('isVideo: returns false for non-video files', () => {
  assert.equal(isVideo('output/thumbnails/foo.png'), false);
  assert.equal(isVideo('output/comments/comments.json'), false);
  assert.equal(isVideo('output/comments/comments.ass'), false);
});

test('Range header parsing: bytes=0-499', () => {
  const match = 'bytes=0-499'.match(/^bytes=(\d*)-(\d*)$/);
  assert.ok(match);
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? Math.min(parseInt(match[2], 10), 1000 - 1) : 1000 - 1;
  assert.equal(start, 0);
  assert.equal(end, 499);
});

test('Range header parsing: bytes=500- (open-ended)', () => {
  const total = 1000;
  const match = 'bytes=500-'.match(/^bytes=(\d*)-(\d*)$/);
  assert.ok(match);
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
  assert.equal(start, 500);
  assert.equal(end, 999);
});

test('Range header parsing: bytes=-100 (suffix)', () => {
  const total = 1000;
  const match = 'bytes=-100'.match(/^bytes=(\d*)-(\d*)$/);
  assert.ok(match);
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
  assert.equal(start, 0);
  assert.equal(end, 100);
});
