import { NextRequest, NextResponse } from "next/server";
import { getStudioApiBaseUrl, ensureStudioBackendAvailable, studioApiUnreachableResponse } from "@/lib/server/studio-jobs-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  await ensureStudioBackendAvailable();
  const apiBase = getStudioApiBaseUrl();
  try {
    const res = await fetch(`${apiBase}/studio/jobs/${jobId}`, {
      method: "GET",
      cache: "no-store",
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

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  await ensureStudioBackendAvailable();
  const apiBase = getStudioApiBaseUrl();
  try {
    const res = await fetch(`${apiBase}/studio/jobs/${jobId}`, {
      method: "DELETE",
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
