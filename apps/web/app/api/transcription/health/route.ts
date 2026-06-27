import { NextResponse } from "next/server";
import { proxyJsonRequest } from "@/lib/server/api-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { response, payload } = await proxyJsonRequest("/api/transcription/health");
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { available: false, engine: "faster-whisper", error: error instanceof Error ? error.message : "Could not reach transcription API" },
      { status: 503 }
    );
  }
}
