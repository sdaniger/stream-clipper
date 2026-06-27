import { NextResponse } from "next/server";
import { getMediaRuntimeStatus } from "@/lib/server/media-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getMediaRuntimeStatus());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown media status error" }, { status: 500 });
  }
}
