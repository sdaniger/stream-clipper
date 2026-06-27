import { NextResponse } from "next/server";
import { generateClip, type GenerateClipInput } from "@/lib/server/media-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<GenerateClipInput>;

    if (typeof body.inputPath !== "string") {
      return NextResponse.json({ error: "inputPath must be a string relative to MEDIA_ROOT." }, { status: 400 });
    }

    if (typeof body.candidateId !== "string" || typeof body.variantId !== "string") {
      return NextResponse.json({ error: "candidateId and variantId are required strings." }, { status: 400 });
    }

    if (typeof body.start !== "string" || typeof body.duration !== "string") {
      return NextResponse.json({ error: "start and duration are required time strings." }, { status: 400 });
    }

    if (body.mode && body.mode !== "copy" && body.mode !== "reencode") {
      return NextResponse.json({ error: "mode must be copy or reencode." }, { status: 400 });
    }

    return NextResponse.json(await generateClip(body as GenerateClipInput));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown clip generation error" }, { status: 400 });
  }
}
