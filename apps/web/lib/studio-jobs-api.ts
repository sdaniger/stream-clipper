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
  | "comment_filtering"
  | "ass_generation"
  | "preview_rendering"
  | "ffmpeg_rendering"
  | "transcription_started"
  | "transcription_segmenting"
  | "transcription_completed"
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
  outline?: number;
  shadow?: number;
  density?: "low" | "medium" | "high";
  min_message_length?: number;
  deduplicate_consecutive?: boolean;
  safety_comment_limit?: number | null;
  ng_words?: string[];
  // New: style preset name (overrides font/opacity/outline defaults if set)
  style_preset?: string;
  // New: lane / density tuning
  max_lanes?: number | null;
  max_comments_per_second?: number | null;
  lane_height?: number | null;
  top_margin?: number | null;
  bottom_margin?: number | null;
  horizontal_padding?: number | null;
  long_comment_scale?: number | null;
  emoji_only_scale?: number | null;
  // New: filter toggles
  filter_urls?: boolean;
  filter_repeated_by_user?: boolean;
  emoji_spam_limit?: number | null;
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
  category?: "funny" | "surprise" | "clip_worthy" | "hype" | "accident" | "cute" | "chat_spike" | "general" | string;
  confidence?: number;
  representative_comments?: Array<{ time_sec: number; author?: string; message: string; signal_score?: number }>;
  overlap_group?: string | null;
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
  // Legacy: true = hard-burn, false = off. Prefer comment_burn_in_mode.
  with_danmaku?: boolean;
  // New: explicit comment display mode
  comment_burn_in_mode?: "off" | "preview_overlay" | "hard_burn";
  // New: style preset name (resolved server-side)
  danmaku_style_preset?: string | null;
  ffmpeg_preset?: "ultrafast" | "veryfast" | "fast" | "medium" | "slow";
  ffmpeg_crf?: number;
  target_aspect?: "16:9" | "9:16";
  streamer_name?: string | null;
  vod_title?: string | null;
  transcription_provider?: "auto" | "existing" | "whisper_cpp" | "disabled" | null;
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
  elapsed_seconds: number;
  result: Record<string, any>;
  error_code: string | null;
  error_message: string | null;
  cancelled: boolean;
  history: Array<{ stage: string; message: string; progress: number; ts: number }>;
}

/** Per-candidate status in a batch render sequence. */
export interface BatchItem {
  candidate_id: string;
  rank: number;
  kind: string;
  status: "pending" | "active" | "completed" | "failed";
  job_state?: JobState;
  error_message?: string;
}

export interface StartJobResponse {
  job_id: string;
  status: string;
  message: string;
}

export interface PreviewRenderRequest {
  candidate: Candidate;
  source: "twitch_vod" | "local_file" | "ass_only";
  vod_url?: string | null;
  video_id?: string | null;
  video_path?: string | null;
  chat_messages?: Array<{ timestamp: number; time_sec?: number; message: string; author?: string }>;
  options?: DanmakuOptions;
  // Max duration for the preview clip (default 30s; capped at 60s).
  max_duration_sec?: number | null;
  // Preview resolution (default 720p = 1280x720).
  preview_width?: number | null;
  preview_height?: number | null;
  danmaku_style_preset?: string | null;
}

export interface PreviewClip {
  preview_path: string;
  preview_filename: string;
  duration_seconds: number;
  width: number;
  height: number;
  burned_comment_count: number;
  in_range_count: number;
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

export async function startPreviewJob(req: PreviewRenderRequest): Promise<StartJobResponse> {
  return postJson<StartJobResponse>("/api/studio/jobs/preview-render", req);
}

export async function getJob(jobId: string, signal?: AbortSignal): Promise<JobState> {
  const res = await fetch(`/api/studio/jobs/${jobId}`, { cache: "no-store", signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function listJobs(jobKind?: JobKind, signal?: AbortSignal): Promise<JobState[]> {
  const url = jobKind ? `/api/studio/jobs?job_kind=${jobKind}` : "/api/studio/jobs";
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function cancelJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/studio/jobs/${jobId}/cancel`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Cancel job failed: HTTP ${res.status}`);
  }
}

export interface PollOptions {
  intervalMs?: number;
  signal?: AbortSignal;
  /** Maximum polls before giving up. Defaults to 30 minutes at 1s. */
  maxAttempts?: number;
  /** Maximum total time in ms before giving up. Defaults to 30 minutes. */
  maxDurationMs?: number;
}

/**
 * Poll a job's state until it reaches a terminal stage.
 * Calls `onUpdate` on every poll.
 *
 * Throws an Error if the polling exceeds `maxAttempts` or
 * `maxDurationMs` so the UI does not poll forever for a job the
 * backend has lost track of.
 */
export async function pollJobUntilDone(
  jobId: string,
  onUpdate: (state: JobState) => void,
  options?: PollOptions,
): Promise<JobState> {
  const interval = options?.intervalMs ?? 1000;
  const signal = options?.signal;
  const maxAttempts = options?.maxAttempts ?? 1800; // 30 min at 1s
  const maxDurationMs = options?.maxDurationMs ?? 30 * 60 * 1000;
  const start = Date.now();
  let attempts = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) {
      throw new DOMException("The user aborted a request.", "AbortError");
    }
    if (attempts >= maxAttempts || Date.now() - start >= maxDurationMs) {
      throw new Error(`Polling timed out for job ${jobId} after ${attempts} attempts.`);
    }
    const state = await getJob(jobId, signal);
    onUpdate(state);
    if (
      state.status === "completed" ||
      state.status === "failed" ||
      state.status === "cancelled"
    ) {
      return state;
    }
    attempts += 1;
    await new Promise((r) => setTimeout(r, interval));
  }
}

// ─── Display labels for the JobProgress component ───────────────────────────

export const ANALYZE_STAGES: JobStage[] = [
  "pending",
  "metadata_fetching",
  "chat_fetching",
  "chat_normalizing",
  "timeline_scoring",
  "candidate_generation",
];

export const RENDER_STAGES: JobStage[] = [
  "pending",
  "vod_range_fetching",
  "comment_filtering",
  "ass_generation",
  "preview_rendering",
  "ffmpeg_rendering",
  "transcription_started",
  "transcription_segmenting",
  "transcription_completed",
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
  comment_filtering: "コメント選別",
  ass_generation: "ASS 弾幕生成",
  preview_rendering: "プレビュー生成",
  ffmpeg_rendering: "FFmpeg レンダリング",
  transcription_started: "文字起こし開始",
  transcription_segmenting: "文字起こし中",
  transcription_completed: "文字起こし完了",
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
  comment_filtering: "Filtering comments",
  ass_generation: "Generating ASS",
  preview_rendering: "Rendering preview",
  ffmpeg_rendering: "FFmpeg rendering",
  transcription_started: "Transcription started",
  transcription_segmenting: "Transcribing",
  transcription_completed: "Transcription complete",
  metadata_generation: "Generating YouTube metadata",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** User-facing stage labels for JobProgress display. */
export const STAGE_USER_LABELS_JA: Record<JobStage, string> = {
  pending: "準備中",
  metadata_fetching: "動画情報を取得中",
  chat_fetching: "チャットを取得中",
  chat_normalizing: "チャットを整理中",
  timeline_scoring: "盛り上がりを解析中",
  candidate_generation: "候補を生成中",
  vod_range_fetching: "動画範囲を取得中",
  comment_filtering: "表示するコメントを選別中",
  ass_generation: "弾幕コメントを生成中",
  preview_rendering: "焼き込みプレビューを生成中",
  ffmpeg_rendering: "コメントをMP4に焼き込み中",
  transcription_started: "文字起こしを開始中",
  transcription_segmenting: "文字起こしを実行中",
  transcription_completed: "文字起こしが完了",
  metadata_generation: "投稿用情報を作成中",
  completed: "完了",
  failed: "失敗",
  cancelled: "キャンセル",
};

export const STAGE_USER_LABELS_EN: Record<JobStage, string> = {
  pending: "Preparing",
  metadata_fetching: "Fetching video info",
  chat_fetching: "Fetching chat",
  chat_normalizing: "Organizing chat",
  timeline_scoring: "Analyzing activity",
  candidate_generation: "Generating candidates",
  vod_range_fetching: "Downloading video range",
  comment_filtering: "Selecting comments to show",
  ass_generation: "Generating danmaku",
  preview_rendering: "Rendering burn-in preview",
  ffmpeg_rendering: "Burning comments into MP4",
  transcription_started: "Starting transcription",
  transcription_segmenting: "Transcribing audio",
  transcription_completed: "Transcription complete",
  metadata_generation: "Creating metadata",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** User-friendly descriptions shown during each stage. */
export const STAGE_USER_DESCRIPTIONS_JA: Record<JobStage, string> = {
  pending: "しばらくお待ちください",
  metadata_fetching: "配信のタイトルや長さなどの基本情報を取得しています",
  chat_fetching: "Twitchから視聴者のコメントを取得しています",
  chat_normalizing: "取得したコメントを解析用に整理しています",
  timeline_scoring: "コメントのアクティビティを分析し、盛り上がりポイントをスコアリングしています",
  candidate_generation: "検出した盛り上がりから切り抜き候補を生成しています",
  vod_range_fetching: "Twitch VODから該当範囲の動画をダウンロードしています（数分かかることがあります）",
  comment_filtering: "URLや連投、絵文字スパムを除外し、見せたいコメントを選んでいます",
  ass_generation: "ニコニコ風の弾幕コメントファイルを生成しています",
  preview_rendering: "コメントを焼き込んだ短いプレビュー動画を生成しています",
  ffmpeg_rendering: "FFmpegでコメントを動画に焼き込んでいます。コメント付き動画は再エンコードが必要なため、少し時間がかかります",
  transcription_started: "文字起こしエンジンの準備をしています",
  transcription_segmenting: "音声をテキストに変換しています",
  transcription_completed: "文字起こしが完了しました",
  metadata_generation: "YouTube投稿用のタイトル・説明・タグを生成しています",
  completed: "",
  failed: "",
  cancelled: "",
};

export const STAGE_USER_DESCRIPTIONS_EN: Record<JobStage, string> = {
  pending: "Please wait...",
  metadata_fetching: "Fetching video title, duration, and other basic info",
  chat_fetching: "Fetching chat messages from Twitch",
  chat_normalizing: "Organizing messages for analysis",
  timeline_scoring: "Analyzing chat activity and scoring highlight moments",
  candidate_generation: "Generating clip candidates from detected highlights",
  vod_range_fetching: "Downloading the time range from Twitch VOD (may take a few minutes)",
  comment_filtering: "Removing URLs, spammers, and emoji spam; picking the best comments to show",
  ass_generation: "Generating NicoNico-style danmaku overlay file",
  preview_rendering: "Generating a short preview video with burned-in comments",
  ffmpeg_rendering: "Burning danmaku into video. Re-encoding takes time for clips with comments",
  transcription_started: "Preparing the transcription engine",
  transcription_segmenting: "Converting audio to text",
  transcription_completed: "Transcription finished",
  metadata_generation: "Generating YouTube title, description, and tags",
  completed: "",
  failed: "",
  cancelled: "",
};

/** User-friendly error descriptions mapped from error codes. */
export const ERROR_USER_MESSAGES_JA: Record<string, string> = {
  YT_DLP_NOT_FOUND: "yt-dlp がインストールされていません",
  YT_DLP_TIMEOUT: "動画情報の取得がタイムアウトしました。再度お試しください",
  YT_DLP_FAILED: "動画情報の取得に失敗しました。URLが正しいか確認してください",
  TWITCH_CHAT_FAILED: "チャットの取得に失敗しました。VODが削除されている可能性があります",
  CHAT_DOWNLOADER_FAILED: "チャットの取得に失敗しました。しばらくしてから再度お試しください",
  TIMELINE_FAILED: "タイムラインの解析中にエラーが発生しました",
  CANDIDATE_GENERATION_FAILED: "候補の生成中にエラーが発生しました",
  EMPTY_CHAT: "チャットメッセージが見つかりませんでした。VODにチャットがない可能性があります",
  EMPTY_TIMELINE: "盛り上がりポイントが見つかりませんでした",
  VOD_URL_REQUIRED: "Twitch VODのURLが必要です",
  INVALID_RANGE: "クリップの時間範囲が無効です",
  RANGE_TOO_LARGE: "動画の範囲が長すぎます（最大30分）",
  RANGE_FETCH_FAILED: "動画範囲の取得に失敗しました。ローカルファイルを試すか、再度お試しください",
  YT_DLP_PARSE_FAILED: "動画情報の解析に失敗しました",
  FFMPEG_NOT_FOUND: "FFmpeg がインストールされていません",
  FFMPEG_TIMEOUT: "動画の書き出しがタイムアウトしました。設定を下げて再度お試しください",
  FFMPEG_FAILED: "動画の書き出しに失敗しました",
  ASS_FAILED: "弾幕ファイルの生成に失敗しました。",
  ASS_GENERATION_FAILED: "弾幕コメントの生成に失敗しました。",
  METADATA_FAILED: "メタデータの生成に失敗しました",
  NO_SOURCE_VIDEO: "元動画が見つかりません",
  LOCAL_VIDEO_NOT_FOUND: "指定された動画ファイルが見つかりません",
  API_UNREACHABLE: "サーバーに接続できません。バックエンドが起動しているか確認してください",
  NVENC_ON_ANDROID: "AndroidではNVIDIA NVENCは利用できません。CPUエンコードに切り替えてください。",
  FONT_NOT_FOUND: "日本語フォントが見つかりません。Noto Sans JP または Noto Sans CJK JP を設定してください。",
  ASS_FILTER_NOT_SUPPORTED: "このFFmpegはASS字幕の焼き込みに対応していません。libass対応のFFmpegを使用してください。",
  PREVIEW_FAILED: "焼き込みプレビューの生成に失敗しました。軽量プレビューで確認できます。",
  ANDROID_NO_FONTS: "Androidシステムフォントでは日本語コメントが正しく表示されない可能性があります",
  CLIP_EXTRACT_FAILED: "クリップの切り出しに失敗しました",
  ASS_BURN_FAILED: "弾幕の焼き込みに失敗しました",
  ASS_BURN_TIMEOUT: "弾幕の焼き込みがタイムアウトしました",
  PREVIEW_TIMEOUT: "プレビュー生成がタイムアウトしました",
  DANMAKU_IMPORT_FAILED: "弾幕ライブラリの読み込みに失敗しました",
};

export const ERROR_USER_MESSAGES_EN: Record<string, string> = {
  YT_DLP_NOT_FOUND: "yt-dlp is not installed",
  YT_DLP_TIMEOUT: "Video info fetch timed out. Please try again",
  YT_DLP_FAILED: "Failed to fetch video info. Check the URL",
  TWITCH_CHAT_FAILED: "Failed to fetch chat. The VOD may have been deleted",
  CHAT_DOWNLOADER_FAILED: "Failed to fetch chat. Please try again later",
  TIMELINE_FAILED: "An error occurred during timeline analysis",
  CANDIDATE_GENERATION_FAILED: "An error occurred during candidate generation",
  EMPTY_CHAT: "No chat messages found. The VOD may have no chat",
  EMPTY_TIMELINE: "No highlight moments were detected",
  VOD_URL_REQUIRED: "A Twitch VOD URL is required",
  INVALID_RANGE: "The clip time range is invalid",
  RANGE_TOO_LARGE: "The video range is too long (max 30 minutes)",
  RANGE_FETCH_FAILED: "Failed to download the video range. Try using a local file",
  YT_DLP_PARSE_FAILED: "Failed to parse video info",
  FFMPEG_NOT_FOUND: "ffmpeg is not installed",
  FFMPEG_TIMEOUT: "Video rendering timed out. Try lower quality settings",
  FFMPEG_FAILED: "Failed to render the video",
  ASS_FAILED: "Failed to generate danmaku file",
  ASS_GENERATION_FAILED: "Failed to generate danmaku comments",
  METADATA_FAILED: "Failed to generate metadata",
  NO_SOURCE_VIDEO: "Source video not found",
  LOCAL_VIDEO_NOT_FOUND: "The specified video file was not found",
  API_UNREACHABLE: "Cannot connect to the server. Make sure the backend is running",
  NVENC_ON_ANDROID: "NVIDIA NVENC is not available on Android. Switching to CPU encoding.",
  FONT_NOT_FOUND: "Japanese font not found. Please install Noto Sans JP or Noto Sans CJK JP.",
  ASS_FILTER_NOT_SUPPORTED: "This FFmpeg build does not support ASS subtitle burn-in. Use a libass-enabled FFmpeg.",
  PREVIEW_FAILED: "Failed to generate burn-in preview. You can still use the lightweight preview.",
  ANDROID_NO_FONTS: "Android system fonts may not render Japanese comments correctly",
  CLIP_EXTRACT_FAILED: "Failed to extract clip",
  ASS_BURN_FAILED: "Failed to burn in danmaku",
  ASS_BURN_TIMEOUT: "Danmaku burn-in timed out",
  PREVIEW_TIMEOUT: "Preview rendering timed out",
  DANMAKU_IMPORT_FAILED: "Failed to import danmaku library",
};

/** Returns a user-friendly message for a given error code. Falls back to raw message. */
export function getUserErrorMessage(errorCode: string | null, isJa: boolean): string {
  if (!errorCode) return "";
  const map = isJa ? ERROR_USER_MESSAGES_JA : ERROR_USER_MESSAGES_EN;
  return map[errorCode] || "";
}

/** Returns true if the error code suggests the operation can be retried. */
export function isRetryableError(errorCode: string | null): boolean {
  if (!errorCode) return false;
  const retryable = [
    "YT_DLP_TIMEOUT", "YT_DLP_FAILED", "TWITCH_CHAT_FAILED",
    "FFMPEG_TIMEOUT", "RANGE_FETCH_FAILED", "API_UNREACHABLE",
    "CHAT_DOWNLOADER_FAILED",
  ];
  return retryable.includes(errorCode);
}
