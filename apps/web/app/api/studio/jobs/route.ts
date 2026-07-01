import { NextRequest, NextResponse } from "next/server";
import { getStudioApiBaseUrl, ensureStudioBackendAvailable, studioApiUnreachableResponse } from "@/lib/server/studio-jobs-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jobKind = request.nextUrl.searchParams.get("job_kind");
  await ensureStudioBackendAvailable();
  const apiBase = getStudioApiBaseUrl();
  const url = jobKind
    ? `${apiBase}/studio/jobs?job_kind=${encodeURIComponent(jobKind)}`
    : `${apiBase}/studio/jobs`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return studioApiUnreachableResponse(e);
  }
}
