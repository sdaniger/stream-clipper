import { execFile, spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getMediaPaths, probeVideo } from "@/lib/server/media-service";

const execFileAsync = promisify(execFile);

export type YtDlpProgressEvent = {
  percent: number;
  speed: string;
  eta: string;
  total: string;
};

export type VideoSourceType = "local_file" | "yt_dlp_url" | "future_platform_api" | "future_manual_upload";

export type YtDlpMetadataInput = {
  url: string;
};

export type YtDlpDownloadInput = {
  url: string;
  format?: string;
  onProgress?: (progress: YtDlpProgressEvent) => void;
};

export type YtDlpMetadata = {
  source: VideoSourceType;
  url: string;
  id: string | null;
  title: string | null;
  uploader: string | null;
  durationSeconds: number | null;
  duration: string | null;
  webpageUrl: string | null;
  thumbnail: string | null;
  extractor: string | null;
  isLive: boolean;
  commandPreview: string;
};

export type YtDlpDownloadedVideo = {
  source: VideoSourceType;
  url: string;
  inputPath: string;
  absolutePath: string;
  filename: string;
  metadataPath: string;
  commandPreview: string;
  downloadedAt: string;
  metadata: YtDlpMetadata;
  probe: Awaited<ReturnType<typeof probeVideo>>;
};

type RawYtDlpMetadata = {
  id?: unknown;
  title?: unknown;
  uploader?: unknown;
  channel?: unknown;
  duration?: unknown;
  webpage_url?: unknown;
  original_url?: unknown;
  thumbnail?: unknown;
  extractor?: unknown;
  extractor_key?: unknown;
  is_live?: unknown;
};

export async function extractYtDlpMetadata(input: YtDlpMetadataInput): Promise<YtDlpMetadata> {
  const url = validateUrl(input.url);
  const args = ["--dump-json", "--skip-download", "--no-playlist", url];

  try {
    const { stdout } = await execFileAsync("yt-dlp", args, { timeout: 90_000, maxBuffer: 16 * 1024 * 1024 });
    const firstLine = stdout.split(/\r?\n/).find((line) => line.trim());
    if (!firstLine) {
      throw new Error("yt-dlp returned empty metadata output.");
    }

    return normalizeYtDlpMetadata(JSON.parse(firstLine) as RawYtDlpMetadata, url, `yt-dlp ${args.map(shellQuote).join(" ")}`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`yt-dlp metadata JSON could not be parsed: ${error.message}`);
    }

    throw new Error(`yt-dlp metadata extraction failed: ${formatExecError(error)}. Install it with \`pip install yt-dlp\` and confirm \`yt-dlp\` is on PATH.`);
  }
}

export async function downloadVideoWithYtDlp(input: YtDlpDownloadInput): Promise<YtDlpDownloadedVideo> {
  const url = validateUrl(input.url);
  const format = input.format?.trim() || "bv*+ba/best";
  const paths = getMediaPaths();

  await mkdir(paths.inputDownloadsDir, { recursive: true });

  const outputTemplate = path.join(paths.inputDownloadsDir, "%(extractor_key)s_%(id)s_%(title).80B.%(ext)s");
  const args = [
    "--no-playlist",
    "--restrict-filenames",
    "--merge-output-format",
    "mp4",
    "-f",
    format,
    "-o",
    outputTemplate,
    "--print",
    "after_move:filepath",
    url
  ];

  const stdout = input.onProgress
    ? await spawnYtDlpWithProgress(args, input.onProgress)
    : await execYtDlp(args);

  const absoluteDownloadedPath = resolveDownloadedFilePath(stdout, paths.inputDownloadsDir);
  const downloadedStat = await stat(absoluteDownloadedPath);
  if (!downloadedStat.isFile()) {
    throw new Error("yt-dlp output path exists but is not a file.");
  }

  const relativeInputPath = toMediaRelativePath(absoluteDownloadedPath, paths.mediaRoot);
  const metadata = await extractYtDlpMetadata({ url });
  const probe = await probeVideo(relativeInputPath);
  const metadataFileName = `${path.basename(absoluteDownloadedPath, path.extname(absoluteDownloadedPath))}.yt-dlp.json`;
  const metadataAbsolutePath = path.join(paths.inputDownloadsDir, metadataFileName);
  const metadataPath = toMediaRelativePath(metadataAbsolutePath, paths.mediaRoot);

  await writeFile(metadataAbsolutePath, JSON.stringify(metadata, null, 2) + "\n", "utf8");

  return {
    source: "yt_dlp_url",
    url,
    inputPath: relativeInputPath,
    absolutePath: absoluteDownloadedPath,
    filename: path.basename(absoluteDownloadedPath),
    metadataPath,
    commandPreview: `yt-dlp ${args.map(shellQuote).join(" ")}`,
    downloadedAt: new Date().toISOString(),
    metadata,
    probe
  };
}

async function execYtDlp(args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("yt-dlp", args, { timeout: 60 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    throw new Error(`yt-dlp download failed: ${formatExecError(error)}. Install it with \`pip install yt-dlp\` and confirm \`yt-dlp\` is on PATH.`);
  }
}

async function spawnYtDlpWithProgress(args: string[], onProgress: (p: YtDlpProgressEvent) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
      timeout: 60 * 60_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb", PYTHONUNBUFFERED: "1" }
    });

    let stdout = "";
    let stderrBuffer = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      reject(new Error("yt-dlp timed out after 60 minutes."));
    }, 60 * 60_000);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const PROGRESS_RE = /\[download\]\s+([\d.]+)%\s+of\s+~?(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)/;

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      // yt-dlp uses \r to update the same line; split by both \r and \n
      const lines = (stderrBuffer + text).split(/\r?\n|\r/);
      stderrBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.includes("[download]") && line.includes("%")) {
          const match = line.match(PROGRESS_RE);
          if (match) {
            try {
              onProgress({
                percent: parseFloat(match[1]),
                total: match[2],
                speed: match[3],
                eta: match[4]
              });
            } catch {
              // client disconnected
            }
          }
        }
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) {
        resolve(stdout);
      } else {
        const tail = (stderrBuffer || "").trim().slice(-1000);
        reject(new Error(`yt-dlp exited with code ${code}${tail ? `: ${tail}` : ""}`));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("yt-dlp is not installed. Install it with \`pip install yt-dlp\`."));
      } else {
        reject(err);
      }
    });
  });
}

function validateUrl(value: string) {
  const url = value.trim();
  if (!url) {
    throw new Error("A video archive URL is required.");
  }

  if (!/^https?:\/\//i.test(url)) {
    throw new Error("URL must start with http:// or https://.");
  }

  return url;
}

function normalizeYtDlpMetadata(raw: RawYtDlpMetadata, url: string, commandPreview: string): YtDlpMetadata {
  const durationSeconds = typeof raw.duration === "number" && Number.isFinite(raw.duration) ? Math.round(raw.duration) : null;

  return {
    source: "yt_dlp_url",
    url,
    id: stringOrNull(raw.id),
    title: stringOrNull(raw.title),
    uploader: stringOrNull(raw.uploader) ?? stringOrNull(raw.channel),
    durationSeconds,
    duration: durationSeconds === null ? null : formatSeconds(durationSeconds),
    webpageUrl: stringOrNull(raw.webpage_url) ?? stringOrNull(raw.original_url),
    thumbnail: stringOrNull(raw.thumbnail),
    extractor: stringOrNull(raw.extractor_key) ?? stringOrNull(raw.extractor),
    isLive: raw.is_live === true,
    commandPreview
  };
}

function resolveDownloadedFilePath(stdout: string, downloadsDir: string) {
  const candidates = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();

  for (const candidate of candidates) {
    const absolutePath = path.resolve(candidate);
    const relativeFromDownloads = path.relative(downloadsDir, absolutePath);
    if (!relativeFromDownloads.startsWith("..") && !path.isAbsolute(relativeFromDownloads)) {
      return absolutePath;
    }
  }

  throw new Error("yt-dlp did not report a downloaded file path under MEDIA_ROOT/input/downloads.");
}

function toMediaRelativePath(absolutePath: string, mediaRoot: string) {
  const relativeFromRoot = path.relative(mediaRoot, absolutePath);
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error("Downloaded file path must stay inside MEDIA_ROOT.");
  }

  return relativeFromRoot.replaceAll(path.sep, "/");
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatSeconds(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
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

  return "Unknown yt-dlp error";
}

function shellQuote(value: string) {
  if (/^[a-zA-Z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
