import { NextRequest, NextResponse } from "next/server";
import { extractYtDlpMetadata } from "@/lib/server/yt-dlp-service";
import { extractVodIdFromUrl } from "@/lib/server/twitch-helix-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { vod_url, top_n } = body as { vod_url?: string; top_n?: number };

    if (!vod_url) {
      return NextResponse.json({ error: "vod_url is required" }, { status: 400 });
    }

    const videoId = extractVodIdFromUrl(vod_url);
    if (!videoId) {
      return NextResponse.json({ error: "Could not extract video ID from URL" }, { status: 400 });
    }

    const meta = await extractYtDlpMetadata({ url: vod_url });

    return NextResponse.json({
      video_id: videoId,
      title: meta.title,
      duration_seconds: meta.durationSeconds,
      candidates: [],
      metadata: meta,
      notice: "Full analysis pipeline (download + chat + analysis) coming soon. Video ID extracted successfully.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
