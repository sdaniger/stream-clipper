import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = process.env.STUDIO_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function POST(_request: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  try {
    const res = await fetch(`${API_BASE}/studio/jobs/${jobId}/cancel`, {
      method: "POST",
    });
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
