import { NextResponse } from "next/server";
import { probeVideo } from "@/lib/server/media-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { inputPath?: unknown };

    if (typeof body.inputPath !== "string") {
      return NextResponse.json({ error: "inputPath must be a string relative to MEDIA_ROOT." }, { status: 400 });
    }

    return NextResponse.json(await probeVideo(body.inputPath));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown probe error" }, { status: 400 });
  }
}
