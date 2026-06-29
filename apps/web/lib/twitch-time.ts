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

/**
 * Extract a Twitch VOD video ID from a variety of URL formats.
 *
 * Supports:
 *   - https://www.twitch.tv/videos/1234567890
 *   - https://twitch.tv/videos/1234567890
 *   - https://www.twitch.tv/streamer/video/1234567890
 *   - https://m.twitch.tv/videos/1234567890
 *   - https://clips.twitch.tv/Slug  (returns the slug, not a numeric id)
 *   - https://www.twitch.tv/streamer/clip/Slug  (returns the slug)
 *   - Bare numeric id: "1234567890"
 *   - URL with `?video=1234567890` query
 *   - Player URL: https://player.twitch.tv/?video=v1234567890
 *
 * Returns the id (or clip slug) as a string, or null if it cannot be parsed.
 */
export function extractVideoId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Bare numeric id
  if (/^\d+$/.test(trimmed)) return trimmed;

  // Player URL: ?video=v12345 or ?video=12345
  const playerMatch = trimmed.match(/[?&]video=v?(\d+)/i);
  if (playerMatch) return playerMatch[1];

  // Standard VOD URL: /videos/12345
  const vodMatch = trimmed.match(/\/videos?\/(\d+)/i);
  if (vodMatch) return vodMatch[1];

  // Streamer's VOD: /streamer/video/12345
  const streamerMatch = trimmed.match(/\/[a-z0-9_]+\/video\/(\d+)/i);
  if (streamerMatch) return streamerMatch[1];

  // Clip slug (alphabetic identifier)
  const clipMatch = trimmed.match(/twitch\.tv\/[a-z0-9_-]+\/clip\/([a-z0-9_-]+)/i)
    || trimmed.match(/clips\.twitch\.tv\/([a-z0-9_-]+)/i);
  if (clipMatch) return clipMatch[1];

  return null;
}
