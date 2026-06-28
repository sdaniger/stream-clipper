import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { getMediaRoot } from "@/lib/server/media-service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);

function resolvePath(relativePath: string) {
  const normalized = path.posix.normalize(relativePath.trim().replaceAll("\\", "/"));
  if (normalized === "." || normalized.startsWith("../")) {
    throw new Error("Path traversal not allowed.");
  }
  return path.resolve(getMediaRoot(), normalized);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { clipPath?: string; candidateId?: string };

    if (typeof body.clipPath !== "string" || !body.clipPath.trim()) {
      return NextResponse.json({ error: "clipPath is required." }, { status: 400 });
    }

    const absoluteInput = resolvePath(body.clipPath.trim());
    const inputBase = absoluteInput.replace(/\.mp4$/i, "");
    const outputPath = `${inputBase}_cut.mp4`;

    // Narinico defaults: audio threshold 20%, 0.5s margin on each side
    const args = [
      absoluteInput,
      "--edit", "audio:threshold=20%",
      "--margin", "0.5s,0.5sec",
      "--no-open",
      "--output", outputPath
    ];

    const { stderr } = await execFileAsync("auto-editor", args, {
      timeout: 30 * 60_000,
      maxBuffer: 32 * 1024 * 1024
    });

    const lastLine = (stderr || "").split("\n").filter(Boolean).pop() ?? "";
    const isDone = /done|complete|finished/i.test(lastLine);

    return NextResponse.json({
      ok: true,
      inputPath: body.clipPath,
      outputPath: outputPath,
      message: isDone ? "Silence removed successfully." : "Auto-edit completed (see logs)."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown auto-edit error";
    // auto-editor not found
    if (message.includes("ENOENT") || message.includes("not found")) {
      return NextResponse.json({
        ok: false,
        error: "auto-editor is not installed. Run: pip install auto-editor"
      }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Quick check: is auto-editor available on PATH?
 */
export async function GET() {
  try {
    const { stdout } = await execFileAsync("auto-editor", ["--version"], { timeout: 5000 });
    return NextResponse.json({ available: true, version: (stdout || "").trim().split("\n")[0] });
  } catch {
    return NextResponse.json({ available: false, error: "auto-editor not found" });
  }
}
