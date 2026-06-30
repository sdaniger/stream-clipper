import { stat, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getMediaRoot } from "@/lib/server/media-service";

export const runtime = "nodejs";

/**
 * Serve files produced by the render job (output_path, ass_path,
 * metadata_path). These are stored relative to the project root (e.g.
 * `output/clips/clip_001_short_danmaku.mp4`), which lives one directory
 * above MEDIA_ROOT. We resolve the path against the project root and
 * verify it does not escape the workspace.
 */
function getProjectRoot() {
  const cwd = process.cwd();
  const parent = path.basename(path.dirname(cwd));
  const current = path.basename(cwd);
  if (current === "web" && parent === "apps") {
    return path.resolve(cwd, "../..");
  }
  return cwd;
}

function contentTypeForPath(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".mp4" || extension === ".m4v") return "video/mp4";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".json") return "application/json;charset=utf-8";
  if (extension === ".ass") return "text/x-ssa;charset=utf-8";
  if (extension === ".srt") return "application/x-subrip;charset=utf-8";
  if (extension === ".txt") return "text/plain;charset=utf-8";
  return "application/octet-stream";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const relativePath = url.searchParams.get("path") ?? "";
    const trimmed = relativePath.trim().replaceAll("\\", "/");
    if (!trimmed) {
      return NextResponse.json({ error: "path query parameter is required." }, { status: 400 });
    }
    if (path.isAbsolute(trimmed)) {
      return NextResponse.json({ error: "Use a path relative to the project root." }, { status: 400 });
    }
    const normalized = path.posix.normalize(trimmed);
    if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
      return NextResponse.json({ error: "Path traversal is not allowed." }, { status: 400 });
    }

    const projectRoot = getProjectRoot();
    const mediaRoot = getMediaRoot();
    // Allow: paths under project root (output/, etc.) OR paths under media root.
    const underProject = path.resolve(projectRoot, normalized);
    const relFromProject = path.relative(projectRoot, underProject);
    if (relFromProject.startsWith("..") || path.isAbsolute(relFromProject)) {
      return NextResponse.json({ error: "Path is not within the workspace." }, { status: 400 });
    }
    void mediaRoot;

    const contentType = contentTypeForPath(normalized);
    const isVideo = contentType.startsWith("video/");

    if (isVideo) {
      return await serveVideoWithRange(request, underProject, contentType);
    }

    const fileStat = await stat(underProject);
    const stream = Readable.toWeb(createReadStream(underProject)) as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileStat.size.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status =
      error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status },
    );
  }
}

async function serveVideoWithRange(request: Request, absolutePath: string, contentType: string) {
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
            "Cache-Control": "no-store",
          },
        });
      } finally {
        await handle.close();
      }
    }
  }

  const nodeStream = createReadStream(absolutePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": total.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
