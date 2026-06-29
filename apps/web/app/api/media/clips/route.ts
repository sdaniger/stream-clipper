import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { generateClip, getMediaPaths, type GenerateClipInput } from "@/lib/server/media-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const paths = getMediaPaths();
    const results: Array<{
      id: string;
      title: string;
      streamer: string;
      archiveTitle: string;
      detectedAt: string;
      duration: string;
      confidence: number;
      status: string;
      createdAt: string;
      clipPath: string | null;
      commentBurnedPath: string | null;
    }> = [];

    // Scan packages for saved candidate metadata
    try {
      const packageDirs = await readdir(paths.outputPackagesDir, { withFileTypes: true });
      for (const dir of packageDirs) {
        if (!dir.isDirectory()) continue;
        const metaPath = path.join(paths.outputPackagesDir, dir.name, "metadata.json");
        try {
          const meta = JSON.parse(await readFile(metaPath, "utf-8"));
          const candidateId = meta.candidate?.id || dir.name;
          results.push({
            id: candidateId,
            title: meta.candidate?.title || candidateId,
            streamer: meta.candidate?.streamer || "",
            archiveTitle: meta.candidate?.archiveTitle || "",
            detectedAt: meta.candidate?.detectedAt || "",
            duration: meta.candidate?.duration || "",
            confidence: meta.candidate?.confidence || 0,
            status: meta.candidate?.status || "unknown",
            createdAt: meta.createdAt || "",
            clipPath: meta.packagePath ? `output/packages/${dir.name}` : null,
            commentBurnedPath: null,
          });
        } catch {
          // skip unreadable metadata
        }
      }
    } catch {
      // no packages directory yet
    }

    // Scan clips directory for actual clip files
    const clipFiles = new Map<string, string>();
    try {
      const files = await readdir(paths.outputClipsDir);
      for (const f of files) {
        if (!f.endsWith(".mp4")) continue;
        const candidateId = f.split("_")[0];
        if (candidateId && !clipFiles.has(candidateId)) {
          clipFiles.set(candidateId, `output/clips/${f}`);
        }
      }
    } catch {
      // no clips directory yet
    }

    // Scan clips_with_comments directory for burned clips
    const burnedFiles = new Map<string, string>();
    try {
      const files = await readdir(paths.outputClipsWithCommentsDir);
      for (const f of files) {
        if (!f.endsWith(".mp4")) continue;
        const candidateId = f.split("_")[0];
        if (candidateId) {
          burnedFiles.set(candidateId, `output/clips_with_comments/${f}`);
        }
      }
    } catch {
      // no clips_with_comments directory yet
    }

    // Merge file info into results
    for (const r of results) {
      r.clipPath = clipFiles.get(r.id) || r.clipPath;
      r.commentBurnedPath = burnedFiles.get(r.id) || null;
    }

    // Sort by creation date (newest first)
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ clips: results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list clips" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<GenerateClipInput>;

    if (typeof body.inputPath !== "string") {
      return NextResponse.json({ error: "inputPath must be a string relative to MEDIA_ROOT." }, { status: 400 });
    }

    if (typeof body.candidateId !== "string" || typeof body.variantId !== "string") {
      return NextResponse.json({ error: "candidateId and variantId are required strings." }, { status: 400 });
    }

    if (typeof body.start !== "string" || typeof body.duration !== "string") {
      return NextResponse.json({ error: "start and duration are required time strings." }, { status: 400 });
    }

    if (body.mode && body.mode !== "copy" && body.mode !== "reencode") {
      return NextResponse.json({ error: "mode must be copy or reencode." }, { status: 400 });
    }

    return NextResponse.json(await generateClip(body as GenerateClipInput));
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown clip generation error";
    const status = msg.includes("not found") || msg.includes("was not found") ? 404
      : msg.includes("not available") ? 503
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
