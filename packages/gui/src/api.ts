export interface HighlightCandidate {
  rank: number;
  start: number;
  end: number;
  peak_time: number;
  score: number;
  chat_count: number;
  keyword_hits: number;
  matched_keywords: string[];
  reasons: string[];
  clip_start: number;
  clip_duration: number;
  output_file: string | null;
}

export interface TimelineRow {
  start: number;
  end: number;
  score: number;
  chat_count: number;
  keyword_hits: number;
  matched_keywords: string[];
}

export interface AnalyzeResponse {
  highlights: HighlightCandidate[];
  timeline: TimelineRow[];
  metadata: Record<string, unknown>;
}

export interface ClipCreateResponse {
  output_file: string;
  success: boolean;
}

export interface ClipBatchResponse {
  clips: ClipCreateResponse[];
}

export interface TranscribeResponse {
  text: string;
  segments: Array<{
    id: number;
    start: number;
    end: number;
    start_time: string;
    end_time: string;
    text: string;
  }>;
  language: string | null;
  duration_seconds: number | null;
}

export interface ShortCreateResponse {
  output_file: string;
  success: boolean;
}

export interface OutputFileEntry {
  name: string;
  size: number;
  path: string;
}

export interface OutputFilesResponse {
  files: OutputFileEntry[];
  path: string;
}

/* ─── Unified chat message format (shared with Next.js /api/twitch/chat) ─── */
export type NormalizedChatMessage = {
  timestamp: number;
  time_sec: number;
  message: string;
  author?: string;
};

/* ─── Twitch chat fetch API response ─── */
interface TwitchChatApiResponse {
  ok: boolean;
  video_id?: string;
  message_count?: number;
  chat?: NormalizedChatMessage[];
  error_code?: string;
  message?: string;
}

/* ─── Base URL for the Next.js chat API (CORS-enabled) ─── */
const CHAT_API_BASE_URL =
  import.meta.env.VITE_CHAT_API_BASE_URL ?? "http://localhost:3000";

/* ─── Generic request helper (for FastAPI backend via proxy) ─── */
async function request<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

/* ─── Fetch Twitch chat via the shared Next.js API route (not directly from Twitch) ─── */
export async function fetchTwitchChat(vodUrl: string): Promise<NormalizedChatMessage[]> {
  const params = new URLSearchParams({ vodUrl });
  const res = await fetch(`${CHAT_API_BASE_URL}/api/twitch/chat?${params}`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    let msg = `Chat API HTTP ${res.status}`;
    try {
      const errBody: TwitchChatApiResponse = await res.json();
      msg = errBody.message ?? msg;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  const data: TwitchChatApiResponse = await res.json();

  if (!data.ok || !data.chat) {
    throw new Error(data.message ?? "Twitch chat fetch failed (API returned !ok)");
  }

  return data.chat;
}

/* ─── Analyze highlights from video + chat ───
 *
 * Two modes:
 *  1) logPath provided → existing file-based flow (unchanged)
 *  2) vodUrl provided  → fetch chat via shared API, then send inline chat_data
 */
export async function analyzeHighlights(
  videoPath: string,
  logPath: string | null,
  vodUrl: string | null,
  options: {
    window?: number;
    top?: number;
    min_gap?: number;
    keywords?: string;
    keywords_list?: string[];
    keyword_weight?: number;
    clip_duration?: number;
    clip_padding?: number;
  }
): Promise<AnalyzeResponse> {
  // If a VOD URL is given (no local log file), fetch chat via shared API first
  if (vodUrl && !logPath) {
    const chatData = await fetchTwitchChat(vodUrl);
    if (chatData.length === 0) {
      throw new Error("Fetched chat is empty — cannot analyze");
    }
    return request<AnalyzeResponse>("/api/gui/analyze", {
      video_path: videoPath,
      chat_data: chatData,
      vod_url: vodUrl,
      window: options.window ?? 30,
      top: options.top ?? 5,
      min_gap: options.min_gap ?? 30,
      keywords_list: options.keywords_list ?? null,
      keywords: options.keywords ?? null,
      keyword_weight: options.keyword_weight ?? 2.0,
      clip_duration: options.clip_duration ?? 30,
      clip_padding: options.clip_padding ?? 5,
    });
  }

  // Legacy file-based path
  return request<AnalyzeResponse>("/api/gui/analyze", {
    video_path: videoPath,
    log_path: logPath,
    window: options.window ?? 30,
    top: options.top ?? 5,
    min_gap: options.min_gap ?? 30,
    keywords_list: options.keywords_list ?? null,
    keywords: options.keywords ?? null,
    keyword_weight: options.keyword_weight ?? 2.0,
    clip_duration: options.clip_duration ?? 30,
    clip_padding: options.clip_padding ?? 5,
  });
}

export async function createClip(
  videoPath: string,
  start: number,
  duration: number,
  outputDir: string,
  rank: number,
  options?: { encoder?: string; mode?: string }
): Promise<ClipCreateResponse> {
  return request<ClipCreateResponse>("/api/gui/clips/create", {
    video_path: videoPath,
    start,
    duration,
    output_dir: outputDir,
    rank,
    encoder: options?.encoder ?? "auto",
    mode: options?.mode ?? "reencode",
  });
}

export async function batchCreateClips(
  videoPath: string,
  highlights: HighlightCandidate[],
  outputDir: string,
  options?: { encoder?: string; mode?: string }
): Promise<ClipBatchResponse> {
  return request<ClipBatchResponse>("/api/gui/clips/batch", {
    video_path: videoPath,
    highlights,
    output_dir: outputDir,
    encoder: options?.encoder ?? "auto",
    mode: options?.mode ?? "reencode",
  });
}

export async function transcribeAudio(
  clipPath: string,
  options?: { model?: string; language?: string }
): Promise<TranscribeResponse> {
  return request<TranscribeResponse>("/api/transcription/transcribe", {
    clip_path: clipPath,
    model: options?.model ?? "turbo",
    language: options?.language ?? "ja",
    device: "cuda",
    compute_type: "float16",
  });
}

export async function createShort(
  videoPath: string,
  start: number,
  duration: number,
  outputDir: string,
  rank: number
): Promise<ShortCreateResponse> {
  return request<ShortCreateResponse>("/api/gui/short/create", {
    video_path: videoPath,
    start,
    duration,
    output_dir: outputDir,
    rank,
  });
}

export async function checkHealth(): Promise<{ status: string }> {
  const res = await fetch("/api/gui/health");
  if (!res.ok) throw new Error("Backend not available");
  return res.json();
}

export async function listOutputFiles(outputDir?: string): Promise<OutputFilesResponse> {
  const params = outputDir ? `?output_dir=${encodeURIComponent(outputDir)}` : "";
  const res = await fetch(`/api/gui/output-files${params}`);
  if (!res.ok) throw new Error("Failed to list output files");
  return res.json();
}
