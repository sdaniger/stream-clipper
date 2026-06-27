import { stat, open, readFile } from "node:fs/promises";
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

    const contentType = contentTypeForPath(relativePath);
    const isVideo = contentType.startsWith("video/");

    // Video files need Range request support so the <video> element can seek
    // and the browser can stream the file in chunks. Without this, browsers
    // must download the entire file before playing.
    if (isVideo) {
      return await serveWithRange(request, absolutePath, relativePath, contentType);
    }

    const file = await readFile(absolutePath);
    return new NextResponse(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown media file error" }, { status: 400 });
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

  // No range: send the whole file but advertise Range support so the browser
  // upgrades to range requests on its own (e.g. for seeking).
  const handle = await open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(total);
    await handle.read(buffer, 0, total, 0);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": total.toString(),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      }
    });
  } finally {
    await handle.close();
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

  if (extension === ".json" || extension === ".ass" || extension === ".srt" || extension === ".vtt" || extension === ".txt") {
    return "text/plain;charset=utf-8";
  }

  return "application/octet-stream";
}
