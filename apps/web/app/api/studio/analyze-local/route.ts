import { NextRequest } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { analyzeChatEntries, type ChatLogEntry } from "@/lib/chat-analysis";
import type { HighlightCandidate, TimelineRow } from "@/lib/studio-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clockToSeconds(clock: string): number {
  const parts = clock.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function buildTimeline(entries: ChatLogEntry[], windowSec: number): TimelineRow[] {
  const buckets = new Map<number, { chat: number; kw: number; keywords: Set<string> }>();
  const reactions = ["www", "草", "爆笑", "笑", "w", "lol", "lmao", "kusa",
    "すごい", "すげ", "やばい", "やば", "神", "最高", "天才", "上手い",
    "きた", "来た", "ｷﾀ", "キタ", "は？", "何", "え？", "なに",
    "助けて", "たすけて", "死", "わろ", "ワロ",
  ];

  for (const entry of entries) {
    const idx = Math.floor(entry.timestamp_seconds / windowSec);
    if (!buckets.has(idx)) buckets.set(idx, { chat: 0, kw: 0, keywords: new Set() });
    const b = buckets.get(idx)!;
    b.chat++;
    const msg = entry.message.toLowerCase();
    for (const r of reactions) {
      if (msg.includes(r)) { b.kw++; b.keywords.add(r); }
    }
  }

  const minIdx = Math.min(...buckets.keys());
  const maxIdx = Math.max(...buckets.keys());
  const result: TimelineRow[] = [];

  for (let i = minIdx; i <= maxIdx; i++) {
    const b = buckets.get(i) ?? { chat: 0, kw: 0, keywords: new Set() };
    result.push({
      start: i * windowSec,
      end: (i + 1) * windowSec,
      score: b.chat + b.kw * 2,
      chat_count: b.chat,
      keyword_hits: b.kw,
      matched_keywords: [...b.keywords],
    });
  }

  return result;
}

function clipCandidateToHighlight(
  c: any,
  index: number,
  timeline: TimelineRow[],
  topN: number,
  minGap: number,
): HighlightCandidate {
  const clipStart = clockToSeconds(c.detectedAt ?? "0");
  const duration = clockToSeconds(c.duration ?? "30");
  const peakFromTitle = (() => {
    const m = c.title?.match(/(\d+):(\d+)(?::(\d+))?/);
    if (!m) return clipStart + duration / 2;
    return (parseInt(m[1]) * 60 + parseInt(m[2] ?? "0")) * (m[3] ? 1 : 1) + (m[3] ? parseInt(m[3]) : 0);
  })();
  const highlightStart = clipStart;
  const highlightEnd = clipStart + duration;

  const matchedRows = timeline.filter(
    (r) => r.start >= highlightStart && r.end <= highlightEnd,
  );
  const totalScore = matchedRows.reduce((s, r) => s + r.score, 0);
  const totalChat = matchedRows.reduce((s, r) => s + r.chat_count, 0);
  const totalKw = matchedRows.reduce((s, r) => s + r.keyword_hits, 0);
  const allKws = [...new Set(matchedRows.flatMap((r) => r.matched_keywords))];

  return {
    rank: index + 1,
    start: highlightStart,
    end: highlightEnd,
    peak_time: peakFromTitle,
    score: Math.round(c.confidence ?? totalScore),
    chat_count: c.chat?.messages ?? totalChat,
    keyword_hits: totalKw,
    matched_keywords: allKws,
    reasons: c.whyDetected ?? [],
    clip_start: clipStart,
    clip_duration: duration,
    output_file: null,
  };
}

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
    const { video_path, log_path, top_n, window: windowSec, min_gap, keywords } = body as {
      video_path?: string;
      log_path?: string;
      top_n?: number;
      window?: number;
      min_gap?: number;
      keywords?: string;
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
          const title = video_path ? path.basename(video_path) : "Local Video";

          send({ type: "progress", stage: "analyze", message: "候補生成中...", progress: 50 });
          const analysis = analyzeChatEntries(entries, `local-${Date.now()}`, {
            windowSeconds: wSec,
            minGap: min_gap ?? 45,
          });

          send({ type: "progress", stage: "timeline", message: "タイムライン構築中...", progress: 75 });
          const timeline = buildTimeline(entries, wSec);

          const candidates: HighlightCandidate[] = (analysis.candidates ?? [])
            .map((c: any, i: number) => clipCandidateToHighlight(c, i, timeline, top_n ?? 10, min_gap ?? 45))
            .slice(0, top_n ?? 10);

          send({ type: "progress", stage: "done", message: `分析完了: ${candidates.length} 件の候補`, progress: 100 });
          send({
            type: "result",
            video_id: null,
            title,
            duration_seconds: null,
            message_count: entries.length,
            candidates,
            timeline,
            video_exists: videoExists,
            summary: {
              inputMessages: analysis.summary.inputMessages,
              analyzedMessages: analysis.summary.analyzedMessages,
              candidateCount: analysis.summary.candidateCount,
              baselinePerMinute: analysis.summary.baselinePerMinute,
              peakPerMinute: analysis.summary.peakPerMinute,
            },
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
