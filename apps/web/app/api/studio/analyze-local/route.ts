import { NextRequest } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { type ChatLogEntry } from "@/lib/chat-analysis";
import type { HighlightCandidate, TimelineRow } from "@/lib/studio-api";
import {
  buildStudioTimeline,
  generateTopNCandidates,
  type StudioAnalyzeOptions,
} from "@/lib/studio-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeEntry(item: any): ChatLogEntry {
  if (item.timestamp_seconds != null && item.author_name != null) {
    return {
      timestamp_seconds: Number(item.timestamp_seconds),
      author_name: String(item.author_name),
      message: String(item.message ?? ""),
    };
  }
  const ts = item.timestamp ?? item.time ?? item.time_sec ?? item.createdAt ?? 0;
  const author = item.author ?? item.user ?? item.username ?? item.name ?? item.author_name ?? "";
  const message = item.message ?? item.text ?? item.body ?? "";
  return {
    timestamp_seconds: Number(ts),
    author_name: String(author),
    message: String(message),
  };
}

function loadChatFromJson(content: string): ChatLogEntry[] {
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error("Chat JSON must be an array");
  }
  const entries = parsed.map((item: any) => normalizeEntry(item));
  entries.sort((a: ChatLogEntry, b: ChatLogEntry) => a.timestamp_seconds - b.timestamp_seconds);
  return entries;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { video_path, log_path, top_n, window: windowSec, min_gap, keywords, step, keyword_weight, clip_duration, clip_offset } = body as {
      video_path?: string;
      log_path?: string;
      top_n?: number;
      window?: number;
      min_gap?: number;
      keywords?: string;
      step?: number;
      keyword_weight?: number;
      clip_duration?: number;
      clip_offset?: number;
    };

    if (!log_path) {
      return Response.json({ error: "log_path is required" }, { status: 400 });
    }

    let streamClosed = false;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          if (streamClosed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            streamClosed = true;
          }
        };

        try {
          send({ type: "progress", stage: "file_read", message: "チャットファイルを読み込み中...", progress: 10 });
          let fileContent: string;
          try {
            fileContent = await readFile(log_path, "utf-8");
          } catch {
            send({ type: "error", error: `Chat file not found: ${log_path}` });
            streamClosed = true;
            controller.close();
            return;
          }

          send({ type: "progress", stage: "parse", message: "チャットを解析中...", progress: 30 });
          let entries: ChatLogEntry[];
          try {
            entries = loadChatFromJson(fileContent);
          } catch {
            send({ type: "error", error: "Failed to parse chat file. Use JSON array format." });
            streamClosed = true;
            controller.close();
            return;
          }

          if (entries.length === 0) {
            send({ type: "error", error: "Chat file is empty" });
            streamClosed = true;
            controller.close();
            return;
          }

          send({ type: "progress", stage: "parse_done", message: `チャット解析完了: ${entries.length} messages`, progress: 40 });

          let videoExists = false;
          if (video_path) {
            try {
              await stat(video_path);
              videoExists = true;
            } catch {}
          }

          const wSec = windowSec ?? 30;
          const sSec = step ?? 10;
          const title = video_path ? path.basename(video_path) : "Local Video";

          send({ type: "progress", stage: "analyze", message: "候補生成中...", progress: 50 });

          const parsedKeywords = keywords
            ? keywords.split(",").map((k) => k.trim()).filter(Boolean)
            : [];

          const analyzeOptions: StudioAnalyzeOptions = {
            windowSeconds: wSec,
            topN: top_n ?? 10,
            minGap: min_gap ?? 45,
            step: sSec,
            keywordWeight: keyword_weight ?? 2.0,
            clipDuration: clip_duration ?? 30,
            clipOffset: clip_offset ?? 10,
            keywords: parsedKeywords,
          };

          const timeline = buildStudioTimeline(entries, wSec, sSec, parsedKeywords, analyzeOptions.keywordWeight ?? 2.0);
          const analysisResult = generateTopNCandidates(timeline, entries, analyzeOptions);

          send({ type: "progress", stage: "timeline", message: "タイムライン構築中...", progress: 75 });

          send({ type: "progress", stage: "done", message: `分析完了: ${analysisResult.candidates.length} 件の候補`, progress: 100 });
          send({
            type: "result",
            video_id: null,
            title,
            duration_seconds: null,
            message_count: entries.length,
            candidates: analysisResult.candidates,
            timeline: analysisResult.timeline,
            video_exists: videoExists,
            diagnostic: analysisResult.diagnostic,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          if (!streamClosed) {
            try { send({ type: "error", error: msg }); } catch {}
          }
        }

        if (!streamClosed) {
          streamClosed = true;
          try { controller.close(); } catch {}
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
