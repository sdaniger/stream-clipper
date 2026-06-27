import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatLogEntry } from "@/lib/chat-analysis";
import { getMediaPaths } from "@/lib/server/media-service";

export type ChatSourceType = "manual_json" | "chat_downloader" | "imported_file" | "future_twitch_live_capture" | "future_platform_api";

export type FetchChatDownloaderInput = {
  url: string;
  maxMessages?: number;
  onProgress?: (messageCount: number) => void;
};

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

const PYTHON_TIMEOUT = 5 * 60_000;

export async function fetchChatWithChatDownloader(input: FetchChatDownloaderInput): Promise<FetchChatDownloaderResult> {
  const url = input.url.trim();
  if (!url) {
    throw new Error("A livestream, VOD, or clip URL is required.");
  }

  if (!/^https?:\/\//i.test(url)) {
    throw new Error("URL must start with http:// or https://.");
  }

  const maxMessages = clampInteger(input.maxMessages ?? 5000, 1, 50000);
  const safeUrl = JSON.stringify(url);

  const pythonScript = [
    "from chat_downloader import ChatDownloader",
    "import json, sys",
    `chat = ChatDownloader().get_chat(${safeUrl}, message_groups=['messages'], max_messages=${maxMessages}, interruptible_retry=False, retry_timeout=5)`,
    "for message in chat:",
    "    print(json.dumps(message, default=str))"
  ].join("\n");

  const { stdout, stderr } = await spawnPythonWithProgress(pythonScript, maxMessages, input.onProgress);

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
    source: "chat_downloader",
    url,
    normalizedMessages,
    normalizedPath,
    rawPath,
    commandPreview: `python3 -c "from chat_downloader ..."`,
    fetchedAt: new Date().toISOString()
  };
}

async function spawnPythonWithProgress(
  script: string,
  maxMessages: number,
  onProgress?: (count: number) => void
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-u", "-c", script], {
      timeout: PYTHON_TIMEOUT,
      env: { ...process.env, TERM: "dumb", PAGER: "cat", PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let lineCount = 0;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      reject(new Error("chat-downloader (Python) timed out after 5 minutes."));
    }, PYTHON_TIMEOUT);

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
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0 || (code === null && stdout.trim().length > 0)) {
        resolve({ stdout, stderr });
      } else {
        const detail = stderr.trim().slice(-1000) || `exit code ${code}`;
        reject(new Error(`chat-downloader failed: ${detail}`));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(
          "python3 is required to fetch chat. Install Python 3 and \`pip install chat-downloader\`."
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


