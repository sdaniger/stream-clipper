import { NextResponse } from "next/server";
import { evaluateClip, getLlmStatus, type LlmProvider } from "@/lib/server/llm-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = getLlmStatus();
  return NextResponse.json(status);
}

type EvaluateRequest = {
  transcript?: string;
  segments?: Array<{ start?: number; end?: number; text?: string }>;
  provider?: LlmProvider;
  context?: { streamer?: string; archiveTitle?: string };
  noCache?: boolean;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EvaluateRequest;
    const segments = (body.segments ?? [])
      .filter((s): s is { start: number; end: number; text: string } =>
        Boolean(s) && typeof s.text === "string" && s.text.trim().length > 0
      )
      .map((s) => ({
        start: typeof s.start === "number" ? s.start : 0,
        end: typeof s.end === "number" ? s.end : 0,
        text: s.text,
      }));

    const evaluation = await evaluateClip({
      transcript: body.transcript,
      segments,
      provider: body.provider,
      context: body.context,
      noCache: body.noCache,
    });
    return NextResponse.json(evaluation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM error";
    const status = message.includes("LLM_API_KEY") || message.includes("API key") || message.includes("not configured")
      ? 503
      : message.includes("required")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
