export type HighlightCandidate = {
  id?: string | number;
  rank: number;
  start?: number;
  end?: number;
  clip_start?: number;
  clip_duration?: number;
  peak_time?: number;
  score?: number;
  chat_count?: number;
  keyword_hits?: number;
  matched_keywords?: string[];
  reasons?: string[];
  title?: string;
  output_file?: string | null;
};

export function secondsToTwitchTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

export function getCandidateSeekTime(candidate: HighlightCandidate): number | null {
  const value =
    typeof candidate.clip_start === "number"
      ? candidate.clip_start
      : typeof candidate.start === "number"
        ? candidate.start
        : typeof candidate.peak_time === "number"
          ? candidate.peak_time
          : null;
  if (value === null || Number.isNaN(value)) return null;
  return Math.max(0, value);
}

export function extractVideoId(url: string): string | null {
  const m = url.match(/(?:twitch\.tv\/videos\/|video=)(\d+)/i);
  return m ? m[1] : null;
}
