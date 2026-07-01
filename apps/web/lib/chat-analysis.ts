import type {
  CandidateWarning,
  ClipCandidate,
  ClipCandidateMarker,
  ClipCandidateVariant,
  DetectionReason,
  RepresentativeComment,
  TranscriptSegment
} from "@/lib/mock-candidates";

export type ChatLogEntry = {
  timestamp_seconds: number;
  author_name: string;
  message: string;
};

export type ChatImportMode = "append" | "replace";

export type ChatAnalysisSummary = {
  inputMessages: number;
  analyzedMessages: number;
  candidateCount: number;
  baselinePerMinute: number;
  peakPerMinute: number;
};

export type ClipLengthPreset = "short" | "standard" | "long";

export type ChatAnalysisResult = {
  candidates: ClipCandidate[];
  summary: ChatAnalysisSummary;
};

type ReactionKind = "laughter" | "surprise" | "praise" | "clip" | "general";

type Bucket = {
  index: number;
  start: number;
  end: number;
  entries: ChatLogEntry[];
  uniqueAuthors: number;
  reactionCounts: Record<ReactionKind, number>;
  signalScore: number;
};

type CandidateWindow = {
  start: number;
  end: number;
  clipStart: number;
  clipEnd: number;
  buckets: Bucket[];
  entries: ChatLogEntry[];
  peakBucket: Bucket;
  score: number;
  dominantReaction: ReactionKind;
};

const DEFAULT_WINDOW_SECONDS = 30;
const MAX_CANDIDATES = 24;

export function computeAdaptiveWindowSeconds(
  durationSeconds?: number | null,
  preferred?: number
): number {
  if (preferred && preferred >= 10 && preferred <= 300) return preferred;
  if (!durationSeconds || durationSeconds <= 0) return DEFAULT_WINDOW_SECONDS;
  if (durationSeconds < 7200) return 30;
  if (durationSeconds < 21600) return 45;
  return 60;
}

function contextBeforeSeconds(windowSeconds: number) {
  return Math.max(10, Math.round(windowSeconds * 5 / 6));
}

function contextAfterSeconds(windowSeconds: number) {
  return Math.max(15, Math.round(windowSeconds * 3 / 2));
}

const reactionRules: Record<Exclude<ReactionKind, "general">, RegExp[]> = {
  laughter: [/草+/, /w{2,}/i, /ｗ{2,}/, /笑+/, /爆笑/, /lol/i, /lmao/i, /haha/i, /ハハ/, /しぬ|死ぬ/, /腹筋/, /おもろすぎ/, /ワロ/, /草ァ/],
  surprise: [/え[!?！？]?/, /待って|まって/, /まじ|マジ/, /やば|ヤバ/, /うそ|嘘/, /no way/i, /what/i, /wtf/i, /omg/i, /[!?！？]{2,}/, /は？/, /えぐ|エグ/, /こわ|怖/, /なんで/],
  praise: [/うま|上手|うますぎ/, /すご|凄/, /神/, /天才/, /かわいい|可愛い/, /尊い/, /助かる/, /鳥肌/, /8888/, /nice/i, /clutch/i, /gg/i, /beautiful/i, /泣|cry/i],
  clip: [/clip/i, /クリップ/, /切り抜き|切抜き/, /タイムスタンプ|timestamp/i, /ここ好き/, /ここ切り抜き/, /撮れ高/, /神展開/, /神回/, /放送事故|事故/]
};

const reactionLabels: Record<ReactionKind, string> = {
  laughter: "笑いスパイク",
  surprise: "驚きスパイク",
  praise: "称賛ウェーブ",
  clip: "切り抜きリクエスト",
  general: "チャット盛り上がり"
};

const reactionTags: Record<ReactionKind, string[]> = {
  laughter: ["laughter", "funny", "chat-import"],
  surprise: ["surprise", "reaction", "chat-import"],
  praise: ["praise", "hype", "chat-import"],
  clip: ["clip-request", "highlight", "chat-import"],
  general: ["chat-spike", "rule-based", "chat-import"]
};

const visualTones: Record<ReactionKind, string> = {
  laughter: "from-fuchsia-400/30 via-purple-500/20 to-cyan-500/25",
  surprise: "from-rose-400/30 via-orange-500/20 to-amber-400/25",
  praise: "from-emerald-400/30 via-cyan-500/20 to-sky-400/25",
  clip: "from-cyan-400/30 via-blue-500/20 to-violet-500/30",
  general: "from-slate-300/25 via-cyan-500/15 to-violet-500/25"
};

export function parseChatJson(input: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Invalid JSON: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Expected the chat JSON root to be an array of messages.");
  }

  if (parsed.length === 0) {
    throw new Error("The chat JSON array is empty. Add at least a few chat messages to analyze.");
  }

  return parsed.map((item, index) => validateChatEntry(item, index)).sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
}

export function analyzeChatJson(input: string, idPrefix = `chat-${Date.now()}`, options?: { windowSeconds?: number; clipLength?: ClipLengthPreset; keywordWeight?: number; minGap?: number }): ChatAnalysisResult {
  const entries = parseChatJson(input);
  return analyzeChatEntries(entries, idPrefix, options);
}

export function analyzeChatEntries(
  entries: ChatLogEntry[],
  idPrefix = `chat-${Date.now()}`,
  options?: { windowSeconds?: number; clipLength?: ClipLengthPreset; keywordWeight?: number; minGap?: number }
): ChatAnalysisResult {
  const windowSec = options?.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const keywordWeight = options?.keywordWeight ?? 1;

  const normalizedEntries = entries
    .filter((entry) => entry.message.trim().length > 0)
    .sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);

  if (normalizedEntries.length === 0) {
    return {
      candidates: [],
      summary: {
        inputMessages: entries.length,
        analyzedMessages: 0,
        candidateCount: 0,
        baselinePerMinute: 0,
        peakPerMinute: 0
      }
    };
  }

  const buckets = buildBuckets(normalizedEntries, windowSec, keywordWeight);
  const counts = buckets.map((bucket) => bucket.entries.length);
  const baselinePerMinute = Math.round(median(counts) * (60 / windowSec));
  const peakPerMinute = Math.round(Math.max(...counts) * (60 / windowSec));

  const sortedCounts = [...counts].sort((a, b) => a - b);
  const p70Index = Math.floor(sortedCounts.length * 0.70);
  const volumeThreshold = Math.max(3, sortedCounts[p70Index] ?? 0);
  const sortedSignals = buckets
    .map((bucket) => bucket.signalScore)
    .sort((a, b) => a - b);
  const p70SignalIndex = Math.floor(sortedSignals.length * 0.70);
  const reactionThreshold = Math.max(5, sortedSignals[p70SignalIndex] ?? 0);

  const highlightedBuckets = buckets.filter((bucket) => {
    const hasVolumeSpike = bucket.entries.length >= volumeThreshold;
    const hasReactionSpike = bucket.signalScore >= reactionThreshold && bucket.entries.length >= 4;
    return hasVolumeSpike || hasReactionSpike;
  });

  if (process.env.NODE_ENV !== "test" && typeof console !== "undefined") {
    console.log(
      `[chat-analysis] buckets=${buckets.length} messages=${normalizedEntries.length} ` +
        `p70=${sortedCounts[p70Index]} volumeThreshold=${volumeThreshold} ` +
        `p70Signal=${sortedSignals[p70SignalIndex]} reactionThreshold=${reactionThreshold} ` +
        `highlighted=${highlightedBuckets.length} windowSec=${windowSec}`
    );
  }

  if (highlightedBuckets.length === 0) {
    return {
      candidates: [],
      summary: {
        inputMessages: entries.length,
        analyzedMessages: normalizedEntries.length,
        candidateCount: 0,
        baselinePerMinute,
        peakPerMinute
      }
    };
  }

  const ctxBefore = contextBeforeSeconds(windowSec);
  const ctxAfter = contextAfterSeconds(windowSec);
  const windows = mergeHighlightedBuckets(highlightedBuckets, normalizedEntries, ctxBefore, ctxAfter);
  const clipLength = options?.clipLength ?? "standard";
  const minGap = options?.minGap;

  const dedupedWindows = minGap ? deduplicateWindows(windows, minGap) : windows;
  const candidates = dedupedWindows
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map((window, index) => buildCandidateFromWindow(window, index, idPrefix, baselinePerMinute, peakPerMinute, windowSec, clipLength));

  return {
    candidates,
    summary: {
      inputMessages: entries.length,
      analyzedMessages: normalizedEntries.length,
      candidateCount: candidates.length,
      baselinePerMinute,
      peakPerMinute
    }
  };
}

function validateChatEntry(item: unknown, index: number): ChatLogEntry {
  if (!item || typeof item !== "object") {
    throw new Error(`Message at index ${index} must be an object.`);
  }

  const record = item as Record<string, unknown>;
  const timestamp = record.timestamp_seconds;
  const authorName = record.author_name;
  const message = record.message;

  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error(`Message at index ${index} needs a non-negative numeric timestamp_seconds.`);
  }

  if (typeof authorName !== "string" || authorName.trim().length === 0) {
    throw new Error(`Message at index ${index} needs a non-empty author_name string.`);
  }

  if (typeof message !== "string") {
    throw new Error(`Message at index ${index} needs a message string.`);
  }

  return {
    timestamp_seconds: Math.round(timestamp),
    author_name: authorName.trim(),
    message: message.trim()
  };
}

function buildBuckets(entries: ChatLogEntry[], windowSec: number, keywordWeight = 1): Bucket[] {
  const bucketMap = new Map<number, ChatLogEntry[]>();

  for (const entry of entries) {
    const index = Math.floor(entry.timestamp_seconds / windowSec);
    bucketMap.set(index, [...(bucketMap.get(index) ?? []), entry]);
  }

  const minIndex = Math.min(...bucketMap.keys());
  const maxIndex = Math.max(...bucketMap.keys());
  const buckets: Bucket[] = [];

  for (let index = minIndex; index <= maxIndex; index += 1) {
    const bucketEntries = bucketMap.get(index) ?? [];
    const reactionCounts = countReactions(bucketEntries);
    const uniqueAuthors = new Set(bucketEntries.map((entry) => entry.author_name)).size;
  const repeatedAuthorPenalty = bucketEntries.length > 0 ? uniqueAuthors / bucketEntries.length : 0;
  const keywordScore = reactionCounts.laughter * 1.8 + reactionCounts.surprise * 2 + reactionCounts.praise * 1.5 + reactionCounts.clip * 2.5;

    buckets.push({
      index,
      start: index * windowSec,
      end: (index + 1) * windowSec,
      entries: bucketEntries,
      uniqueAuthors,
      reactionCounts,
      signalScore: bucketEntries.length + uniqueAuthors * 1.1 + keywordScore * keywordWeight + repeatedAuthorPenalty * 3
    });
  }

  return buckets;
}

function mergeHighlightedBuckets(highlightedBuckets: Bucket[], entries: ChatLogEntry[], ctxBefore: number, ctxAfter: number): CandidateWindow[] {
  const sorted = [...highlightedBuckets].sort((a, b) => a.index - b.index);
  const clusters: Bucket[][] = [];

  for (const bucket of sorted) {
    const lastCluster = clusters.at(-1);
    const lastBucket = lastCluster?.at(-1);

    if (!lastCluster || !lastBucket || bucket.index - lastBucket.index > 1) {
      clusters.push([bucket]);
    } else {
      lastCluster.push(bucket);
    }
  }

  return clusters.map((cluster) => {
    const start = cluster[0].start;
    const end = cluster[cluster.length - 1].end;
    const clipStart = Math.max(0, start - ctxBefore);
    const clipEnd = end + ctxAfter;
    const windowEntries = entries.filter((entry) => entry.timestamp_seconds >= clipStart && entry.timestamp_seconds <= clipEnd);
    const peakBucket = cluster.reduce((best, bucket) => (bucket.signalScore > best.signalScore ? bucket : best), cluster[0]);
    const reactionCounts = countReactions(windowEntries);
    const dominantReaction = dominantReactionKind(reactionCounts);
    const score = cluster.reduce((total, bucket) => total + bucket.signalScore, 0) + windowEntries.length * 0.35;

    return { start, end, clipStart, clipEnd, buckets: cluster, entries: windowEntries, peakBucket, score, dominantReaction };
  });
}

function deduplicateWindows(windows: CandidateWindow[], minGap: number): CandidateWindow[] {
  const sorted = [...windows].sort((a, b) => b.score - a.score);
  const result: CandidateWindow[] = [];
  for (const w of sorted) {
    const peakA = w.peakBucket.start + (w.peakBucket.end - w.peakBucket.start) / 2;
    let tooClose = false;
    for (const existing of result) {
      const peakB = existing.peakBucket.start + (existing.peakBucket.end - existing.peakBucket.start) / 2;
      if (Math.abs(peakA - peakB) < minGap) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      result.push(w);
    }
  }
  return result.sort((a, b) => a.start - b.start);
}

function buildCandidateFromWindow(
  window: CandidateWindow,
  index: number,
  idPrefix: string,
  baselinePerMinute: number,
  globalPeakPerMinute: number,
  windowSec: number,
  clipLength: ClipLengthPreset = "standard"
): ClipCandidate {
  const id = `${idPrefix}-${index + 1}`;
  const durationSeconds = Math.max(30, window.clipEnd - window.clipStart);
  const peakPerMinute = Math.round(window.peakBucket.entries.length * (60 / windowSec));
  const uniqueAuthors = new Set(window.entries.map((entry) => entry.author_name)).size;
  const repeatedPhrases = topPhrases(window.entries).slice(0, 3);
  const representativeComments = buildRepresentativeComments(window);
  const confidence = clamp(
    Math.round(58 + spikeRatio(peakPerMinute, baselinePerMinute) * 8 + Math.min(uniqueAuthors, 20) * 0.8 + reactionBonus(window.dominantReaction)),
    60,
    96
  );
  const sparkline = buildSparkline(window.entries, window.clipStart, window.clipEnd);
  const peakOffsetSeconds = Math.max(0, Math.round(window.peakBucket.start + windowSec / 2 - window.clipStart));
  const reactionLabel = reactionLabels[window.dominantReaction];

  const topPhrase = repeatedPhrases[0] ?? "";
  const shortPhrase = topPhrase.length > 20 ? topPhrase.slice(0, 17) + "…" : topPhrase;

  return {
    id,
    title: topPhrase
      ? `${shortPhrase} · ${reactionLabel} · ${secondsToClock(window.peakBucket.start)}`
      : `${reactionLabel} · ${secondsToClock(window.peakBucket.start)}`,
    streamer: "チャット JSON 取り込み",
    archiveTitle: "チャット JSON 取り込み",
    detectedAt: secondsToClock(window.clipStart),
    duration: secondsToClock(durationSeconds),
    confidence,
    status: "pending",
    summary: `ルールベース解析: ${secondsToClock(window.start)}-${secondsToClock(window.end)} で ${window.entries.length} 件のメッセージ (${uniqueAuthors} ユーザー) を検出。ピーク時 ${peakPerMinute}/分。`,
    whyDetected: [
      `ピーク時のチャット速度: ${peakPerMinute}/分`,
      `${reactionLabel} を検出`,
      repeatedPhrases[0] ? `繰り返し語句: ${repeatedPhrases[0]}` : `${uniqueAuthors} 人のユニークユーザー`
    ],
    tags: reactionTags[window.dominantReaction],
    chat: {
      messages: window.entries.length,
      peakPerMinute,
      topPhrases: repeatedPhrases.length > 0 ? repeatedPhrases : [reactionLabel, "盛り上がり", "確認"],
      sentiment: reactionLabel
    },
    peak: {
      offset: secondsToClock(peakOffsetSeconds),
      label: `${reactionLabel} peak`,
      intensity: clamp(Math.max(...sparkline), 45, 98),
      sparkline
    },
    transcript: [
      "まだ文字起こしはインポートされていません。",
      "チャットが盛り上がった付近のソースアーカイブを確認してください。",
      "代表コメントとマーカーを参考に、編集する価値があるか判断してください。"
    ],
    transcriptSegments: buildTranscriptPlaceholders(window, peakOffsetSeconds),
    representativeComments,
    detectionReasons: buildDetectionReasons(window, baselinePerMinute, globalPeakPerMinute, uniqueAuthors, windowSec),
    warnings: buildWarnings(window, baselinePerMinute, windowSec),
    notes: {
      editPlan: `${secondsToClock(window.clipStart)}-${secondsToClock(window.clipEnd)} を確認。チャットスパイク前の文脈から始めて、${reactionLabel} に視覚的・音声的な見どころがあるかチェックする。`,
      titleIdea: `${secondsToClock(window.peakBucket.start)} 頃に${reactionLabel}`,
      thumbnailIdea: "チャットピーク付近の配信者のリアクションフレームを使用。一つ短いチャット語句を追加すると効果的。",
      uploadText: "インポートしたチャット JSON から生成。公開前にソース動画の内容を必ず確認してください。"
    },
    markers: buildMarkers(id, peakOffsetSeconds, durationSeconds, window.dominantReaction),
    variants: buildVariants(id, window.clipStart, window.clipEnd, window.peakBucket.start, window.peakBucket.end, clipLength),
    selectedVariantId: `${id}-standard`,
    visualTone: visualTones[window.dominantReaction]
  };
}

function countReactions(entries: ChatLogEntry[]): Record<ReactionKind, number> {
  const counts: Record<ReactionKind, number> = {
    laughter: 0,
    surprise: 0,
    praise: 0,
    clip: 0,
    general: 0
  };

  for (const entry of entries) {
    const matchedKinds = Object.entries(reactionRules).filter(([, rules]) => rules.some((rule) => rule.test(entry.message)));

    if (matchedKinds.length === 0) {
      counts.general += 1;
    } else {
      for (const [kind] of matchedKinds) {
        counts[kind as Exclude<ReactionKind, "general">] += 1;
      }
    }
  }

  return counts;
}

function dominantReactionKind(counts: Record<ReactionKind, number>): ReactionKind {
  const candidates: ReactionKind[] = ["clip", "surprise", "laughter", "praise", "general"];
  return candidates.reduce((best, kind) => (counts[kind] > counts[best] ? kind : best), "general");
}

function buildRepresentativeComments(window: CandidateWindow): RepresentativeComment[] {
  const scored = window.entries
    .map((entry) => ({ entry, score: messageSignalScore(entry.message) }))
    .sort((a, b) => b.score - a.score || a.entry.timestamp_seconds - b.entry.timestamp_seconds);
  const selected: RepresentativeComment[] = [];
  const usedMessages = new Set<string>();

  for (const { entry, score } of scored) {
    const normalized = normalizePhrase(entry.message);
    if (!normalized || usedMessages.has(normalized)) {
      continue;
    }

    usedMessages.add(normalized);
    selected.push({
      time: secondsToClock(Math.max(0, entry.timestamp_seconds - window.clipStart)),
      author: entry.author_name,
      text: entry.message,
      intensity: score >= 5 ? "high" : score >= 2 ? "medium" : "low"
    });

    if (selected.length === 4) {
      break;
    }
  }

  if (selected.length > 0) {
    return selected;
  }

  return window.entries.slice(0, 4).map((entry) => ({
    time: secondsToClock(Math.max(0, entry.timestamp_seconds - window.clipStart)),
    author: entry.author_name,
    text: entry.message,
    intensity: "medium"
  }));
}

function buildDetectionReasons(window: CandidateWindow, baselinePerMinute: number, globalPeakPerMinute: number, uniqueAuthors: number, windowSec: number): DetectionReason[] {
  const peakPerMinute = Math.round(window.peakBucket.entries.length * (60 / windowSec));
  const reactionCounts = countReactions(window.entries);
  const dominant = dominantReactionKind(reactionCounts);

  return [
    {
      label: "チャット速度スパイク",
      detail: `ピーク時 ${peakPerMinute}/分 (ベースライン約 ${baselinePerMinute}/分)。`,
      score: clamp(Math.round(spikeRatio(peakPerMinute, baselinePerMinute) * 24), 50, 98)
    },
    {
      label: reactionLabels[dominant],
      detail: `${reactionCounts[dominant]} 件のメッセージが${reactionLabels[dominant]}のパターンに一致。`,
      score: clamp(55 + reactionCounts[dominant] * 4, 55, 95)
    },
    {
      label: "参加者の多さ",
      detail: `候補ウィンドウ内に ${uniqueAuthors} 人のユニークユーザーが参加。全体のインポート済みピークは ${globalPeakPerMinute}/分。`,
      score: clamp(45 + uniqueAuthors * 3, 45, 92)
    }
  ];
}

function buildWarnings(window: CandidateWindow, baselinePerMinute: number, windowSec: number): CandidateWarning[] {
  const warnings: CandidateWarning[] = [
    {
      label: "チャットのみ",
      detail: "この候補はチャット JSON のみから生成されています。元動画に見どころ (映像/音声) があるか確認してください。",
      severity: "medium"
    }
  ];
  const peakPerMinute = Math.round(window.peakBucket.entries.length * (60 / windowSec));

  if (window.entries.length < 12) {
    warnings.push({
      label: "サンプル少数",
      detail: "この範囲のコメントが少ないため、ハイライトスコアが不安定かもしれません。",
      severity: "low"
    });
  }

  if (spikeRatio(peakPerMinute, baselinePerMinute) < 1.8) {
    warnings.push({
      label: "スパイクが弱い",
      detail: "ピークがベースラインをやや上回る程度です。編集時間をかける前に確認してください。",
      severity: "low"
    });
  }

  return warnings;
}

function buildTranscriptPlaceholders(window: CandidateWindow, peakOffsetSeconds: number): TranscriptSegment[] {
  return [
    {
      start: "00:00",
      end: secondsToClock(Math.min(10, Math.max(5, peakOffsetSeconds - 10))),
      speaker: "システム",
      text: "まだ文字起こしは利用できません。この候補はチャット活動から生成されました。"
    },
    {
      start: secondsToClock(Math.max(0, peakOffsetSeconds - 8)),
      end: secondsToClock(peakOffsetSeconds + 8),
      speaker: "チャットシグナル",
      text: `チャットピーク付近で${reactionLabels[window.dominantReaction]}を検出。`,
      highlight: true
    },
    {
      start: secondsToClock(Math.max(0, peakOffsetSeconds + 10)),
      end: secondsToClock(Math.max(20, peakOffsetSeconds + 24)),
      speaker: "編集者メモ",
      text: "この範囲をソースアーカイブで確認してから候補を選択してください。"
    }
  ];
}

function buildMarkers(id: string, peakOffsetSeconds: number, durationSeconds: number, reaction: ReactionKind): ClipCandidateMarker[] {
  const setupTime = secondsToClock(Math.max(0, peakOffsetSeconds - 20));
  const peakTime = secondsToClock(peakOffsetSeconds);
  const endingTime = secondsToClock(Math.min(durationSeconds, peakOffsetSeconds + 25));

  return [
    { id: `${id}-marker-setup`, time: setupTime, label: "スパイク前の文脈", kind: "setup" },
    { id: `${id}-marker-peak`, time: peakTime, label: `${reactionLabels[reaction]} のピーク`, kind: reaction === "laughter" ? "funny" : "peak" },
    { id: `${id}-marker-ending`, time: endingTime, label: "見どころ/ENDING を確認", kind: "ending" }
  ];
}

function buildVariants(id: string, clipStart: number, clipEnd: number, peakStart: number, peakEnd: number, clipLength: ClipLengthPreset = "standard"): ClipCandidateVariant[] {
  // Scale factor based on clip length preset:
  // short   = 0.6x  → tight around the peak
  // standard = 1.0x → current default
  // long    = 1.5x  → extra context before/after
  const scale = clipLength === "short" ? 0.6 : clipLength === "long" ? 1.5 : 1.0;
  const SHORT_LEAD = Math.round(15 * scale);
  const SHORT_TRAIL = Math.round(25 * scale);
  const CONTEXT_BEFORE = Math.round(20 * scale);
  const CONTEXT_AFTER = Math.round(20 * scale);
  const LONG_EXTRA = Math.round(40 * scale);

  const shortStart = Math.max(0, peakStart - SHORT_LEAD);
  const shortEnd = peakEnd + SHORT_TRAIL;
  const standardStart = clipStart;
  const standardEnd = clipEnd;
  const contextStart = Math.max(0, clipStart - CONTEXT_BEFORE);
  const contextEnd = clipEnd + CONTEXT_AFTER;

  const variants: ClipCandidateVariant[] = [
    {
      id: `${id}-short`,
      label: clipLength === "short" ? "最小限" : "スパイクのみ",
      start: secondsToClock(shortStart),
      end: secondsToClock(shortEnd),
      duration: secondsToClock(shortEnd - shortStart),
      description: "最も強いチャット反応の時間帯を集中的に切り出し。",
      tradeoff: "短時間で確認できるが、前後の文脈が抜ける可能性あり。"
    },
    {
      id: `${id}-standard`,
      label: clipLength === "long" ? "標準" : "標準レビュー",
      start: secondsToClock(standardStart),
      end: secondsToClock(standardEnd),
      duration: secondsToClock(standardEnd - standardStart),
      description: "リードイン、チャットスパイク、その後の余韻までを含む。",
      tradeoff: "人間のレビューには最適なデフォルト。",
      recommended: clipLength !== "long"
    },
    {
      id: `${id}-context`,
      label: clipLength === "long" ? "文脈広め" : "文脈多め",
      start: secondsToClock(contextStart),
      end: secondsToClock(contextEnd),
      duration: secondsToClock(contextEnd - contextStart),
      description: "前後により長いバッファを追加。",
      tradeoff: "文脈が安全だが、レビューに時間がかかる。"
    }
  ];

  // Long preset gets a 4th "extra long" variant for game streams where more
  // context around a highlight is valuable (e.g. build-up + reaction + aftermath).
  if (clipLength === "long") {
    const extraLongStart = Math.max(0, clipStart - LONG_EXTRA);
    const extraLongEnd = clipEnd + LONG_EXTRA;
    variants.push({
      id: `${id}-extralong`,
      label: "超長め（ゲーム向け）",
      start: secondsToClock(extraLongStart),
      end: secondsToClock(extraLongEnd),
      duration: secondsToClock(extraLongEnd - extraLongStart),
      description: "前後に大幅なバッファを追加。ゲームの展開・反応・余韻まで包括。",
      tradeoff: "尺が長いが、見どころを逃さない。長時間配信の切り抜きに最適。",
      recommended: true
    });
  }

  return variants;
}

function buildSparkline(entries: ChatLogEntry[], start: number, end: number) {
  const bucketCount = 12;
  const duration = Math.max(1, end - start);
  const counts = Array.from({ length: bucketCount }, () => 0);

  for (const entry of entries) {
    const bucketIndex = clamp(Math.floor(((entry.timestamp_seconds - start) / duration) * bucketCount), 0, bucketCount - 1);
    counts[bucketIndex] += 1;
  }

  const max = Math.max(...counts, 1);
  return counts.map((count) => clamp(Math.round((count / max) * 92) + 6, 8, 98));
}

function topPhrases(entries: ChatLogEntry[]) {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    const phrase = normalizePhrase(entry.message);
    if (!phrase) {
      continue;
    }

    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([phrase]) => phrase.toUpperCase());
}

function messageSignalScore(message: string) {
  let score = 0;

  for (const [kind, rules] of Object.entries(reactionRules)) {
    if (rules.some((rule) => rule.test(message))) {
      score += kind === "clip" ? 4 : kind === "surprise" ? 3 : 2;
    }
  }

  if (message.length <= 12) {
    score += 1;
  }

  return score;
}

function normalizePhrase(message: string) {
  return message.trim().replace(/\s+/g, " ").slice(0, 48).toLowerCase();
}

function reactionBonus(reaction: ReactionKind) {
  if (reaction === "clip") {
    return 9;
  }

  if (reaction === "surprise" || reaction === "laughter") {
    return 7;
  }

  if (reaction === "praise") {
    return 5;
  }

  return 2;
}

function spikeRatio(value: number, baseline: number) {
  return value / Math.max(baseline, 1);
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function secondsToClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export type ChatAnalysisCsvRow = {
  start: number;
  end: number;
  score: number;
  chatCount: number;
  keywordHits: number;
  matchedKeywords: string[];
};

export function exportChatAnalysisCsv(
  entries: ChatLogEntry[],
  windowSeconds = 30,
  keywordWeight = 1
): ChatAnalysisCsvRow[] {
  if (entries.length === 0) return [];

  const sorted = [...entries].filter(e => e.message.trim().length > 0).sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
  const minTs = sorted[0].timestamp_seconds;
  const maxTs = sorted[sorted.length - 1].timestamp_seconds;

  const buckets = buildBuckets(sorted, windowSeconds, keywordWeight);
  const rows: ChatAnalysisCsvRow[] = [];

  for (let ts = minTs; ts <= maxTs; ts += windowSeconds) {
    const bucketIndex = Math.floor(ts / windowSeconds);
    const bucket = buckets.find(b => b.index === bucketIndex) ?? null;
    const start = bucketIndex * windowSeconds;
    const end = (bucketIndex + 1) * windowSeconds;

    if (bucket) {
      const reactions = bucket.reactionCounts;
      const totalKeywordHits = reactions.laughter + reactions.surprise + reactions.praise + reactions.clip;
      const matchedKeywords = [
        ...(reactions.laughter > 0 ? ["laughter"] : []),
        ...(reactions.surprise > 0 ? ["surprise"] : []),
        ...(reactions.praise > 0 ? ["praise"] : []),
        ...(reactions.clip > 0 ? ["clip"] : []),
      ];
      rows.push({
        start,
        end,
        score: bucket.signalScore,
        chatCount: bucket.entries.length,
        keywordHits: totalKeywordHits,
        matchedKeywords,
      });
    } else {
      rows.push({ start, end, score: 0, chatCount: 0, keywordHits: 0, matchedKeywords: [] });
    }
  }

  return rows;
}
