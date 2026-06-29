import { NextResponse } from "next/server";
import { exportDanmakuClip, type DanmakuOptions, type DanmakuExportSource } from "@/lib/server/danmaku-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Danmaku export can take a while (extract + ASS + burn + Twitch range fetch).
export const maxDuration = 1800;

type RequestBody = {
  source?: DanmakuExportSource;
  // For source == "local_file"
  video_path?: string | null;
  // For source == "twitch_vod"
  vod_url?: string | null;
  video_id?: string | null;
  // Common
  candidate?: {
    rank?: number;
    start?: number;
    end?: number;
    clip_start?: number;
    clip_duration?: number;
    peak_time?: number;
    id?: string | number;
  };
  chat?: Array<{
    timestamp?: number;
    time_sec?: number;
    message?: string;
    author?: string;
  }>;
  options?: DanmakuOptions & {
    output_dir?: string;
    with_danmaku?: boolean;
    fast?: boolean;
    format?: string;
    all_comments?: boolean;
    safety_comment_limit?: number | null;
    preset?: "ultrafast" | "veryfast" | "fast" | "medium" | "slow";
    crf?: number;
    reuse_temp_clip?: boolean;
    reuse_ass?: boolean;
  };
  // Allow the caller to override the clip range (e.g. after "Set from current")
  edited_start?: number;
  edited_end?: number;
};

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error_code: "INVALID_JSON", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // 1. Resolve source
  const source: DanmakuExportSource =
    body.source ?? (body.vod_url ? "twitch_vod" : (body.video_path ? "local_file" : "ass_only"));

  // 2. Validate per-source requirements
  if (source === "local_file" && (typeof body.video_path !== "string" || !body.video_path.trim())) {
    return NextResponse.json(
      {
        ok: false,
        error_code: "LOCAL_VIDEO_REQUIRED",
        message: "ローカル動画ファイルのパスを指定してください。",
      },
      { status: 400 },
    );
  }
  if (source === "twitch_vod" && (typeof body.vod_url !== "string" || !body.vod_url.trim())) {
    return NextResponse.json(
      {
        ok: false,
        error_code: "VOD_URL_REQUIRED",
        message: "Twitch VOD URLが必要です。",
      },
      { status: 400 },
    );
  }

  // 3. Validate candidate
  const c = body.candidate;
  if (!c || typeof c !== "object") {
    return NextResponse.json(
      { ok: false, error_code: "CANDIDATE_REQUIRED", message: "候補が指定されていません。" },
      { status: 400 },
    );
  }
  const clipStart = body.edited_start ?? c.clip_start ?? c.start;
  const clipEnd = body.edited_end ?? c.end ?? (c.clip_start != null && c.clip_duration != null ? c.clip_start + c.clip_duration : null);
  if (typeof clipStart !== "number" || typeof clipEnd !== "number" || clipEnd <= clipStart) {
    return NextResponse.json(
      {
        ok: false,
        error_code: "INVALID_RANGE",
        message: `候補の範囲が無効です (start=${clipStart}, end=${clipEnd})`,
      },
      { status: 400 },
    );
  }

  // 4. Validate chat
  const chat = Array.isArray(body.chat) ? body.chat : [];
  const normalizedChat = chat
    .map((m) => ({
      timestamp: typeof m.timestamp === "number" ? m.timestamp : (m.time_sec ?? 0),
      time_sec: typeof m.time_sec === "number" ? m.time_sec : (m.timestamp ?? 0),
      message: typeof m.message === "string" ? m.message : "",
      author: typeof m.author === "string" ? m.author : undefined,
    }))
    .filter((m) => m.message.length > 0);

  // 5. Run export
  const result = await exportDanmakuClip({
    source,
    video_path: body.video_path ?? null,
    vod_url: body.vod_url ?? null,
    video_id: body.video_id ?? null,
    chat: normalizedChat,
    clip_start: clipStart,
    clip_end: clipEnd,
    output_dir: body.options?.output_dir,
    with_danmaku: body.options?.with_danmaku ?? true,
    fast: body.options?.fast ?? false,
    options: body.options,
  });

  // Status code by error type
  const status = result.ok
    ? 200
    : result.error_code === "LOCAL_VIDEO_REQUIRED" || result.error_code === "VOD_URL_REQUIRED" || result.error_code === "CANDIDATE_REQUIRED" || result.error_code === "INVALID_RANGE" || result.error_code === "INVALID_JSON"
      ? 400
      : 500;
  return NextResponse.json(result, { status });
}
