import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { burnCommentsIntoClip, getMediaRoot, probeVideo } from "@/lib/server/media-service";
import { downloadSectionWithYtDlp } from "@/lib/server/yt-dlp-service";
import { fetchChatWithChatDownloader } from "@/lib/server/chat-downloader-service";
import {
  generateCommentOverlayItemsFromChat,
  createCommentExportPayload,
  generateScrollingCommentsAss,
  defaultCommentOverlaySettings,
} from "@/lib/comment-overlay";
import type { CommentOverlaySettings } from "@/types/comment-overlay";
import type { ClipCandidate } from "@/lib/mock-candidates";
import type { ChatLogEntry } from "@/lib/chat-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualClipInput = {
  url: string;
  startSeconds: number;
  durationSeconds: number;
  commentSettings?: Partial<CommentOverlaySettings>;
  encoder?: "libx264" | "h264_nvenc" | "hevc_nvenc" | "libx265";
  normalizeAudio?: boolean;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ManualClipInput>;

    if (typeof body.url !== "string" || !body.url.trim()) {
      return NextResponse.json({ error: "url is required." }, { status: 400 });
    }
    if (typeof body.startSeconds !== "number" || body.startSeconds < 0) {
      return NextResponse.json({ error: "startSeconds must be a non-negative number." }, { status: 400 });
    }
    if (typeof body.durationSeconds !== "number" || body.durationSeconds <= 0) {
      return NextResponse.json({ error: "durationSeconds must be a positive number." }, { status: 400 });
    }

    const url = body.url.trim();
    const startSeconds = body.startSeconds;
    const durationSeconds = body.durationSeconds;
    const endSeconds = startSeconds + durationSeconds;
    const settings: CommentOverlaySettings = { ...defaultCommentOverlaySettings, ...body.commentSettings };

    // 1. Download only the specified section
    const downloadResult = await downloadSectionWithYtDlp({
      url,
      startSeconds,
      endSeconds,
      candidateId: `manual-${Date.now()}`,
      signal: request.signal,
    });

    // 2. Try loading comments from VOD-level cache before fetching
    let chatMessages: ChatLogEntry[] = [];
    const videoIdMatch = url.match(/\/videos?\/(\d+)/);
    const videoId = videoIdMatch?.[1] ?? url.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 60);
    const cacheFilePath = path.join(getMediaRoot(), "cache", "comments", `${videoId}.rechat.json`);

    try {
      const cacheContent = await readFile(cacheFilePath, "utf8");
      chatMessages = JSON.parse(cacheContent);
    } catch {
      // Cache miss — fetch from Twitch
      try {
        const chatResult = await fetchChatWithChatDownloader({
          url,
          maxMessages: 50_000,
          signal: request.signal,
        });
        chatMessages = chatResult.normalizedMessages;
        // Save to cache for future use
        try {
          const { mkdir: mkdirFs, writeFile: writeFileFs } = await import("node:fs/promises");
          const cacheDir = path.join(getMediaRoot(), "cache", "comments");
          await mkdirFs(cacheDir, { recursive: true });
          await writeFileFs(cacheFilePath, JSON.stringify(chatMessages, null, 2) + "\n", "utf8");
        } catch {
          // Cache write is non-fatal
        }
      } catch {
        // Chat fetch failed — continue without comments
      }
    }

    // 3. Filter chat to the time range and normalize to 0-based
    const filteredMessages = chatMessages
      .filter((msg) => msg.timestamp_seconds >= startSeconds && msg.timestamp_seconds <= endSeconds)
      .map((msg) => ({
        ...msg,
        timestamp_seconds: msg.timestamp_seconds - startSeconds,
      }));

    // Probe the downloaded section for accurate dimensions
    let width = 1920;
    let height = 1080;
    try {
      const probe = await probeVideo(downloadResult.inputPath);
      width = probe?.video?.width ?? 1920;
      height = probe?.video?.height ?? 1080;
    } catch {
      // Use defaults
    }

    const candidateId = `manual-${Date.now()}`;

    if (filteredMessages.length === 0) {
      // No chat in this range — generate clip without comments
      const result = await burnCommentsIntoClip({
        clipPath: downloadResult.inputPath,
        candidateId,
        assContent: generateEmptyAss(),
        assFileName: "empty.ass",
        encoder: body.encoder,
        normalizeAudio: body.normalizeAudio,
      });
      return NextResponse.json({
        ...result,
        chatMessageCount: 0,
        warning: "No chat messages found in the specified time range. Clip generated without comments.",
      });
    }

    // 4. Generate ASS overlay from filtered chat
    const dummyCandidate = {
      id: candidateId,
      title: `Manual clip ${startSeconds}s`,
      confidence: 100,
      detectedAt: "00:00",
      duration: `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, "0")}`,
      tags: [],
      warnings: [],
      transcript: [],
      transcriptSegments: [],
      summary: "",
      notes: { editPlan: "", uploadText: "", titleIdea: "", thumbnailIdea: "" },
      representativeComments: [],
      variants: [],
    } as unknown as ClipCandidate;

    const overlayItems = generateCommentOverlayItemsFromChat(
      dummyCandidate,
      filteredMessages,
      0,
      durationSeconds,
      settings,
    );

    const payload = createCommentExportPayload({
      candidate: dummyCandidate,
      comments: overlayItems,
      settings,
      duration: durationSeconds,
      width,
      height,
    });

    const assContent = generateScrollingCommentsAss(payload);

    // 5. Burn comments into the clip
    const result = await burnCommentsIntoClip({
      clipPath: downloadResult.inputPath,
      candidateId,
      assContent,
      assFileName: `${candidateId}-comments.ass`,
      encoder: body.encoder,
      normalizeAudio: body.normalizeAudio,
    });

    return NextResponse.json({
      ...result,
      chatMessageCount: filteredMessages.length,
      overlayItemCount: overlayItems.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown manual clip error";
    const status = msg.includes("not found") ? 404
      : msg.includes("not available") ? 503
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

function generateEmptyAss(): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: NicoComment,Noto Sans JP,52,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,3,7,20,20,30,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n") + "\n";
}
