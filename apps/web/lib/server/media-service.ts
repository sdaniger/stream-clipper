import { execFile, spawn } from "node:child_process";
import { access, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ClipCandidate, ClipCandidateVariant, ClipTranscription, CommentAssetReference, CommentBurnedClipReference, GeneratedClipReference, ThumbnailCandidateReference } from "@/lib/mock-candidates";

const execFileAsync = promisify(execFile);

export type ToolStatus = {
  available: boolean;
  command: string;
  version?: string;
  error?: string;
};

export type MediaRuntimeStatus = {
  mediaRoot: string;
  inputDir: string;
  inputDownloadsDir: string;
  outputClipsDir: string;
  outputCommentAssDir: string;
  outputClipsWithCommentsDir: string;
  outputChatLogsDir: string;
  outputPackagesDir: string;
  outputThumbnailsDir: string;
  ffmpeg: ToolStatus;
  ffprobe: ToolStatus;
  ytDlp: ToolStatus;
};

export type VideoMetadata = {
  inputPath: string;
  absolutePath: string;
  filename: string;
  sizeBytes: number;
  durationSeconds: number | null;
  duration: string | null;
  formatName: string | null;
  bitrate: number | null;
  video: {
    codec: string | null;
    width: number | null;
    height: number | null;
    fps: number | null;
  } | null;
  audio: {
    codec: string | null;
    sampleRate: number | null;
    channels: number | null;
  } | null;
};

export type FfmpegProgressEvent = {
  frame: number;
  fps: number;
  timeSeconds: number;
  percent: number;
  etaSeconds: number;
  speed: string;
};

export type FfmpegProgressCallback = (progress: FfmpegProgressEvent) => void;

export type GenerateClipInput = {
  inputPath: string;
  candidateId: string;
  variantId: string;
  start: string;
  duration: string;
  mode?: "copy" | "reencode";
  /** FFmpeg encoder. Defaults to libx264 (CPU). Use h264_nvenc for GPU. */
  encoder?: "libx264" | "h264_nvenc" | "hevc_nvenc";
  onProgress?: FfmpegProgressCallback;
  signal?: AbortSignal;
};

export type GeneratedClip = {
  inputPath: string;
  outputPath: string;
  absoluteOutputPath: string;
  start: string;
  duration: string;
  mode: "copy" | "reencode";
  commandPreview: string;
};

export type BurnCommentsIntoClipInput = {
  clipPath: string;
  candidateId: string;
  variantId?: string;
  assPath?: string;
  assContent?: string;
  assFileName?: string;
  /**
   * Optional FFmpeg knobs. Defaults to the narinico tool's values:
   * libx264 veryfast crf=20, AAC 160k, +faststart. Set encoder to
   * "h264_nvenc" on hosts with NVIDIA GPUs to use the hardware path.
   */
  encoder?: "libx264" | "h264_nvenc" | "hevc_nvenc" | "libx265";
  crf?: number;
  preset?: string;
  /**
   * Apply EBU R128 loudness normalization to the audio before muxing.
   * Useful for VTubers who stream at low volume (matches the narinico
   * tool's `loudnorm` pass). Defaults to false to avoid double-normalizing
   * already-loud sources.
   */
  normalizeAudio?: boolean;
};

export type CommentBurnedClip = {
  candidateId: string;
  variantId?: string;
  inputClipPath: string;
  assPath: string;
  outputPath: string;
  absoluteOutputPath: string;
  commandPreview: string;
  createdAt: string;
};

export type GenerateExportPackageInput = {
  candidate: ClipCandidate;
  selectedVariant?: ClipCandidateVariant;
  generatedClip?: GeneratedClipReference;
  commentBurnedClip?: CommentBurnedClipReference;
  transcription?: ClipTranscription;
  commentsJson?: string;
  commentsAss?: string;
  commentJsonFileName?: string;
  commentAssFileName?: string;
  thumbnailCandidates?: ThumbnailCandidateReference[];
};

export type ExportPackageAsset = {
  label: string;
  kind: "video" | "transcript" | "comments" | "thumbnail";
  fileName: string;
  packagePath: string;
  sourcePath?: string;
  sizeBytes: number;
};

export type GeneratedExportPackage = {
  candidateId: string;
  packagePath: string;
  absolutePackagePath: string;
  metadataPath: string;
  notesPath: string;
  copiedAssets: ExportPackageAsset[];
  createdAt: string;
};

export type GenerateThumbnailInput = {
  clipPath: string;
  candidateId: string;
  timestamp: string;
  label?: string;
};

export type GeneratedThumbnail = {
  candidateId: string;
  sourceClipPath: string;
  timestamp: string;
  outputPath: string;
  absoluteOutputPath: string;
  commandPreview: string;
  createdAt: string;
};

export type WriteCommentAssetsInput = {
  candidateId: string;
  jsonContent: string;
  assContent: string;
  jsonFileName?: string;
  assFileName?: string;
};

type FfprobeJson = {
  format?: {
    filename?: string;
    format_name?: string;
    duration?: string;
    bit_rate?: string;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    sample_rate?: string;
    channels?: number;
  }>;
};

export function getMediaRoot() {
  const workspaceRoot = getWorkspaceRoot();
  const configuredRoot = process.env.MEDIA_ROOT ?? "./media";

  return path.resolve(workspaceRoot, configuredRoot);
}

export function getMediaPaths() {
  const mediaRoot = getMediaRoot();

  return {
    mediaRoot,
    inputDir: path.join(mediaRoot, "input"),
    inputDownloadsDir: path.join(mediaRoot, "input", "downloads"),
    outputClipsDir: path.join(mediaRoot, "output", "clips"),
    outputCommentAssDir: path.join(mediaRoot, "output", "comments_ass"),
    outputClipsWithCommentsDir: path.join(mediaRoot, "output", "clips_with_comments"),
    outputChatLogsDir: path.join(mediaRoot, "output", "chat_logs"),
    outputPackagesDir: path.join(mediaRoot, "output", "packages"),
    outputThumbnailsDir: path.join(mediaRoot, "output", "thumbnails")
  };
}

export async function getMediaRuntimeStatus(): Promise<MediaRuntimeStatus> {
  const paths = getMediaPaths();
  await ensureMediaDirs();

  const [ffmpeg, ffprobe, ytDlp] = await Promise.all([checkTool("ffmpeg"), checkTool("ffprobe"), checkTool("yt-dlp")]);

  return {
    ...paths,
    ffmpeg,
    ffprobe,
    ytDlp
  };
}

export async function probeVideo(inputPath: string): Promise<VideoMetadata> {
  const absoluteInputPath = resolveMediaPath(inputPath);
  const fileStat = await assertFileExists(absoluteInputPath);
  const ffprobe = await checkTool("ffprobe");

  if (!ffprobe.available) {
    throw new Error(ffprobe.error ?? "ffprobe is not available on PATH.");
  }

  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", absoluteInputPath],
    { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }
  );
  const metadata = JSON.parse(stdout) as FfprobeJson;
  const videoStream = metadata.streams?.find((stream) => stream.codec_type === "video");
  const audioStream = metadata.streams?.find((stream) => stream.codec_type === "audio");
  const durationSeconds = parseNullableNumber(metadata.format?.duration);

  return {
    inputPath: normalizeRelativePath(inputPath),
    absolutePath: absoluteInputPath,
    filename: path.basename(absoluteInputPath),
    sizeBytes: fileStat.size,
    durationSeconds,
    duration: durationSeconds === null ? null : formatSeconds(durationSeconds),
    formatName: metadata.format?.format_name ?? null,
    bitrate: parseNullableInteger(metadata.format?.bit_rate),
    video: videoStream
      ? {
          codec: videoStream.codec_name ?? null,
          width: videoStream.width ?? null,
          height: videoStream.height ?? null,
          fps: parseFrameRate(videoStream.avg_frame_rate ?? videoStream.r_frame_rate)
        }
      : null,
    audio: audioStream
      ? {
          codec: audioStream.codec_name ?? null,
          sampleRate: parseNullableInteger(audioStream.sample_rate),
          channels: audioStream.channels ?? null
        }
      : null
  };
}

export async function generateClip(input: GenerateClipInput): Promise<GeneratedClip> {
  const mode = input.mode ?? "copy";
  const absoluteInputPath = resolveMediaPath(input.inputPath);
  await assertFileExists(absoluteInputPath);
  await ensureMediaDirs();

  const ffmpeg = await checkTool("ffmpeg");
  if (!ffmpeg.available) {
    throw new Error(ffmpeg.error ?? "ffmpeg is not available on PATH.");
  }

  const startSeconds = parseTimecode(input.start, "start");
  const durationSeconds = parseTimecode(input.duration, "duration");

  if (durationSeconds <= 0) {
    throw new Error("Clip duration must be greater than zero.");
  }

  if (durationSeconds > 30 * 60) {
    throw new Error("Development clip generation is limited to 30 minutes per request.");
  }

  const outputFileName = buildOutputFileName(input.candidateId, input.variantId, input.start, mode);
  const outputPath = path.join(getMediaPaths().outputClipsDir, outputFileName);
  const outputRelativePath = path.join("output", "clips", outputFileName);
  const args = buildFfmpegArgs(absoluteInputPath, outputPath, startSeconds, durationSeconds, mode, input.encoder);

  if (input.onProgress) {
    await runFfmpegWithProgress(args, durationSeconds, input.onProgress, input.signal);
  } else {
    await execFileAsync("ffmpeg", args, { timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024 });
  }

  return {
    inputPath: normalizeRelativePath(input.inputPath),
    outputPath: outputRelativePath.replaceAll(path.sep, "/"),
    absoluteOutputPath: outputPath,
    start: formatSeconds(startSeconds),
    duration: formatSeconds(durationSeconds),
    mode,
    commandPreview: `ffmpeg ${args.map(shellQuote).join(" ")}`
  };
}

async function runFfmpegWithProgress(args: string[], durationSeconds: number, onProgress: FfmpegProgressCallback, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = resolveFfmpegPath();
    const child = spawn(ffmpegPath, args, { timeout: 10 * 60_000 });
    let stderrCollector = "";
    let stderrBuffer = "";
    let timedOut = false;
    let aborted = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      reject(new Error("FFmpeg process timed out after 10 minutes."));
    }, 10 * 60_000);

    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      child.kill("SIGTERM");
      reject(new DOMException("FFmpeg clip was cancelled.", "AbortError"));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrCollector += text;
      stderrBuffer += text;
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.includes("time=")) continue;

        const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (!timeMatch) continue;

        const h = parseInt(timeMatch[1], 10);
        const m = parseInt(timeMatch[2], 10);
        const s = parseFloat(timeMatch[3]);
        const elapsedSeconds = h * 3600 + m * 60 + s;
        const percent = durationSeconds > 0 ? Math.min(99, (elapsedSeconds / durationSeconds) * 100) : 0;
        const remaining = durationSeconds - elapsedSeconds;

        const frameMatch = line.match(/frame=\s*(\d+)/);
        const fpsMatch = line.match(/fps=\s*([\d.]+)/);
        const speedMatch = line.match(/speed=\s*([\d.]+)x/);

        if (!timedOut) {
          try {
            onProgress({
              frame: frameMatch ? parseInt(frameMatch[1], 10) : 0,
              fps: fpsMatch ? parseFloat(fpsMatch[1]) : 0,
              timeSeconds: elapsedSeconds,
              percent,
              etaSeconds: Math.max(0, remaining),
              speed: speedMatch ? speedMatch[1] : "0"
            });
          } catch {
            // Client disconnected
          }
        }
      }
    });

    child.on("close", (code) => {
      cleanup();
      if (timedOut || aborted) return;
      if (code === 0) {
        resolve();
      } else {
        const tail = stderrCollector.trim().slice(-1000);
        reject(new Error(`FFmpeg exited with code ${code}${tail ? `: ${tail}` : ""}`));
      }
    });

    child.on("error", (err) => {
      cleanup();
      if (aborted) return;
      reject(err);
    });
  });
}

function resolveFfmpegPath() {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

export async function burnCommentsIntoClip(input: BurnCommentsIntoClipInput): Promise<CommentBurnedClip> {
  const absoluteClipPath = resolveMediaPath(input.clipPath);
  await assertFileExists(absoluteClipPath, "Clip file");
  await ensureMediaDirs();

  const ffmpeg = await checkTool("ffmpeg");
  if (!ffmpeg.available) {
    throw new Error(ffmpeg.error ?? "ffmpeg is not available on PATH.");
  }

  const { assRelativePath } = await prepareAssFile(input);
  const outputFileName = buildCommentBurnedOutputFileName(input.candidateId, input.variantId);
  const paths = getMediaPaths();
  const outputPath = path.join(paths.outputClipsWithCommentsDir, outputFileName);
  const outputRelativePath = path.join("output", "clips_with_comments", outputFileName).replaceAll(path.sep, "/");
  const filterRelativePath = toPosixPath(assRelativePath);

  const encoder = input.encoder ?? "libx264";
  const preset = input.preset ?? "veryfast";
  const crf = input.crf ?? 20;
  const normalizeAudio = input.normalizeAudio === true;
  const isNvenc = encoder === "h264_nvenc" || encoder === "hevc_nvenc";

  const audioFilter = normalizeAudio ? "loudnorm=I=-16:TP=-1.5:LRA=11" : null;

  const args = [
    "-hide_banner",
    "-y",
    "-i",
    absoluteClipPath,
    "-vf",
    `ass=${quoteFfmpegFilterValue(filterRelativePath)}`,
    ...(audioFilter ? ["-af", audioFilter] : []),
    "-c:v",
    encoder,
    ...(isNvenc
      ? ["-preset", "p4", "-cq", String(crf), "-b:v", "0", "-pix_fmt", "yuv420p"]
      : ["-preset", preset, "-crf", String(crf)]),
    "-r", "60",           // CFR for smooth playback
    "-g", "120",           // 2-second GOP for fast seeking
    "-sc_threshold", "0",  // disable scene detection for seek-optimized GOP
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath
  ];

  try {
    await execFileAsync("ffmpeg", args, { cwd: getMediaRoot(), timeout: 20 * 60_000, maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`FFmpeg comment burn-in failed: ${formatExecError(error)}`);
  }

  return {
    candidateId: input.candidateId,
    variantId: input.variantId,
    inputClipPath: normalizeRelativePath(input.clipPath),
    assPath: assRelativePath,
    outputPath: outputRelativePath,
    absoluteOutputPath: outputPath,
    commandPreview: `ffmpeg ${args.map(shellQuote).join(" ")}`,
    createdAt: new Date().toISOString()
  };
}

export async function generateExportPackage(input: GenerateExportPackageInput): Promise<GeneratedExportPackage> {
  if (!input.candidate?.id) {
    throw new Error("candidate.id is required to generate an export package.");
  }

  await ensureMediaDirs();

  const paths = getMediaPaths();
  const createdAt = new Date().toISOString();
  const selectedVariant = input.selectedVariant ?? input.candidate.variants.find((variant) => variant.id === input.candidate.selectedVariantId) ?? input.candidate.variants[0];
  const cleanClip = input.generatedClip ?? input.candidate.generatedClip;
  const commentBurnedClip = input.commentBurnedClip ?? input.candidate.commentBurnedClip;
  const transcription = input.transcription ?? input.candidate.transcription;
  const packageDirName = buildPackageDirName(input.candidate.id, input.candidate.title);
  const absolutePackagePath = path.join(paths.outputPackagesDir, packageDirName);
  const packagePath = path.join("output", "packages", packageDirName).replaceAll(path.sep, "/");
  const copiedAssets: ExportPackageAsset[] = [];

  // Flat structure — files at package root for easy editor import
  await mkdir(path.join(absolutePackagePath, "thumbnail_candidates"), { recursive: true });

  if (cleanClip?.outputPath) {
    // Don't copy the clip (~100 MB) — just record its path. The file
    // already lives under output/clips/ and is served via /api/media/files.
    copiedAssets.push({
      label: "Clean clip (reference)",
      kind: "video",
      fileName: path.basename(cleanClip.outputPath),
      packagePath: `${packagePath}`,
      sourcePath: cleanClip.outputPath,
      sizeBytes: 0
    });
    // Write a small .ref file so editors know the clip path
    await writeFile(
      path.join(absolutePackagePath, "clip_clean.mp4.ref"),
      `${cleanClip.outputPath}\n${cleanClip.absoluteOutputPath}\n`,
      "utf8"
    ).catch(() => undefined);
  }

  if (commentBurnedClip?.outputPath) {
    copiedAssets.push({
      label: "Comment-burned clip (reference)",
      kind: "video",
      fileName: path.basename(commentBurnedClip.outputPath),
      packagePath: `${packagePath}`,
      sourcePath: commentBurnedClip.outputPath,
      sizeBytes: 0
    });
    await writeFile(
      path.join(absolutePackagePath, "clip_with_comments.mp4.ref"),
      `${commentBurnedClip.outputPath}\n${commentBurnedClip.absoluteOutputPath}\n`,
      "utf8"
    ).catch(() => undefined);
  }

  if (transcription?.outputs.jsonPath) {
    copiedAssets.push(await copyPackageAsset({
      label: "Transcript JSON",
      kind: "transcript",
      sourcePath: transcription.outputs.jsonPath,
      packagePath,
      absolutePackagePath,
      targetDir: ".",
      targetFileName: "transcript.json"
    }));
  }

  if (transcription?.outputs.srtPath) {
    copiedAssets.push(await copyPackageAsset({
      label: "Transcript SRT",
      kind: "transcript",
      sourcePath: transcription.outputs.srtPath,
      packagePath,
      absolutePackagePath,
      targetDir: ".",
      targetFileName: "transcript.srt"
    }));
  }

  if (transcription?.outputs.txtPath) {
    copiedAssets.push(await copyPackageAsset({
      label: "Transcript TXT",
      kind: "transcript",
      sourcePath: transcription.outputs.txtPath,
      packagePath,
      absolutePackagePath,
      targetDir: ".",
      targetFileName: "transcript.txt"
    }));
  }

  if (input.commentsJson?.trim()) {
    copiedAssets.push(await writePackageTextAsset({
      label: "Comments JSON",
      kind: "comments",
      content: input.commentsJson,
      packagePath,
      absolutePackagePath,
      targetDir: ".",
      targetFileName: "comments.json"
    }));
  }

  if (input.commentsAss?.trim()) {
    copiedAssets.push(await writePackageTextAsset({
      label: "Comments ASS",
      kind: "comments",
      content: input.commentsAss,
      packagePath,
      absolutePackagePath,
      targetDir: ".",
      targetFileName: "comments.ass"
    }));
  } else if (commentBurnedClip?.assPath) {
    copiedAssets.push(await copyPackageAsset({
      label: "Comments ASS",
      kind: "comments",
      sourcePath: commentBurnedClip.assPath,
      packagePath,
      absolutePackagePath,
      targetDir: ".",
      targetFileName: "comments.ass"
    }));
  }

  // Thumbnail candidates
  const thumbnailCandidates = input.thumbnailCandidates ?? input.candidate.thumbnailCandidates ?? [];
  for (const thumbnail of thumbnailCandidates) {
    try {
      copiedAssets.push(await copyPackageAsset({
        label: `Thumbnail at ${thumbnail.timestamp}`,
        kind: "thumbnail",
        sourcePath: thumbnail.outputPath,
        packagePath,
        absolutePackagePath,
        targetDir: "thumbnail_candidates",
        targetFileName: path.basename(thumbnail.outputPath)
      }));
    } catch {
      // Skip thumbnail if file is missing — it may have been cleaned up
    }
  }

  const metadataPath = path.join(packagePath, "metadata.json").replaceAll(path.sep, "/");
  const notesPath = path.join(packagePath, "notes.md").replaceAll(path.sep, "/");
  const metadata = buildPackageMetadata({ input, selectedVariant, cleanClip, commentBurnedClip, transcription, packagePath, metadataPath, notesPath, copiedAssets, createdAt });
  const notes = buildPackageNotes(input.candidate, selectedVariant, copiedAssets);

  await writeFile(path.join(absolutePackagePath, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n", "utf8");
  await writeFile(path.join(absolutePackagePath, "notes.md"), notes, "utf8");

  return {
    candidateId: input.candidate.id,
    packagePath,
    absolutePackagePath,
    metadataPath,
    notesPath,
    copiedAssets,
    createdAt
  };
}

export async function generateThumbnailCandidate(input: GenerateThumbnailInput): Promise<GeneratedThumbnail> {
  const absoluteClipPath = resolveMediaPath(input.clipPath);
  await assertFileExists(absoluteClipPath, "Clip file");
  await ensureMediaDirs();

  const ffmpeg = await checkTool("ffmpeg");
  if (!ffmpeg.available) {
    throw new Error(ffmpeg.error ?? "ffmpeg is not available on PATH.");
  }

  const timestampSeconds = parseTimecode(input.timestamp, "thumbnail timestamp");
  const outputFileName = buildThumbnailOutputFileName(input.candidateId, input.timestamp, input.label);
  const outputPath = path.join(getMediaPaths().outputThumbnailsDir, outputFileName);
  const outputRelativePath = path.join("output", "thumbnails", outputFileName).replaceAll(path.sep, "/");
  const args = [
    "-hide_banner",
    "-y",
    "-ss",
    timestampSeconds.toString(),
    "-i",
    absoluteClipPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outputPath
  ];

  try {
    await execFileAsync("ffmpeg", args, { timeout: 2 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`FFmpeg thumbnail generation failed: ${formatExecError(error)}`);
  }

  return {
    candidateId: input.candidateId,
    sourceClipPath: normalizeRelativePath(input.clipPath),
    timestamp: formatSeconds(timestampSeconds),
    outputPath: outputRelativePath,
    absoluteOutputPath: outputPath,
    commandPreview: `ffmpeg ${args.map(shellQuote).join(" ")}`,
    createdAt: new Date().toISOString()
  };
}

export async function writeCommentAssets(input: WriteCommentAssetsInput): Promise<CommentAssetReference> {
  if (!input.candidateId.trim()) {
    throw new Error("candidateId is required to write comment assets.");
  }

  const normalizedJson = input.jsonContent.replace(/\r\n/g, "\n");
  const normalizedAss = input.assContent.replace(/\r\n/g, "\n");

  if (!normalizedJson.trim() || !normalizedAss.trim()) {
    throw new Error("Comment JSON and ASS content are required.");
  }

  if (Buffer.byteLength(normalizedJson, "utf8") > 10 * 1024 * 1024 || Buffer.byteLength(normalizedAss, "utf8") > 10 * 1024 * 1024) {
    throw new Error("Comment assets are too large for development export.");
  }

  await ensureMediaDirs();

  const paths = getMediaPaths();
  const safeCandidateId = sanitizeFilePart(input.candidateId);
  const jsonBaseName = sanitizeFilePart((input.jsonFileName ?? `${safeCandidateId}-comments.json`).replace(/\.json$/i, ""));
  const assBaseName = sanitizeFilePart((input.assFileName ?? `${safeCandidateId}-comments.ass`).replace(/\.ass$/i, ""));
  const timestamp = buildTimestampFilePart();
  const jsonFileName = `${jsonBaseName}_${timestamp}.json`;
  const assFileName = `${assBaseName}_${timestamp}.ass`;
  const jsonAbsolutePath = path.join(paths.outputCommentAssDir, jsonFileName);
  const assAbsolutePath = path.join(paths.outputCommentAssDir, assFileName);

  await writeFile(jsonAbsolutePath, normalizedJson, "utf8");
  await writeFile(assAbsolutePath, normalizedAss, "utf8");

  return {
    candidateId: input.candidateId,
    jsonPath: path.join("output", "comments_ass", jsonFileName).replaceAll(path.sep, "/"),
    assPath: path.join("output", "comments_ass", assFileName).replaceAll(path.sep, "/"),
    jsonFileName,
    assFileName,
    createdAt: new Date().toISOString()
  };
}

export function parseTimecode(value: string, label: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`Missing ${label} time.`);
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`${label} must be seconds, MM:SS, or HH:MM:SS.`);
  }

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new Error(`${label} contains an invalid time component.`);
  }

  if (numbers.length === 2) {
    return numbers[0] * 60 + numbers[1];
  }

  return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

function buildFfmpegArgs(inputPath: string, outputPath: string, startSeconds: number, durationSeconds: number, mode: "copy" | "reencode", encoder?: GenerateClipInput["encoder"]) {
  const baseArgs = ["-hide_banner", "-y", "-ss", startSeconds.toString(), "-i", inputPath, "-t", durationSeconds.toString(), "-avoid_negative_ts", "make_zero"];

  if (mode === "copy") {
    return [...baseArgs, "-c", "copy", "-movflags", "+faststart", outputPath];
  }

  if (encoder === "h264_nvenc" || encoder === "hevc_nvenc") {
    // NVENC GPU encoder — uses -cq instead of -crf, -preset p1..p7
    const quality = encoder === "hevc_nvenc" ? 23 : 20; // HEVC benefits from slightly higher CQ
    return [...baseArgs,
      "-c:v", encoder, "-preset", "p4", "-cq", String(quality), "-b:v", "0",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", outputPath];
  }

  // Default: CPU libx264
  return [...baseArgs, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "128k", outputPath];
}

function resolveMediaPath(relativePath: string) {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(getMediaRoot(), normalizedRelativePath);
  const relativeFromRoot = path.relative(getMediaRoot(), absolutePath);

  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error("Path must stay inside MEDIA_ROOT.");
  }

  return absolutePath;
}

function normalizeRelativePath(relativePath: string) {
  const trimmed = relativePath.trim().replaceAll("\\", "/");

  if (!trimmed) {
    throw new Error("Input path is required.");
  }

  if (path.isAbsolute(trimmed)) {
    throw new Error("Use a path relative to MEDIA_ROOT, for example input/archive.mp4.");
  }

  const normalized = path.posix.normalize(trimmed);

  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new Error("Path traversal is not allowed.");
  }

  return normalized;
}

async function prepareAssFile(input: BurnCommentsIntoClipInput) {
  if (input.assPath?.trim()) {
    const assRelativePath = normalizeRelativePath(input.assPath);
    if (path.extname(assRelativePath).toLowerCase() !== ".ass") {
      throw new Error("assPath must point to an .ass file under MEDIA_ROOT.");
    }

    const absoluteAssPath = resolveMediaPath(assRelativePath);
    await assertFileExists(absoluteAssPath, "ASS comment file");
    return { absoluteAssPath, assRelativePath };
  }

  if (typeof input.assContent !== "string" || input.assContent.trim().length === 0) {
    throw new Error("Provide assPath or non-empty assContent for comment burn-in.");
  }

  const normalizedAssContent = input.assContent.replace(/\r\n/g, "\n");
  if (Buffer.byteLength(normalizedAssContent, "utf8") > 5 * 1024 * 1024) {
    throw new Error("ASS content is too large for development burn-in.");
  }

  const outputFileName = buildCommentAssFileName(input.candidateId, input.variantId, input.assFileName);
  const absoluteAssPath = path.join(getMediaPaths().outputCommentAssDir, outputFileName);
  const assRelativePath = path.join("output", "comments_ass", outputFileName).replaceAll(path.sep, "/");
  await writeFile(absoluteAssPath, normalizedAssContent, "utf8");

  return { absoluteAssPath, assRelativePath };
}

let dirsEnsured = false;

async function ensureMediaDirs() {
  if (dirsEnsured) return;
  const { inputDir, inputDownloadsDir, outputClipsDir, outputCommentAssDir, outputClipsWithCommentsDir, outputChatLogsDir, outputPackagesDir, outputThumbnailsDir } = getMediaPaths();
  await Promise.all([
    mkdir(inputDir, { recursive: true }),
    mkdir(inputDownloadsDir, { recursive: true }),
    mkdir(outputClipsDir, { recursive: true }),
    mkdir(outputCommentAssDir, { recursive: true }),
    mkdir(outputClipsWithCommentsDir, { recursive: true }),
    mkdir(outputChatLogsDir, { recursive: true }),
    mkdir(outputPackagesDir, { recursive: true }),
    mkdir(outputThumbnailsDir, { recursive: true })
  ]);
  dirsEnsured = true;
}

async function assertFileExists(absolutePath: string, label = "Video file") {
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new Error("Path exists but is not a file.");
    }

    return fileStat;
  } catch (error) {
    if (error instanceof Error && error.message === "Path exists but is not a file.") {
      throw error;
    }

    throw new Error(`${label} was not found under MEDIA_ROOT: ${path.basename(absolutePath)}`);
  }
}

async function checkTool(command: string): Promise<ToolStatus> {
  try {
    await access(getMediaRoot()).catch(() => undefined);
    const { stdout } = await execFileAsync(command, ["-version"], { timeout: 10_000, maxBuffer: 1024 * 1024 });
    const version = stdout.split("\n")[0]?.trim() || `${command} is available`;

    return { available: true, command, version };
  } catch (error) {
    return {
      available: false,
      command,
      error: error instanceof Error ? error.message : `${command} is not available`
    };
  }
}

function getWorkspaceRoot() {
  const cwd = process.cwd();
  const parent = path.basename(path.dirname(cwd));
  const current = path.basename(cwd);

  if (current === "web" && parent === "apps") {
    return path.resolve(cwd, "../..");
  }

  return cwd;
}

function buildOutputFileName(candidateId: string, variantId: string, start: string, mode: string) {
  const safeCandidateId = sanitizeFilePart(candidateId || "candidate");
  const safeVariantId = sanitizeFilePart(variantId || "variant");
  const safeStart = sanitizeFilePart(start || "start");
  const timestamp = buildTimestampFilePart();

  return `${safeCandidateId}_${safeVariantId}_${safeStart}_${mode}_${timestamp}.mp4`;
}

function buildCommentAssFileName(candidateId: string, variantId: string | undefined, requestedFileName: string | undefined) {
  const safeCandidateId = sanitizeFilePart(candidateId || "candidate");
  const safeVariantId = sanitizeFilePart(variantId || "variant");
  const safeRequestedName = requestedFileName ? sanitizeFilePart(requestedFileName.replace(/\.ass$/i, "")) : "";
  const baseName = safeRequestedName || `${safeCandidateId}_${safeVariantId}_comments`;

  return `${baseName}_${buildTimestampFilePart()}.ass`;
}

function buildCommentBurnedOutputFileName(candidateId: string, variantId: string | undefined) {
  const safeCandidateId = sanitizeFilePart(candidateId || "candidate");
  const safeVariantId = sanitizeFilePart(variantId || "variant");

  return `${safeCandidateId}_${safeVariantId}_comments_${buildTimestampFilePart()}.mp4`;
}

function buildPackageDirName(candidateId: string, title: string) {
  const safeCandidateId = sanitizeFilePart(candidateId || "candidate");
  const safeTitle = sanitizeFilePart(title || "clip").slice(0, 48);

  return `${safeCandidateId}_${safeTitle}_${buildTimestampFilePart()}`;
}

function buildThumbnailOutputFileName(candidateId: string, timestamp: string, label: string | undefined) {
  const safeCandidateId = sanitizeFilePart(candidateId || "candidate");
  const safeTimestamp = sanitizeFilePart(timestamp || "time");
  const safeLabel = label ? `_${sanitizeFilePart(label).slice(0, 32)}` : "";

  return `${safeCandidateId}_${safeTimestamp}${safeLabel}_${buildTimestampFilePart()}.jpg`;
}

async function copyPackageAsset({
  label,
  kind,
  sourcePath,
  packagePath,
  absolutePackagePath,
  targetDir,
  targetFileName
}: {
  label: string;
  kind: ExportPackageAsset["kind"];
  sourcePath: string;
  packagePath: string;
  absolutePackagePath: string;
  targetDir: string;
  targetFileName: string;
}): Promise<ExportPackageAsset> {
  const absoluteSourcePath = resolveMediaPath(sourcePath);
  await assertFileExists(absoluteSourcePath, label);

  const safeTargetFileName = sanitizeFilePart(targetFileName);
  const absoluteTargetPath = path.join(absolutePackagePath, targetDir, safeTargetFileName);
  await assertPathInside(absolutePackagePath, absoluteTargetPath);
  await copyFile(absoluteSourcePath, absoluteTargetPath);

  const fileStat = await stat(absoluteTargetPath);
  const packageAssetPath = path.join(packagePath, targetDir, safeTargetFileName).replaceAll(path.sep, "/");

  return {
    label,
    kind,
    fileName: safeTargetFileName,
    packagePath: packageAssetPath,
    sourcePath: normalizeRelativePath(sourcePath),
    sizeBytes: fileStat.size
  };
}

async function writePackageTextAsset({
  label,
  kind,
  content,
  packagePath,
  absolutePackagePath,
  targetDir,
  targetFileName
}: {
  label: string;
  kind: ExportPackageAsset["kind"];
  content: string;
  packagePath: string;
  absolutePackagePath: string;
  targetDir: string;
  targetFileName: string;
}): Promise<ExportPackageAsset> {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  if (Buffer.byteLength(normalizedContent, "utf8") > 10 * 1024 * 1024) {
    throw new Error(`${label} is too large for development package generation.`);
  }

  const safeTargetFileName = sanitizeFilePart(targetFileName);
  const absoluteTargetPath = path.join(absolutePackagePath, targetDir, safeTargetFileName);
  await assertPathInside(absolutePackagePath, absoluteTargetPath);
  await writeFile(absoluteTargetPath, normalizedContent, "utf8");

  const fileStat = await stat(absoluteTargetPath);
  const packageAssetPath = path.join(packagePath, targetDir, safeTargetFileName).replaceAll(path.sep, "/");

  return {
    label,
    kind,
    fileName: safeTargetFileName,
    packagePath: packageAssetPath,
    sizeBytes: fileStat.size
  };
}

function buildPackageMetadata({
  input,
  selectedVariant,
  cleanClip,
  commentBurnedClip,
  transcription,
  packagePath,
  metadataPath,
  notesPath,
  copiedAssets,
  createdAt
}: {
  input: GenerateExportPackageInput;
  selectedVariant: ClipCandidateVariant | undefined;
  cleanClip: GeneratedClipReference | undefined;
  commentBurnedClip: CommentBurnedClipReference | undefined;
  transcription: ClipTranscription | undefined;
  packagePath: string;
  metadataPath: string;
  notesPath: string;
  copiedAssets: ExportPackageAsset[];
  createdAt: string;
}) {
  const candidate = input.candidate;

  return {
    version: 1,
    createdAt,
    packagePath,
    metadataPath,
    notesPath,
    candidate: {
      id: candidate.id,
      title: candidate.title,
      streamer: candidate.streamer,
      archiveTitle: candidate.archiveTitle,
      detectedAt: candidate.detectedAt,
      duration: candidate.duration,
      confidence: candidate.confidence,
      status: candidate.status,
      summary: candidate.summary,
      tags: candidate.tags,
      warnings: candidate.warnings
    },
    selectedVariant: selectedVariant ?? null,
    markers: candidate.markers,
    notes: candidate.notes,
    generatedAssets: {
      cleanClip: cleanClip?.outputPath ?? null,
      commentBurnedClip: commentBurnedClip?.outputPath ?? null,
      commentAss: commentBurnedClip?.assPath ?? null,
      transcriptJson: transcription?.outputs.jsonPath ?? null,
      transcriptSrt: transcription?.outputs.srtPath ?? null,
      transcriptTxt: transcription?.outputs.txtPath ?? null
    },
    copiedAssets
  };
}

function buildPackageNotes(candidate: ClipCandidate, selectedVariant: ClipCandidateVariant | undefined, copiedAssets: ExportPackageAsset[]) {
  const warnings = candidate.warnings.length > 0
    ? candidate.warnings.map((warning) => `- ${warning.severity.toUpperCase()}: ${warning.label} - ${warning.detail}`).join("\n")
    : "- None";
  const markers = candidate.markers.length > 0
    ? candidate.markers.map((marker) => `- ${marker.time} [${marker.kind}] ${marker.label}`).join("\n")
    : "- None";
  const assets = copiedAssets.length > 0
    ? copiedAssets.map((asset) => `- ${asset.label}: ${asset.packagePath}`).join("\n")
    : "- No generated media assets were available when this package was created.";

  return [
    `# ${candidate.title}`,
    "",
    `- Candidate: ${candidate.id}`,
    `- Streamer: ${candidate.streamer}`,
    `- Archive: ${candidate.archiveTitle}`,
    `- Status: ${candidate.status}`,
    `- Variant: ${selectedVariant?.label ?? "None"}`,
    `- Detected at: ${candidate.detectedAt}`,
    "",
    "## Summary",
    "",
    candidate.summary,
    "",
    "## Editor Notes",
    "",
    `### Edit Plan\n${candidate.notes.editPlan || "Not provided."}`,
    "",
    `### Title Idea\n${candidate.notes.titleIdea || "Not provided."}`,
    "",
    `### Thumbnail Idea\n${candidate.notes.thumbnailIdea || "Not provided."}`,
    "",
    `### Upload Text\n${candidate.notes.uploadText || "Not provided."}`,
    "",
    "## Markers",
    "",
    markers,
    "",
    "## Warnings",
    "",
    warnings,
    "",
    "## Packaged Assets",
    "",
    assets,
    ""
  ].join("\n");
}

async function assertPathInside(rootPath: string, targetPath: string) {
  const relativeFromRoot = path.relative(rootPath, targetPath);
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error("Package asset path must stay inside the package folder.");
  }
}

function extensionForRelativePath(relativePath: string, fallback: string) {
  const extension = path.extname(normalizeRelativePath(relativePath));
  return extension || fallback;
}

function buildTimestampFilePart() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

function sanitizeFilePart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "clip";
}

function toPosixPath(value: string) {
  return value.replaceAll(path.sep, "/");
}

function quoteFfmpegFilterValue(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function formatExecError(error: unknown) {
  if (error && typeof error === "object") {
    const maybeExecError = error as { message?: unknown; stderr?: unknown };
    const stderr = typeof maybeExecError.stderr === "string" ? maybeExecError.stderr.trim() : "";
    if (stderr) {
      return stderr.slice(-2000);
    }

    if (typeof maybeExecError.message === "string") {
      return maybeExecError.message;
    }
  }

  return "Unknown FFmpeg error";
}

function parseNullableNumber(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableInteger(value: string | undefined) {
  const parsed = parseNullableNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function parseFrameRate(value: string | undefined) {
  if (!value || value === "0/0") {
    return null;
  }

  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return Math.round((numerator / denominator) * 100) / 100;
}

function formatSeconds(totalSeconds: number) {
  const roundedSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const seconds = roundedSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function shellQuote(value: string) {
  if (/^[a-zA-Z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
