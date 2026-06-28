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
    const msg = error instanceof Error ? error.message : "Unknown thumbnail generation error";
    const status = msg.includes("not found") || msg.includes("was not found") ? 404
      : msg.includes("not available") ? 503
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
