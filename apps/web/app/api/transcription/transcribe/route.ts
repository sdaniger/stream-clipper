import { NextResponse } from "next/server";
import { proxyJsonRequest } from "@/lib/server/api-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { response, payload } = await proxyJsonRequest("/api/transcription/transcribe", {
      method: "POST",
      body: JSON.stringify(body)
    });

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not transcribe clip" },
      { status: 503 }
    );
  }
}
