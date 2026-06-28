import { NextResponse } from "next/server";
import { evaluateClip, getLlmStatus, type LlmProvider } from "@/lib/server/llm-service";

export const runtime = "nodejs";

export async function GET() {
  const status = getLlmStatus();
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { transcript?: string; segments?: Array<{ text: string }>; provider?: LlmProvider };

    const transcript = body.transcript?.trim() || body.segments?.map((s) => s.text).filter(Boolean).join("\n") || "";

    if (!transcript) {
      return NextResponse.json({ error: "transcript or segments is required." }, { status: 400 });
    }

    if (transcript.length > 8000) {
      return NextResponse.json({ error: "Transcript too long (max 8000 chars)." }, { status: 400 });
    }

    const evaluation = await evaluateClip(transcript, body.provider);
    return NextResponse.json(evaluation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM error";
    const status = message.includes("LLM_API_KEY") || message.includes("API key") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
