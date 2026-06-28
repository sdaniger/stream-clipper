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

export async function analyzeHighlights(
  videoPath: string,
  logPath: string,
  options: {
    window?: number;
    top?: number;
    min_gap?: number;
    keywords?: string;
    keyword_weight?: number;
    clip_duration?: number;
    clip_padding?: number;
  }
): Promise<AnalyzeResponse> {
  return request<AnalyzeResponse>("/api/gui/analyze", {
    video_path: videoPath,
    log_path: logPath,
    window: options.window ?? 30,
    top: options.top ?? 5,
    min_gap: options.min_gap ?? 30,
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
  rank: number
): Promise<ClipCreateResponse> {
  return request<ClipCreateResponse>("/api/gui/clips/create", {
    video_path: videoPath,
    start,
    duration,
    output_dir: outputDir,
    rank,
  });
}

export async function batchCreateClips(
  videoPath: string,
  highlights: HighlightCandidate[],
  outputDir: string
): Promise<ClipBatchResponse> {
  return request<ClipBatchResponse>("/api/gui/clips/batch", {
    video_path: videoPath,
    highlights,
    output_dir: outputDir,
  });
}

export async function checkHealth(): Promise<{ status: string }> {
  const res = await fetch("/api/gui/health");
  if (!res.ok) throw new Error("Backend not available");
  return res.json();
}
