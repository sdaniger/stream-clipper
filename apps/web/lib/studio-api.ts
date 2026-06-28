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
}

export interface StudioAnalyzeResponse {
  video_id: string;
  title: string | null;
  duration_seconds: number | null;
  candidates: HighlightCandidate[];
  metadata: Record<string, unknown>;
  notice?: string;
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

function normalizeCandidate(raw: any): HighlightCandidate {
  return {
    rank: raw.rank ?? 0,
    start: raw.start ?? raw.clip_start ?? 0,
    end: raw.end ?? (raw.clip_start != null ? raw.clip_start + (raw.clip_duration ?? 30) : 30),
    peak_time: raw.peak_time ?? raw.start ?? 0,
    score: raw.score ?? 0,
    chat_count: raw.chat_count ?? 0,
    keyword_hits: raw.keyword_hits ?? 0,
    matched_keywords: raw.matched_keywords ?? raw.matched_keywords ?? [],
    reasons: raw.reasons ?? raw.reason ? [raw.reason] : [],
    clip_start: raw.clip_start ?? raw.start ?? 0,
    clip_duration: raw.clip_duration ?? raw.duration ?? 30,
    output_file: raw.output_file ?? null,
  };
}

export function normalizeCandidates(raw: any[]): HighlightCandidate[] {
  return (raw ?? []).map(normalizeCandidate);
}
