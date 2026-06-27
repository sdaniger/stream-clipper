import { NextResponse } from "next/server";
import { runArchiveAutoAnalysis, type ArchiveAutoAnalyzeInput } from "@/lib/server/archive-analysis-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ArchiveAutoAnalyzeInput>;

    if (typeof body.url !== "string") {
      return NextResponse.json({ error: "url must be an archive URL string." }, { status: 400 });
    }

    if (body.ytDlpFormat !== undefined && typeof body.ytDlpFormat !== "string") {
      return NextResponse.json({ error: "ytDlpFormat must be a string when provided." }, { status: 400 });
    }

    if (body.maxMessages !== undefined && typeof body.maxMessages !== "number") {
      return NextResponse.json({ error: "maxMessages must be a number when provided." }, { status: 400 });
    }

    if (body.maxCandidates !== undefined && typeof body.maxCandidates !== "number") {
      return NextResponse.json({ error: "maxCandidates must be a number when provided." }, { status: 400 });
    }

    if (body.clipMode !== undefined && body.clipMode !== "copy" && body.clipMode !== "reencode") {
      return NextResponse.json({ error: "clipMode must be copy or reencode." }, { status: 400 });
    }

    return NextResponse.json(await runArchiveAutoAnalysis(body as ArchiveAutoAnalyzeInput));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown archive auto-analysis error" }, { status: 400 });
  }
}
