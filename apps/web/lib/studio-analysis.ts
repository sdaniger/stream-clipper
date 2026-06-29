/**
 * Shared Studio analysis utilities.
 *
 * Extracts duplicated logic from analyze-vod and analyze-local routes,
 * and provides a top_n ranking-based candidate generation system.
 */

import type { ChatLogEntry } from "@/lib/chat-analysis";
import type { HighlightCandidate, TimelineRow } from "@/lib/studio-api";

// ─── Types ──────────────────────────────────────────────────────────────────

export type StudioAnalyzeOptions = {
  windowSeconds?: number;
  topN?: number;
  minGap?: number;
  step?: number;
  keywordWeight?: number;
  clipDuration?: number;
  clipOffset?: number;
  keywords?: string[];
};

export type StudioAnalyzeDiagnostic = {
  fetched_chat_count: number;
  normalized_chat_count: number;
  timeline_count: number;
  raw_candidate_count: number;
  candidates_after_threshold: number;
  candidates_after_min_gap: number;
  final_candidate_count: number;
  top_n: number;
  window: number;
  step: number;
  threshold: number;
  min_gap: number;
};

export type StudioAnalyzeResult = {
  candidates: HighlightCandidate[];
  timeline: TimelineRow[];
  diagnostic: StudioAnalyzeDiagnostic;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_WINDOW = 30;
const DEFAULT_STEP = 10;
const DEFAULT_TOP_N = 10;
const DEFAULT_MIN_GAP = 45;
const DEFAULT_CLIP_DURATION = 30;
const DEFAULT_CLIP_OFFSET = 10;

const REACTION_KEYWORDS = [
  "草", "ｗ", "www", "笑", "爆笑", "腹痛い", "おもろ", "やばい",
  "lol", "lmao", "haha", "w", "ｗ",
  "え", "まじ", "マジ", "うそ", "嘘",
  "神", "最高", "天才", "上手い", "すご",
  "きた", "来た", "ｷﾀ", "キタ",
];

// ─── Utility Functions ──────────────────────────────────────────────────────

export function clockToSeconds(clock: string): number {
  const parts = clock.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

export function secondsToClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

// ─── Chat Normalization ─────────────────────────────────────────────────────

export type NormalizedChatMessage = {
  timestamp: number;
  time_sec: number;
  message: string;
  author?: string;
};

/**
 * Normalize raw chat messages into a consistent format for analysis.
 * Filters out entries with invalid timestamps or empty messages.
 */
export function normalizeChatMessages(raw: ChatLogEntry[]): NormalizedChatMessage[] {
  const normalized = raw
    .filter((entry) => {
      const ts = entry.timestamp_seconds;
      return Number.isFinite(ts) && ts >= 0 && entry.message.trim().length > 0;
    })
    .map((entry) => ({
      timestamp: entry.timestamp_seconds,
      time_sec: entry.timestamp_seconds,
      message: entry.message.trim(),
      author: entry.author_name || undefined,
    }));

  return normalized;
}

// ─── Timeline Builder ───────────────────────────────────────────────────────

/**
 * Build a timeline of chat activity buckets.
 * Each bucket represents a time window with chat count, keyword hits, and score.
 */
export function buildStudioTimeline(
  entries: ChatLogEntry[],
  windowSec: number,
  stepSec: number,
  keywords: string[] = [],
  keywordWeight: number = 2.0,
): TimelineRow[] {
  const allKeywords = [...new Set([...REACTION_KEYWORDS, ...keywords])];
  const buckets = new Map<number, { chat: number; kw: number; keywords: Set<string>; authors: Set<string> }>();

  for (const entry of entries) {
    const idx = Math.floor(entry.timestamp_seconds / windowSec);
    if (!buckets.has(idx)) buckets.set(idx, { chat: 0, kw: 0, keywords: new Set(), authors: new Set() });
    const b = buckets.get(idx)!;
    b.chat++;
    if (entry.author_name) b.authors.add(entry.author_name);
    const msg = entry.message.toLowerCase();
    for (const r of allKeywords) {
      if (msg.includes(r.toLowerCase())) {
        b.kw++;
        b.keywords.add(r);
      }
    }
  }

  const indices = [...buckets.keys()];
  if (indices.length === 0) return [];
  const minIdx = Math.min(...indices);
  const maxIdx = Math.max(...indices);

  const result: TimelineRow[] = [];
  for (let i = minIdx; i <= maxIdx; i++) {
    const b = buckets.get(i) ?? { chat: 0, kw: 0, keywords: new Set<string>(), authors: new Set<string>() };
    const uniqueAuthors = b.authors.size;
    result.push({
      start: i * windowSec,
      end: (i + 1) * windowSec,
      score: b.chat + b.kw * keywordWeight + uniqueAuthors * 0.3,
      chat_count: b.chat,
      keyword_hits: b.kw,
      matched_keywords: [...b.keywords],
    });
  }

  return result;
}

// ─── Top-N Ranking Candidate Generation ─────────────────────────────────────

/**
 * Generate highlight candidates using top-N ranking instead of threshold-based detection.
 * This ensures multiple candidates are returned even when chat activity is uniform.
 */
export function generateTopNCandidates(
  timeline: TimelineRow[],
  entries: ChatLogEntry[],
  options: StudioAnalyzeOptions = {},
): StudioAnalyzeResult {
  const windowSec = options.windowSeconds ?? DEFAULT_WINDOW;
  const stepSec = options.step ?? DEFAULT_STEP;
  const topN = options.topN ?? DEFAULT_TOP_N;
  const minGap = options.minGap ?? DEFAULT_MIN_GAP;
  const clipDuration = options.clipDuration ?? DEFAULT_CLIP_DURATION;
  const clipOffset = options.clipOffset ?? DEFAULT_CLIP_OFFSET;

  // Sort timeline by score descending
  const ranked = [...timeline]
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score);

  const rawCandidateCount = ranked.length;

  // Calculate dynamic threshold: top 70th percentile score
  const scores = ranked.map((t) => t.score);
  const p70Idx = Math.floor(scores.length * 0.30);
  const threshold = scores.length > 0 ? (scores[p70Idx] ?? 0) : 0;

  // Apply threshold (but don't discard too aggressively)
  const afterThreshold = ranked.filter((t) => t.score >= Math.max(threshold * 0.5, 1));
  const candidatesAfterThreshold = afterThreshold.length;

  // Deduplicate by min_gap
  const selected: TimelineRow[] = [];
  for (const item of afterThreshold) {
    if (selected.length >= topN) break;
    const peakTime = (item.start + item.end) / 2;
    const tooClose = selected.some((s) => {
      const sPeak = (s.start + s.end) / 2;
      return Math.abs(peakTime - sPeak) < minGap;
    });
    if (!tooClose) {
      selected.push(item);
    }
  }
  const candidatesAfterMinGap = selected.length;

  // Build HighlightCandidate objects
  const candidates: HighlightCandidate[] = selected.map((item, index) => {
    const startTime = item.start;
    const endTime = item.end;
    const peakTime = (startTime + endTime) / 2;
    const clipStart = Math.max(0, peakTime - clipOffset);
    const clipEnd = clipStart + clipDuration;

    // Count unique authors in this window
    const windowEntries = entries.filter(
      (e) => e.timestamp_seconds >= startTime && e.timestamp_seconds <= endTime,
    );
    const uniqueAuthors = new Set(windowEntries.map((e) => e.author_name)).size;

    // Build reasons
    const reasons: string[] = [];
    if (item.chat_count > 0) reasons.push(`コメント密度が高い (${item.chat_count}件)`);
    if (item.keyword_hits > 0) reasons.push(`笑い語・キーワードが集中 (${item.keyword_hits}件)`);
    if (uniqueAuthors > 3) reasons.push(`複数の視聴者が反応 (${uniqueAuthors}人)`);
    if (index > 0) {
      const prevItem = selected[index - 1];
      if (prevItem && item.chat_count > prevItem.chat_count * 1.5) {
        reasons.push("直前区間より反応が急増");
      }
    }
    if (reasons.length === 0) reasons.push("チャット活動を検出");

    return {
      rank: index + 1,
      start: startTime,
      end: endTime,
      peak_time: peakTime,
      clip_start: clipStart,
      clip_duration: clipDuration,
      score: Math.round(item.score),
      chat_count: item.chat_count,
      keyword_hits: item.keyword_hits,
      unique_author_count: uniqueAuthors,
      matched_keywords: item.matched_keywords,
      reasons,
      output_file: null,
    };
  });

  const diagnostic: StudioAnalyzeDiagnostic = {
    fetched_chat_count: entries.length,
    normalized_chat_count: entries.length,
    timeline_count: timeline.length,
    raw_candidate_count: rawCandidateCount,
    candidates_after_threshold: candidatesAfterThreshold,
    candidates_after_min_gap: candidatesAfterMinGap,
    final_candidate_count: candidates.length,
    top_n: topN,
    window: windowSec,
    step: stepSec,
    threshold: Math.round(threshold),
    min_gap: minGap,
  };

  return { candidates, timeline, diagnostic };
}

// ─── Legacy Compatibility ───────────────────────────────────────────────────

/**
 * Convert a ClipCandidate (from chat-analysis.ts) to HighlightCandidate format.
 */
export function clipCandidateToHighlight(
  c: any,
  index: number,
  timeline: TimelineRow[],
): HighlightCandidate {
  const clipStart = clockToSeconds(c.detectedAt ?? "0");
  const duration = clockToSeconds(c.duration ?? "30");
  const peakFromTitle = (() => {
    const m = c.title?.match(/(\d+):(\d+)(?::(\d+))?/);
    if (!m) return clipStart + duration / 2;
    const base = parseInt(m[1]) * 60 + parseInt(m[2] ?? "0");
    return m[3] ? base * 60 + parseInt(m[3]) : base;
  })();
  const highlightStart = clipStart;
  const highlightEnd = clipStart + duration;

  const matchedRows = timeline.filter(
    (r) => r.start >= highlightStart && r.end <= highlightEnd,
  );
  const totalScore = matchedRows.reduce((s, r) => s + r.score, 0);
  const totalChat = matchedRows.reduce((s, r) => s + r.chat_count, 0);
  const totalKw = matchedRows.reduce((s, r) => s + r.keyword_hits, 0);
  const allKws = [...new Set(matchedRows.flatMap((r) => r.matched_keywords))];

  return {
    rank: index + 1,
    start: highlightStart,
    end: highlightEnd,
    peak_time: peakFromTitle,
    score: Math.round(c.confidence ?? totalScore),
    chat_count: c.chat?.messages ?? totalChat,
    keyword_hits: totalKw,
    matched_keywords: allKws,
    reasons: c.whyDetected ?? [],
    clip_start: clipStart,
    clip_duration: duration,
    output_file: null,
  };
}
