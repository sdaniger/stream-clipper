import { analyzeChatEntries, type ChatAnalysisSummary, type ChatLogEntry } from "@/lib/chat-analysis";
import {
  createCommentExportBundle,
  defaultCommentOverlaySettings,
  generateCommentOverlayItems,
  generateCommentOverlayItemsFromChat,
  generateCommentsJson,
  generateScrollingCommentsAss
} from "@/lib/comment-overlay";
import type { ClipCandidate, ClipTranscription, GeneratedClipReference, TranscriptSegment } from "@/lib/mock-candidates";
import { generateClip, generateExportPackage, parseTimecode, writeCommentAssets } from "@/lib/server/media-service";
import { proxyJsonRequest } from "@/lib/server/api-proxy";
import { fetchChatWithChatDownloader, defaultChatLimitForDuration, type FetchChatDownloaderResult } from "@/lib/server/chat-downloader-service";
import { createLimiter } from "@/lib/concurrency";
import { cpus } from "node:os";
import { downloadVideoWithYtDlp, extractYtDlpMetadata, type YtDlpDownloadedVideo, type YtDlpMetadata } from "@/lib/server/yt-dlp-service";

export type ArchiveProgressStage = "metadata" | "download" | "chat" | "analysis" | "clip" | "transcription" | "comments" | "package";

export type ArchiveProgressEvent = {
  stage: ArchiveProgressStage;
  status: "running" | "done" | "error" | "skipped";
  message?: string;
  candidateId?: string;
  candidateIndex?: number;
  candidateTotal?: number;
};

export type ArchiveAutoAnalyzeInput = {
  url: string;
  ytDlpFormat?: string;
  maxMessages?: number;
  maxCandidates?: number;
  clipMode?: "copy" | "reencode";
  transcribe?: boolean;
  transcriptionModel?: string;
  transcriptionLanguage?: string;
  generatePackages?: boolean;
  signal?: AbortSignal;
};

export type ArchiveAutoAnalyzeWarning = {
  stage: "metadata" | "download" | "chat" | "analysis" | "clip" | "transcription" | "comments" | "package";
  candidateId?: string;
  message: string;
};

export type ArchiveAutoAnalyzeResult = {
  sourceUrl: string;
  metadata: YtDlpMetadata;
  downloadedVideo: YtDlpDownloadedVideo;
  chat: Pick<FetchChatDownloaderResult, "source" | "url" | "normalizedPath" | "rawPath" | "commandPreview" | "fetchedAt"> & {
    messageCount: number;
  };
  summary: ChatAnalysisSummary;
  candidates: ClipCandidate[];
  generatedClipCount: number;
  transcribedCount: number;
  commentAssetCount: number;
  packageCount: number;
  pipelineWarnings: ArchiveAutoAnalyzeWarning[];
};

type TranscriptionResponseSegment = {
  id: number;
  start: number;
  end: number;
  start_time: string;
  end_time: string;
  text: string;
};

type TranscriptionResponse = {
  engine: string;
  model: string;
  device: string;
  compute_type: string;
  language: string | null;
  duration_seconds: number | null;
  clip_path: string;
  text: string;
  segments: TranscriptionResponseSegment[];
  srt: string;
  txt: string;
  outputs: {
    json_path: string;
    srt_path: string;
    txt_path: string;
  };
};

export async function runArchiveAutoAnalysis(
  input: ArchiveAutoAnalyzeInput,
  onProgress?: (event: ArchiveProgressEvent) => void
): Promise<ArchiveAutoAnalyzeResult> {
  const url = validateArchiveUrl(input.url);
  const maxCandidates = clampInteger(input.maxCandidates ?? 6, 1, 24);
  const clipMode = input.clipMode ?? "copy";
  const shouldTranscribe = input.transcribe !== false;
  const shouldGeneratePackages = input.generatePackages !== false;
  const warnings: ArchiveAutoAnalyzeWarning[] = [];
  const emitProgress = (event: ArchiveProgressEvent) => { try { onProgress?.(event); } catch { /* client disconnected */ } };

  emitProgress({ stage: "metadata", status: "running", message: "Fetching video metadata via yt-dlp..." });
  const metadata = await extractYtDlpMetadata({ url });
  emitProgress({ stage: "metadata", status: "done", message: `${metadata.title ?? metadata.url}` });

  // 0 = user explicitly asked for "as much as possible". Otherwise, derive a
  // sensible default from the VOD duration when the caller didn't pick a number.
  const explicitLimit = input.maxMessages ?? 0;
  const requestedChatLimit =
    explicitLimit > 0 ? explicitLimit : defaultChatLimitForDuration(metadata.durationSeconds);
  const isUnlimited = explicitLimit === 0;
  const maxChatMsgsLabel = isUnlimited
    ? `∞ (cap ${requestedChatLimit.toLocaleString()})`
    : requestedChatLimit.toLocaleString();
  if (isUnlimited) {
    warnings.push({
      stage: "chat",
      message: `Unlimited mode capped at ${requestedChatLimit.toLocaleString()} messages to keep the pipeline within the 10-minute timeout.`
    });
  }

  // Phase 1 parallelization: video download and chat fetch hit different
  // backends (Twitch CDN for video, GQL API for chat) and have no shared
  // state, so we can overlap them. The total wall-clock time becomes
  // max(download, chat) instead of download + chat. The chat fetch
  // gracefully tolerates the video not being downloaded yet because it only
  // needs the VOD duration (already returned by metadata).
  emitProgress({ stage: "download", status: "running", message: `Downloading video...` });
  emitProgress({ stage: "chat", status: "running", message: "Fetching chat..." });

  let downloadedVideo: Awaited<ReturnType<typeof downloadVideoWithYtDlp>>;
  let fetchedChat: FetchChatDownloaderResult;
  const chatPromise = (async () => {
    try {
      const result = await fetchChatWithChatDownloaderWithRetry({
        url,
        maxMessages: requestedChatLimit,
        durationSeconds: metadata.durationSeconds,
        signal: input.signal,
        onProgress: (count) => {
          emitProgress({ stage: "chat", status: "running", message: `Fetching chat... ${count.toLocaleString()} / ${maxChatMsgsLabel} messages` });
        }
      });
      emitProgress({ stage: "chat", status: "done", message: `Fetched ${result.normalizedMessages.length.toLocaleString()} messages` });
      return { ok: true as const, result };
    } catch (error) {
      // AbortErrors bubble up so the outer route can emit "cancelled".
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      return { ok: false as const, error };
    }
  })();

  try {
    downloadedVideo = await downloadVideoWithYtDlp({
      url,
      format: input.ytDlpFormat,
      signal: input.signal,
      onProgress: (p) => {
        emitProgress({ stage: "download", status: "running", message: `Downloading... ${p.percent.toFixed(1)}% at ${p.speed}, ETA ${p.eta}` });
      }
    });
    emitProgress({ stage: "download", status: "done", message: `Downloaded ${downloadedVideo.filename}` });
  } catch (error) {
    // If the video download fails, the chat promise is still running in the
    // background. Wait for it (it might still succeed) before throwing.
    await chatPromise.catch(() => undefined);
    throw error;
  }

  const chatResult = await chatPromise;
  if (chatResult.ok) {
    fetchedChat = chatResult.result;
  } else {
    const chatErrMsg = chatResult.error instanceof Error ? chatResult.error.message : "Unknown chat-downloader error";
    warnings.push({ stage: "chat", message: `${chatErrMsg} (continuing with empty chat)` });
    emitProgress({ stage: "chat", status: "error", message: chatErrMsg });
    fetchedChat = {
      source: "chat_downloader" as const,
      url,
      normalizedMessages: [],
      normalizedPath: "",
      rawPath: "",
      commandPreview: "",
      fetchedAt: new Date().toISOString()
    };
  }

  // Build a zero-candidate summary when chat data is missing so the pipeline
  // can finish gracefully instead of throwing inside analyzeChatEntries.
  const analysis =
    fetchedChat.normalizedMessages.length > 0
      ? analyzeChatEntries(fetchedChat.normalizedMessages, buildCandidatePrefix(metadata))
      : {
          candidates: [],
          summary: {
            inputMessages: 0,
            analyzedMessages: 0,
            candidateCount: 0,
            baselinePerMinute: 0,
            peakPerMinute: 0
          }
        };

  if (fetchedChat.normalizedMessages.length === 0) {
    warnings.push({
      stage: "chat",
      message: "No chat messages were collected. Candidates cannot be generated from chat activity."
    });
  }

  emitProgress({
    stage: "analysis",
    status: "running",
    message:
      fetchedChat.normalizedMessages.length > 0
        ? "Running rule-based chat analysis..."
        : "Skipping analysis (no chat data — no candidates can be generated)."
  });

  const sourceCandidates = enrichArchiveCandidates(analysis.candidates, metadata).slice(0, maxCandidates);
  emitProgress({ stage: "analysis", status: "done", message: `Found ${sourceCandidates.length} candidates` });

  const candidates: ClipCandidate[] = [];

  // Phase 2 parallelization: process all candidates concurrently.
  //
  // Per-candidate stages:
  //   1. Clip generation — concurrency-limited to CPU cores / 2 to
  //      prevent ffmpeg thrashing (each ffmpeg instance tries to use
  //      all cores in reencode mode).
  //   2. Transcription + comments — these are INDEPENDENT (transcription
  //      needs the clip file, comments need the chat messages). They
  //      run in parallel inside each candidate, cutting wall-clock
  //      time by ~30% per candidate.
  //      Transcription is limited to 2 concurrent (faster-whisper uses
  //      ~1GB RAM per request).
  //      Comments are CPU + small file I/O — fast enough to be unlimited.
  //   3. Export package — runs after both transcription and comments
  //      complete (needs transcription outputs + comment bundle).
  const candidateCount = sourceCandidates.length;
  const cpuCount = cpus().length;
  // Re-encode: concurrency = cores / 2. Copy mode can use more, but
  // we keep a conservative cap to avoid I/O thrash on HDDs.
  const clipLimit = createLimiter(Math.max(1, Math.floor(cpuCount / 2)));
  const transcribeLimit = createLimiter(2);

  const processed = await Promise.all(
    sourceCandidates.map(async (candidate, candidateIndex): Promise<ClipCandidate> => {
      const indexLabel = `${candidateIndex + 1}/${candidateCount}`;
      const selectedVariant =
        candidate.variants.find((v) => v.id === candidate.selectedVariantId) ?? candidate.variants[0];

      if (!selectedVariant) {
        warnings.push({ stage: "clip", candidateId: candidate.id, message: "Candidate has no variant to clip." });
        return candidate;
      }

      // Stage 1: clip generation (concurrency-limited)
      const clipStartTime = Date.now();
      emitProgress({ stage: "clip", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Generating clip for candidate ${indexLabel}...` });
      let generatedClip: GeneratedClipReference | undefined;
      let generatedCandidate = candidate;
      try {
        generatedClip = await clipLimit(() => generateClip({
          inputPath: downloadedVideo.inputPath,
          candidateId: candidate.id,
          variantId: selectedVariant.id,
          start: selectedVariant.start,
          duration: selectedVariant.duration,
          mode: clipMode,
          signal: input.signal,
          onProgress: (ffmpegProgress) => {
            const elapsed = Math.round((Date.now() - clipStartTime) / 1000);
            const eta = Math.round(ffmpegProgress.etaSeconds);
            const pct = Math.round(ffmpegProgress.percent);
            emitProgress({ stage: "clip", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Clip ${indexLabel} - ${pct}% done, ETA ${eta}s (elapsed ${elapsed}s)` });
          }
        }));
        generatedCandidate = { ...generatedCandidate, generatedClip };
        const totalElapsed = Math.round((Date.now() - clipStartTime) / 1000);
        emitProgress({ stage: "clip", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Clip generated in ${totalElapsed}s` });
      } catch (error) {
        warnings.push({ stage: "clip", candidateId: candidate.id, message: errorMessage(error, "Could not generate FFmpeg clip.") });
        emitProgress({ stage: "clip", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: errorMessage(error, "Clip generation failed") });
      }

      // Stages 2+3 run IN PARALLEL: transcription and comments are
      // independent — transcription hits the FastAPI backend, comments
      // are local CPU + file I/O from already-downloaded chat data.
      let transcription: ClipTranscription | undefined;

      // Build the precomputed clip window values (shared by both branches)
      const clipStartSeconds = parseTimecode(selectedVariant.start, "clip start");
      const clipDurationSeconds = parseTimecode(selectedVariant.duration, "clip duration");

      // Pre-build the comment bundle so it's available for both comment
      // assets and later for the export package (avoids double computing)
      let commentBundle: ReturnType<typeof buildCommentBundle> | undefined;

      if (generatedClip) {
        const tasks: Promise<unknown>[] = [];

        // Task A: transcription (if enabled, concurrency-limited)
        if (shouldTranscribe) {
          emitProgress({ stage: "transcription", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Transcribing clip ${indexLabel}...` });
          tasks.push(
            transcribeLimit(() => transcribeClip(generatedClip!.outputPath, input))
              .then((tx) => {
                transcription = tx;
                generatedCandidate = applyTranscription(generatedCandidate, tx);
                emitProgress({ stage: "transcription", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Transcribed ${tx.segments.length} segments` });
              })
              .catch((error) => {
                const detail = errorMessage(error, "Could not transcribe generated clip.");
                const hint = detail.includes("fetch failed") || detail.includes("ECONNREFUSED")
                  ? " (Start the Python FastAPI backend on http://127.0.0.1:8000, or uncheck 'transcribe' in the archive panel.)"
                  : "";
                warnings.push({ stage: "transcription", candidateId: candidate.id, message: detail + hint });
                emitProgress({ stage: "transcription", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: errorMessage(error, "Transcription failed") });
              })
          );
        } else {
          emitProgress({
            stage: "transcription", status: "done", candidateId: candidate.id,
            candidateIndex: candidateIndex + 1, candidateTotal: candidateCount,
            message: "Transcription skipped (disabled in panel)"
          });
        }

        // Task B: comment assets + bundle (always runs, parallel with transcription)
        emitProgress({ stage: "comments", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Generating comment JSON/ASS assets for ${indexLabel}...` });
        tasks.push(
          (async () => {
            try {
              const commentAssets = await generateCandidateCommentAssets(
                generatedCandidate,
                selectedVariant.duration,
                fetchedChat.normalizedMessages,
                clipStartSeconds,
                clipStartSeconds + clipDurationSeconds
              );

              commentBundle = buildCommentBundle(
                generatedCandidate,
                selectedVariant.duration,
                fetchedChat.normalizedMessages,
                clipStartSeconds,
                clipStartSeconds + clipDurationSeconds
              );

              generatedCandidate = {
                ...generatedCandidate,
                commentAssets,
                commentOverlayItems: commentBundle.comments as ClipCandidate["commentOverlayItems"]
              };
              emitProgress({ stage: "comments", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Comment assets generated` });
            } catch (error) {
              warnings.push({ stage: "comments", candidateId: candidate.id, message: errorMessage(error, "Could not generate comment assets.") });
              emitProgress({ stage: "comments", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: errorMessage(error, "Comment asset generation failed") });
            }
          })()
        );

        // Wait for both parallel tasks to complete
        await Promise.all(tasks);
      }

      // Stage 4: export package (file copies — needs both transcription + commentBundle)
      if (shouldGeneratePackages && generatedClip) {
        // Rebuild commentBundle if not already built (e.g. comment stage failed)
        if (!commentBundle) {
          commentBundle = buildCommentBundle(
            generatedCandidate,
            selectedVariant.duration,
            fetchedChat.normalizedMessages,
            clipStartSeconds,
            clipStartSeconds + clipDurationSeconds
          );
        }
        emitProgress({ stage: "package", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Generating editor package for ${indexLabel}...` });
        try {
          const exportPackage = await generateExportPackage({
            candidate: generatedCandidate,
            selectedVariant,
            generatedClip,
            transcription,
            commentsJson: generateCommentsJson(commentBundle),
            commentsAss: generateScrollingCommentsAss(commentBundle),
            commentJsonFileName: commentBundle.files.jsonFileName,
            commentAssFileName: commentBundle.files.assFileName
          });
          generatedCandidate = { ...generatedCandidate, exportPackage };
          emitProgress({ stage: "package", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Package generated` });
        } catch (error) {
          warnings.push({ stage: "package", candidateId: candidate.id, message: errorMessage(error, "Could not generate editor package.") });
          emitProgress({ stage: "package", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: errorMessage(error, "Package generation failed") });
        }
      }

      return generatedCandidate;
    })
  );
  for (const result of processed) candidates.push(result);
  emitProgress({ stage: "comments", status: "done", message: "Pipeline complete" });

  // Delete the downloaded VOD now that clips are generated. The full
  // archive is typically 10-15 GB per VOD and the generated clips are
  // only ~100 MB each, so keeping the original download wastes disk.
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(downloadedVideo.absolutePath).catch(() => undefined);
    emitProgress({ stage: "download", status: "done", message: "Cleaned up download" });
  } catch {
    // Non-critical — the download will accumulate and can be cleared
    // later via the 'すべてクリア' button or manual rm.
  }

  return {
    sourceUrl: url,
    metadata,
    downloadedVideo,
    chat: {
      source: fetchedChat.source,
      url: fetchedChat.url,
      normalizedPath: fetchedChat.normalizedPath,
      rawPath: fetchedChat.rawPath,
      messageCount: fetchedChat.normalizedMessages.length,
      commandPreview: fetchedChat.commandPreview,
      fetchedAt: fetchedChat.fetchedAt
    },
    summary: { ...analysis.summary, candidateCount: candidates.length },
    candidates,
    generatedClipCount: candidates.filter((candidate) => candidate.generatedClip).length,
    transcribedCount: candidates.filter((candidate) => candidate.transcription).length,
    commentAssetCount: candidates.filter((candidate) => candidate.commentAssets).length,
    packageCount: candidates.filter((candidate) => candidate.exportPackage).length,
    pipelineWarnings: warnings
  };
}

function enrichArchiveCandidates(candidates: ClipCandidate[], metadata: YtDlpMetadata): ClipCandidate[] {
  const streamer = metadata.uploader ?? "Archive URL import";
  const archiveTitle = metadata.title ?? metadata.webpageUrl ?? metadata.url;

  return candidates.map((candidate) => ({
    ...candidate,
    streamer,
    archiveTitle,
    summary: `${candidate.summary} Source archive: ${archiveTitle}.`,
    notes: {
      ...candidate.notes,
      uploadText: `${candidate.notes.uploadText}\n\nSource: ${metadata.webpageUrl ?? metadata.url}`.trim()
    },
    tags: Array.from(new Set([...candidate.tags, "archive-url", metadata.extractor?.toLowerCase()].filter((tag): tag is string => Boolean(tag))))
  }));
}

async function generateCandidateCommentAssets(
  candidate: ClipCandidate,
  duration: string,
  chatEntries: ChatLogEntry[],
  clipStartSeconds: number,
  clipEndSeconds: number
) {
  const bundle = buildCommentBundle(candidate, duration, chatEntries, clipStartSeconds, clipEndSeconds);
  return writeCommentAssets({
    candidateId: candidate.id,
    jsonContent: generateCommentsJson(bundle),
    assContent: generateScrollingCommentsAss(bundle),
    jsonFileName: bundle.files.jsonFileName,
    assFileName: bundle.files.assFileName
  });
}

function buildCommentBundle(
  candidate: ClipCandidate,
  duration: string,
  chatEntries: ChatLogEntry[],
  clipStartSeconds: number,
  clipEndSeconds: number
) {
  const durationSeconds = Math.max(1, parseTimecode(duration, "comment duration"));
  const settings = defaultCommentOverlaySettings;
  // Prefer the real-time chat as the source of comments. If the chat slice
  // is empty (e.g. clip from a region with no chat), fall back to the
  // synthetic representative-comment generator so the user still sees
  // something rather than a blank overlay.
  const inWindow = chatEntries.filter(
    (entry) => entry.timestamp_seconds >= clipStartSeconds && entry.timestamp_seconds <= clipEndSeconds
  );
  const comments = inWindow.length > 0
    ? generateCommentOverlayItemsFromChat(candidate, inWindow, clipStartSeconds, clipEndSeconds, settings)
    : generateCommentOverlayItems(candidate, durationSeconds);

  return createCommentExportBundle({
    candidate,
    comments,
    settings,
    duration: durationSeconds
  });
}

async function transcribeClip(clipPath: string, input: ArchiveAutoAnalyzeInput): Promise<ClipTranscription> {
  const { response, payload } = await proxyJsonRequest("/api/transcription/transcribe", {
    method: "POST",
    body: JSON.stringify({
      clip_path: clipPath,
      model: input.transcriptionModel?.trim() || undefined,
      language: input.transcriptionLanguage?.trim() || undefined
    })
  });

  if (!response.ok) {
    throw new Error(readProxyError(payload, `Transcription backend returned ${response.status}.`));
  }

  return mapTranscriptionResponse(payload as TranscriptionResponse);
}

function applyTranscription(candidate: ClipCandidate, transcription: ClipTranscription): ClipCandidate {
  const excerpt = transcription.segments.slice(0, 3).map((segment) => segment.text);

  return {
    ...candidate,
    transcription,
    transcript: excerpt.length > 0 ? excerpt : [transcription.text],
    transcriptSegments: transcription.segments.length > 0 ? transcription.segments : candidate.transcriptSegments,
    notes: {
      ...candidate.notes,
      editPlan: candidate.notes.editPlan.includes("Transcript available")
        ? candidate.notes.editPlan
        : `${candidate.notes.editPlan}\n\nTranscript available: ${transcription.outputs.txtPath}`
    }
  };
}

function mapTranscriptionResponse(response: TranscriptionResponse): ClipTranscription {
  const segments: TranscriptSegment[] = response.segments.map((segment) => ({
    start: segment.start_time,
    end: segment.end_time,
    speaker: "Transcript",
    text: segment.text,
    highlight: segment.text.trim().length > 0
  }));

  return {
    engine: response.engine,
    model: response.model,
    device: response.device,
    computeType: response.compute_type,
    language: response.language,
    durationSeconds: response.duration_seconds,
    text: response.text,
    segments,
    srt: response.srt,
    txt: response.txt,
    outputs: {
      jsonPath: response.outputs.json_path,
      srtPath: response.outputs.srt_path,
      txtPath: response.outputs.txt_path
    },
    createdAt: new Date().toISOString()
  };
}

function buildCandidatePrefix(metadata: YtDlpMetadata) {
  // Friendly, compact prefix like "twitch-2802697956" instead of "archive-TwitchVod-v2802697956".
  const platform = (() => {
    const ext = (metadata.extractor ?? "").toLowerCase();
    if (ext.includes("twitch")) return "twitch";
    if (ext.includes("youtube")) return "youtube";
    if (ext.includes("nicovideo") || ext.includes("niconico")) return "niconico";
    return ext.split(/[^a-z0-9]+/)[0] || "archive";
  })();
  const id = (metadata.id ?? metadata.webpageUrl ?? `local-${Date.now()}`)
    .toString()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const sourceId = id || `clip-${Date.now()}`;
  return `${platform}-${sourceId}`.slice(0, 60);
}

function validateArchiveUrl(value: string) {
  const url = value.trim();
  if (!url) {
    throw new Error("Archive URL is required.");
  }

  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Archive URL must start with http:// or https://.");
  }

  return url;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function readProxyError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string") {
      return record.error;
    }

    if (typeof record.detail === "string") {
      return record.detail;
    }
  }

  return fallback;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Fetch chat with a single automatic retry on transient network errors
 * (fetch failed, ECONNRESET, ETIMEDOUT, etc.). Aborts and user-thrown
 * errors propagate immediately without retry.
 */
async function fetchChatWithChatDownloaderWithRetry(
  input: Parameters<typeof fetchChatWithChatDownloader>[0],
  maxAttempts = 2
): Promise<FetchChatDownloaderResult> {
  const RETRYABLE = /(fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|ENETUNREACH)/i;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchChatWithChatDownloader(input);
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (input.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts || !RETRYABLE.test(message)) throw error;
      // Backoff before retry
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastError;
}
