import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

export async function GET() {
  const results: Record<string, unknown> = {};

  // 1. yt-dlp version & availability
  try {
    const { stdout: verOut } = await execFileAsync("yt-dlp", ["--version"], { timeout: 10_000 });
    results.version = verOut.trim();
    results.available = true;
  } catch {
    results.version = null;
    results.available = false;
    results.error = "yt-dlp not found on PATH";
    return NextResponse.json(results);
  }

  // 2. extractor info
  try {
    const { stdout: extOut } = await execFileAsync("yt-dlp", ["--extractor-descriptions"], { timeout: 10_000 });
    const extractors = extOut.split("\n").filter(l => l.includes("twitch"));
    results.twitchExtractors = extractors;
  } catch {
    results.twitchExtractors = [];
  }

  // 3. format test (dry-run) with youtube (most reliable for testing)
  try {
    const { stdout: fmtOut, stderr: fmtErr } = await execFileAsync("yt-dlp", [
      "--skip-download", "--no-playlist", "-f", "bv*[height<=720]+ba/best",
      "--merge-output-format", "mp4",
      "--print", "format",
      "https://www.youtube.com/watch?v=jNQXAC9IVRw"
    ], { timeout: 15_000 });
    const lines = fmtOut.trim().split("\n").filter(Boolean);
    results.formatTest = {
      ok: true,
      formats: lines.slice(0, 5),
      downloaded: false
    };
  } catch (err) {
    results.formatTest = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // 4. actual small download speed test
  const tmpOut = `/tmp/yt-dlp-diag-${Date.now()}.mp4`;
  try {
    const startTime = Date.now();
    const { stderr: dlErr } = await execFileAsync("yt-dlp", [
      "--no-playlist",
      "--restrict-filenames",
      "--no-mtime",
      "-N", "4",
      "--buffer-size", "32K",
      "--merge-output-format", "mp4",
      "-f", "bv*[height<=720]+ba/best",
      "-o", tmpOut,
      "https://www.youtube.com/watch?v=jNQXAC9IVRw"
    ], { timeout: 30_000 });
    const elapsed = (Date.now() - startTime) / 1000;
    const fileStat = await stat(tmpOut).catch(() => null);
    const sizeMB = fileStat ? (fileStat.size / (1024 * 1024)) : 0;
    results.speedTest = {
      ok: true,
      elapsedSec: elapsed.toFixed(1),
      sizeMB: sizeMB.toFixed(2),
      speedMBs: elapsed > 0 ? (sizeMB / elapsed).toFixed(2) : "N/A"
    };
  } catch (err) {
    results.speedTest = {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }

  // 5. args test — verify yt-dlp accepts our custom args
  try {
    const { stderr: argsErr } = await execFileAsync("yt-dlp", [
      "--skip-download", "--no-playlist", "-N", "4", "--buffer-size", "32K",
      "--print", "id", "https://www.youtube.com/watch?v=jNQXAC9IVRw"
    ], { timeout: 15_000 });
    results.argsValid = { ok: true };
  } catch (err) {
    results.argsValid = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" }
  });
}
