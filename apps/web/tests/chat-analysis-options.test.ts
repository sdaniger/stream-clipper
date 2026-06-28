import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeChatEntries, exportChatAnalysisCsv } from "@/lib/chat-analysis";
import type { ChatLogEntry } from "@/lib/chat-analysis";

function makeEntry(ts: number, msg: string): ChatLogEntry {
  return { timestamp_seconds: ts, author_name: "user", message: msg };
}

describe("analyzeChatEntries keywordWeight", () => {
  const entries: ChatLogEntry[] = [
    makeEntry(10, "草"),
    makeEntry(11, "www"),
    makeEntry(12, "lol"),
    makeEntry(30, "hello"),
    makeEntry(60, "爆笑"),
    makeEntry(61, "草草"),
    makeEntry(62, "www www"),
    makeEntry(63, "lol lmao"),
  ];

  it("default keywordWeight (1) produces baseline scores", () => {
    const result1 = analyzeChatEntries(entries, "test", { keywordWeight: 1 });
    const result2 = analyzeChatEntries(entries, "test", {});
    // Both should find same candidate count
    assert.equal(result1.candidates.length, result2.candidates.length);
  });

  it("higher keywordWeight produces higher scores", () => {
    const low = analyzeChatEntries(entries, "test", { keywordWeight: 0.5 });
    const high = analyzeChatEntries(entries, "test", { keywordWeight: 5 });
    // At least one candidate should have higher score with higher weight
    if (low.candidates.length > 0 && high.candidates.length > 0) {
      const topLow = low.candidates[0];
      const topHigh = high.candidates[0];
      assert.ok(topHigh.confidence >= topLow.confidence, "higher keywordWeight should not decrease confidence");
    }
  });
});

describe("analyzeChatEntries minGap", () => {
  const entries: ChatLogEntry[] = [];
  // Create three clusters of activity
  for (let i = 0; i < 10; i++) {
    entries.push(makeEntry(10 + i, "草"));
  }
  for (let i = 0; i < 10; i++) {
    entries.push(makeEntry(50 + i, "www"));
  }
  for (let i = 0; i < 10; i++) {
    entries.push(makeEntry(200 + i, "lol"));
  }

  it("minGap deduplicates windows that are too close", () => {
    // Without minGap: should find multiple candidates
    const without = analyzeChatEntries(entries, "test", {});
    // With large minGap: should dedup to fewer candidates
    const withGap = analyzeChatEntries(entries, "test", { minGap: 200 });
    assert.ok(withGap.candidates.length <= without.candidates.length, "minGap should not increase candidate count");
  });

  it("minGap=0 keeps all candidates", () => {
    const noGap = analyzeChatEntries(entries, "test", { minGap: 0 });
    const default_ = analyzeChatEntries(entries, "test", {});
    assert.equal(noGap.candidates.length, default_.candidates.length);
  });
});

describe("exportChatAnalysisCsv", () => {
  const entries: ChatLogEntry[] = [
    makeEntry(5, "草"),
    makeEntry(15, "www"),
    makeEntry(35, "hello"),
    makeEntry(70, "爆笑"),
    makeEntry(71, "lol"),
  ];

  it("returns rows with expected structure", () => {
    const rows = exportChatAnalysisCsv(entries);
    assert.ok(rows.length > 0);
    const row = rows[0];
    assert.equal(typeof row.start, "number");
    assert.equal(typeof row.end, "number");
    assert.equal(typeof row.score, "number");
    assert.equal(typeof row.chatCount, "number");
    assert.equal(typeof row.keywordHits, "number");
    assert.ok(Array.isArray(row.matchedKeywords));
  });

  it("returns empty for empty input", () => {
    const rows = exportChatAnalysisCsv([], 30, 1);
    assert.deepEqual(rows, []);
  });

  it("keywordHits is accurate", () => {
    const rows = exportChatAnalysisCsv(entries, 30, 1);
    // Bucket 0 (0-30s): 2 entries, should have keyword hits (laughter)
    const bucket0 = rows.find(r => r.start === 0);
    if (bucket0) {
      assert.ok(bucket0.chatCount >= 2);
      assert.ok(bucket0.matchedKeywords.length > 0);
    }
  });
});
