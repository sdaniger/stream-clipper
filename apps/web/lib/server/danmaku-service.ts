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
  max_comments?: number;
  font_size?: number;
  font_name?: string;
  comment_duration?: number;
  opacity?: number;
  ng_words?: string[];
  min_message_length?: number;
  deduplicate_consecutive?: boolean;
  play_res_x?: number;
  play_res_y?: number;
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
};

export type DanmakuGenerateResult = {
  ass_path: string;
  stats: DanmakuStats;
};

export type DanmakuExportRequest = {
  video_path: string;
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
  output_file?: string;
  ass_file?: string;
  comment_count?: number;
  in_range_count?: number;
  skipped_ng?: number;
  skipped_too_short?: number;
  skipped_duplicate?: number;
  clip_start?: number;
  clip_end?: number;
  error_code?: string;
  message?: string;
  command_preview?: string;
  duration_seconds?: number;
};

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_PLAY_RES_X = 1920;
const DEFAULT_PLAY_RES_Y = 1080;
const DEFAULT_FONT_NAME = "Noto Sans CJK JP";
const DEFAULT_FONT_SIZE = 32;
const DEFAULT_COMMENT_DURATION = 4.0;
const DEFAULT_OPACITY = 0.9;
const DEFAULT_MAX_COMMENTS = 120;
const DEFAULT_DENSITY: DanmakuDensity = "medium";
const DEFAULT_LINE_HEIGHT = 48;
const DENSITY_PRESETS: Record<DanmakuDensity, number> = {
  low: 50,
  medium: 120,
  high: 250,
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
): Array<{ message: NormalizedChatMessage; lane: number }> {
  const lineHeight = Math.max(fontSize + 8, DEFAULT_LINE_HEIGHT);
  const usable = Math.floor(playResY * 0.8);
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
      // All lanes busy — overwrite the earliest-freeing one
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

function normalizeOptions(opts: DanmakuOptions = {}): Required<DanmakuOptions> {
  const density: DanmakuDensity = opts.density ?? DEFAULT_DENSITY;
  const maxFromOpts = opts.max_comments;
  // If user didn't override max_comments, use density preset
  const maxComments = maxFromOpts != null
    ? clampInt(maxFromOpts, 1, 1000, DEFAULT_MAX_COMMENTS)
    : DENSITY_PRESETS[density];

  return {
    density,
    max_comments: maxComments,
    font_size: clampInt(opts.font_size ?? DEFAULT_FONT_SIZE, 8, 96, DEFAULT_FONT_SIZE),
    font_name: opts.font_name ?? DEFAULT_FONT_NAME,
    comment_duration: clampFloat(opts.comment_duration ?? DEFAULT_COMMENT_DURATION, 0.5, 30, DEFAULT_COMMENT_DURATION),
    opacity: clampFloat(opts.opacity ?? DEFAULT_OPACITY, 0, 1, DEFAULT_OPACITY),
    ng_words: Array.isArray(opts.ng_words) ? opts.ng_words : [],
    min_message_length: clampInt(opts.min_message_length ?? 1, 0, 10, 1),
    deduplicate_consecutive: opts.deduplicate_consecutive ?? true,
    play_res_x: clampInt(opts.play_res_x ?? DEFAULT_PLAY_RES_X, 320, 7680, DEFAULT_PLAY_RES_X),
    play_res_y: clampInt(opts.play_res_y ?? DEFAULT_PLAY_RES_Y, 240, 4320, DEFAULT_PLAY_RES_Y),
  };
}

// ─── ASS generation ─────────────────────────────────────────────────────────

export function generateDanmakuAss(req: DanmakuGenerateRequest): DanmakuGenerateResult {
  const opts = normalizeOptions(req.options);
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

  // Step 5: Cap to max_comments with priority selection
  let capped = deduped;
  if (deduped.length > opts.max_comments) {
    const scored = deduped.map((m, i) => ({ score: priorityScore(m.message), idx: i, m }));
    scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
    const chosen = scored.slice(0, opts.max_comments);
    chosen.sort((a, b) => a.idx - b.idx);
    capped = chosen.map((c) => c.m);
  }

  // Step 6: Lane assignment
  const lanePairs = assignLanes(
    capped,
    clip_start,
    clip_end,
    opts.play_res_y,
    opts.font_size,
    opts.comment_duration,
  );

  // Step 7: Build ASS
  const lines: string[] = [buildAssHeader(opts)];
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
): { finalPath: string; clipPath: string; assPath: string; baseName: string } {
  const paths = getMediaPaths();
  const base = paths.mediaRoot;
  let outDir = outputDir;
  if (!path.isAbsolute(outDir)) {
    outDir = path.join(base, outDir);
  }
  const ts = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const suffix = withDanmaku ? "_danmaku" : "";
  const baseName = `clip_${ts}${suffix}`;
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
): Promise<void> {
  const duration = Math.max(0.1, clipEnd - clipStart);
  let args: string[];
  if (fast) {
    args = [
      "-y",
      "-ss", clipStart.toFixed(3),
      "-i", inputPath,
      "-t", duration.toFixed(3),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
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
): Promise<void> {
  // ffmpeg's filter parser: backslashes need to be escaped, colons too on Windows
  const assFilterValue = assPath
    .replaceAll("\\", "/")
    .replaceAll(":", "\\:");
  const args = [
    "-y",
    "-i", clipPath,
    "-vf", `ass=${assFilterValue}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "copy",
    "-movflags", "+faststart",
    outputPath,
  ];
  await runFfmpeg(args, 15 * 60_000);
}

// ─── Main entry point ───────────────────────────────────────────────────────

export async function exportDanmakuClip(req: DanmakuExportRequest): Promise<DanmakuExportResult> {
  const start = Date.now();
  try {
    // 1. Resolve video path
    const videoAbs = resolveVideoPath(req.video_path);
    if (!existsSync(videoAbs)) {
      return {
        ok: false,
        error_code: "LOCAL_VIDEO_REQUIRED",
        message: `弾幕付きmp4出力にはローカル動画ファイルが必要です (path: ${req.video_path})`,
      };
    }

    if (req.clip_end <= req.clip_start) {
      return {
        ok: false,
        error_code: "INVALID_RANGE",
        message: `clip_end (${req.clip_end}) must be greater than clip_start (${req.clip_start})`,
      };
    }

    // 2. Build paths
    const { finalPath, clipPath, assPath } = buildOutputPaths(
      req.output_dir ?? "output",
      req.with_danmaku !== false,
    );
    await mkdir(path.dirname(finalPath), { recursive: true });

    // 3. Extract clip (stage 1)
    try {
      await ffmpegExtractClip(videoAbs, clipPath, req.clip_start, req.clip_end, req.fast ?? false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown FFmpeg error";
      return {
        ok: false,
        error_code: "CLIP_EXTRACT_FAILED",
        message: `クリップ抽出に失敗しました: ${msg}`,
      };
    }

    // 4. If danmaku disabled, just rename the clip as the final
    if (req.with_danmaku === false) {
      // Move clip → final
      await writeFile(finalPath, await import("node:fs").then((fs) => fs.promises.readFile(clipPath)));
      await unlink(clipPath).catch(() => {});
      return {
        ok: true,
        output_file: toRelativeIfPossible(finalPath),
        comment_count: 0,
        in_range_count: 0,
        clip_start: req.clip_start,
        clip_end: req.clip_end,
        duration_seconds: (Date.now() - start) / 1000,
      };
    }

    // 5. Generate ASS (stage 2)
    const opts = normalizeOptions(req.options);
    const generated = generateDanmakuAss({
      chat: req.chat,
      clip_start: req.clip_start,
      clip_end: req.clip_end,
      options: opts,
    });
    const assContent = (generated as any)._assContent as string;
    await writeFile(assPath, assContent, "utf8");

    // 6. Burn ASS into clip (stage 3)
    try {
      await ffmpegBurnAss(clipPath, assPath, finalPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown FFmpeg error";
      return {
        ok: false,
        error_code: "ASS_BURN_FAILED",
        message: `弾幕の焼き込みに失敗しました: ${msg}`,
        ass_file: toRelativeIfPossible(assPath),
        comment_count: generated.stats.used_count,
        in_range_count: generated.stats.in_range_count,
        skipped_ng: generated.stats.skipped_ng,
        skipped_too_short: generated.stats.skipped_too_short,
        skipped_duplicate: generated.stats.skipped_duplicate,
      };
    }

    // 7. Cleanup intermediate clip
    await unlink(clipPath).catch(() => {});

    // 8. Get final size
    const finalStat = await stat(finalPath).catch(() => null);

    return {
      ok: true,
      output_file: toRelativeIfPossible(finalPath),
      ass_file: toRelativeIfPossible(assPath),
      comment_count: generated.stats.used_count,
      in_range_count: generated.stats.in_range_count,
      skipped_ng: generated.stats.skipped_ng,
      skipped_too_short: generated.stats.skipped_too_short,
      skipped_duplicate: generated.stats.skipped_duplicate,
      clip_start: req.clip_start,
      clip_end: req.clip_end,
      duration_seconds: (Date.now() - start) / 1000,
    };
  } catch (e) {
    return {
      ok: false,
      error_code: "INTERNAL_ERROR",
      message: e instanceof Error ? e.message : "Unknown internal error",
    };
  }
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
      options: opts,
    });
    const assContent = (generated as any)._assContent as string;
    await mkdir(path.dirname(req.output_path), { recursive: true });
    await writeFile(req.output_path, assContent, "utf8");
    return { ...generated, ass_path: req.output_path, ok: true };
  } catch (e) {
    return {
      ok: false,
      ass_path: "",
      stats: { in_range_count: 0, used_count: 0, skipped_ng: 0, skipped_too_short: 0, skipped_duplicate: 0 },
      error_code: "ASS_GENERATION_FAILED",
      message: e instanceof Error ? e.message : "Unknown error",
    };
  }
}
