import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getMediaRoot } from "@/lib/server/media-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const relativePath = normalizeRelativePath(url.searchParams.get("path") ?? "");
    const absolutePath = path.resolve(getMediaRoot(), relativePath);
    const relativeFromRoot = path.relative(getMediaRoot(), absolutePath);

    if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
      return NextResponse.json({ error: "Path must stay inside MEDIA_ROOT." }, { status: 400 });
    }

    const file = await readFile(absolutePath);
    return new NextResponse(file, {
      headers: {
        "Content-Type": contentTypeForPath(relativePath),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown media file error" }, { status: 400 });
  }
}

function normalizeRelativePath(relativePath: string) {
  const trimmed = relativePath.trim().replaceAll("\\", "/");
  if (!trimmed) {
    throw new Error("path query parameter is required.");
  }

  if (path.isAbsolute(trimmed)) {
    throw new Error("Use a path relative to MEDIA_ROOT.");
  }

  const normalized = path.posix.normalize(trimmed);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new Error("Path traversal is not allowed.");
  }

  return normalized;
}

function contentTypeForPath(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".png") {
    return "image/png";
  }

  return "application/octet-stream";
}
