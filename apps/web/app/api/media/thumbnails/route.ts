import { NextResponse } from "next/server";
import { generateThumbnailCandidate, type GenerateThumbnailInput } from "@/lib/server/media-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<GenerateThumbnailInput>;

    if (typeof body.clipPath !== "string") {
      return NextResponse.json({ error: "clipPath must be a string relative to MEDIA_ROOT." }, { status: 400 });
    }

    if (typeof body.candidateId !== "string") {
      return NextResponse.json({ error: "candidateId is required." }, { status: 400 });
    }

    if (typeof body.timestamp !== "string") {
      return NextResponse.json({ error: "timestamp is required." }, { status: 400 });
    }

    if (body.label !== undefined && typeof body.label !== "string") {
      return NextResponse.json({ error: "label must be a string when provided." }, { status: 400 });
    }

    return NextResponse.json(await generateThumbnailCandidate(body as GenerateThumbnailInput));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown thumbnail generation error" }, { status: 400 });
  }
}
