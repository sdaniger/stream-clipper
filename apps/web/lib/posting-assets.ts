import type { ClipCandidate, ClipCandidateVariant, RepresentativeComment, TranscriptSegment } from "@/lib/mock-candidates";

export type TitleMaterial = {
  label: string;
  value: string;
  reason: string;
};

export type ThumbnailTimestampCandidate = {
  label: string;
  time: string;
  seconds: number;
  reason: string;
  source: "peak" | "marker" | "comment" | "transcript";
};

export type PostingAssets = {
  titleMaterials: TitleMaterial[];
  titleKeywords: string[];
  thumbnailCandidates: ThumbnailTimestampCandidate[];
  thumbnailTextIdeas: string[];
  oneLineSummary: string;
};

export function extractPostingAssets(candidate: ClipCandidate, selectedVariant: ClipCandidateVariant | undefined): PostingAssets {
  const durationSeconds = Math.max(1, parseTimeToSeconds(selectedVariant?.duration ?? candidate.duration));
  const titleMaterials = dedupeTitleMaterials([
    { label: "Current title", value: candidate.title, reason: "Existing working title from the candidate." },
    { label: "Title memo", value: candidate.notes.titleIdea, reason: "Editor-provided title direction." },
    ...candidate.chat.topPhrases.slice(0, 3).map((phrase) => ({ label: "Chat phrase", value: phrase, reason: "Repeated or high-signal chat phrase." })),
    ...candidate.representativeComments.filter(isTitleComment).slice(0, 3).map((comment) => ({ label: "Reaction quote", value: comment.text, reason: `Representative ${comment.intensity} chat reaction at +${comment.time}.` })),
    ...candidate.transcriptSegments.filter((segment) => segment.highlight).slice(0, 2).map((segment) => ({ label: "Spoken quote", value: segment.text, reason: `Highlighted transcript line around +${segment.start}.` }))
  ]).slice(0, 8);

  const titleKeywords = dedupeStrings([
    ...candidate.tags,
    ...candidate.chat.topPhrases,
    candidate.peak.label,
    candidate.chat.sentiment,
    selectedVariant?.label ?? ""
  ].map(cleanKeyword)).filter(Boolean).slice(0, 10);

  const thumbnailCandidates = dedupeThumbnailCandidates([
    {
      label: "Peak reaction",
      time: candidate.peak.offset,
      seconds: parseTimeToSeconds(candidate.peak.offset),
      reason: `${candidate.peak.label} with ${candidate.peak.intensity}/100 intensity.`,
      source: "peak" as const
    },
    ...candidate.markers.filter((marker) => marker.kind === "peak" || marker.kind === "funny" || marker.kind === "ending").map((marker) => ({
      label: marker.kind === "funny" ? "Funny marker" : marker.kind === "ending" ? "Reaction aftermath" : "Editor peak marker",
      time: marker.time,
      seconds: parseTimeToSeconds(marker.time),
      reason: marker.label,
      source: "marker" as const
    })),
    ...candidate.representativeComments.filter((comment) => comment.intensity === "high").slice(0, 2).map((comment) => ({
      label: "High chat reaction",
      time: comment.time,
      seconds: parseTimeToSeconds(comment.time),
      reason: comment.text,
      source: "comment" as const
    })),
    ...candidate.transcriptSegments.filter((segment) => segment.highlight).slice(0, 2).map((segment) => ({
      label: "Highlighted line",
      time: segment.start,
      seconds: parseTimeToSeconds(segment.start),
      reason: segment.text,
      source: "transcript" as const
    }))
  ], durationSeconds).slice(0, 6);

  return {
    titleMaterials,
    titleKeywords,
    thumbnailCandidates,
    thumbnailTextIdeas: dedupeStrings([
      candidate.notes.thumbnailIdea,
      candidate.chat.topPhrases[0] ?? "",
      candidate.peak.label,
      titleKeywords[0] ?? ""
    ].filter(Boolean)).slice(0, 4),
    oneLineSummary: candidate.summary
  };
}

export function formatPostingText(assets: PostingAssets) {
  return [
    "Title materials:",
    ...assets.titleMaterials.map((material) => `- ${material.label}: ${material.value}`),
    "",
    "Title keywords:",
    assets.titleKeywords.join(", "),
    "",
    "Thumbnail timestamps:",
    ...assets.thumbnailCandidates.map((candidate) => `- +${candidate.time}: ${candidate.label} - ${candidate.reason}`),
    "",
    "Thumbnail text ideas:",
    assets.thumbnailTextIdeas.join(" / ")
  ].join("\n");
}

function isTitleComment(comment: RepresentativeComment) {
  return comment.intensity === "high" || /clip|切り抜き|ここ|no way|草|神|天才|最高/i.test(comment.text);
}

function dedupeTitleMaterials(materials: TitleMaterial[]) {
  const seen = new Set<string>();
  const result: TitleMaterial[] = [];

  for (const material of materials) {
    const value = material.value.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({ ...material, value });
  }

  return result;
}

function dedupeThumbnailCandidates(candidates: ThumbnailTimestampCandidate[], durationSeconds: number) {
  const seen = new Set<number>();
  const result: ThumbnailTimestampCandidate[] = [];

  for (const candidate of candidates) {
    const seconds = Math.min(Math.max(0, Math.round(candidate.seconds)), Math.max(0, durationSeconds - 1));
    if (seen.has(seconds)) {
      continue;
    }

    seen.add(seconds);
    result.push({ ...candidate, seconds, time: secondsToTime(seconds) });
  }

  return result.sort((a, b) => a.seconds - b.seconds);
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = value.trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(cleaned);
  }

  return result;
}

function cleanKeyword(value: string) {
  return value.trim().replace(/^#+/, "").slice(0, 36);
}

function parseTimeToSeconds(time: string) {
  const parts = time.split(":").map(Number);

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return Number.isFinite(parts[0]) ? parts[0] : 0;
}

function secondsToTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
