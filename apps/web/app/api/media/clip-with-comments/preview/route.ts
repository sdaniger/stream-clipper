import { NextResponse } from "next/server";
import { downloadVideoWithYtDlp, extractYtDlpMetadata } from "@/lib/server/yt-dlp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };

    if (typeof body.url !== "string" || !body.url.trim()) {
      return NextResponse.json({ error: "url is required." }, { status: 400 });
    }

    const url = body.url.trim();

    // Fetch metadata first for duration
    const metadata = await extractYtDlpMetadata({ url });

    // Download the full VOD (needed for video player preview)
    const result = await downloadVideoWithYtDlp({
      url,
      prefetchedMetadata: metadata,
      signal: request.signal,
    });

    return NextResponse.json({
      inputPath: result.inputPath,
      absolutePath: result.absolutePath,
      filename: result.filename,
      durationSeconds: metadata.durationSeconds ?? result.probe?.durationSeconds ?? 0,
      title: metadata.title,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown VOD preview error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
