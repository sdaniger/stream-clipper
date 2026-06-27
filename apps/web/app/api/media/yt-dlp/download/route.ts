import { NextResponse } from "next/server";
import { downloadVideoWithYtDlp, type YtDlpDownloadInput } from "@/lib/server/yt-dlp-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<YtDlpDownloadInput>;

    if (typeof body.url !== "string") {
      return NextResponse.json({ error: "url must be a video archive URL string." }, { status: 400 });
    }

    if (body.format !== undefined && typeof body.format !== "string") {
      return NextResponse.json({ error: "format must be a yt-dlp format string when provided." }, { status: 400 });
    }

    return NextResponse.json(await downloadVideoWithYtDlp({ url: body.url, format: body.format }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown yt-dlp download error" }, { status: 400 });
  }
}
