import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, stat, readdir, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ChatLogEntry } from "@/lib/chat-analysis";
import { getMediaPaths } from "@/lib/server/media-service";

const execFileAsync = promisify(execFile);

let resolvedPythonPath: string | null = null;

async function resolveChatDownloaderPython(): Promise<string> {
  if (resolvedPythonPath) return resolvedPythonPath;

  if (process.env.CHAT_DOWNLOADER_PYTHON) {
    resolvedPythonPath = process.env.CHAT_DOWNLOADER_PYTHON;
    return resolvedPythonPath;
  }

  try {
    const { stdout: whichOut } = await execFileAsync("which", ["chat_downloader"], { timeout: 5_000 });
    const scriptPath = whichOut.trim();
    if (scriptPath) {
      const content = await readFile(scriptPath, "utf8");
      const shebang = content.match(/^#!(.+)/);
      if (shebang) {
        resolvedPythonPath = shebang[1].trim();
        return resolvedPythonPath;
      }
    }
  } catch {}

  const fallback = path.join(os.homedir(), ".local/share/pipx/venvs/chat-downloader/bin/python3");
  resolvedPythonPath = fallback;
  return fallback;
}

export type ChatSourceType = "manual_json" | "chat_downloader" | "imported_file" | "future_twitch_live_capture" | "future_platform_api";

export type FetchChatDownloaderInput = {
  url: string;
  maxMessages?: number;
  durationSeconds?: number | null;
  onProgress?: (messageCount: number) => void;
  signal?: AbortSignal;
};

/** 0 means "as much as Twitch will return within the timeout". This is the
 *  hard upper bound on a single fetch to keep the pipeline from running
 *  forever on runaway pagination. 300K messages covers an 8-hour stream
 *  at ~10 msg/sec with headroom for pop-off moments. */
const PRACTICAL_MESSAGE_CAP = 300_000;
const PYTHON_TIMEOUT = 20 * 60_000;

/**
 * Returns a sensible default chat limit for the given VOD duration (seconds).
 * Assumption: popular streams run ~7 msg/sec average, so 1 second of VOD
 * maps to ~7 messages. We cap the result at PRACTICAL_MESSAGE_CAP and
 * enforce a minimum of 1000 so short VODs still get useful coverage.
 */
export function defaultChatLimitForDuration(durationSeconds: number | null | undefined): number {
  if (!durationSeconds || durationSeconds <= 0) return 5000;
  const estimated = Math.ceil(durationSeconds * 7);
  return Math.max(1000, Math.min(PRACTICAL_MESSAGE_CAP, estimated));
}

export type FetchChatDownloaderResult = {
  source: ChatSourceType;
  url: string;
  normalizedMessages: ChatLogEntry[];
  normalizedPath: string;
  rawPath: string;
  commandPreview: string;
  fetchedAt: string;
  /** True when the process exited with an error but we salvaged partial stdout data. */
  partialResult?: boolean;
};

type RawChatDownloaderMessage = {
  message?: unknown;
  message_type?: unknown;
  time_in_seconds?: unknown;
  timestamp?: unknown;
  timestamp_usec?: unknown;
  time_text?: unknown;
  author?: {
    name?: unknown;
    display_name?: unknown;
    id?: unknown;
  };
};

// ─── LRU In-Memory Cache ─────────────────────────────────────────────────────

type CacheEntry = {
  messages: ChatLogEntry[];
  fetchedAt: number; // Date.now()
  accessCount: number;
};

const CACHE_MAX_ENTRIES = 10;
const CACHE_MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100MB
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

class ChatLruCache {
  private store = new Map<string, CacheEntry>();

  get(videoId: string): ChatLogEntry[] | null {
    const entry = this.store.get(videoId);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
      this.store.delete(videoId);
      return null;
    }
    entry.accessCount++;
    // Move to end (most recently used)
    this.store.delete(videoId);
    this.store.set(videoId, entry);
    return entry.messages;
  }

  set(videoId: string, messages: ChatLogEntry[]): void {
    // Evict LRU entries if over capacity
    while (this.store.size >= CACHE_MAX_ENTRIES) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }

    this.store.set(videoId, {
      messages,
      fetchedAt: Date.now(),
      accessCount: 1,
    });

    // Enforce total memory cap (approximate: 1KB per message)
    let estimatedBytes = this.store.size * messages.length * 1024;
    while (estimatedBytes > CACHE_MAX_TOTAL_BYTES && this.store.size > 1) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        const removed = this.store.get(firstKey);
        estimatedBytes -= (removed?.messages.length ?? 0) * 1024;
        this.store.delete(firstKey);
      } else break;
    }
  }

  has(videoId: string): boolean {
    return this.get(videoId) !== null;
  }

  delete(videoId: string): void {
    this.store.delete(videoId);
  }
}

const chatCache = new ChatLruCache();

/**
 * Get cached messages from in-memory LRU cache.
 * Falls back to filesystem cache.
 */
export async function getCachedChat(videoId: string): Promise<ChatLogEntry[] | null> {
  // 1. Check in-memory LRU
  const memCached = chatCache.get(videoId);
  if (memCached) return memCached;

  // 2. Check filesystem cache
  try {
    const mediaPaths = getMediaPaths();
    const cacheDir = path.join(mediaPaths.mediaRoot, "cache", "comments");
    const cacheFilePath = path.join(cacheDir, `${videoId}.rechat.json`);
    const fileStat = await stat(cacheFilePath);

    // TTL check: 7 days
    if (Date.now() - fileStat.mtimeMs > CACHE_TTL_MS) {
      try { await unlink(cacheFilePath); } catch {}
      return null;
    }

    const content = await readFile(cacheFilePath, "utf8");
    const messages: ChatLogEntry[] = JSON.parse(content);
    if (messages.length > 0) {
      chatCache.set(videoId, messages);
      return messages;
    }
  } catch {}
  return null;
}

/**
 * Save messages to both in-memory LRU and filesystem cache.
 */
export async function setCachedChat(videoId: string, messages: ChatLogEntry[]): Promise<void> {
  // 1. Save to in-memory LRU
  chatCache.set(videoId, messages);

  // 2. Save to filesystem (compact JSON for speed and size)
  try {
    const mediaPaths = getMediaPaths();
    const cacheDir = path.join(mediaPaths.mediaRoot, "cache", "comments");
    await mkdir(cacheDir, { recursive: true });
    const cacheFilePath = path.join(cacheDir, `${videoId}.rechat.json`);
    await writeFile(cacheFilePath, JSON.stringify(messages), "utf8");
  } catch {}
}

/**
 * Evict expired cache entries on startup.
 */
export async function evictExpiredCache(): Promise<void> {
  try {
    const mediaPaths = getMediaPaths();
    const cacheDir = path.join(mediaPaths.mediaRoot, "cache", "comments");
    const files = await readdir(cacheDir);
    for (const file of files) {
      if (!file.endsWith(".rechat.json")) continue;
      const filePath = path.join(cacheDir, file);
      try {
        const fileStat = await stat(filePath);
        if (Date.now() - fileStat.mtimeMs > CACHE_TTL_MS || fileStat.size > CACHE_MAX_TOTAL_BYTES / 5) {
          await unlink(filePath).catch(() => {});
        }
      } catch {}
    }
  } catch {}
}

// ─── Main Fetch Functions ────────────────────────────────────────────────────

export async function fetchChatWithChatDownloader(input: FetchChatDownloaderInput): Promise<FetchChatDownloaderResult> {
  const url = input.url.trim();
  if (!url) {
    throw new Error("A livestream, VOD, or clip URL is required.");
  }

  if (!/^https?:\/\//i.test(url)) {
    throw new Error("URL must start with http:// or https://");
  }

  // 0 (or undefined) means "no client cap" — we still apply a safety ceiling so a runaway
  // loop can never exhaust disk. The Python script and GQL pagination are bounded by the
  // wall-clock timeout below.
  const requested = input.maxMessages ?? 0;
  const maxMessages =
    requested <= 0 ? PRACTICAL_MESSAGE_CAP : clampInteger(requested, 1, PRACTICAL_MESSAGE_CAP);
  const isTwitch = /twitch\.tv/i.test(url);

  const pythonScript = isTwitch
    ? buildTwitchScript(url, maxMessages, input.durationSeconds)
    : buildChatDownloaderScript(url, maxMessages);

  const pythonPath = isTwitch ? "python3" : await resolveChatDownloaderPython();
  const { stdout, stderr, rawJsonlPath } = await spawnPythonWithStreaming(pythonScript, maxMessages, input.onProgress, pythonPath, input.signal);

  // Streaming parse: process JSONL line by line as they arrive
  const normalizedMessages = await parseStreamingJsonl(rawJsonlPath, url);

  if (normalizedMessages.length === 0) {
    const stderrHint = stderr.trim() ? ` Stderr: ${stderr.trim().slice(0, 500)}` : "";
    throw new Error(`chat-downloader returned no usable chat messages.${stderrHint}`);
  }

  const paths = getMediaPaths();
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const baseName = `chat_downloader_${timestamp}`;
  const normalizedFileName = `${baseName}.normalized.json`;
  const normalizedPath = path.join("output", "chat_logs", normalizedFileName).replaceAll(path.sep, "/");
  const rawPath = path.join("output", "chat_logs", `${baseName}.jsonl`).replaceAll(path.sep, "/");

  await mkdir(paths.outputChatLogsDir, { recursive: true });
  // Write raw JSONL (already exists from streaming, just keep reference)
  // Write normalized as compact JSON (much faster to write + smaller)
  await writeFile(path.join(paths.outputChatLogsDir, normalizedFileName), JSON.stringify(normalizedMessages), "utf8");

  return {
    source: isTwitch ? "future_platform_api" : "chat_downloader",
    url,
    normalizedMessages,
    normalizedPath,
    rawPath,
    commandPreview: isTwitch ? "Python GQL (std-lib)" : `python3 -c "from chat_downloader ..."`,
    fetchedAt: new Date().toISOString()
  };
}

// ─── Streaming JSONL Parser ──────────────────────────────────────────────────

/**
 * Parse JSONL file line-by-line instead of loading all into memory.
 * Normalizes and filters as messages arrive.
 */
async function parseStreamingJsonl(filePath: string, sourceUrl: string): Promise<ChatLogEntry[]> {
  const results: ChatLogEntry[] = [];
  let index = 0;

  try {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        index++;
        continue;
      }

      if (!parsed || typeof parsed !== "object") {
        index++;
        continue;
      }

      const record = parsed as Record<string, unknown>;

      if (record.message_type === "data" || record.message_type === undefined) {
        if (record.message !== undefined || record.author !== undefined) {
          const normalized = normalizeChatDownloaderMessage(record as unknown as RawChatDownloaderMessage, index);
          if (normalized) {
            results.push(normalized);
          }
        }
      }
      index++;
    }
  } catch {
    // File read error — return what we have
  }

  // Sort by timestamp (required for analysis)
  results.sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
  return results;
}

function buildChatDownloaderScript(url: string, maxMessages: number): string {
  const safeUrl = JSON.stringify(url);
  return [
    "from chat_downloader import ChatDownloader",
    "import json, sys",
    "try:",
    `    chat = ChatDownloader().get_chat(${safeUrl}, message_groups=['messages'], max_messages=${maxMessages}, interruptible_retry=False, retry_timeout=5)`,
    "    for message in chat:",
    "        print(json.dumps(message, default=str))",
    "except Exception as _cd_e:",
    "    _cd_msg = str(_cd_e).replace(chr(10), ' ').strip()",
    "    print(f'{type(_cd_e).__name__}: {_cd_msg}', file=sys.stderr)",
    "    sys.exit(1)"
  ].join("\n");
}

function buildTwitchScript(url: string, maxMessages: number, durationSeconds?: number | null): string {
  const safeUrl = JSON.stringify(url);
  const duration = Math.max(1, Math.round(durationSeconds ?? 0));
  // Dynamic thread count: 4 for short VODs, up to 16 for long ones
  const dynamicThreads = Math.max(4, Math.min(16, Math.ceil(duration / 300)));
  return (
`import json, re, sys, time as _time, os, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

GQL_URL = "https://gql.twitch.tv/gql"
CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
HASH_COMMENTS = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
DURATION = ${duration}
THREAD_COUNT = ${dynamicThreads}

def extract_vod_id(url):
    m = re.search(r'/videos?/(\\d+)', url)
    if m:
        return m.group(1)
    m = re.search(r'/([^/]+)/video/(\\d+)', url)
    if m:
        return m.group(2)
    print("Cannot extract VOD ID from URL", file=sys.stderr)
    sys.exit(1)

def fetch_chat(vod_id, max_messages, timeout_seconds=600):

    def get_integrity():
        data = json.dumps({}).encode()
        req = urllib.request.Request("https://gql.twitch.tv/integrity", data=data)
        req.add_header("Client-ID", CLIENT_ID)
        req.add_header("Content-Type", "application/json")
        req.add_header("Origin", "https://www.twitch.tv")
        req.add_header("Referer", "https://www.twitch.tv/")
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
        token = result.get("token")
        if not token:
            raise ValueError("No integrity token in response")
        return token

    try:
        integrity_token = get_integrity()
    except Exception as e:
        print(f"Integrity token failed: {str(e).strip().replace(chr(10), ' ')}", file=sys.stderr)
        sys.exit(1)

    def gql_comments(video_id, offset):
        query = [{
            "operationName": "VideoCommentsByOffsetOrCursor",
            "variables": {"videoID": video_id, "contentOffsetSeconds": offset, "first": 100},
            "extensions": {"persistedQuery": {"version": 1, "sha256Hash": HASH_COMMENTS}}
        }]
        data = json.dumps(query).encode()
        req = urllib.request.Request(GQL_URL, data=data)
        req.add_header("Content-Type", "text/plain;charset=UTF-8")
        req.add_header("Client-ID", CLIENT_ID)
        req.add_header("Client-Integrity", integrity_token)
        req.add_header("Origin", "https://www.twitch.tv")
        req.add_header("Referer", "https://www.twitch.tv/")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())

    duration = DURATION
    if duration <= 0:
        try:
            q = {"operationName": "VideoMetadata", "query": "query VideoMetadata($videoID: ID!) { video(id: $videoID) { lengthSeconds } }", "variables": {"videoID": vod_id}}
            data = json.dumps(q).encode()
            req = urllib.request.Request(GQL_URL, data=data)
            req.add_header("Content-Type", "text/plain;charset=UTF-8")
            req.add_header("Client-ID", CLIENT_ID)
            req.add_header("Client-Integrity", integrity_token)
            req.add_header("Origin", "https://www.twitch.tv")
            req.add_header("Referer", "https://www.twitch.tv/")
            meta = json.loads(urllib.request.urlopen(req, timeout=10).read())
            duration = int(meta.get("data", {}).get("video", {}).get("lengthSeconds", 3600))
        except Exception:
            duration = 3600

    if duration <= 0:
        duration = 3600

    segment_count = max(1, min(max_messages // 200, 100))
    comments_per_segment = max(1, max_messages // segment_count)

    def fetch_segment(seg_offset, seg_limit, deadline):
        results = []
        seen = set()
        page_offset = seg_offset
        fetched = 0
        stale = 0
        while fetched < seg_limit:
            if _time.time() >= deadline: break
            try:
                resp_data = gql_comments(vod_id, page_offset)
            except Exception:
                stale += 1
                if stale >= 3: break
                page_offset += 30
                continue
            if isinstance(resp_data, list): resp_data = resp_data[0]
            if "errors" in resp_data:
                return results, True  # fatal
            edges = (resp_data.get("data", {}).get("video", {}).get("comments", {}).get("edges") or [])
            if not edges:
                stale += 1
                if stale >= 3: break
                page_offset += 30
                continue
            stale = 0
            max_os = page_offset
            for edge in edges:
                node = edge.get("node")
                if not node: continue
                cid = node.get("id")
                if cid and cid in seen: continue
                if cid: seen.add(cid)
                ts = node.get("contentOffsetSeconds")
                if ts is None: continue
                try: ts = round(float(ts), 3)
                except: continue
                commenter = node.get("commenter") or {}
                user = str(commenter.get("displayName") or commenter.get("login") or "unknown")
                fragments = node.get("message", {}).get("fragments") or []
                if not fragments: continue
                out = {
                    "message": fragments, "time_in_seconds": ts,
                    "author": {"display_name": user, "id": str(commenter.get("id", ""))},
                    "message_type": "data"
                }
                results.append((json.dumps(out, default=str), ts, cid))
                fetched += 1
                if ts > max_os: max_os = ts
                if fetched >= seg_limit: break
            if fetched < seg_limit:
                page_offset = int(max_os) + 3
        return results, False

    seen_lock = Lock()
    print_lock = Lock()
    total_lock = Lock()
    seen_ids = set()
    total = [0]
    deadline = _time.time() + timeout_seconds

    futures = {}
    fatal_error = False
    with ThreadPoolExecutor(max_workers=THREAD_COUNT) as executor:
        for seg in range(segment_count):
            seg_offset = int(seg * duration / segment_count)
            futures[executor.submit(
                fetch_segment, seg_offset, comments_per_segment, deadline
            )] = seg

        for future in as_completed(futures):
            if _time.time() >= deadline or total[0] >= max_messages or fatal_error:
                continue
            seg = futures[future]
            try:
                results, err = future.result()
                if err and total[0] == 0:
                    fatal_error = True
                    with print_lock:
                        print(f"Segment {seg} GQL fatal error", file=sys.stderr)
                for (json_line, ts, cid) in results:
                    if total[0] >= max_messages: break
                    with seen_lock:
                        if cid and cid in seen_ids: continue
                        if cid: seen_ids.add(cid)
                    with total_lock: total[0] += 1
                    with print_lock: print(json_line)
            except Exception as e:
                with print_lock:
                    print(f"Segment {seg} crashed: {str(e).strip().replace(chr(10), ' ')}", file=sys.stderr)

    total_count = total[0]
    if total_count == 0:
        print("No comments collected", file=sys.stderr)
        sys.exit(1)

    print(f"collected {total_count} comments", file=sys.stderr)

fetch_chat(extract_vod_id(${safeUrl}), ${maxMessages})`
  );
}

/**
 * Spawn Python and write stdout to a temporary JSONL file as it streams,
 * then return the file path for streaming parse. This avoids accumulating
 * all stdout in a JS string before processing.
 */
async function spawnPythonWithStreaming(
  script: string,
  maxMessages: number,
  onProgress?: (count: number) => void,
  pythonPath?: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; rawJsonlPath: string }> {
  const py = pythonPath ?? await resolveChatDownloaderPython();
  const paths = getMediaPaths();
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const rawFileName = `chat_stream_${timestamp}.jsonl`;
  const rawFilePath = path.join(paths.outputChatLogsDir, rawFileName);
  const rawRelativePath = rawFilePath;

  await mkdir(paths.outputChatLogsDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const child = spawn(py, ["-u", "-c", script], {
      timeout: PYTHON_TIMEOUT,
      env: { ...process.env, TERM: "dumb", PAGER: "cat", PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let lineCount = 0;

    // Stream stdout directly to file instead of accumulating in memory
    const writeStream = require("node:fs").createWriteStream(rawFilePath, { encoding: "utf8" });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      writeStream.end();
      reject(new Error(`chat-downloader (Python) timed out after ${Math.round(PYTHON_TIMEOUT / 60_000)} minutes.`));
    }, PYTHON_TIMEOUT);

    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      child.kill("SIGTERM");
      writeStream.end();
      reject(new DOMException("Chat download was cancelled.", "AbortError"));
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

    child.stdout?.on("data", (chunk: Buffer) => {
      writeStream.write(chunk);
      if (!onProgress) return;
      // Count newlines in this chunk for progress reporting
      const text = chunk.toString();
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "\n") lineCount++;
      }
      try {
        onProgress(Math.min(lineCount, maxMessages));
      } catch {
        // client disconnected
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      cleanup();
      writeStream.end(() => {
        if (aborted || timedOut) return;
        if (code === 0 || (code === null)) {
          // Read back the raw stdout as string for legacy compatibility
          try {
            const rawStdout = require("node:fs").readFileSync(rawFilePath, "utf8");
            resolve({ stdout: rawStdout, stderr, rawJsonlPath: rawRelativePath });
          } catch {
            resolve({ stdout: "", stderr, rawJsonlPath: rawRelativePath });
          }
        } else {
          const detail = stderr.trim().slice(-1000) || `exit code ${code}`;
          reject(new Error(`chat-downloader failed: ${detail}`));
        }
      });
    });

    child.on("error", (err) => {
      cleanup();
      writeStream.end();
      if (aborted) return;
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(
          `chat-downloader Python (${py}) not found. Install \`pip install chat-downloader\` or set CHAT_DOWNLOADER_PYTHON env var.`
        ));
      } else {
        reject(err);
      }
    });
  });
}

function normalizeChatDownloaderMessage(message: RawChatDownloaderMessage, index: number): ChatLogEntry | null {
  const text = normalizeMessageText(message.message);
  if (!text) {
    return null;
  }

  const timestampSeconds = readTimestampSeconds(message);
  if (timestampSeconds === null) {
    return null;
  }

  return {
    timestamp_seconds: Math.max(0, Math.round(timestampSeconds)),
    author_name: readAuthorName(message, index),
    message: text
  };
}

function normalizeMessageText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part && typeof part === "object") {
        const record = part as Record<string, unknown>;
        return typeof record.text === "string" ? record.text : "";
      }

      return "";
    }).join("").trim();
  }

  return "";
}

function readTimestampSeconds(message: RawChatDownloaderMessage) {
  if (typeof message.time_in_seconds === "number" && Number.isFinite(message.time_in_seconds)) {
    return message.time_in_seconds;
  }

  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
    return Math.floor(message.timestamp / 1_000_000);
  }

  if (typeof message.timestamp_usec === "number" && Number.isFinite(message.timestamp_usec)) {
    return Math.floor(message.timestamp_usec / 1_000_000);
  }

  if (typeof message.time_text === "string") {
    return parseTimeText(message.time_text);
  }

  return null;
}

function readAuthorName(message: RawChatDownloaderMessage, index: number) {
  const author = message.author;
  const rawName = author && (author.display_name ?? author.name ?? author.id);

  if (typeof rawName === "string" && rawName.trim()) {
    return rawName.trim();
  }

  return `chat-user-${index + 1}`;
}

function parseTimeText(value: string) {
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return null;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Fetch chat with automatic retry on transient network errors.
 * Abort and user-thrown errors propagate immediately without retry.
 */
export async function fetchChatWithChatDownloaderWithRetry(
  input: FetchChatDownloaderInput,
  maxAttempts = 2,
): Promise<FetchChatDownloaderResult> {
  const RETRYABLE = /(fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|ENETUNREACH)/i;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchChatWithChatDownloader(input);
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (input.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts || !RETRYABLE.test(message)) throw error;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastError;
}
