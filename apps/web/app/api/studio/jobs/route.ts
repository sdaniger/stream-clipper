import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = process.env.STUDIO_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  const jobKind = request.nextUrl.searchParams.get("job_kind");
  const url = jobKind
    ? `${API_BASE}/studio/jobs?job_kind=${encodeURIComponent(jobKind)}`
    : `${API_BASE}/studio/jobs`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ ok: false, error_code: "API_UNREACHABLE", message: msg }, { status: 502 });
  }
}
