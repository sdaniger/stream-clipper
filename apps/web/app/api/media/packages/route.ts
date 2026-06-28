import { NextResponse } from "next/server";
import { generateExportPackage, type GenerateExportPackageInput } from "@/lib/server/media-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<GenerateExportPackageInput>;

    if (!body.candidate || typeof body.candidate !== "object" || typeof body.candidate.id !== "string") {
      return NextResponse.json({ error: "candidate with a string id is required." }, { status: 400 });
    }

    if (body.commentsJson !== undefined && typeof body.commentsJson !== "string") {
      return NextResponse.json({ error: "commentsJson must be a string when provided." }, { status: 400 });
    }

    if (body.commentsAss !== undefined && typeof body.commentsAss !== "string") {
      return NextResponse.json({ error: "commentsAss must be a string when provided." }, { status: 400 });
    }

    return NextResponse.json(await generateExportPackage(body as GenerateExportPackageInput));
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown export package error";
    const status = msg.includes("not found") || msg.includes("was not found") ? 404
      : msg.includes("not available") ? 503
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
