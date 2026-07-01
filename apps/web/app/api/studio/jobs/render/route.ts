import { NextRequest, NextResponse } from "next/server";
import { getStudioApiBaseUrl, ensureStudioBackendAvailable, studioApiUnreachableResponse } from "@/lib/server/studio-jobs-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error_code: "INVALID_JSON" }, { status: 400 });
  }
  try {
    await ensureStudioBackendAvailable();
    const apiBase = getStudioApiBaseUrl();
    const res = await fetch(`${apiBase}/studio/jobs/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return studioApiUnreachableResponse(e);
  }
}
