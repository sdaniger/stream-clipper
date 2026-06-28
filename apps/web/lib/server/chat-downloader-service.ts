import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
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
  const { stdout, stderr } = await spawnPythonWithProgress(pythonScript, maxMessages, input.onProgress, pythonPath, input.signal);

  const rawMessages = parseJsonLines(stdout, url);
  const normalizedMessages = rawMessages
    .map((message, index) => normalizeChatDownloaderMessage(message, index))
    .filter((message): message is ChatLogEntry => Boolean(message))
    .sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);

  if (normalizedMessages.length === 0) {
    const stderrHint = stderr.trim() ? ` Stderr: ${stderr.trim().slice(0, 500)}` : "";
    throw new Error(`chat-downloader returned no usable chat messages.${stderrHint}`);
  }

  const paths = getMediaPaths();
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const baseName = `chat_downloader_${timestamp}`;
  const rawFileName = `${baseName}.jsonl`;
  const normalizedFileName = `${baseName}.normalized.json`;
  const rawPath = path.join("output", "chat_logs", rawFileName).replaceAll(path.sep, "/");
  const normalizedPath = path.join("output", "chat_logs", normalizedFileName).replaceAll(path.sep, "/");

  await mkdir(paths.outputChatLogsDir, { recursive: true });
  await writeFile(path.join(paths.outputChatLogsDir, rawFileName), stdout, "utf8");
  await writeFile(path.join(paths.outputChatLogsDir, normalizedFileName), JSON.stringify(normalizedMessages, null, 2) + "\n", "utf8");

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
  return (
`import json, re, sys, time as _time, os, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

GQL_URL = "https://gql.twitch.tv/gql"
CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
HASH_COMMENTS = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
DURATION = ${duration}

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

    # Per-segment worker: fetches comments from one time offset using
    # urllib.request.urlopen (fully thread-safe, no shared state).
    # Returns list of (json_line, timestamp, comment_id, error_flag).
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

    # Shared state for cross-thread deduplication and ordering
    seen_lock = Lock()
    print_lock = Lock()
    total_lock = Lock()
    seen_ids = set()
    total = [0]
    deadline = _time.time() + timeout_seconds

    futures = {}
    fatal_error = False
    with ThreadPoolExecutor(max_workers=8) as executor:
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

 async function spawnPythonWithProgress(
  script: string,
  maxMessages: number,
  onProgress?: (count: number) => void,
  pythonPath?: string,
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string }> {
  const py = pythonPath ?? await resolveChatDownloaderPython();
  return new Promise((resolve, reject) => {
    const child = spawn(py, ["-u", "-c", script], {
      timeout: PYTHON_TIMEOUT,
      env: { ...process.env, TERM: "dumb", PAGER: "cat", PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let lineCount = 0;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      reject(new Error(`chat-downloader (Python) timed out after ${Math.round(PYTHON_TIMEOUT / 60_000)} minutes.`));
    }, PYTHON_TIMEOUT);

    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      child.kill("SIGTERM");
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
      stdout += chunk.toString();
      if (!onProgress) return;
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
      if (aborted || timedOut) return;
      if (code === 0 || (code === null && stdout.trim().length > 0)) {
        resolve({ stdout, stderr });
      } else {
        const detail = stderr.trim().slice(-1000) || `exit code ${code}`;
        reject(new Error(`chat-downloader failed: ${detail}`));
      }
    });

    child.on("error", (err) => {
      cleanup();
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

function parseJsonLines(stdout: string, sourceUrl: string): RawChatDownloaderMessage[] {
  const results: RawChatDownloaderMessage[] = [];
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    const record = parsed as Record<string, unknown>;

    if (record.message_type === "data" || record.message_type === undefined) {
      if (record.message !== undefined || record.author !== undefined) {
        results.push(record as unknown as RawChatDownloaderMessage);
      }
    }
  }

  return results;
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


