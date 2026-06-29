/**
 * Twitch VOD range fetcher.
 *
 * Downloads only the requested time range from a Twitch VOD using
 * yt-dlp's --download-sections feature. The resulting MP4 lives in
 * MEDIA_ROOT/output/tmp/ and is consumed by the danmaku export pipeline.
 *
 * Why: the user has a VOD URL but not a local file. We don't want to
 * download the whole VOD just for a 30s clip.
 *
 * This is a TypeScript mirror of apps/api/app/services/twitch_range_fetcher.py.
 */

import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getMediaRoot, getMediaPaths } from "@/lib/server/media-service";

const execFileAsync = promisify(execFile);

export type TwitchRangeFetchRequest = {
  vod_url: string;
  video_id?: string | null;
  start_seconds: number;
  end_seconds: number;
  output_dir?: string;
  format?: string;
  yt_dlp_path?: string;
};

export type TwitchRangeFetchResult = {
  ok: boolean;
  output_path?: string;
  absolute_path?: string;
  size_bytes?: number;
  duration_seconds?: number;
  commandPreview?: string;
  error_code?: string;
  message?: string;
};

const RANGE_LIMIT_SECONDS = 30 * 60; // 30 min

function extractVideoId(url: string): string | null {
  const m = url.match(/\/videos?\/(\d+)/);
  if (m) return m[1];
  const m2 = url.match(/[?&]video=(\d+)/);
  if (m2) return m2[1];
  return null;
}

function secondsToHms(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe - h * 3600 - m * 60;
  // yt-dlp expects *HH:MM:SS.mmm with dot separator for fractional seconds
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

function whichYtDlp(override?: string): string {
  if (override) return override;
  if (process.env.YT_DLP_PATH) return process.env.YT_DLP_PATH;
  return "yt-dlp";
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:=+@%-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function toRelativeIfPossible(absolutePath: string): string {
  try {
    const root = getMediaRoot();
    const rel = path.relative(root, absolutePath);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      return rel.replaceAll(path.sep, "/");
    }
  } catch {}
  return absolutePath;
}

export async function fetchTwitchRange(req: TwitchRangeFetchRequest): Promise<TwitchRangeFetchResult> {
  const start = Date.now();

  if (!req.vod_url || !req.vod_url.trim()) {
    return {
      ok: false,
      error_code: "VOD_URL_REQUIRED",
      message: "vod_url is required for Twitch VOD range fetch.",
    };
  }
  if (req.end_seconds <= req.start_seconds) {
    return {
      ok: false,
      error_code: "INVALID_RANGE",
      message: `end_seconds (${req.end_seconds}) must be greater than start_seconds (${req.start_seconds}).`,
    };
  }
  if (req.end_seconds - req.start_seconds > RANGE_LIMIT_SECONDS) {
    return {
      ok: false,
      error_code: "RANGE_TOO_LARGE",
      message: "Twitch VOD range fetch is limited to 30 minutes per request.",
    };
  }

  const videoId = req.video_id || extractVideoId(req.vod_url);
  if (!videoId) {
    return {
      ok: false,
      error_code: "INVALID_VOD_URL",
      message: "Twitch VOD URLから video ID を抽出できませんでした。",
    };
  }

  // Build output path
  const paths = getMediaPaths();
  const baseDir = req.output_dir
    ? (path.isAbsolute(req.output_dir) ? req.output_dir : path.join(paths.mediaRoot, req.output_dir))
    : path.join(paths.outputClipsDir, "..", "tmp");
  await mkdir(baseDir, { recursive: true });

  const safeStart = Math.floor(req.start_seconds);
  const safeEnd = Math.floor(req.end_seconds);
  const outName = `v${videoId}_${safeStart}_${safeEnd}_${Math.random().toString(36).slice(2, 8)}.mp4`;
  const outPath = path.join(baseDir, outName);

  const ytDlp = whichYtDlp(req.yt_dlp_path);
  const fmt = (req.format || "bv*[height<=1080]+ba/best").trim();
  const startStr = secondsToHms(req.start_seconds);
  const endStr = secondsToHms(req.end_seconds);

  const args = [
    "--no-playlist",
    "--restrict-filenames",
    "--no-mtime",
    "-N", "4",
    "--buffer-size", "32K",
    "--merge-output-format", "mp4",
    "-f", fmt,
    "-o", outPath,
    "--print", "after_move:filepath",
    "--download-sections", `*${startStr}-${endStr}`,
    "--force-keyframes-at-cuts",
    req.vod_url,
  ];
  const commandPreview = `${ytDlp} ${args.map(shellQuote).join(" ")}`;

  let stdout: string;
  try {
    const result = await execFileAsync(ytDlp, args, {
      timeout: 15 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    if (err.code === "ENOENT") {
      return {
        ok: false,
        error_code: "YT_DLP_NOT_FOUND",
        message: `yt-dlpが見つかりません: ${ytDlp}。\`pip install yt-dlp\`で導入するか、YT_DLP_PATH環境変数で指定してください。`,
      };
    }
    if (err.killed) {
      return {
        ok: false,
        error_code: "YT_DLP_TIMEOUT",
        message: "Twitch VOD range fetch timed out (15 min).",
        commandPreview,
      };
    }
    return {
      ok: false,
      error_code: "YT_DLP_FAILED",
      message: `yt-dlp failed: ${(err.stderr || err.message || "").trim().slice(-1500)}`,
      commandPreview,
    };
  }

  // Find the actual output file
  const lines = stdout.trim().split(/\r?\n/);
  const actualPathStr = lines[lines.length - 1] || outPath;
  const actualPath = actualPathStr.trim();

  if (!existsSync(actualPath)) {
    return {
      ok: false,
      error_code: "OUTPUT_MISSING",
      message: `yt-dlpは成功したが出力ファイルが見つかりません: ${actualPath}`,
      commandPreview,
    };
  }

  const fileStat = await stat(actualPath);
  const relPath = toRelativeIfPossible(actualPath);

  return {
    ok: true,
    output_path: relPath,
    absolute_path: actualPath,
    size_bytes: fileStat.size,
    duration_seconds: (Date.now() - start) / 1000,
    commandPreview,
  };
}
