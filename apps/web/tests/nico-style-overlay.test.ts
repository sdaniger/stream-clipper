/**
 * Tests for the new real-chat-driven comment overlay generator.
 * Run with: npx tsx tests/nico-style-overlay.test.ts
 *
 * The narinico tool produces a NicoNico-style danmaku overlay from the
 * ACTUAL Twitch chat messages at their REAL timestamps. These tests
 * verify the same behavior in our pipeline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCommentOverlayItemsFromChat, defaultCommentOverlaySettings } from "../lib/comment-overlay";
import type { ChatLogEntry } from "../lib/chat-analysis";
import type { ClipCandidate } from "../lib/mock-candidates";

function makeCandidate(id: string): ClipCandidate {
  return {
    id,
    title: "test",
    streamer: "tester",
    archiveTitle: "test archive",
    detectedAt: "00:00",
    duration: "00:30",
    confidence: 80,
    status: "pending",
    summary: "",
    whyDetected: [],
    tags: [],
    chat: { messages: 0, peakPerMinute: 0, topPhrases: [], sentiment: "" },
    peak: { offset: "00:00", label: "", intensity: 0, sparkline: [] },
    transcript: [],
    transcriptSegments: [],
    representativeComments: [],
    detectionReasons: [],
    warnings: [],
    notes: { editPlan: "", titleIdea: "", thumbnailIdea: "", uploadText: "" },
    markers: [],
    variants: [],
    selectedVariantId: "",
    visualTone: ""
  };
}

function makeChat(timestamps: number[], text = "草"): ChatLogEntry[] {
  return timestamps.map((seconds, index) => ({
    timestamp_seconds: seconds,
    author_name: `user${index}`,
    message: text
  }));
}

test("real chat at real timestamps becomes real comments at real times", () => {
  const candidate = makeCandidate("c1");
  // Use unique texts to avoid the dedup filter and density=low to avoid modulo
  const chat: ChatLogEntry[] = [
    { timestamp_seconds: 10, author_name: "u1", message: "w" },
    { timestamp_seconds: 12, author_name: "u2", message: "a" },
    { timestamp_seconds: 15, author_name: "u3", message: "b" },
    { timestamp_seconds: 20, author_name: "u4", message: "c" },
    { timestamp_seconds: 25, author_name: "u5", message: "d" }
  ];
  const settings = { ...defaultCommentOverlaySettings, density: "danmaku" as const, filterRepeatedComments: false, syncOffsetSeconds: 0 };
  const items = generateCommentOverlayItemsFromChat(candidate, chat, 5, 30, settings);

  assert.equal(items.length, 5, "should produce one comment per chat message");
  // Real timestamps: 10, 12, 15, 20, 25, all in [5, 30]
  // Relative to clipStart=5: 5, 7, 10, 15, 20
  const times = items.map((c) => c.time).sort((a, b) => a - b);
  console.log("  comment times:", times);
  assert.deepEqual(times, [5, 7, 10, 15, 20]);
});

test("comments outside the clip window are dropped", () => {
  const candidate = makeCandidate("c2");
  const chat: ChatLogEntry[] = [
    { timestamp_seconds: 0, author_name: "u1", message: "a" },
    { timestamp_seconds: 5, author_name: "u2", message: "b" },
    { timestamp_seconds: 10, author_name: "u3", message: "c" },
    { timestamp_seconds: 50, author_name: "u4", message: "d" },
    { timestamp_seconds: 60, author_name: "u5", message: "e" },
    { timestamp_seconds: 100, author_name: "u6", message: "f" }
  ];
  const settings = { ...defaultCommentOverlaySettings, density: "danmaku" as const, filterRepeatedComments: false, syncOffsetSeconds: 0 };
  const items = generateCommentOverlayItemsFromChat(candidate, chat, 10, 30, settings);

  // Only [10] is in [10, 30] (others are outside the window)
  // relativeTime = abs - clipStart, so chat@10 → relative 0
  const times = items.map((c) => c.time).sort((a, b) => a - b);
  console.log("  in-window times:", times);
  assert.deepEqual(times, [0], "should only keep chat@10 (in window, relative time 0)");
});

test("sync offset shifts all comments by the same amount", () => {
  const candidate = makeCandidate("c3");
  const chat: ChatLogEntry[] = [
    { timestamp_seconds: 10, author_name: "u1", message: "a" },
    { timestamp_seconds: 15, author_name: "u2", message: "b" },
    { timestamp_seconds: 20, author_name: "u3", message: "c" }
  ];
  const settings = { ...defaultCommentOverlaySettings, density: "danmaku" as const, filterRepeatedComments: false, syncOffsetSeconds: -2 };
  const items = generateCommentOverlayItemsFromChat(candidate, chat, 5, 30, settings);
  // Original times relative to clipStart=5: 5, 10, 15
  // With syncOffset -2: 3, 8, 13
  const times = items.map((c) => c.time).sort((a, b) => a - b);
  console.log("  shifted times:", times);
  assert.deepEqual(times, [3, 8, 13]);
});

test("filterUrls drops chat with URLs", () => {
  const candidate = makeCandidate("c4");
  const chat: ChatLogEntry[] = [
    { timestamp_seconds: 10, author_name: "u1", message: "a" },
    { timestamp_seconds: 11, author_name: "u2", message: "見て https://example.com" },
    { timestamp_seconds: 12, author_name: "u3", message: "b" }
  ];
  const settings = { ...defaultCommentOverlaySettings, density: "danmaku" as const, filterRepeatedComments: false, filterUrls: true };
  const items = generateCommentOverlayItemsFromChat(candidate, chat, 5, 30, settings);
  assert.equal(items.length, 2, "should drop the URL comment");
  for (const item of items) {
    assert.ok(!item.text.includes("http"), "remaining items should not contain URLs");
  }
});

test("filterLongComments drops chat > 40 chars", () => {
  const candidate = makeCandidate("c5");
  const longText = "あ".repeat(50);
  const chat: ChatLogEntry[] = [
    { timestamp_seconds: 10, author_name: "u1", message: "a" },
    { timestamp_seconds: 11, author_name: "u2", message: longText },
    { timestamp_seconds: 12, author_name: "u3", message: "b" }
  ];
  const settings = { ...defaultCommentOverlaySettings, density: "danmaku" as const, filterRepeatedComments: false, filterLongComments: true };
  const items = generateCommentOverlayItemsFromChat(candidate, chat, 5, 30, settings);
  assert.equal(items.length, 2, "should drop the 50-char comment");
  for (const item of items) {
    assert.ok(item.text.length <= 40, "remaining items should be <= 40 chars");
  }
});

test("filterRepeatedComments drops chat repeats within 3s window", () => {
  const candidate = makeCandidate("c6");
  const chat: ChatLogEntry[] = [
    { timestamp_seconds: 10, author_name: "u1", message: "草" },
    { timestamp_seconds: 11, author_name: "u2", message: "草" }, // 1s after, dedup
    { timestamp_seconds: 14, author_name: "u3", message: "草" }  // 4s after, keep
  ];
  const settings = { ...defaultCommentOverlaySettings, density: "danmaku" as const, filterRepeatedComments: true };
  const items = generateCommentOverlayItemsFromChat(candidate, chat, 5, 30, settings);
  // Should keep chat@10 (first) and chat@14 (4s later)
  assert.equal(items.length, 2, "should dedup within 3s");
});

test("maxPerSecond caps comment density", () => {
  const candidate = makeCandidate("c7");
  // 30 messages all at the same second (relative time 5)
  const chat: ChatLogEntry[] = Array.from({ length: 30 }, (_, i) => ({
    timestamp_seconds: 10,  // all at same second
    author_name: `u${i}`,
    message: `msg${i}`  // unique text
  }));
  const settings = { ...defaultCommentOverlaySettings, density: "danmaku" as const, filterRepeatedComments: false, syncOffsetSeconds: 0, maxPerSecond: 5 };
  const items = generateCommentOverlayItemsFromChat(candidate, chat, 5, 30, settings);
  // All 30 messages fall in second 5 (relative time 5), capped at 5
  assert.equal(items.length, 5, `expected 5, got ${items.length}`);
});

test("long comments scroll faster (duration decreases with length)", () => {
  const candidate = makeCandidate("c8");
  const chat: ChatLogEntry[] = [
    { timestamp_seconds: 10, author_name: "u1", message: "草" },
    { timestamp_seconds: 11, author_name: "u2", message: "あ".repeat(30) }
  ];
  const settings = { ...defaultCommentOverlaySettings, density: "danmaku" as const, filterRepeatedComments: false };
  const items = generateCommentOverlayItemsFromChat(candidate, chat, 5, 30, settings);
  const short = items.find((i) => i.text === "草");
  const long = items.find((i) => i.text.length === 30);
  assert.ok(short && long, "should produce both items");
  assert.ok((long?.duration ?? 0) < (short?.duration ?? 0), `long comment duration ${long?.duration} should be < short ${short?.duration}`);
});

test("empty chat returns no comments", () => {
  const candidate = makeCandidate("c9");
  const items = generateCommentOverlayItemsFromChat(candidate, [], 0, 30, defaultCommentOverlaySettings);
  assert.equal(items.length, 0);
});
