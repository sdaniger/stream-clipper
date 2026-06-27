import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ChatLogEntry } from "@/lib/chat-analysis";
import { getMediaPaths } from "@/lib/server/media-service";

const execFileAsync = promisify(execFile);

export type ChatSourceType = "manual_json" | "chat_downloader" | "imported_file" | "future_twitch_live_capture" | "future_platform_api";

export type FetchChatDownloaderInput = {
  url: string;
  maxMessages?: number;
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

/** Options that suppress terminal-dependent chat_downloader features. */
const FETCH_OPTS = {
  timeout: 5 * 60_000,
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, TERM: "dumb", PAGER: "cat", FORCE_COLOR: "0" }
};

export async function fetchChatWithChatDownloader(input: FetchChatDownloaderInput): Promise<FetchChatDownloaderResult> {
  const url = input.url.trim();
  if (!url) {
    throw new Error("A livestream, VOD, or clip URL is required.");
  }

  if (!/^https?:\/\//i.test(url)) {
    throw new Error("URL must start with http:// or https://.");
  }

  const maxMessages = clampInteger(input.maxMessages ?? 5000, 1, 50000);
  const args = ["--message_groups", "messages", "--max_messages", maxMessages.toString(), "--output", "-", "--interruptible_retry", "False", "--retry_timeout", "5", url];

  await assertChatDownloaderInstalled();

  let stdout = "";
  let partialResult = false;

  try {
    const result = await execFileAsync("chat_downloader", args, FETCH_OPTS);
    stdout = result.stdout;
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };

    if (typeof execError.stdout === "string" && execError.stdout.trim().length > 0) {
      stdout = execError.stdout;
      partialResult = true;
    } else {
      const detail = extractChatDownloaderError(error);
      throw new Error(`chat-downloader failed while fetching chat: ${detail}`);
    }
  }

  const rawMessages = parseJsonLines(stdout, url);
  const normalizedMessages = rawMessages
    .map((message, index) => normalizeChatDownloaderMessage(message, index))
    .filter((message): message is ChatLogEntry => Boolean(message))
    .sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);

  if (normalizedMessages.length === 0) {
    throw new Error("chat-downloader returned no usable chat messages.");
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
    commandPreview: `chat_downloader ${args.map(shellQuote).join(" ")}`,
    fetchedAt: new Date().toISOString(),
    ...(partialResult ? { partialResult: true } : {})
  };
}

async function assertChatDownloaderInstalled(): Promise<void> {
  try {
    await execFileAsync("chat_downloader", ["--version"], { timeout: 10_000, env: { ...process.env, TERM: "dumb" } });
  } catch {
    throw new Error(
      "chat_downloader is not installed on the server PATH. " +
      "Install it with `pip install chat-downloader` and restart the dev server."
    );
  }
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

function extractChatDownloaderError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Unknown error";
  }

  const execError = error as { stderr?: unknown; stdout?: unknown; message?: unknown; code?: unknown };
  const stderr = typeof execError.stderr === "string" ? execError.stderr : "";
  const stdout = typeof execError.stdout === "string" ? execError.stdout : "";

  // Filter stderr: remove Python traceback lines, termios noise, and blank lines
  const relevantLines = (stderr + "\n" + stdout)
    .split(/\r?\n/)
    .filter((line) => !/^Traceback/.test(line))
    .filter((line) => !/^  File /.test(line))
    .filter((line) => !/^  /.test(line))
    .filter((line) => !/termios/.test(line))
    .filter((line) => !/Inappropriate ioctl/.test(line))
    .map((line) => line.trim())
    .filter(Boolean);

  const cleaned = relevantLines.slice(-5).join("; ");

  if (cleaned) {
    return cleaned;
  }

  if (typeof execError.message === "string") {
    return execError.message.replace(/^Command failed:\s*/i, "").slice(0, 500);
  }

  return "Unknown chat-downloader error";
}

function shellQuote(value: string) {
  if (/^[a-zA-Z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
