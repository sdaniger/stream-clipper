import { execFile, spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createLimiter } from "@/lib/concurrency";
import { getMediaPaths, probeVideo } from "@/lib/server/media-service";

const execFileAsync = promisify(execFile);

// ── Metadata cache ──────────────────────────────────────────────────
// In-memory LRU-style cache with 1-hour TTL. Avoids redundant yt-dlp
// or GQL calls when the same URL is analysed multiple times.
const metadataCache = new Map<string, { data: YtDlpMetadata; ts: number }>();
const METADATA_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCachedMetadata(url: string): YtDlpMetadata | null {
  const entry = metadataCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.ts > METADATA_CACHE_TTL_MS) {
    metadataCache.delete(url);
    return null;
  }
  return entry.data;
}

function setCachedMetadata(url: string, data: YtDlpMetadata): void {
  // Cap cache size at 100 entries
  if (metadataCache.size > 100) {
    const oldest = metadataCache.keys().next().value;
    if (oldest) metadataCache.delete(oldest);
  }
  metadataCache.set(url, { data, ts: Date.now() });
}

// ── Twitch GQL direct metadata ──────────────────────────────────────
// Bypasses yt-dlp entirely — fetches VOD metadata via Twitch's internal
// GQL API in ~200ms vs 5-30s for yt-dlp.
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";

type TwitchGqlVideoResult = {
  data: {
    video: {
      id: string;
      title: string;
      lengthSeconds: number;
      viewCount: number;
      createdAt: string;
      thumbnailHash: string | null;
      owner: { displayName: string; login: string } | null;
    } | null;
  } | null;
};

function extractTwitchVideoId(url: string): string | null {
  const m = url.match(/(?:twitch\.tv\/videos?|twitch\.tv\/\w+\/video)\/(\d+)/i);
  return m?.[1] ?? null;
}

async function fetchTwitchMetadataViaGQL(url: string, signal?: AbortSignal): Promise<YtDlpMetadata | null> {
  const videoId = extractTwitchVideoId(url);
  if (!videoId) return null;

  try {
    const query = [{
      operationName: "VideoMetadata",
      variables: { videoId },
      query: `query VideoMetadata($videoId: ID!) {
        video(id: $videoId) {
          id
          title
          lengthSeconds
          viewCount
          createdAt
          thumbnailHash
          owner { displayName login }
        }
      }`
    }];

    // Combine caller-provided abort signal with our internal 10s timeout.
    const internalTimeout = AbortSignal.timeout(10_000);
    const combinedSignal = signal
      ? AbortSignal.any([signal, internalTimeout])
      : internalTimeout;

    const res = await fetch(TWITCH_GQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Client-ID": TWITCH_CLIENT_ID,
        "Origin": "https://www.twitch.tv",
        "Referer": "https://www.twitch.tv/",
      },
      body: JSON.stringify(query),
      signal: combinedSignal,
    });

    if (!res.ok) return null;
    const json = await res.json() as TwitchGqlVideoResult;
    const video = json.data?.video;
    if (!video) return null;

    const thumbnail = video.thumbnailHash
      ? `https://static-cdn.jtvnw.net/cf_vods/d1m7jfoe9zdc1jn438ta7joiev/keys/thumb/thumb-${video.thumbnailHash}-320x180.jpg`
      : null;

    return {
      source: "yt_dlp_url",
      url,
      id: video.id,
      title: video.title,
      uploader: video.owner?.displayName ?? null,
      durationSeconds: video.lengthSeconds,
      duration: formatSeconds(video.lengthSeconds),
      webpageUrl: `https://www.twitch.tv/videos/${video.id}`,
      thumbnail,
      extractor: "twitch",
      isLive: false,
      commandPreview: "Twitch GQL (direct)",
    };
  } catch {
    return null;
  }
}

export type YtDlpProgressEvent = {
  percent: number;
  speed: string;
  eta: string;
  total: string;
};

export type VideoSourceType = "local_file" | "yt_dlp_url" | "future_platform_api" | "future_manual_upload";

export type YtDlpMetadataInput = {
  url: string;
  signal?: AbortSignal;
};

export type YtDlpDownloadInput = {
  url: string;
  format?: string;
  /** Metadata already fetched by the caller (skips a second yt-dlp call). */
  prefetchedMetadata?: YtDlpMetadata;
  /** Start time in seconds for partial download. */
  timeStartSeconds?: number;
  /** End time in seconds for partial download. */
  timeEndSeconds?: number;
  onProgress?: (progress: YtDlpProgressEvent) => void;
  signal?: AbortSignal;
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

  // 1. Check in-memory cache
  const cached = getCachedMetadata(url);
  if (cached) return cached;

  // Short-circuit on abort before doing any network work.
  if (input.signal?.aborted) {
    throw new DOMException("yt-dlp metadata extraction was cancelled.", "AbortError");
  }

  // 2. For Twitch URLs, try GQL first (~200ms vs 5-30s for yt-dlp)
  const isTwitch = /twitch\.tv/i.test(url);
  if (isTwitch) {
    const gqlResult = await fetchTwitchMetadataViaGQL(url, input.signal);
    if (gqlResult) {
      setCachedMetadata(url, gqlResult);
      return gqlResult;
    }
  }

  // 3. Fallback to yt-dlp
  const args = ["--dump-json", "--skip-download", "--no-playlist", "--socket-timeout", "15", url];
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Check abort between retries so the caller's cancel propagates quickly.
    if (input.signal?.aborted) {
      throw new DOMException("yt-dlp metadata extraction was cancelled.", "AbortError");
    }

    try {
      const { stdout } = await execFileAsync("yt-dlp", args, { timeout: 90_000, maxBuffer: 16 * 1024 * 1024, signal: input.signal });
      const firstLine = stdout.split(/\r?\n/).find((line) => line.trim());
      if (!firstLine) {
        throw new Error("yt-dlp returned empty metadata output.");
      }

      const metadata = normalizeYtDlpMetadata(JSON.parse(firstLine) as RawYtDlpMetadata, url, `yt-dlp ${args.map(shellQuote).join(" ")}`);
      setCachedMetadata(url, metadata);
      return metadata;
    } catch (error) {
      // If the caller aborted, propagate immediately without retries.
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      const isTransient = error instanceof Error && (
        error.message.includes("handshake") ||
        error.message.includes("timed out") ||
        error.message.includes("ETIMEDOUT") ||
        error.message.includes("ECONNRESET") ||
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("SSL")
      );

      if (isTransient && attempt < MAX_RETRIES) {
        await new Promise<void>((r) => {
          const t = setTimeout(r, 2000 * (attempt + 1));
          input.signal?.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true });
        });
        continue;
      }

      if (error instanceof SyntaxError) {
        throw new Error(`yt-dlp metadata JSON could not be parsed: ${error.message}`);
      }

      throw new Error(`yt-dlp metadata extraction failed: ${formatExecError(error)}. Install it with \`pip install yt-dlp\` and confirm \`yt-dlp\` is on PATH.`);
    }
  }

  throw new Error("yt-dlp metadata extraction failed after retries.");
}

export async function downloadVideoWithYtDlp(input: YtDlpDownloadInput): Promise<YtDlpDownloadedVideo> {
  const url = validateUrl(input.url);
  const format = input.format?.trim() || "bv*[height<=1080]+ba/best";
  const paths = getMediaPaths();

  await mkdir(paths.inputDownloadsDir, { recursive: true });

  const outputTemplate = path.join(paths.inputDownloadsDir, "%(extractor_key)s_%(id)s_%(title).80B.%(ext)s");
  const args = [
    "--no-playlist",
    "--restrict-filenames",
    "--no-mtime",
    "-N", "10",
    "--buffer-size", "256K",
    "--concurrent-fragments", "10",
    "--extractor-retries", "3",
    "--fragment-retries", "5",
    "--retry-sleep", "3",
    "--merge-output-format",
    "mp4",
    "-f",
    format,
    "-o",
    outputTemplate,
    "--print",
    "after_move:filepath",
  ];

  // Partial download: use --download-sections when time range is specified.
  // This avoids downloading the entire VOD when only a portion is needed.
  const hasTimeRange = input.timeStartSeconds != null || input.timeEndSeconds != null;
  if (hasTimeRange) {
    const startStr = secondsToHHMMSS(input.timeStartSeconds ?? 0);
    const endStr = secondsToHHMMSS(input.timeEndSeconds ?? 999999);
    args.push("--download-sections", `*${startStr}-${endStr}`);
    // Force remux to ensure the output is a playable mp4 when section is
    // downloaded. --download-sections with --merge-output-format mp4 is
    // already handled by yt-dlp, but we also add --force-keyframes-at-cuts
    // to make the cut points accurate.
    args.push("--force-keyframes-at-cuts");
  }

  args.push(url);

  const stdout = input.onProgress
    ? await spawnYtDlpWithProgress(args, input.onProgress, input.signal)
    : await execYtDlp(args, input.signal);

  const absoluteDownloadedPath = resolveDownloadedFilePath(stdout, paths.inputDownloadsDir);
  const downloadedStat = await stat(absoluteDownloadedPath);
  if (!downloadedStat.isFile()) {
    throw new Error("yt-dlp output path exists but is not a file.");
  }

  // Validate the downloaded file is a valid video (moov atom check).
  // A corrupt file (e.g. killed mid-merge) will have no moov atom.
  const relativeInputPath = toMediaRelativePath(absoluteDownloadedPath, paths.mediaRoot);
  try {
    await probeVideo(relativeInputPath);
  } catch {
    // Delete the corrupt file so it doesn't block future retries.
    const { unlink } = await import("node:fs/promises");
    await unlink(absoluteDownloadedPath).catch(() => {});
    throw new Error(`Downloaded file is corrupt (no moov atom). The download may have been interrupted. File deleted: ${path.basename(absoluteDownloadedPath)}`);
  }

  // Reuse metadata from the caller if prefetched (avoids a second yt-dlp
  // network call). Otherwise extract it now.
  const [metadata, probe] = await Promise.all([
    input.prefetchedMetadata
      ? Promise.resolve(input.prefetchedMetadata)
      : extractYtDlpMetadata({ url }),
    probeVideo(relativeInputPath)
  ]);
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

async function execYtDlp(args: string[], signal?: AbortSignal): Promise<string> {
  try {
    const result = await execFileAsync("yt-dlp", args, { timeout: 180 * 60_000, maxBuffer: 64 * 1024 * 1024, signal });
    return result.stdout;
  } catch (error) {
    throw new Error(`yt-dlp download failed: ${formatExecError(error)}. Install it with \`pip install yt-dlp\` and confirm \`yt-dlp\` is on PATH.`);
  }
}

async function spawnYtDlpWithProgress(args: string[], onProgress: (p: YtDlpProgressEvent) => void, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
      timeout: 180 * 60_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb", PYTHONUNBUFFERED: "1" }
    });

    let stdout = "";
    let stderr = "";
    let stderrBuffer = "";
    let timedOut = false;
    let aborted = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      reject(new Error("yt-dlp timed out after 180 minutes."));
    }, 180 * 60_000);

    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      child.kill("SIGTERM");
      reject(new DOMException("yt-dlp download was cancelled.", "AbortError"));
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

    // yt-dlp output: `[download]  12.3% of ~ 100.00MiB at 1.00MiB/s ETA 00:30 (frag 0/402)`
    // The optional `~` may be followed by a space before the size value, hence `~?\s*`.
    const PROGRESS_RE = /\[download\]\s+([\d.]+)%\s+of\s+~?\s*(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)/;
    // Some yt-dlp versions/options echo the same line to both stdout and stderr; dedupe by signature.
    const seenSignatures = new Set<string>();

    function processChunk(text: string, isStderr: boolean) {
      if (isStderr) {
        // yt-dlp uses \r to update the same line on stderr; split by both \r and \n
        const lines = (stderrBuffer + text).split(/\r?\n|\r/);
        stderrBuffer = lines.pop() ?? "";
        emitProgressLines(lines);
      } else {
        emitProgressLines(text.split(/\r?\n|\r/));
      }
    }

    function emitProgressLines(lines: string[]) {
      for (const line of lines) {
        if (line.includes("[download]") && line.includes("%")) {
          const match = line.match(PROGRESS_RE);
          if (match) {
            const signature = `${match[1]}|${match[2]}|${match[3]}|${match[4]}`;
            if (seenSignatures.has(signature)) continue;
            seenSignatures.add(signature);
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
    }

    // yt-dlp mixes informational output and progress into both stdout and stderr
    // depending on version/platform. Listen to both to be safe.
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      processChunk(chunk.toString(), false);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      processChunk(chunk.toString(), true);
    });

    child.on("close", (code) => {
      cleanup();
      if (timedOut || aborted) return;
      if (code === 0) {
        resolve(stdout);
      } else {
        const tail = (stderr || "").trim().slice(-2000);
        reject(new Error(`yt-dlp exited with code ${code}${tail ? `: ${tail}` : ""}`));
      }
    });

    child.on("error", (err) => {
      cleanup();
      if (aborted) return;
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

function secondsToHHMMSS(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function shellQuote(value: string) {
  if (/^[a-zA-Z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

export type YtDlpSectionInput = {
  url: string;
  startSeconds: number;
  endSeconds: number;
  candidateId: string;
  onProgress?: (progress: YtDlpProgressEvent) => void;
  signal?: AbortSignal;
};

export type YtDlpSectionResult = {
  inputPath: string;
  candidateId: string;
};

export async function downloadSectionWithYtDlp(input: YtDlpSectionInput): Promise<YtDlpSectionResult> {
  const url = validateUrl(input.url);
  const paths = getMediaPaths();
  await mkdir(paths.inputDownloadsDir, { recursive: true });

  const outputTemplate = path.join(paths.inputDownloadsDir, `section_${input.candidateId}_%(id)s.%(ext)s`);
  const startStr = secondsToHHMMSS(input.startSeconds);
  const endStr = secondsToHHMMSS(input.endSeconds);

  const args = [
    "--no-playlist",
    "--restrict-filenames",
    "--no-mtime",
    "-N", "10",
    "--buffer-size", "256K",
    "--concurrent-fragments", "10",
    "--extractor-retries", "3",
    "--fragment-retries", "5",
    "--retry-sleep", "3",
    "--merge-output-format", "mp4",
    "-f", "bv*[height<=1080]+ba/best",
    "-o", outputTemplate,
    "--print", "after_move:filepath",
    "--download-sections", `*${startStr}-${endStr}`,
    url,
  ];

  const stdout = input.onProgress
    ? await spawnYtDlpWithProgress(args, input.onProgress, input.signal)
    : await execYtDlp(args, input.signal);
  const absolutePath = resolveDownloadedFilePath(stdout, paths.inputDownloadsDir);
  const relativePath = toMediaRelativePath(absolutePath, paths.mediaRoot);

  return { inputPath: relativePath, candidateId: input.candidateId };
}

/**
 * Download multiple sections from a VOD in parallel using separate yt-dlp
 * processes. Each section is downloaded independently with its own
 * `--download-sections` flag and candidateId-tagged output template.
 *
 * The concurrency is capped at `concurrency` (default 4) to avoid
 * overwhelming the CDN while still parallelising across candidates.
 */
export async function downloadSectionsParallel(
  sections: YtDlpSectionInput[],
  concurrency = 4,
  signal?: AbortSignal
): Promise<YtDlpSectionResult[]> {
  const limiter = createLimiter(concurrency);
  return Promise.all(
    sections.map((s) =>
      limiter(() => downloadSectionWithYtDlp({ ...s, signal }))
    )
  );
}


