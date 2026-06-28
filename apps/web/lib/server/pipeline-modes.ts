import type { ClipCandidate, TwitchClipReference } from "@/lib/mock-candidates";
import type { YtDlpMetadata } from "@/lib/server/yt-dlp-service";
import { downloadSectionWithYtDlp } from "@/lib/server/yt-dlp-service";
import { createHelixClip, extractVodIdFromUrl, buildVodTimestampUrl, type HelixClipResult } from "@/lib/server/twitch-helix-service";
import { createLimiter } from "@/lib/concurrency";
import type { ArchiveProgressEvent } from "@/lib/server/archive-analysis-service";

export type PipelineModeContext = {
  url: string;
  metadata: YtDlpMetadata;
  candidates: ClipCandidate[];
  emitProgress: (event: ArchiveProgressEvent) => void;
  signal?: AbortSignal;
};

export function parseTimecodeToSeconds(tc: string): number {
  const parts = tc.split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

export function generateVodTimestampUrls(ctx: PipelineModeContext): ClipCandidate[] {
  const vodId = extractVodIdFromUrl(ctx.metadata.webpageUrl ?? ctx.url);
  if (!vodId) return ctx.candidates;

  return ctx.candidates.map((c) => {
    const variant = c.variants.find((v) => v.id === c.selectedVariantId) ?? c.variants[0];
    if (!variant) return c;
    const startSeconds = parseTimecodeToSeconds(variant.start);
    const url = buildVodTimestampUrl(vodId, startSeconds);
    return { ...c, vodTimestampUrl: url };
  });
}

export async function createTwitchClips(
  ctx: PipelineModeContext,
  oauthToken: string,
  clipDuration: number = 60,
): Promise<ClipCandidate[]> {
  const vodId = extractVodIdFromUrl(ctx.metadata.webpageUrl ?? ctx.url);
  if (!vodId) throw new Error("Cannot extract VOD ID from URL.");

  const results: ClipCandidate[] = [];
  const total = ctx.candidates.length;

  for (let i = 0; i < total; i++) {
    const c = ctx.candidates[i];
    const variant = c.variants.find((v) => v.id === c.selectedVariantId) ?? c.variants[0];
    if (!variant) { results.push(c); continue; }

    const startSeconds = parseTimecodeToSeconds(variant.start);
    ctx.emitProgress({
      stage: "clip",
      status: "running",
      message: `Creating Twitch clip ${i + 1}/${total}...`,
      candidateId: c.id,
      candidateIndex: i + 1,
      candidateTotal: total,
    });

    try {
      const clip = await createHelixClip({
        vodId,
        startSeconds,
        duration: clipDuration,
        oauthToken,
      });
      const ref: TwitchClipReference = {
        id: clip.id,
        editUrl: clip.edit_url,
        previewUrl: clip.embed_url,
        embedUrl: clip.embed_url,
        duration: clip.duration,
        createdAt: clip.created_at,
        broadcasterId: clip.broadcaster_id,
      };
      results.push({ ...c, twitchClip: ref });
    } catch (err) {
      results.push(c);
      ctx.emitProgress({
        stage: "clip",
        status: "error",
        message: `Clip creation failed for candidate ${i + 1}: ${err instanceof Error ? err.message : "Unknown error"}`,
        candidateId: c.id,
      });
    }

    // Rate limit: 500ms between API calls
    if (i < total - 1) await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}

export async function downloadSections(
  ctx: PipelineModeContext,
  paddingBefore: number = 5,
  paddingAfter: number = 5,
): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  const limiter = createLimiter(2);
  const total = ctx.candidates.length;

  const tasks = ctx.candidates.map((c, i) => limiter(async () => {
    const variant = c.variants.find((v) => v.id === c.selectedVariantId) ?? c.variants[0];
    if (!variant) return;

    const startSeconds = Math.max(0, parseTimecodeToSeconds(variant.start) - paddingBefore);
    const endSeconds = parseTimecodeToSeconds(variant.start) + parseTimecodeToSeconds(variant.duration) + paddingAfter;

    ctx.emitProgress({
      stage: "download",
      status: "running",
      message: `Downloading section ${i + 1}/${total} (${variant.start} - ${variant.end})...`,
      candidateId: c.id,
      candidateIndex: i + 1,
      candidateTotal: total,
    });

    try {
      const result = await downloadSectionWithYtDlp({
        url: ctx.url,
        startSeconds,
        endSeconds,
        candidateId: c.id,
        signal: ctx.signal,
      });
      paths.set(c.id, result.inputPath);
    } catch (err) {
      ctx.emitProgress({
        stage: "download",
        status: "error",
        message: `Section download failed for candidate ${i + 1}: ${err instanceof Error ? err.message : "Unknown error"}`,
        candidateId: c.id,
      });
    }
  }));

  await Promise.all(tasks);
  return paths;
}
