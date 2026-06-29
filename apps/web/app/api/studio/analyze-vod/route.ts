import { NextRequest } from "next/server";
import { extractYtDlpMetadata } from "@/lib/server/yt-dlp-service";
import { extractVodIdFromUrl } from "@/lib/server/twitch-helix-service";
import { fetchChatWithChatDownloaderWithRetry, defaultChatLimitForDuration } from "@/lib/server/chat-downloader-service";
import {
  buildStudioTimeline,
  generateTopNCandidates,
  type StudioAnalyzeOptions,
} from "@/lib/studio-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      vod_url,
      top_n,
      window: windowSec,
      step,
      min_gap,
      clip_duration,
      clip_offset,
      keyword_weight,
      keywords,
    } = body as {
      vod_url?: string;
      top_n?: number;
      window?: number;
      step?: number;
      min_gap?: number;
      clip_duration?: number;
      clip_offset?: number;
      keyword_weight?: number;
      keywords?: string;
    };

    if (!vod_url) {
      return Response.json({ error: "vod_url is required" }, { status: 400 });
    }

    const videoId = extractVodIdFromUrl(vod_url);
    if (!videoId) {
      return Response.json({ error: "Could not extract video ID from URL" }, { status: 400 });
    }

    let streamClosed = false;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          if (streamClosed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            streamClosed = true;
          }
        };

        try {
          // Phase 1: Metadata
          send({ type: "progress", stage: "metadata", message: "VOD metadata を取得中...", progress: 5 });

          let meta;
          try {
            meta = await extractYtDlpMetadata({ url: vod_url });
          } catch (metaErr: unknown) {
            const msg = metaErr instanceof Error ? metaErr.message : "Unknown error";
            send({ type: "progress", stage: "error", message: `メタデータ取得失敗: ${msg}`, progress: 0 });
            send({
              type: "result",
              ok: false,
              error_code: "METADATA_FETCH_FAILED",
              video_id: videoId,
              title: null,
              duration_seconds: null,
              message: `VOD metadata fetch failed: ${msg}`,
            });
            streamClosed = true;
            controller.close();
            return;
          }

          const title = meta.title ?? "Unknown VOD";
          send({ type: "progress", stage: "metadata_done", message: `VOD: ${title}`, progress: 10 });

          // Phase 2: Chat Fetch (using shared fast fetcher)
          send({ type: "progress", stage: "chat_fetch", message: "Using shared fast Next.js chat fetcher...", progress: 15 });

          let fetched;
          try {
            const maxMessages = body.maxMessages ?? defaultChatLimitForDuration(meta.durationSeconds);
            send({ type: "progress", stage: "chat_fetch", message: `Chat cache miss: fetching...`, progress: 16 });
            fetched = await fetchChatWithChatDownloaderWithRetry({
              url: vod_url,
              maxMessages,
              durationSeconds: meta.durationSeconds,
              signal: request.signal,
              onProgress: (count: number) => {
                send({
                  type: "progress",
                  stage: "chat_fetch",
                  message: `チャット取得中: ${count} messages`,
                  progress: Math.min(16 + (count / maxMessages) * 54, 70),
                });
              },
            });
          } catch (chatErr: unknown) {
            const msg = chatErr instanceof Error ? chatErr.message : "Unknown error";
            send({ type: "progress", stage: "error", message: `チャット取得失敗: ${msg}`, progress: 0 });
            send({
              type: "result",
              ok: false,
              error_code: "CHAT_FETCH_FAILED",
              video_id: videoId,
              title,
              duration_seconds: meta.durationSeconds,
              message: `Chat fetch failed: ${msg}`,
              fallback: { manual_chat_log_supported: true },
            });
            streamClosed = true;
            controller.close();
            return;
          }

          const messageCount = fetched.normalizedMessages.length;
          send({ type: "progress", stage: "chat_done", message: `Chat loaded: ${messageCount} messages`, progress: 75 });

          // Phase 3: Normalization
          send({ type: "progress", stage: "normalize", message: "Normalizing chat messages...", progress: 76 });

          // Phase 4: Analysis with top-N ranking
          send({ type: "progress", stage: "analyze", message: "Generating candidates from chat...", progress: 80 });

          const wSec = windowSec ?? 30;
          const sSec = step ?? 10;
          const parsedKeywords = keywords
            ? keywords.split(",").map((k) => k.trim()).filter(Boolean)
            : [];

          const analyzeOptions: StudioAnalyzeOptions = {
            windowSeconds: wSec,
            topN: top_n ?? 10,
            minGap: min_gap ?? 45,
            step: sSec,
            keywordWeight: keyword_weight ?? 2.0,
            clipDuration: clip_duration ?? 30,
            clipOffset: clip_offset ?? 10,
            keywords: parsedKeywords,
          };

          const timeline = buildStudioTimeline(fetched.normalizedMessages, wSec, sSec, parsedKeywords, analyzeOptions.keywordWeight ?? 2.0);
          const analysisResult = generateTopNCandidates(timeline, fetched.normalizedMessages, analyzeOptions);

          send({
            type: "progress",
            stage: "analyze_done",
            message: `Candidates generated: ${analysisResult.candidates.length}`,
            progress: 95,
          });

          // Phase 5: Complete
          send({ type: "progress", stage: "done", message: `Analysis completed`, progress: 100 });
          send({
            type: "result",
            ok: true,
            video_id: videoId,
            title,
            duration_seconds: meta.durationSeconds,
            chat: {
              source: "shared_nextjs_fast_fetcher",
              message_count: messageCount,
              normalized_count: messageCount,
              cache: "miss",
            },
            analysis: {
              ...analysisResult.diagnostic,
              normalized_chat_count: messageCount,
            },
            candidates: analysisResult.candidates,
            timeline: analysisResult.timeline,
            // Include the full normalized chat so the client can later filter
            // by candidate range for danmaku export.
            normalized_chat: fetched.normalizedMessages.map((m) => ({
              timestamp_seconds: m.timestamp_seconds,
              author_name: m.author_name,
              message: m.message,
            })),
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          if (!streamClosed) {
            try {
              send({
                type: "result",
                ok: false,
                error_code: "INTERNAL_ERROR",
                message: msg,
              });
            } catch {}
          }
        }

        if (!streamClosed) {
          streamClosed = true;
          try { controller.close(); } catch {}
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
