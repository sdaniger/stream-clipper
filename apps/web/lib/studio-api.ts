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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function request<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
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

export async function analyzeHighlights(
  videoPath: string, logPath: string,
  options: {
    window?: number; top?: number; min_gap?: number;
    keywords?: string; keywords_list?: string[];
    keyword_weight?: number; clip_duration?: number; clip_padding?: number;
  }
): Promise<AnalyzeResponse> {
  return request<AnalyzeResponse>("/api/gui/analyze", {
    video_path: videoPath, log_path: logPath,
    window: options.window ?? 30, top: options.top ?? 5,
    min_gap: options.min_gap ?? 30,
    keywords_list: options.keywords_list ?? null,
    keywords: options.keywords ?? null,
    keyword_weight: options.keyword_weight ?? 2.0,
    clip_duration: options.clip_duration ?? 30,
    clip_padding: options.clip_padding ?? 5,
  });
}

export async function createClip(
  videoPath: string, start: number, duration: number,
  outputDir: string, rank: number,
  options?: { encoder?: string; mode?: string }
): Promise<ClipCreateResponse> {
  return request<ClipCreateResponse>("/api/gui/clips/create", {
    video_path: videoPath, start, duration, output_dir: outputDir, rank,
    encoder: options?.encoder ?? "auto",
    mode: options?.mode ?? "reencode",
  });
}

export async function batchCreateClips(
  videoPath: string, highlights: HighlightCandidate[], outputDir: string,
  options?: { encoder?: string; mode?: string }
): Promise<ClipBatchResponse> {
  return request<ClipBatchResponse>("/api/gui/clips/batch", {
    video_path: videoPath, highlights, output_dir: outputDir,
    encoder: options?.encoder ?? "auto",
    mode: options?.mode ?? "reencode",
  });
}

export async function transcribeAudio(
  clipPath: string, options?: { model?: string; language?: string }
): Promise<TranscribeResponse> {
  return request<TranscribeResponse>("/api/transcription/transcribe", {
    clip_path: clipPath,
    model: options?.model ?? "turbo",
    language: options?.language ?? "ja",
    device: "cuda", compute_type: "float16",
  });
}

export async function createShort(
  videoPath: string, start: number, duration: number,
  outputDir: string, rank: number
): Promise<ShortCreateResponse> {
  return request<ShortCreateResponse>("/api/gui/short/create", {
    video_path: videoPath, start, duration, output_dir: outputDir, rank,
  });
}

export async function listOutputFiles(outputDir?: string): Promise<OutputFilesResponse> {
  const params = outputDir ? `?output_dir=${encodeURIComponent(outputDir)}` : "";
  const res = await fetch(`${API_BASE}/api/gui/output-files${params}`);
  if (!res.ok) throw new Error("Failed to list output files");
  return res.json();
}

// ---- Studio VOD Analysis ----

export interface StudioAnalyzeRequest {
  vod_url: string;
  top_n?: number;
  window?: number;
  min_gap?: number;
  keywords?: string;
  maxMessages?: number;
}

export interface StudioAnalyzeResponse {
  video_id: string;
  title: string | null;
  duration_seconds: number | null;
  message_count: number;
  candidates: HighlightCandidate[];
  timeline: TimelineRow[];
  summary: {
    inputMessages: number;
    analyzedMessages: number;
    candidateCount: number;
    baselinePerMinute: number;
    peakPerMinute: number;
  } | null;
  error?: string;
}

export async function analyzeStudioVod(input: StudioAnalyzeRequest): Promise<StudioAnalyzeResponse> {
  const res = await fetch("/api/studio/analyze-vod", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---- Studio Clip Generation ----

export interface StudioClipRequest {
  inputPath: string;
  candidateId: string;
  variantId?: string;
  start: string;
  duration: string;
  mode?: "copy" | "reencode";
}

export interface StudioClipResponse {
  outputPath: string;
  absoluteOutputPath: string;
  start: string;
  duration: string;
  mode: "copy" | "reencode";
  sizeBytes: number;
  commandPreview: string;
}

export interface StudioClipBatchResponse {
  clips: StudioClipResponse[];
  failed: Array<{ candidateId: string; error: string }>;
}

export async function createStudioClip(input: StudioClipRequest): Promise<StudioClipResponse> {
  const res = await fetch("/api/media/clips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function batchCreateStudioClips(
  inputPath: string,
  candidates: Array<{
    rank: number;
    start?: number;
    end?: number;
    clip_start?: number;
    clip_duration?: number;
    peak_time?: number;
    id?: string | number;
  }>,
  options?: { mode?: "copy" | "reencode" }
): Promise<StudioClipBatchResponse> {
  // The existing /api/media/clips route only handles one at a time, so we
  // call it sequentially. This keeps the surface area minimal while still
  // letting the user kick off a batch from the UI.
  const mode = options?.mode ?? "reencode";
  const variantId = "default";
  const clips: StudioClipResponse[] = [];
  const failed: Array<{ candidateId: string; error: string }> = [];

  for (const c of candidates) {
    const start = c.clip_start ?? c.start ?? c.peak_time ?? 0;
    const end = c.end ?? (c.clip_start != null && c.clip_duration != null ? c.clip_start + c.clip_duration : start + 30);
    const duration = end - start;
    const candidateId = `rank-${c.rank}`;
    try {
      const clip = await createStudioClip({
        inputPath,
        candidateId,
        variantId,
        start: formatTimecode(start),
        duration: formatTimecode(duration),
        mode,
      });
      clips.push(clip);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      failed.push({ candidateId, error: msg });
    }
  }

  return { clips, failed };
}

function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// ---- Studio Danmaku Export ----

export type DanmakuDensity = "low" | "medium" | "high";

export type DanmakuExportOptions = {
  density?: DanmakuDensity;
  font_size?: number;
  font_name?: string;
  comment_duration?: number;
  opacity?: number;
  ng_words?: string[];
  min_message_length?: number;
  deduplicate_consecutive?: boolean;
  play_res_x?: number;
  play_res_y?: number;
  output_dir?: string;
  with_danmaku?: boolean;
  fast?: boolean;
  // New (all-comments mode)
  all_comments?: boolean;
  safety_comment_limit?: number | null;
  preset?: "ultrafast" | "veryfast" | "fast" | "medium" | "slow";
  crf?: number;
  reuse_temp_clip?: boolean;
  reuse_ass?: boolean;
};

export type DanmakuChatMessage = {
  timestamp: number;
  time_sec: number;
  message: string;
  author?: string;
};

export type DanmakuExportSource = "local_file" | "twitch_vod" | "ass_only";

export type DanmakuExportRequest = {
  source?: DanmakuExportSource;
  // For source == "local_file"
  video_path?: string | null;
  // For source == "twitch_vod"
  vod_url?: string | null;
  video_id?: string | null;
  // Common
  candidate: {
    rank: number;
    start?: number;
    end?: number;
    clip_start?: number;
    clip_duration?: number;
    peak_time?: number;
    id?: string | number;
  };
  chat: DanmakuChatMessage[];
  options?: DanmakuExportOptions;
  edited_start?: number;
  edited_end?: number;
};

export type DanmakuFallback = {
  local_file?: boolean;
  twitch_vod?: boolean;
  ass_only?: boolean;
};

export type DanmakuExportResponse = {
  ok: boolean;
  source?: DanmakuExportSource;
  output_file?: string;
  temporary_video_file?: string;
  ass_file?: string;
  // New: every in-range comment is emitted. range_comment_count ==
  // burned_comment_count unless the user opted into a safety cap.
  range_comment_count?: number;
  burned_comment_count?: number;
  /** Hard-burn verification: did the FFmpeg step actually burn the ASS into the MP4? */
  hard_burned?: boolean;
  /** FFmpeg filter actually used (e.g. "ass"). */
  ffmpeg_filter?: string;
  /** Video encoder actually used (e.g. "libx264"). */
  encoder?: string;
  /** Length of the resulting clip in seconds. */
  clip_duration?: number;
  all_comments?: boolean;
  // Legacy aliases
  comment_count?: number;
  in_range_count?: number;
  skipped_ng?: number;
  skipped_too_short?: number;
  skipped_duplicate?: number;
  skipped_safety_limit?: number;
  clip_start?: number;
  clip_end?: number;
  error_code?: string;
  ffmpeg_preset?: string;
  ffmpeg_crf?: number;
  ass_cache_hit?: boolean;
  temp_video_cache_hit?: boolean;
  message?: string;
  fallback?: DanmakuFallback;
  duration_seconds?: number;
};

export async function exportDanmakuClip(
  input: DanmakuExportRequest,
  signal?: AbortSignal
): Promise<DanmakuExportResponse> {
  const res = await fetch("/api/studio/export-danmaku-clip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export type GenerateAssRequest = {
  chat: DanmakuChatMessage[];
  clip_start: number;
  clip_end: number;
  output_path: string;
  options?: DanmakuExportOptions;
};

export type GenerateAssResponse = {
  ok: boolean;
  ass_path: string;
  comment_count: number;
  in_range_count: number;
  skipped_ng: number;
  skipped_too_short: number;
  skipped_duplicate: number;
  error_code?: string;
  message?: string;
  stats?: {
    in_range_count: number;
    used_count: number;
    skipped_ng: number;
    skipped_too_short: number;
    skipped_duplicate: number;
  };
};

export async function generateAssOnly(
  input: GenerateAssRequest,
  signal?: AbortSignal
): Promise<GenerateAssResponse> {
  // Use the export endpoint with source="ass_only" — this is the proper
  // path that doesn't require a video_path. If the user provided an
  // output_path, treat its parent as the output_dir.
  const outputDir = input.output_path.replace(/[^/]+$/, "");
  const res = await fetch("/api/studio/export-danmaku-clip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "ass_only",
      candidate: { rank: 0, clip_start: input.clip_start, clip_duration: input.clip_end - input.clip_start },
      chat: input.chat,
      options: {
        ...input.options,
        with_danmaku: true,
        output_dir: outputDir,
      },
    }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return {
    ok: json.ok,
    ass_path: json.ass_file ?? "",
    comment_count: json.comment_count ?? 0,
    in_range_count: json.in_range_count ?? 0,
    skipped_ng: json.skipped_ng ?? 0,
    skipped_too_short: json.skipped_too_short ?? 0,
    skipped_duplicate: json.skipped_duplicate ?? 0,
    error_code: json.error_code,
    message: json.message,
  };
}
