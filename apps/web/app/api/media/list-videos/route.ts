import { NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { getMediaRoot } from "@/lib/server/media-service";

export const runtime = "nodejs";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".ts", ".m3u8"]);

async function scanForVideos(dir: string, prefix: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(relativePath);
      } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const nested = await scanForVideos(fullPath, relativePath);
        results.push(...nested);
      }
    }
  } catch {
    // directory doesn't exist yet
  }
  return results;
}

export async function GET() {
  try {
    const mediaRoot = getMediaRoot();
    const inputDir = path.join(mediaRoot, "input");
    const downloadsDir = path.join(mediaRoot, "input", "downloads");

    const [inputVideos, downloadVideos] = await Promise.all([
      scanForVideos(inputDir, "input"),
      scanForVideos(downloadsDir, "input/downloads"),
    ]);

    // Deduplicate and sort by modification time (newest first)
    const allPaths = [...new Set([...inputVideos, ...downloadVideos])];

    return NextResponse.json({ videos: allPaths });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list videos" }, { status: 500 });
  }
}
