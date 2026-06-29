import { NextRequest, NextResponse } from "next/server";
import { fetchChatWithChatDownloader } from "@/lib/server/chat-downloader-service";
import { extractVodIdFromUrl } from "@/lib/server/twitch-helix-service";
import type { ChatLogEntry } from "@/lib/chat-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type NormalizedChatMessage = {
  timestamp: number;
  time_sec: number;
  message: string;
  author?: string;
};

function toUnifiedFormat(entries: ChatLogEntry[]): NormalizedChatMessage[] {
  return entries.map((e) => ({
    timestamp: e.timestamp_seconds,
    time_sec: e.timestamp_seconds,
    message: e.message,
    author: e.author_name,
  }));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET(request: NextRequest) {
  const vodId = request.nextUrl.searchParams.get("vodId");
  const vodUrl = request.nextUrl.searchParams.get("vodUrl");

  if (!vodId && !vodUrl) {
    return NextResponse.json(
      { ok: false, error_code: "MISSING_PARAM", message: "vodId or vodUrl query parameter is required." },
      { status: 400, headers: corsHeaders() }
    );
  }

  const url = vodUrl ?? `https://www.twitch.tv/videos/${vodId}`;
  const videoId = vodId ?? extractVodIdFromUrl(url);

  try {
    const maxMessages = parseInt(request.nextUrl.searchParams.get("maxMessages") ?? "10000", 10);
    const fetched = await fetchChatWithChatDownloader({ url, maxMessages: Math.min(maxMessages, 50000) });

    const chat = toUnifiedFormat(fetched.normalizedMessages);

    return NextResponse.json(
      {
        ok: true,
        video_id: videoId,
        message_count: chat.length,
        chat,
      },
      { headers: corsHeaders() }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error_code: "CHAT_FETCH_FAILED", message },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url: string | undefined = body.url;

    if (!url) {
      return NextResponse.json(
        { ok: false, error_code: "MISSING_PARAM", message: "url is required." },
        { status: 400, headers: corsHeaders() }
      );
    }

    const videoId = extractVodIdFromUrl(url) ?? url;
    const maxMessages = typeof body.maxMessages === "number" ? body.maxMessages : 10000;

    const fetched = await fetchChatWithChatDownloader({ url, maxMessages: Math.min(maxMessages, 50000) });
    const chat = toUnifiedFormat(fetched.normalizedMessages);

    return NextResponse.json(
      {
        ok: true,
        video_id: videoId,
        message_count: chat.length,
        chat,
      },
      { headers: corsHeaders() }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error_code: "CHAT_FETCH_FAILED", message },
      { status: 500, headers: corsHeaders() }
    );
  }
}
