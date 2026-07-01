import { NextResponse } from "next/server";
import { getBackendApiBaseUrl } from "./api-proxy";
import { checkBackendHealth, spawnBackend } from "./backend-manager";

export function getStudioApiBaseUrl() {
  return process.env.STUDIO_API_BASE_URL ?? getBackendApiBaseUrl();
}

export async function ensureStudioBackendAvailable() {
  if (process.env.STUDIO_API_BASE_URL) return;
  const health = await checkBackendHealth();
  if (!health.alive) await spawnBackend();
}

export function studioApiUnreachableResponse(error: unknown) {
  const detail = error instanceof Error ? error.message : "unknown";
  const baseUrl = getStudioApiBaseUrl();
  return NextResponse.json(
    {
      ok: false,
      error_code: "API_UNREACHABLE",
      message: `FastAPI backend is unreachable at ${baseUrl}. Start it with "npm run dev" or "npm run dev:api". (${detail})`,
    },
    { status: 502 },
  );
}
