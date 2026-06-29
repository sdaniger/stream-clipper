/**
 * Danmaku (NicoNico-style scrolling comments) export service.
 *
 * Generates an ASS subtitle file from chat messages, then optionally
 * burns it into a clipped section of a local video via FFmpeg.
 *
 * This is a TypeScript port of the Python danmaku_ass / danmaku_export
 * modules under apps/api/app/services. The Python versions are kept for
 * CLI / direct API use; this file is the in-process implementation that
 * the Next.js Studio route uses to avoid a subprocess hop.
 */

import { execFile, spawn } from "node:child_process";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getMediaRoot, getMediaPaths } from "@/lib/server/media-service";
import { fetchTwitchRange } from "@/lib/server/twitch-range-fetcher";

const execFileAsync = promisify(execFile);

// ─── Types ──────────────────────────────────────────────────────────────────

export type NormalizedChatMessage = {
  timestamp: number;
  time_sec: number;
  message: string;
  author?: string;
};

export type DanmakuDensity = "low" | "medium" | "high";

export type DanmakuOptions = {
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
  // Optional safety cap. When set, comments above this are dropped with
  // priority scoring. When undefined, every in-range comment is emitted.
  safety_comment_limit?: number;
  // FFmpeg encoder knobs (consumed by the export pipeline)
  preset?: "ultrafast" | "veryfast" | "fast" | "medium" | "slow";
  crf?: number;
  // Cache reuse
  reuse_temp_clip?: boolean;
  reuse_ass?: boolean;
};

export type DanmakuGenerateRequest = {
  chat: NormalizedChatMessage[];
  clip_start: number;
  clip_end: number;
  options?: DanmakuOptions;
};

export type DanmakuStats = {
  in_range_count: number;
  used_count: number;
  skipped_ng: number;
  skipped_too_short: number;
  skipped_duplicate: number;
  skipped_safety_limit: number;
};

export type DanmakuGenerateResult = {
  ass_path: string;
  stats: DanmakuStats;
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
  chat: NormalizedChatMessage[];
  clip_start: number;
  clip_end: number;
  output_dir?: string;
  with_danmaku?: boolean;
  fast?: boolean;
  options?: DanmakuOptions;
};

export type DanmakuExportResult = {
  ok: boolean;
  source?: DanmakuExportSource;
  output_file?: string;
  temporary_video_file?: string;
  ass_file?: string;
  range_comment_count?: number;
  burned_comment_count?: number;
  comment_count?: number;          // legacy alias
  in_range_count?: number;
  skipped_ng?: number;
  skipped_too_short?: number;
  skipped_duplicate?: number;
  skipped_safety_limit?: number;
  all_comments?: boolean;
  clip_start?: number;
  clip_end?: number;
  error_code?: string;
  message?: string;
  fallback?: { local_file?: boolean; twitch_vod?: boolean; ass_only?: boolean };
  command_preview?: string;
  duration_seconds?: number;
  ffmpeg_preset?: string;
  ffmpeg_crf?: number;
  ass_cache_hit?: boolean;
  temp_video_cache_hit?: boolean;
};

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_PLAY_RES_X = 1920;
const DEFAULT_PLAY_RES_Y = 1080;
const DEFAULT_FONT_NAME = "Noto Sans CJK JP";
const DEFAULT_FONT_SIZE = 32;
const DEFAULT_COMMENT_DURATION = 4.0;
const DEFAULT_OPACITY = 0.9;
const DEFAULT_DENSITY: DanmakuDensity = "medium";
const DEFAULT_LINE_HEIGHT = 48;
// Density presets now control (lane_fraction, comment_duration) — NOT
// the number of comments emitted. Every in-range comment is emitted by
// default.
const DENSITY_PRESETS: Record<DanmakuDensity, { laneFraction: number; commentDuration: number }> = {
  low:    { laneFraction: 0.55, commentDuration: 6.0 },
  medium: { laneFraction: 0.75, commentDuration: 4.0 },
  high:   { laneFraction: 0.90, commentDuration: 3.0 },
};
// FFmpeg quality presets (preset → crf)
const FFMPEG_PRESET_CRF: Record<NonNullable<DanmakuOptions["preset"]>, number> = {
  ultrafast: 26,
  veryfast: 23,
  fast: 22,
  medium: 20,
  slow: 18,
};

const PRIORITY_KEYWORDS = [
  "草", "ｗ", "w", "www", "笑", "爆笑", "腹痛い", "おもろ",
  "やばい", "やば", "lol", "lmao", "神", "最高", "天才",
  "きた", "来た", "ｷﾀ", "キタ", "助けて", "たすけて",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function formatAssTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe - hours * 3600 - minutes * 60;
  let centis = Math.round((secs - Math.floor(secs)) * 100);
  if (centis === 100) {
    centis = 0;
  }
  const intSecs = Math.floor(secs);
  return `${hours}:${minutes.toString().padStart(2, "0")}:${intSecs.toString().padStart(2, "0")}.${centis.toString().padStart(2, "0")}`;
}

function isValidMessage(text: string, minLength: number): boolean {
  const stripped = text.trim();
  if (!stripped) return false;
  if (stripped.length < minLength) return false;
  return true;
}

function containsNgWord(text: string, ngWords: string[]): boolean {
  const lowered = text.toLowerCase();
  for (const word of ngWords) {
    if (!word) continue;
    if (lowered.includes(word.toLowerCase())) return true;
  }
  return false;
}

function priorityScore(text: string): number {
  let score = 0;
  const lowered = text.toLowerCase();
  for (const kw of PRIORITY_KEYWORDS) {
    if (lowered.includes(kw.toLowerCase())) score += 1;
  }
  const length = text.trim().length;
  if (length >= 4 && length <= 30) score += 1;
  return score;
}

function escapeAssText(text: string, maxLength = 80): string {
  let cleaned = text.replace(/\r/g, " ").replace(/\n/g, " ");
  // Strip ASS override braces
  cleaned = cleaned.replace(/\{/g, "(").replace(/\}/g, ")");
  // Remove control chars
  cleaned = cleaned.replace(/[\x00-\x1f\x7f]/g, "");
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength - 1) + "…";
  }
  return cleaned.trim();
}

function buildAssHeader(opts: Required<DanmakuOptions>): string {
  const alpha = Math.max(0, Math.min(255, Math.round((1.0 - opts.opacity) * 255)));
  const primary = `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}FFFFFF`;
  const outline = "&H00000000";
  const back = "&H80000000";

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${opts.play_res_x}`,
    `PlayResY: ${opts.play_res_y}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Danmaku,${opts.font_name},${opts.font_size},${primary},${primary},${outline},${back},1,0,0,0,100,100,0,0,1,2,1,7,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "",
  ].join("\n");
}

function assignLanes(
  comments: NormalizedChatMessage[],
  clipStart: number,
  clipEnd: number,
  playResY: number,
  fontSize: number,
  commentDuration: number,
  density: DanmakuDensity = "medium",
): Array<{ message: NormalizedChatMessage; lane: number }> {
  const lineHeight = Math.max(fontSize + 8, DEFAULT_LINE_HEIGHT);
  const laneFraction = DENSITY_PRESETS[density]?.laneFraction ?? 0.75;
  const usable = Math.floor(playResY * laneFraction);
  const numLanes = Math.max(1, Math.floor(usable / lineHeight));
  const nextFreeAt = new Array<number>(numLanes).fill(0);

  const result: Array<{ message: NormalizedChatMessage; lane: number }> = [];
  for (const c of comments) {
    const relStart = Math.max(0, c.time_sec - clipStart);
    const relEnd = relStart + commentDuration;
    if (relStart >= clipEnd - clipStart) continue;

    let chosen: number | null = null;
    for (let lane = 0; lane < numLanes; lane++) {
      if (nextFreeAt[lane] <= relStart) {
        chosen = lane;
        break;
      }
    }
    if (chosen === null) {
      // All lanes busy — overwrite the soonest-freeing one
      let minIdx = 0;
      let minVal = nextFreeAt[0];
      for (let i = 1; i < numLanes; i++) {
        if (nextFreeAt[i] < minVal) {
          minVal = nextFreeAt[i];
          minIdx = i;
        }
      }
      chosen = minIdx;
      nextFreeAt[chosen] = relStart + commentDuration;
    } else {
      nextFreeAt[chosen] = relEnd;
    }
    result.push({ message: c, lane: chosen });
  }
  return result;
}

function buildDialogueLine(
  comment: NormalizedChatMessage,
  lane: number,
  clipStart: number,
  playResX: number,
  playResY: number,
  fontSize: number,
  commentDuration: number,
): string | null {
  const text = escapeAssText(comment.message);
  if (!text) return null;

  const relStart = Math.max(0, comment.time_sec - clipStart);
  const relEnd = relStart + commentDuration;

  const lineHeight = Math.max(fontSize + 8, DEFAULT_LINE_HEIGHT);
  const marginTop = Math.floor(playResY * 0.05);
  let y = marginTop + lane * lineHeight;
  y = Math.min(y, playResY - lineHeight);

  const xStart = playResX + 200;
  const xEnd = -Math.floor(playResX * 0.5);

  const startTs = formatAssTime(relStart);
  const endTs = formatAssTime(relEnd);

  return `Dialogue: 0,${startTs},${endTs},Danmaku,,0,0,0,,{\\move(${xStart},${y},${xEnd},${y})}${text}`;
}

type NormalizedDanmakuOptions = Omit<Required<DanmakuOptions>, "safety_comment_limit" | "preset" | "crf" | "reuse_temp_clip" | "reuse_ass"> & {
  safety_comment_limit: number | null;
  preset: NonNullable<DanmakuOptions["preset"]>;
  crf: number;
  reuse_temp_clip: boolean;
  reuse_ass: boolean;
};

function normalizeOptions(opts: DanmakuOptions = {}): NormalizedDanmakuOptions {
  const density: DanmakuDensity = opts.density ?? DEFAULT_DENSITY;
  const densityPreset = DENSITY_PRESETS[density];
  // Density controls lane fraction + comment duration, not the number of
  // comments emitted. comment_duration falls back to the density default
  // when the user didn't override it.
  const commentDuration = opts.comment_duration != null
    ? clampFloat(opts.comment_duration, 0.5, 30, densityPreset.commentDuration)
    : densityPreset.commentDuration;
  const safety = opts.safety_comment_limit;
  const preset = (opts.preset && FFMPEG_PRESET_CRF[opts.preset] != null ? opts.preset : "veryfast") as NonNullable<DanmakuOptions["preset"]>;
  const crf = opts.crf != null
    ? clampInt(opts.crf, 15, 35, FFMPEG_PRESET_CRF[preset])
    : FFMPEG_PRESET_CRF[preset];

  return {
    density,
    font_size: clampInt(opts.font_size ?? DEFAULT_FONT_SIZE, 8, 96, DEFAULT_FONT_SIZE),
    font_name: opts.font_name ?? DEFAULT_FONT_NAME,
    comment_duration: commentDuration,
    opacity: clampFloat(opts.opacity ?? DEFAULT_OPACITY, 0, 1, DEFAULT_OPACITY),
    ng_words: Array.isArray(opts.ng_words) ? opts.ng_words : [],
    min_message_length: clampInt(opts.min_message_length ?? 1, 0, 10, 1),
    deduplicate_consecutive: opts.deduplicate_consecutive ?? true,
    play_res_x: clampInt(opts.play_res_x ?? DEFAULT_PLAY_RES_X, 320, 7680, DEFAULT_PLAY_RES_X),
    play_res_y: clampInt(opts.play_res_y ?? DEFAULT_PLAY_RES_Y, 240, 4320, DEFAULT_PLAY_RES_Y),
    safety_comment_limit: safety != null ? clampInt(safety, 1, 10000, 1000) : null,
    preset,
    crf,
    reuse_temp_clip: opts.reuse_temp_clip ?? true,
    reuse_ass: opts.reuse_ass ?? false,
  };
}

// ─── ASS generation ─────────────────────────────────────────────────────────

export function generateDanmakuAss(req: DanmakuGenerateRequest): DanmakuGenerateResult {
  // Strip out the safety_comment_limit / preset / crf / cache knobs
  // before calling normalizeOptions (those are pipeline-level, not
  // ASS-level). This keeps DanmakuOptions backward-compatible.
  const { safety_comment_limit, ...assOnly } = (req.options || {}) as DanmakuOptions;
  const opts = normalizeOptions(assOnly);
  const { clip_start, clip_end } = req;

  // Step 1: Filter by range
  const inRange = req.chat.filter((m) => {
    const ts = m.time_sec;
    return ts >= clip_start && ts <= clip_end;
  });

  // Step 2: Apply message filters
  let skippedShort = 0;
  let skippedNg = 0;
  const filtered: NormalizedChatMessage[] = [];
  for (const msg of inRange) {
    if (!isValidMessage(msg.message, opts.min_message_length)) {
      skippedShort++;
      continue;
    }
    if (containsNgWord(msg.message, opts.ng_words)) {
      skippedNg++;
      continue;
    }
    filtered.push(msg);
  }

  // Step 3: Deduplicate consecutive identical comments
  let skippedDup = 0;
  const deduped: NormalizedChatMessage[] = [];
  if (opts.deduplicate_consecutive) {
    let lastText: string | null = null;
    for (const msg of filtered) {
      if (msg.message.trim() === lastText) {
        skippedDup++;
        continue;
      }
      lastText = msg.message.trim();
      deduped.push(msg);
    }
  } else {
    deduped.push(...filtered);
  }

  // Step 4: Sort by timestamp
  deduped.sort((a, b) => a.time_sec - b.time_sec);

  // Step 5: Apply optional safety cap (off by default). When no cap is
  // set we emit every in-range comment — this is the requested default
  // behaviour ("全コメントを焼き込む").
  let capped = deduped;
  let skippedSafety = 0;
  if (opts.safety_comment_limit != null && deduped.length > opts.safety_comment_limit) {
    const scored = deduped.map((m, i) => ({ score: priorityScore(m.message), idx: i, m }));
    scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
    const chosen = scored.slice(0, opts.safety_comment_limit);
    chosen.sort((a, b) => a.idx - b.idx);
    capped = chosen.map((c) => c.m);
    skippedSafety = deduped.length - capped.length;
  }

  // Step 6: Lane assignment
  const lanePairs = assignLanes(
    capped,
    clip_start,
    clip_end,
    opts.play_res_y,
    opts.font_size,
    opts.comment_duration,
    opts.density,
  );

  // Step 7: Build ASS (header requires Required<DanmakuOptions>; cast)
  const lines: string[] = [buildAssHeader(opts as Required<DanmakuOptions>)];
  for (const { message, lane } of lanePairs) {
    const dlg = buildDialogueLine(
      message,
      lane,
      clip_start,
      opts.play_res_x,
      opts.play_res_y,
      opts.font_size,
      opts.comment_duration,
    );
    if (dlg) lines.push(dlg);
  }

  const assContent = lines.join("\n") + "\n";
  // Caller writes the file (this function is pure)
  return {
    ass_path: "", // filled by caller
    stats: {
      in_range_count: inRange.length,
      used_count: lanePairs.length,
      skipped_ng: skippedNg,
      skipped_too_short: skippedShort,
      skipped_duplicate: skippedDup,
      skipped_safety_limit: skippedSafety,
    },
    // attach for caller convenience (cast to any to keep type clean)
    ...({ _assContent: assContent } as any),
  } as DanmakuGenerateResult & { _assContent: string };
}

// ─── Video resolution probe (for future use) ────────────────────────────────

export async function probeVideoForResolution(videoPath: string): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0",
        videoPath,
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    const m = trimmed.match(/^(\d+)x(\d+)$/);
    if (m) return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  } catch {}
  return null;
}

// ─── Path resolution ────────────────────────────────────────────────────────

function resolveVideoPath(videoPath: string): string {
  // Try as-is
  if (existsSync(videoPath)) return path.resolve(videoPath);
  // Try relative to MEDIA_ROOT
  const mediaRoot = getMediaRoot();
  const fromMedia = path.join(mediaRoot, videoPath);
  if (existsSync(fromMedia)) return fromMedia;
  // Try absolute
  if (path.isAbsolute(videoPath) && existsSync(videoPath)) return videoPath;
  // Fallback to the first candidate (will error in ffmpeg)
  return videoPath;
}

function buildOutputPaths(
  outputDir: string,
  withDanmaku: boolean,
  source: DanmakuExportSource = "local_file",
): { finalPath: string; clipPath: string; assPath: string; baseName: string } {
  const paths = getMediaPaths();
  const base = paths.mediaRoot;
  let outDir = outputDir;
  if (!path.isAbsolute(outDir)) {
    outDir = path.join(base, outDir);
  }
  const ts = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const suffix = withDanmaku ? "_danmaku" : "";
  const srcTag = source === "twitch_vod" ? "_vod" : source === "ass_only" ? "_ass" : "";
  const baseName = `clip${srcTag}_${ts}${suffix}`;
  const finalPath = path.join(outDir, `${baseName}.mp4`);
  const clipPath = path.join(outDir, `${baseName}.pre.mp4`);
  const assPath = path.join(outDir, `${baseName}.ass`);
  return { finalPath, clipPath, assPath, baseName };
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

// ─── FFmpeg stages ──────────────────────────────────────────────────────────

function runFfmpeg(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`FFmpeg timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout?.on("data", (b: Buffer) => { stdout += b.toString(); });
    child.stderr?.on("data", (b: Buffer) => { stderr += b.toString(); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const tail = stderr.trim().slice(-1000);
        reject(new Error(`FFmpeg exited with code ${code}: ${tail}`));
      }
    });
  });
}

async function ffmpegExtractClip(
  inputPath: string,
  outputPath: string,
  clipStart: number,
  clipEnd: number,
  fast: boolean,
  preset: string = "veryfast",
  crf: number = 23,
): Promise<void> {
  const duration = Math.max(0.1, clipEnd - clipStart);
  let args: string[];
  if (fast) {
    args = [
      "-y",
      "-ss", clipStart.toFixed(3),
      "-i", inputPath,
      "-t", duration.toFixed(3),
      "-c:v", "libx264", "-preset", preset, "-crf", String(crf),
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath,
    ];
  } else {
    args = [
      "-y",
      "-ss", clipStart.toFixed(3),
      "-i", inputPath,
      "-t", duration.toFixed(3),
      "-c", "copy",
      "-avoid_negative_ts", "make_zero",
      "-movflags", "+faststart",
      outputPath,
    ];
  }
  await runFfmpeg(args, 10 * 60_000);
}

async function ffmpegBurnAss(
  clipPath: string,
  assPath: string,
  outputPath: string,
  preset: string = "veryfast",
  crf: number = 23,
): Promise<void> {
  // ffmpeg's filter parser: backslashes need to be escaped, colons too on Windows
  const assFilterValue = assPath
    .replaceAll("\\", "/")
    .replaceAll(":", "\\:");
  const args = [
    "-y",
    "-i", clipPath,
    "-vf", `ass=${assFilterValue}`,
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf),
    "-c:a", "copy",
    "-movflags", "+faststart",
    outputPath,
  ];
  await runFfmpeg(args, 15 * 60_000);
}

/**
 * Single-pass FFmpeg: seek to clipStart, run for clipEnd-clipStart
 * seconds, optionally apply an ASS filter, and encode to H.264 — all in
 * one invocation. This avoids the round-trip cost of extracting a
 * pre-clip first.
 */
async function ffmpegExtractAndBurnOnePass(
  inputPath: string,
  outputPath: string,
  clipStart: number,
  clipEnd: number,
  assPath: string,
  preset: string = "veryfast",
  crf: number = 23,
): Promise<void> {
  const duration = Math.max(0.1, clipEnd - clipStart);
  const assFilterValue = assPath
    .replaceAll("\\", "/")
    .replaceAll(":", "\\:");
  const args = [
    "-y",
    "-ss", clipStart.toFixed(3),
    "-i", inputPath,
    "-t", duration.toFixed(3),
    "-vf", `ass=${assFilterValue}`,
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf),
    "-c:a", "copy",
    "-movflags", "+faststart",
    outputPath,
  ];
  await runFfmpeg(args, 15 * 60_000);
}

// ─── Caching helpers ─────────────────────────────────────────────────────────

function tempVideoPathFor(videoId: string, start: number, end: number): string {
  const paths = getMediaPaths();
  const base = path.join(paths.outputClipsDir, "..", "tmp");
  const safeId = (videoId || "video").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(base, `v${safeId}_${Math.floor(start)}_${Math.floor(end)}.mp4`);
}

function assCacheKey(
  chat: NormalizedChatMessage[],
  clipStart: number,
  clipEnd: number,
  options: DanmakuOptions,
): string {
  const parts = [
    `s=${clipStart.toFixed(6)}`,
    `e=${clipEnd.toFixed(6)}`,
    `n=${chat.length}`,
    `first=${chat.length > 0 ? chat[0].time_sec : 0}`,
    `last=${chat.length > 0 ? chat[chat.length - 1].time_sec : 0}`,
    `d=${options.density ?? "medium"}`,
    `f=${options.font_size ?? 32}`,
    `cd=${options.comment_duration ?? 4.0}`,
    `o=${options.opacity ?? 0.9}`,
    `fn=${options.font_name ?? "Noto Sans CJK JP"}`,
    `sl=${options.safety_comment_limit ?? ""}`,
    `dd=${options.deduplicate_consecutive ?? true}`,
    `ml=${options.min_message_length ?? 1}`,
  ];
  // Lightweight FNV-1a hash to avoid pulling crypto into the bundle
  let h = 0x811c9dc5;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `ass_${h.toString(16).padStart(8, "0")}.ass`;
}

function assCachePathFor(key: string): string {
  const paths = getMediaPaths();
  return path.join(paths.outputClipsDir, "..", "ass_cache", key);
}

// ─── Main entry point ───────────────────────────────────────────────────────

export async function exportDanmakuClip(req: DanmakuExportRequest): Promise<DanmakuExportResult> {
  const start = Date.now();
  const source: DanmakuExportSource = req.source ?? (req.vod_url ? "twitch_vod" : "local_file");
  const withDanmaku = req.with_danmaku !== false;

  // Validate range up front
  if (req.clip_end <= req.clip_start) {
    return {
      ok: false,
      source,
      error_code: "INVALID_RANGE",
      message: `clip_end (${req.clip_end}) must be greater than clip_start (${req.clip_start})`,
    };
  }

  const opts = normalizeOptions(req.options);
  const allCommentsMode = opts.safety_comment_limit == null;
  let tempVideoCacheHit = false;
  let assCacheHit = false;

  try {
    // ── ASS-only path: skip video entirely ───────────────────────────────
    if (source === "ass_only") {
      const { assPath, finalPath } = buildOutputPaths(
        req.output_dir ?? "output",
        true,
        source,
      );
      await mkdir(path.dirname(assPath), { recursive: true });
      const generated = generateDanmakuAss({
        chat: req.chat,
        clip_start: req.clip_start,
        clip_end: req.clip_end,
        options: opts as DanmakuOptions,
      });
      const assContent = (generated as any)._assContent as string;
      await writeFile(assPath, assContent, "utf8");
      return {
        ok: true,
        source,
        output_file: undefined,
        ass_file: toRelativeIfPossible(assPath),
        range_comment_count: generated.stats.in_range_count,
        burned_comment_count: generated.stats.used_count,
        comment_count: generated.stats.used_count,
        in_range_count: generated.stats.in_range_count,
        skipped_ng: generated.stats.skipped_ng,
        skipped_too_short: generated.stats.skipped_too_short,
        skipped_duplicate: generated.stats.skipped_duplicate,
        skipped_safety_limit: generated.stats.skipped_safety_limit,
        all_comments: allCommentsMode,
        clip_start: req.clip_start,
        clip_end: req.clip_end,
        duration_seconds: (Date.now() - start) / 1000,
        ffmpeg_preset: opts.preset,
        ffmpeg_crf: opts.crf,
        ass_cache_hit: false,
        temp_video_cache_hit: false,
      };
    }

    // ── Build output paths once ────────────────────────────────────────
    const { finalPath, clipPath, assPath } = buildOutputPaths(
      req.output_dir ?? "output",
      withDanmaku,
      source,
    );
    await mkdir(path.dirname(finalPath), { recursive: true });

    // ── Resolve the source video ────────────────────────────────────────
    let videoInputPath: string = "";
    let temporaryVideoFile: string | undefined;

    if (source === "twitch_vod") {
      if (!req.vod_url) {
        return {
          ok: false,
          source,
          error_code: "VOD_URL_REQUIRED",
          message: "Twitch VOD URLが必要です。",
        };
      }
      // Cache check: reuse the temp clip if it already exists.
      const cachedTemp = tempVideoPathFor(
        req.video_id ?? "video", req.clip_start, req.clip_end
      );
      if (opts.reuse_temp_clip && existsSync(cachedTemp)) {
        try {
          const st = await stat(cachedTemp);
          if (st.size > 0) {
            videoInputPath = cachedTemp;
            temporaryVideoFile = toRelativeIfPossible(cachedTemp);
            tempVideoCacheHit = true;
          }
        } catch {}
      }
      if (!videoInputPath) {
        const fetchResult = await fetchTwitchRange({
          vod_url: req.vod_url,
          video_id: req.video_id ?? null,
          start_seconds: req.clip_start,
          end_seconds: req.clip_end,
          output_dir: "output/tmp",
        });
        if (!fetchResult.ok) {
          return {
            ok: false,
            source,
            error_code: fetchResult.error_code || "TWITCH_VOD_RANGE_FETCH_FAILED",
            message: fetchResult.message || "Twitch VODから選択範囲を取得できませんでした。",
            fallback: { local_file: true, twitch_vod: false, ass_only: true },
          };
        }
        videoInputPath = fetchResult.absolute_path!;
        temporaryVideoFile = fetchResult.output_path;
        // The fetched file IS the full range; clip_start becomes 0 for
        // the subsequent ASS burn-in stage.
        req = { ...req, clip_start: 0.0, clip_end: req.clip_end - req.clip_start };
      } else {
        // Cache hit: shift the burn-in to start at 0
        req = { ...req, clip_start: 0.0, clip_end: req.clip_end - req.clip_start };
      }
    } else {
      if (!req.video_path) {
        return {
          ok: false,
          source,
          error_code: "LOCAL_VIDEO_REQUIRED",
          message: "ローカル動画ファイルが必要です。",
        };
      }
      videoInputPath = resolveVideoPath(req.video_path);
      if (!existsSync(videoInputPath)) {
        return {
          ok: false,
          source,
          error_code: "LOCAL_VIDEO_NOT_FOUND",
          message: `ローカル動画ファイルが見つかりません: ${req.video_path}`,
          fallback: { local_file: false, twitch_vod: true, ass_only: true },
        };
      }
    }

    // ── If danmaku disabled, just produce the video clip ──────────────
    if (!withDanmaku) {
      if (source === "twitch_vod") {
        // The temp file IS the clip — copy it to the final path.
        await writeFile(finalPath, await import("node:fs").then((fs) => fs.promises.readFile(videoInputPath)));
      } else {
        try {
          await ffmpegExtractClip(
            videoInputPath,
            clipPath,
            req.clip_start,
            req.clip_end,
            req.fast ?? false,
            opts.preset,
            opts.crf,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown FFmpeg error";
          return {
            ok: false,
            source,
            error_code: "CLIP_EXTRACT_FAILED",
            message: `クリップ抽出に失敗しました: ${msg}`,
            ffmpeg_preset: opts.preset,
            ffmpeg_crf: opts.crf,
          };
        }
        await writeFile(finalPath, await import("node:fs").then((fs) => fs.promises.readFile(clipPath)));
        await unlink(clipPath).catch(() => {});
      }
      return {
        ok: true,
        source,
        output_file: toRelativeIfPossible(finalPath),
        temporary_video_file: temporaryVideoFile,
        range_comment_count: 0,
        burned_comment_count: 0,
        clip_start: req.clip_start,
        clip_end: req.clip_end,
        duration_seconds: (Date.now() - start) / 1000,
        ffmpeg_preset: opts.preset,
        ffmpeg_crf: opts.crf,
        temp_video_cache_hit: tempVideoCacheHit,
        ass_cache_hit: false,
        all_comments: allCommentsMode,
      };
    }

    // ── Generate ASS (with optional cache) ──────────────────────────────
    let assStats: DanmakuStats;
    if (opts.reuse_ass) {
      const cacheKey = assCacheKey(req.chat, req.clip_start, req.clip_end, req.options ?? {});
      const cachePath = assCachePathFor(cacheKey);
      if (existsSync(cachePath)) {
        const cacheStat = await stat(cachePath);
        if (cacheStat.size > 0) {
          assCacheHit = true;
          await mkdir(path.dirname(assPath), { recursive: true });
          await writeFile(assPath, await import("node:fs").then((fs) => fs.promises.readFile(cachePath)));
          // Recompute stats cheaply: the cache hit implies all in-range
          // comments are emitted (no cap). We compute in_range_count
          // from the chat array directly.
          const inRange = req.chat.filter(
            (m) => m.time_sec >= req.clip_start && m.time_sec <= req.clip_end
          ).length;
          assStats = {
            in_range_count: inRange,
            used_count: inRange,
            skipped_ng: 0,
            skipped_too_short: 0,
            skipped_duplicate: 0,
            skipped_safety_limit: 0,
          };
        } else {
          assStats = await generateAndCacheAss(req, assPath, opts);
        }
      } else {
        assStats = await generateAndCacheAss(req, assPath, opts);
      }
    } else {
      assStats = await generateAndCacheAss(req, assPath, opts);
    }

    // ── Burn ASS into the source video (single-pass when possible) ───
    try {
      if (source === "twitch_vod") {
        // The temp file IS the full range — single-pass.
        await ffmpegExtractAndBurnOnePass(
          videoInputPath,
          finalPath,
          req.clip_start,
          req.clip_end,
          assPath,
          opts.preset,
          opts.crf,
        );
      } else {
        // local_file: single-pass extract + burn (skips the pre-clip.mp4
        // round-trip).
        await ffmpegExtractAndBurnOnePass(
          videoInputPath,
          finalPath,
          req.clip_start,
          req.clip_end,
          assPath,
          opts.preset,
          opts.crf,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown FFmpeg error";
      const isTimeout = e instanceof Error && e.message?.toLowerCase().includes("timeout");
      return {
        ok: false,
        source,
        error_code: isTimeout ? "ASS_BURN_TIMEOUT" : "ASS_BURN_FAILED",
        message: `弾幕の焼き込みに失敗しました: ${msg}`,
        temporary_video_file: temporaryVideoFile,
        ass_file: toRelativeIfPossible(assPath),
        range_comment_count: assStats.in_range_count,
        burned_comment_count: assStats.used_count,
        skipped_ng: assStats.skipped_ng,
        skipped_too_short: assStats.skipped_too_short,
        skipped_duplicate: assStats.skipped_duplicate,
        skipped_safety_limit: assStats.skipped_safety_limit,
        all_comments: allCommentsMode,
        ffmpeg_preset: opts.preset,
        ffmpeg_crf: opts.crf,
      };
    }

    // Cleanup the local_file intermediate (we used single-pass so it
    // shouldn't exist, but be safe).
    if (source === "local_file" && clipPath) {
      await unlink(clipPath).catch(() => {});
    }

    return {
      ok: true,
      source,
      output_file: toRelativeIfPossible(finalPath),
      temporary_video_file: temporaryVideoFile,
      ass_file: toRelativeIfPossible(assPath),
      range_comment_count: assStats.in_range_count,
      burned_comment_count: assStats.used_count,
      comment_count: assStats.used_count,
      in_range_count: assStats.in_range_count,
      skipped_ng: assStats.skipped_ng,
      skipped_too_short: assStats.skipped_too_short,
      skipped_duplicate: assStats.skipped_duplicate,
      skipped_safety_limit: assStats.skipped_safety_limit,
      all_comments: allCommentsMode,
      clip_start: req.clip_start,
      clip_end: req.clip_end,
      duration_seconds: (Date.now() - start) / 1000,
      ffmpeg_preset: opts.preset,
      ffmpeg_crf: opts.crf,
      command_preview: undefined,
      ass_cache_hit: assCacheHit,
      temp_video_cache_hit: tempVideoCacheHit,
    };
  } catch (e) {
    return {
      ok: false,
      source,
      error_code: "INTERNAL_ERROR",
      message: e instanceof Error ? e.message : "Unknown internal error",
    };
  }
}

/** Generate the ASS file (and write to ASS cache) and return the stats. */
async function generateAndCacheAss(
  req: DanmakuExportRequest,
  assPath: string,
  opts: ReturnType<typeof normalizeOptions>,
): Promise<DanmakuStats> {
  const generated = generateDanmakuAss({
    chat: req.chat,
    clip_start: req.clip_start,
    clip_end: req.clip_end,
    options: opts as DanmakuOptions,
  });
  const assContent = (generated as any)._assContent as string;
  await writeFile(assPath, assContent, "utf8");

  if (opts.reuse_ass) {
    try {
      const cacheKey = assCacheKey(req.chat, req.clip_start, req.clip_end, req.options ?? {});
      const cachePath = assCachePathFor(cacheKey);
      const cacheDir = path.dirname(cachePath);
      await mkdir(cacheDir, { recursive: true });
      if (!existsSync(cachePath)) {
        await writeFile(cachePath, assContent, "utf8");
      }
    } catch {
      // cache write failure is non-fatal
    }
  }

  return generated.stats;
}

/**
 * Generate only the ASS file (no video output).
 */
export async function generateAssOnly(req: DanmakuGenerateRequest & { output_path: string }): Promise<DanmakuGenerateResult & { ok: boolean; error_code?: string; message?: string }> {
  try {
    const opts = normalizeOptions(req.options);
    const generated = generateDanmakuAss({
      chat: req.chat,
      clip_start: req.clip_start,
      clip_end: req.clip_end,
      options: opts as DanmakuOptions,
    });
    const assContent = (generated as any)._assContent as string;
    await mkdir(path.dirname(req.output_path), { recursive: true });
    await writeFile(req.output_path, assContent, "utf8");
    return { ...generated, ass_path: req.output_path, ok: true };
  } catch (e) {
    return {
      ok: false,
      ass_path: "",
      stats: { in_range_count: 0, used_count: 0, skipped_ng: 0, skipped_too_short: 0, skipped_duplicate: 0, skipped_safety_limit: 0 },
      error_code: "ASS_GENERATION_FAILED",
      message: e instanceof Error ? e.message : "Unknown error",
    };
  }
}
