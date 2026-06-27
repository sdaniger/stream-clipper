import { NextResponse } from "next/server";
import { burnCommentsIntoClip, type BurnCommentsIntoClipInput } from "@/lib/server/media-service";

export const runtime = "nodejs";

const ALLOWED_ENCODERS: ReadonlyArray<NonNullable<BurnCommentsIntoClipInput["encoder"]>> = ["libx264", "h264_nvenc", "libx265"];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<BurnCommentsIntoClipInput> & Record<string, unknown>;

    if (typeof body.clipPath !== "string") {
      return NextResponse.json({ error: "clipPath must be a string relative to MEDIA_ROOT." }, { status: 400 });
    }

    if (typeof body.candidateId !== "string") {
      return NextResponse.json({ error: "candidateId is required." }, { status: 400 });
    }

    if (body.variantId !== undefined && typeof body.variantId !== "string") {
      return NextResponse.json({ error: "variantId must be a string when provided." }, { status: 400 });
    }

    if (body.assPath !== undefined && typeof body.assPath !== "string") {
      return NextResponse.json({ error: "assPath must be a string relative to MEDIA_ROOT when provided." }, { status: 400 });
    }

    if (body.assContent !== undefined && typeof body.assContent !== "string") {
      return NextResponse.json({ error: "assContent must be a string when provided." }, { status: 400 });
    }

    if (body.assFileName !== undefined && typeof body.assFileName !== "string") {
      return NextResponse.json({ error: "assFileName must be a string when provided." }, { status: 400 });
    }

    if (body.encoder !== undefined && !ALLOWED_ENCODERS.includes(body.encoder as never)) {
      return NextResponse.json({ error: `encoder must be one of: ${ALLOWED_ENCODERS.join(", ")}` }, { status: 400 });
    }

    if (body.crf !== undefined && (typeof body.crf !== "number" || body.crf < 0 || body.crf > 51)) {
      return NextResponse.json({ error: "crf must be a number between 0 and 51." }, { status: 400 });
    }

    if (body.preset !== undefined && typeof body.preset !== "string") {
      return NextResponse.json({ error: "preset must be a string when provided." }, { status: 400 });
    }

    if (body.audioBitrate !== undefined && typeof body.audioBitrate !== "string") {
      return NextResponse.json({ error: "audioBitrate must be a string when provided." }, { status: 400 });
    }

    if (body.normalizeAudio !== undefined && typeof body.normalizeAudio !== "boolean") {
      return NextResponse.json({ error: "normalizeAudio must be a boolean when provided." }, { status: 400 });
    }

    return NextResponse.json(await burnCommentsIntoClip(body as BurnCommentsIntoClipInput));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown comment burn-in error" }, { status: 400 });
  }
}
