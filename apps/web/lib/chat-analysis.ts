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

const WINDOW_SECONDS = 30;
const CONTEXT_BEFORE_SECONDS = 25;
const CONTEXT_AFTER_SECONDS = 45;
const MAX_CANDIDATES = 6;

const reactionRules: Record<Exclude<ReactionKind, "general">, RegExp[]> = {
  laughter: [/草+/, /w{2,}/i, /ｗ{2,}/, /笑+/, /爆笑/, /lol/i, /lmao/i, /haha/i, /ハハ/],
  surprise: [/え[!?！？]?/, /待って/, /まじ|マジ/, /やば|ヤバ/, /うそ|嘘/, /no way/i, /what/i, /wtf/i, /omg/i, /[!?！？]{2,}/],
  praise: [/うま|上手|うますぎ/, /すご|凄/, /神/, /天才/, /かわいい|可愛い/, /nice/i, /clutch/i, /gg/i, /beautiful/i, /泣|cry/i],
  clip: [/clip/i, /クリップ/, /切り抜き|切抜き/, /タイムスタンプ|timestamp/i, /ここ好き/]
};

const reactionLabels: Record<ReactionKind, string> = {
  laughter: "Laughter burst",
  surprise: "Surprise spike",
  praise: "Praise wave",
  clip: "Clip request spike",
  general: "Chat activity spike"
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

export function analyzeChatJson(input: string, idPrefix = `chat-${Date.now()}`): ChatAnalysisResult {
  const entries = parseChatJson(input);
  return analyzeChatEntries(entries, idPrefix);
}

export function analyzeChatEntries(entries: ChatLogEntry[], idPrefix = `chat-${Date.now()}`): ChatAnalysisResult {
  const normalizedEntries = entries
    .filter((entry) => entry.message.trim().length > 0)
    .sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);

  if (normalizedEntries.length === 0) {
    throw new Error("No non-empty chat messages were found after parsing.");
  }

  const buckets = buildBuckets(normalizedEntries);
  const counts = buckets.map((bucket) => bucket.entries.length);
  const baselinePerMinute = Math.round(median(counts) * (60 / WINDOW_SECONDS));
  const peakPerMinute = Math.round(Math.max(...counts) * (60 / WINDOW_SECONDS));
  const threshold = Math.max(6, median(counts) * 2.2, average(counts) * 1.6);
  const highlightedBuckets = buckets.filter((bucket) => {
    const hasVolumeSpike = bucket.entries.length >= threshold;
    const hasReactionSpike = bucket.signalScore >= Math.max(10, threshold * 1.35) && bucket.entries.length >= 4;
    return hasVolumeSpike || hasReactionSpike;
  });

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

  const windows = mergeHighlightedBuckets(highlightedBuckets, normalizedEntries);
  const candidates = windows
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map((window, index) => buildCandidateFromWindow(window, index, idPrefix, baselinePerMinute, peakPerMinute));

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

function buildBuckets(entries: ChatLogEntry[]): Bucket[] {
  const bucketMap = new Map<number, ChatLogEntry[]>();

  for (const entry of entries) {
    const index = Math.floor(entry.timestamp_seconds / WINDOW_SECONDS);
    bucketMap.set(index, [...(bucketMap.get(index) ?? []), entry]);
  }

  const minIndex = Math.min(...bucketMap.keys());
  const maxIndex = Math.max(...bucketMap.keys());
  const buckets: Bucket[] = [];

  for (let index = minIndex; index <= maxIndex; index += 1) {
    const bucketEntries = bucketMap.get(index) ?? [];
    const reactionCounts = countReactions(bucketEntries);
    const uniqueAuthors = new Set(bucketEntries.map((entry) => entry.author_name)).size;
    const keywordScore = reactionCounts.laughter * 1.8 + reactionCounts.surprise * 2 + reactionCounts.praise * 1.5 + reactionCounts.clip * 2.5;

    buckets.push({
      index,
      start: index * WINDOW_SECONDS,
      end: (index + 1) * WINDOW_SECONDS,
      entries: bucketEntries,
      uniqueAuthors,
      reactionCounts,
      signalScore: bucketEntries.length + uniqueAuthors * 0.8 + keywordScore
    });
  }

  return buckets;
}

function mergeHighlightedBuckets(highlightedBuckets: Bucket[], entries: ChatLogEntry[]): CandidateWindow[] {
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
    const clipStart = Math.max(0, start - CONTEXT_BEFORE_SECONDS);
    const clipEnd = end + CONTEXT_AFTER_SECONDS;
    const windowEntries = entries.filter((entry) => entry.timestamp_seconds >= clipStart && entry.timestamp_seconds <= clipEnd);
    const peakBucket = cluster.reduce((best, bucket) => (bucket.signalScore > best.signalScore ? bucket : best), cluster[0]);
    const reactionCounts = countReactions(windowEntries);
    const dominantReaction = dominantReactionKind(reactionCounts);
    const score = cluster.reduce((total, bucket) => total + bucket.signalScore, 0) + windowEntries.length * 0.35;

    return { start, end, clipStart, clipEnd, buckets: cluster, entries: windowEntries, peakBucket, score, dominantReaction };
  });
}

function buildCandidateFromWindow(
  window: CandidateWindow,
  index: number,
  idPrefix: string,
  baselinePerMinute: number,
  globalPeakPerMinute: number
): ClipCandidate {
  const id = `${idPrefix}-${index + 1}`;
  const durationSeconds = Math.max(30, window.clipEnd - window.clipStart);
  const peakPerMinute = Math.round(window.peakBucket.entries.length * (60 / WINDOW_SECONDS));
  const uniqueAuthors = new Set(window.entries.map((entry) => entry.author_name)).size;
  const repeatedPhrases = topPhrases(window.entries).slice(0, 3);
  const representativeComments = buildRepresentativeComments(window);
  const confidence = clamp(
    Math.round(58 + spikeRatio(peakPerMinute, baselinePerMinute) * 8 + Math.min(uniqueAuthors, 20) * 0.8 + reactionBonus(window.dominantReaction)),
    60,
    96
  );
  const sparkline = buildSparkline(window.entries, window.clipStart, window.clipEnd);
  const peakOffsetSeconds = Math.max(0, Math.round(window.peakBucket.start + WINDOW_SECONDS / 2 - window.clipStart));
  const reactionLabel = reactionLabels[window.dominantReaction];

  return {
    id,
    title: `${reactionLabel} around ${secondsToClock(window.peakBucket.start)}`,
    streamer: "Imported chat log",
    archiveTitle: "Chat JSON import",
    detectedAt: secondsToClock(window.clipStart),
    duration: secondsToClock(durationSeconds),
    confidence,
    status: "pending",
    summary: `Rule-based chat analysis found ${window.entries.length} messages from ${uniqueAuthors} users around ${secondsToClock(window.start)}-${secondsToClock(window.end)}. Peak activity reached ${peakPerMinute} messages/minute.`,
    whyDetected: [
      `Peak chat velocity: ${peakPerMinute}/min`,
      `${reactionLabel} signals detected`,
      repeatedPhrases[0] ? `Repeated phrase: ${repeatedPhrases[0]}` : `${uniqueAuthors} unique chatters`
    ],
    tags: reactionTags[window.dominantReaction],
    chat: {
      messages: window.entries.length,
      peakPerMinute,
      topPhrases: repeatedPhrases.length > 0 ? repeatedPhrases : [reactionLabel, "CHAT SPIKE", "REVIEW"],
      sentiment: reactionLabel
    },
    peak: {
      offset: secondsToClock(peakOffsetSeconds),
      label: `${reactionLabel} peak`,
      intensity: clamp(Math.max(...sparkline), 45, 98),
      sparkline
    },
    transcript: [
      "No transcript imported yet.",
      "Review the source archive around this chat spike.",
      "Use representative comments and markers to decide whether this is worth editing."
    ],
    transcriptSegments: buildTranscriptPlaceholders(window, peakOffsetSeconds),
    representativeComments,
    detectionReasons: buildDetectionReasons(window, baselinePerMinute, globalPeakPerMinute, uniqueAuthors),
    warnings: buildWarnings(window, baselinePerMinute),
    notes: {
      editPlan: `Review ${secondsToClock(window.clipStart)}-${secondsToClock(window.clipEnd)}. Start with context before the chat spike, then check whether the ${reactionLabel.toLowerCase()} has a clear visual or audio payoff.`,
      titleIdea: `${reactionLabel} during stream at ${secondsToClock(window.peakBucket.start)}`,
      thumbnailIdea: "Use the streamer reaction frame near the chat peak. Add one short chat phrase if it supports the moment.",
      uploadText: "Generated from imported chat JSON. Confirm the source video context manually before publishing."
    },
    markers: buildMarkers(id, peakOffsetSeconds, durationSeconds, window.dominantReaction),
    variants: buildVariants(id, window.clipStart, window.clipEnd, window.peakBucket.start, window.peakBucket.end),
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

function buildDetectionReasons(window: CandidateWindow, baselinePerMinute: number, globalPeakPerMinute: number, uniqueAuthors: number): DetectionReason[] {
  const peakPerMinute = Math.round(window.peakBucket.entries.length * (60 / WINDOW_SECONDS));
  const reactionCounts = countReactions(window.entries);
  const dominant = dominantReactionKind(reactionCounts);

  return [
    {
      label: "Chat velocity spike",
      detail: `Peak window reached ${peakPerMinute} messages/minute versus a baseline near ${baselinePerMinute}/minute.`,
      score: clamp(Math.round(spikeRatio(peakPerMinute, baselinePerMinute) * 24), 50, 98)
    },
    {
      label: reactionLabels[dominant],
      detail: `${reactionCounts[dominant]} messages matched ${reactionLabels[dominant].toLowerCase()} keywords or patterns.`,
      score: clamp(55 + reactionCounts[dominant] * 4, 55, 95)
    },
    {
      label: "Crowd participation",
      detail: `${uniqueAuthors} unique chatters appeared in the candidate window. Global imported peak was ${globalPeakPerMinute}/minute.`,
      score: clamp(45 + uniqueAuthors * 3, 45, 92)
    }
  ];
}

function buildWarnings(window: CandidateWindow, baselinePerMinute: number): CandidateWarning[] {
  const warnings: CandidateWarning[] = [
    {
      label: "Chat-only signal",
      detail: "This candidate was generated from chat JSON only. Confirm the source video has a visible or audible payoff.",
      severity: "medium"
    }
  ];
  const peakPerMinute = Math.round(window.peakBucket.entries.length * (60 / WINDOW_SECONDS));

  if (window.entries.length < 12) {
    warnings.push({
      label: "Small sample",
      detail: "Few comments were available in this range, so the highlight score may be unstable.",
      severity: "low"
    });
  }

  if (spikeRatio(peakPerMinute, baselinePerMinute) < 1.8) {
    warnings.push({
      label: "Weak spike ratio",
      detail: "The peak is only moderately above baseline. Review before spending edit time.",
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
      speaker: "System",
      text: "Transcript not available yet. This candidate was generated from imported chat activity."
    },
    {
      start: secondsToClock(Math.max(0, peakOffsetSeconds - 8)),
      end: secondsToClock(peakOffsetSeconds + 8),
      speaker: "Chat signal",
      text: `${reactionLabels[window.dominantReaction]} detected near the chat peak.`,
      highlight: true
    },
    {
      start: secondsToClock(Math.max(0, peakOffsetSeconds + 10)),
      end: secondsToClock(Math.max(20, peakOffsetSeconds + 24)),
      speaker: "Editor note",
      text: "Check this range in the source archive before selecting the candidate."
    }
  ];
}

function buildMarkers(id: string, peakOffsetSeconds: number, durationSeconds: number, reaction: ReactionKind): ClipCandidateMarker[] {
  const setupTime = secondsToClock(Math.max(0, peakOffsetSeconds - 20));
  const peakTime = secondsToClock(peakOffsetSeconds);
  const endingTime = secondsToClock(Math.min(durationSeconds, peakOffsetSeconds + 25));

  return [
    { id: `${id}-marker-setup`, time: setupTime, label: "Context before chat spike", kind: "setup" },
    { id: `${id}-marker-peak`, time: peakTime, label: `${reactionLabels[reaction]} peak`, kind: reaction === "laughter" ? "funny" : "peak" },
    { id: `${id}-marker-ending`, time: endingTime, label: "Check payoff / ending", kind: "ending" }
  ];
}

function buildVariants(id: string, clipStart: number, clipEnd: number, peakStart: number, peakEnd: number): ClipCandidateVariant[] {
  const shortStart = Math.max(0, peakStart - 15);
  const shortEnd = peakEnd + 25;
  const standardStart = clipStart;
  const standardEnd = clipEnd;
  const contextStart = Math.max(0, clipStart - 20);
  const contextEnd = clipEnd + 20;

  return [
    {
      id: `${id}-short`,
      label: "Spike only",
      start: secondsToClock(shortStart),
      end: secondsToClock(shortEnd),
      duration: secondsToClock(shortEnd - shortStart),
      description: "Tight cut around the strongest chat reaction window.",
      tradeoff: "Fast to review, but may miss setup context."
    },
    {
      id: `${id}-standard`,
      label: "Standard review",
      start: secondsToClock(standardStart),
      end: secondsToClock(standardEnd),
      duration: secondsToClock(standardEnd - standardStart),
      description: "Includes lead-in context, chat spike, and aftermath.",
      tradeoff: "Best default for human review.",
      recommended: true
    },
    {
      id: `${id}-context`,
      label: "Context review",
      start: secondsToClock(contextStart),
      end: secondsToClock(contextEnd),
      duration: secondsToClock(contextEnd - contextStart),
      description: "Adds extra buffer before and after the generated candidate.",
      tradeoff: "Safer context, slower to review."
    }
  ];
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

function secondsToClock(totalSeconds: number) {
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
