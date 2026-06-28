import { stat, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
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

    const contentType = contentTypeForPath(relativePath);
    const isVideo = contentType.startsWith("video/");

    if (isVideo) {
      return await serveWithRange(request, absolutePath, relativePath, contentType);
    }

    // Stream non-video files instead of buffering entire file
    const fileStat = await stat(absolutePath);
    const stream = Readable.toWeb(createReadStream(absolutePath)) as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileStat.size.toString(),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const status = error instanceof Error && error.message.includes("was not found") ? 404 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown media file error" }, { status });
  }
}

async function serveWithRange(request: Request, absolutePath: string, relativePath: string, contentType: string) {
  const stats = await stat(absolutePath);
  const total = stats.size;
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (match) {
      const startRaw = match[1];
      const endRaw = match[2];
      const start = startRaw ? parseInt(startRaw, 10) : 0;
      const end = endRaw ? Math.min(parseInt(endRaw, 10), total - 1) : total - 1;
      const clampedStart = Math.max(0, Math.min(start, total - 1));
      const clampedEnd = Math.max(clampedStart, Math.min(end, total - 1));
      const chunkSize = clampedEnd - clampedStart + 1;

      const handle = await open(absolutePath, "r");
      try {
        const buffer = Buffer.alloc(chunkSize);
        await handle.read(buffer, 0, chunkSize, clampedStart);
        return new NextResponse(buffer, {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Length": chunkSize.toString(),
            "Content-Range": `bytes ${clampedStart}-${clampedEnd}/${total}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store"
          }
        });
      } finally {
        await handle.close();
      }
    }
  }

  // No range header — stream the entire file via chunked response.
  // The browser will upgrade to range requests when seeking.
  const nodeStream = createReadStream(absolutePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": total.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store"
    }
  });
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

  if (extension === ".mp4" || extension === ".m4v") {
    return "video/mp4";
  }

  if (extension === ".webm") {
    return "video/webm";
  }

  if (extension === ".mov") {
    return "video/quicktime";
  }

  if (extension === ".mkv") {
    return "video/x-matroska";
  }

  if (extension === ".json") {
    return "application/json;charset=utf-8";
  }

  if (extension === ".ass") {
    return "text/x-ssa;charset=utf-8";
  }

  if (extension === ".srt") {
    return "application/x-subrip;charset=utf-8";
  }

  if (extension === ".vtt") {
    return "text/vtt;charset=utf-8";
  }

  if (extension === ".txt" || extension === ".ref" || extension === ".md") {
    return "text/plain;charset=utf-8";
  }

  return "application/octet-stream";
}
