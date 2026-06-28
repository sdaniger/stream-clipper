import { NextRequest, NextResponse } from "next/server";
import { extractYtDlpMetadata } from "@/lib/server/yt-dlp-service";
import { extractVodIdFromUrl } from "@/lib/server/twitch-helix-service";
import { fetchChatWithChatDownloader } from "@/lib/server/chat-downloader-service";
import { analyzeChatEntries, type ChatLogEntry } from "@/lib/chat-analysis";
import type { HighlightCandidate, TimelineRow } from "@/lib/studio-api";

export const runtime = "nodejs";

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

  // Find matching timeline rows to get score context
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { vod_url, top_n, window: windowSec, min_gap, keywords } = body as {
      vod_url?: string;
      top_n?: number;
      window?: number;
      min_gap?: number;
      keywords?: string;
    };

    if (!vod_url) {
      return NextResponse.json({ error: "vod_url is required" }, { status: 400 });
    }

    const videoId = extractVodIdFromUrl(vod_url);
    if (!videoId) {
      return NextResponse.json({ error: "Could not extract video ID from URL" }, { status: 400 });
    }

    // 1. Fetch VOD metadata
    const meta = await extractYtDlpMetadata({ url: vod_url });
    const title = meta.title ?? "Unknown VOD";

    // 2. Fetch chat using existing chat-downloader service
    const maxMessages = body.maxMessages ?? undefined;
    const fetched = await fetchChatWithChatDownloader({
      url: vod_url,
      maxMessages: typeof maxMessages === "number" ? maxMessages : undefined,
    });

    const messageCount = fetched.normalizedMessages.length;

    // 3. Analyze chat entries
    const wSec = windowSec ?? 30;
    const analysis = analyzeChatEntries(fetched.normalizedMessages, `studio-${Date.now()}`, {
      windowSeconds: wSec,
      minGap: min_gap ?? 45,
    });

    // 4. Build timeline
    const timeline = buildTimeline(fetched.normalizedMessages, wSec);

    // 5. Convert ClipCandidate[] -> HighlightCandidate[]
    const candidates: HighlightCandidate[] = (analysis.candidates ?? [])
      .map((c: any, i: number) => clipCandidateToHighlight(c, i, timeline, top_n ?? 10, min_gap ?? 45))
      .slice(0, top_n ?? 10);

    return NextResponse.json({
      video_id: videoId,
      title,
      duration_seconds: meta.durationSeconds,
      message_count: messageCount,
      candidates,
      timeline,
      summary: {
        inputMessages: analysis.summary.inputMessages,
        analyzedMessages: analysis.summary.analyzedMessages,
        candidateCount: analysis.summary.candidateCount,
        baselinePerMinute: analysis.summary.baselinePerMinute,
        peakPerMinute: analysis.summary.peakPerMinute,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
