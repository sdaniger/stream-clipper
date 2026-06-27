import { NextResponse } from "next/server";
import { burnCommentsIntoClip, type BurnCommentsIntoClipInput } from "@/lib/server/media-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<BurnCommentsIntoClipInput>;

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

    return NextResponse.json(await burnCommentsIntoClip(body as BurnCommentsIntoClipInput));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown comment burn-in error" }, { status: 400 });
  }
}
