import { stat, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      return NextResponse.json({ error: "path query parameter is required." }, { status: 400 });
    }

    const resolved = path.resolve(filePath.trim());
    const ext = path.extname(resolved).toLowerCase();
    const videoExts = [".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"];
    const isVideo = videoExts.includes(ext);

    if (!isVideo) {
      return NextResponse.json({ error: "Not a supported video file." }, { status: 400 });
    }

    const stats = await stat(resolved);
    const total = stats.size;
    const contentType = ext === ".webm" ? "video/webm" : ext === ".mov" ? "video/quicktime" : "video/mp4";
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

        const handle = await open(resolved, "r");
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

    const nodeStream = createReadStream(resolved);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": total.toString(),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status =
      error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status }
    );
  }
}
