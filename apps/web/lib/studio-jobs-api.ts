/**
 * Client-side API for the new job-based Studio pipeline.
 *
 * Endpoints (proxied through Next.js to the FastAPI backend):
 *   POST /api/studio/jobs/analyze
 *   POST /api/studio/jobs/render
 *   GET  /api/studio/jobs/{jobId}
 *   GET  /api/studio/jobs
 *   DELETE /api/studio/jobs/{jobId}
 *
 * The client is poll-based: the analyze / render endpoints return a
 * job_id immediately, and the UI polls the job's state.
 */

export type JobKind = "analyze" | "render";

export type JobStage =
  | "pending"
  | "metadata_fetching"
  | "chat_fetching"
  | "chat_normalizing"
  | "timeline_scoring"
  | "candidate_generation"
  | "vod_range_fetching"
  | "ass_generation"
  | "ffmpeg_rendering"
  | "metadata_generation"
  | "completed"
  | "failed"
  | "cancelled";

export interface AnalyzeRequest {
  vod_url?: string;
  chat_data?: Array<{
    timestamp: number;
    author?: string;
    message: string;
  }>;
  window?: number;
  step?: number;
  top_short?: number;
  top_medium?: number;
  top_long?: number;
  min_score?: number;
  custom_keywords?: string[];
  scoring_weights?: Record<string, number>;
}

export interface DanmakuOptions {
  play_res_x?: number;
  play_res_y?: number;
  font_name?: string;
  font_size?: number;
  comment_duration?: number;
  opacity?: number;
  density?: "low" | "medium" | "high";
  min_message_length?: number;
  deduplicate_consecutive?: boolean;
  safety_comment_limit?: number | null;
}

export interface Candidate {
  candidate_id: string;
  kind: "short" | "medium" | "long";
  rank: number;
  start?: number;
  end?: number;
  peak_time: number;
  peak_window_index?: number;
  clip_start?: number;
  clip_end?: number;
  clip_duration: number;
  score: number;
  chat_count: number;
  unique_author_count: number;
  keyword_hits: number;
  laugh_score: number;
  surprise_score: number;
  clip_worthy_score: number;
  reaction_score: number;
  burst_score: number;
  total_score: number;
  peak_count: number;
  peak_centers: number[];
  matched_keywords: string[];
  reasons: string[];
  topic_coherence_score?: number;
  sustained_chat_score?: number;
  dead_air_penalty?: number;
  long_score?: number;
  // Back-compat with the old HighlightCandidate used by VideoArea
  id?: string | number;
  title?: string;
  output_file?: string | null;
}

export interface RenderRequest {
  candidate: Candidate;
  source: "twitch_vod" | "local_file" | "ass_only";
  vod_url?: string | null;
  video_id?: string | null;
  video_path?: string | null;
  chat_messages?: Array<{ timestamp: number; time_sec?: number; message: string; author?: string }>;
  options?: DanmakuOptions;
  output_dir?: string;
  with_danmaku?: boolean;
  ffmpeg_preset?: "ultrafast" | "veryfast" | "fast" | "medium" | "slow";
  ffmpeg_crf?: number;
  target_aspect?: "16:9" | "9:16";
  streamer_name?: string | null;
  vod_title?: string | null;
}

export interface JobState {
  job_id: string;
  job_kind: JobKind;
  status: JobStage;
  progress: number;
  current_stage: JobStage;
  message: string;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
  result: Record<string, any>;
  error_code: string | null;
  error_message: string | null;
  cancelled: boolean;
  history: Array<{ stage: string; message: string; progress: number; ts: number }>;
}

export interface StartJobResponse {
  job_id: string;
  status: string;
  message: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || err.error || err.error_code || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function startAnalyzeJob(req: AnalyzeRequest): Promise<StartJobResponse> {
  return postJson<StartJobResponse>("/api/studio/jobs/analyze", req);
}

export async function startRenderJob(req: RenderRequest): Promise<StartJobResponse> {
  return postJson<StartJobResponse>("/api/studio/jobs/render", req);
}

export async function getJob(jobId: string): Promise<JobState> {
  const res = await fetch(`/api/studio/jobs/${jobId}`, { cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function listJobs(jobKind?: JobKind): Promise<JobState[]> {
  const url = jobKind ? `/api/studio/jobs?job_kind=${jobKind}` : "/api/studio/jobs";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function cancelJob(jobId: string): Promise<void> {
  await fetch(`/api/studio/jobs/${jobId}`, { method: "DELETE" });
}

/**
 * Poll a job's state until it reaches a terminal stage.
 * Calls `onUpdate` on every poll.
 */
export async function pollJobUntilDone(
  jobId: string,
  onUpdate: (state: JobState) => void,
  options?: { intervalMs?: number; signal?: AbortSignal },
): Promise<JobState> {
  const interval = options?.intervalMs ?? 1000;
  const signal = options?.signal;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) {
      throw new Error("aborted");
    }
    const state = await getJob(jobId);
    onUpdate(state);
    if (
      state.status === "completed" ||
      state.status === "failed" ||
      state.status === "cancelled"
    ) {
      return state;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

// ─── Display labels for the JobProgress component ───────────────────────────

export const ANALYZE_STAGES: JobStage[] = [
  "metadata_fetching",
  "chat_fetching",
  "chat_normalizing",
  "timeline_scoring",
  "candidate_generation",
];

export const RENDER_STAGES: JobStage[] = [
  "vod_range_fetching",
  "ass_generation",
  "ffmpeg_rendering",
  "metadata_generation",
];

export const STAGE_LABELS: Record<JobStage, string> = {
  pending: "待機中",
  metadata_fetching: "VOD メタデータ取得",
  chat_fetching: "チャット取得",
  chat_normalizing: "チャット正規化",
  timeline_scoring: "タイムライン解析",
  candidate_generation: "候補生成",
  vod_range_fetching: "VOD 範囲取得",
  ass_generation: "ASS 弾幕生成",
  ffmpeg_rendering: "FFmpeg レンダリング",
  metadata_generation: "YouTube メタデータ生成",
  completed: "完了",
  failed: "失敗",
  cancelled: "キャンセル",
};

export const STAGE_LABELS_EN: Record<JobStage, string> = {
  pending: "Pending",
  metadata_fetching: "Fetching VOD metadata",
  chat_fetching: "Fetching chat",
  chat_normalizing: "Normalizing chat",
  timeline_scoring: "Scoring timeline",
  candidate_generation: "Generating candidates",
  vod_range_fetching: "Fetching VOD range",
  ass_generation: "Generating ASS",
  ffmpeg_rendering: "FFmpeg rendering",
  metadata_generation: "Generating YouTube metadata",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
