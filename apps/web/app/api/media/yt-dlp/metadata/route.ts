import { NextResponse } from "next/server";
import { extractYtDlpMetadata, type YtDlpMetadataInput } from "@/lib/server/yt-dlp-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<YtDlpMetadataInput>;

    if (typeof body.url !== "string") {
      return NextResponse.json({ error: "url must be a video archive URL string." }, { status: 400 });
    }

    return NextResponse.json(await extractYtDlpMetadata({ url: body.url }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown yt-dlp metadata error" }, { status: 400 });
  }
}
