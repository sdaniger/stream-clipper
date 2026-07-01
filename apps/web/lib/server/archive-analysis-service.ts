import { analyzeChatEntries, computeAdaptiveWindowSeconds, secondsToClock, type ChatAnalysisSummary, type ChatLogEntry, type ClipLengthPreset } from "@/lib/chat-analysis";
import {
  createCommentExportBundle,
  defaultCommentOverlaySettings,
  generateCommentOverlayItems,
  generateCommentOverlayItemsFromChat,
  generateCommentsJson,
  generateScrollingCommentsAss
} from "@/lib/comment-overlay";
import type { ClipCandidate, ClipTranscription, GeneratedClipReference, TranscriptSegment } from "@/lib/mock-candidates";
import { burnCommentsIntoClip, formatSeconds, generateClip, generateExportPackage, getMediaRoot, parseTimecode, writeCommentAssets } from "@/lib/server/media-service";
import { proxyJsonRequest } from "@/lib/server/api-proxy";
import { checkBackendHealth, spawnBackend } from "@/lib/server/backend-manager";
import { fetchChatWithChatDownloaderWithRetry, defaultChatLimitForDuration, getCachedChat, setCachedChat, type FetchChatDownloaderResult } from "@/lib/server/chat-downloader-service";
import { createLimiter } from "@/lib/concurrency";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cpus } from "node:os";
import { downloadSectionsParallel, downloadVideoWithYtDlp, extractYtDlpMetadata, type YtDlpDownloadedVideo, type YtDlpMetadata, type YtDlpSectionInput } from "@/lib/server/yt-dlp-service";
import { generateVodTimestampUrls, createTwitchClips, type PipelineModeContext } from "@/lib/server/pipeline-modes";
import type { CommentOverlaySettings } from "@/types/comment-overlay";

export type ArchiveProgressStage = "metadata" | "download" | "chat" | "analysis" | "clip" | "transcription" | "comments" | "burn" | "package" | "links";

export type ArchiveProgressEvent = {
  stage: ArchiveProgressStage;
  status: "running" | "done" | "error" | "skipped";
  message?: string;
  candidateId?: string;
  candidateIndex?: number;
  candidateTotal?: number;
  subProgress?: number;
};

export type ArchiveAutoAnalyzeInput = {
  url: string;
  ytDlpFormat?: string;
  maxMessages?: number;
  maxCandidates?: number;
  clipMode?: "copy" | "reencode";
  /** FFmpeg encoder for clip generation. Defaults to libx264 (CPU). */
  encoder?: "libx264" | "h264_nvenc" | "hevc_nvenc";
  transcribe?: boolean;
  transcriptionModel?: string;
  transcriptionLanguage?: string;
  generatePackages?: boolean;
  /** Start time in seconds for partial VOD analysis. Defaults to 0 (beginning). */
  timeStartSeconds?: number;
  /** End time in seconds for partial VOD analysis. Defaults to end of video. */
  timeEndSeconds?: number;
  /** Bucket window size in seconds. Defaults to adaptive (30/45/60 based on duration). */
  windowSeconds?: number;
  /** Clip length preset — controls variant durations. Defaults to "standard". */
  clipLength?: ClipLengthPreset;
  /** Weight multiplier for keyword/reaction hits in highlight score. Default 1 (current behavior). */
  keywordWeight?: number;
  /** Minimum gap between peak centers for deduplication (seconds). Default: no dedup. */
  minGap?: number;
  /** Pipeline mode: full VOD, VOD timestamp links, Twitch clips, or section downloads. */
  pipelineMode?: "full" | "links" | "clips" | "sections";
  /** Twitch OAuth token for creating clips via Helix API (required for "clips" mode). */
  oauthToken?: string;
  /** Burn scrolling comments (ASS overlay) into the generated clip via FFmpeg. Default: true. */
  burnComments?: boolean;
  /** User comment overlay settings (density, font, filters, etc). */
  commentSettings?: CommentOverlaySettings;
  signal?: AbortSignal;
};

export type ArchiveAutoAnalyzeWarning = {
  stage: "metadata" | "download" | "chat" | "analysis" | "clip" | "transcription" | "comments" | "burn" | "package";
  candidateId?: string;
  message: string;
};

export type ArchiveAutoAnalyzeResult = {
  sourceUrl: string;
  metadata: YtDlpMetadata;
  downloadedVideo: YtDlpDownloadedVideo | null;
  chat: Pick<FetchChatDownloaderResult, "source" | "url" | "normalizedPath" | "rawPath" | "commandPreview" | "fetchedAt"> & {
    messageCount: number;
  };
  summary: ChatAnalysisSummary;
  candidates: ClipCandidate[];
  generatedClipCount: number;
  transcribedCount: number;
  commentAssetCount: number;
  burnedCount: number;
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
  no_speech_prob?: number | null;
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
  let shouldTranscribe = input.transcribe !== false;
  const shouldGeneratePackages = input.generatePackages !== false;
  const pipelineMode = input.pipelineMode ?? "full";
  const warnings: ArchiveAutoAnalyzeWarning[] = [];
  const emitProgress = (event: ArchiveProgressEvent) => { try { onProgress?.(event); } catch { /* client disconnected */ } };

  emitProgress({ stage: "metadata", status: "running", message: "Fetching video metadata via yt-dlp..." });
  const metadata = await extractYtDlpMetadata({ url, signal: input.signal });
  emitProgress({ stage: "metadata", status: "done", message: `${metadata.title ?? metadata.url}` });

  // Compute time range and adaptive window size from metadata.
  const timeStart = Math.max(0, input.timeStartSeconds ?? 0);
  const timeEnd = input.timeEndSeconds ?? metadata.durationSeconds ?? 0;
  const hasTimeRange = timeStart > 0 || (timeEnd > 0 && timeEnd < (metadata.durationSeconds ?? Infinity));
  const windowSec = computeAdaptiveWindowSeconds(
    hasTimeRange ? (timeEnd - timeStart) : metadata.durationSeconds,
    input.windowSeconds
  );

  // 0 = user explicitly asked for "as much as possible". Otherwise, derive a
  // sensible default from the VOD duration when the caller didn't pick a number.
  const explicitLimit = input.maxMessages ?? 0;
  const limitDuration = hasTimeRange ? (timeEnd - timeStart) : metadata.durationSeconds;
  const requestedChatLimit =
    explicitLimit > 0 ? explicitLimit : defaultChatLimitForDuration(limitDuration);
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
  //
  // In "full" mode the entire VOD is downloaded now (Phase 1).
  // In "sections" mode the download is DEFERRED until after analysis so we
  // know which time ranges to fetch. Only the needed sections are
  // downloaded, in parallel (Phase 1.5 below).
  const needsFullDownload = pipelineMode === "full";
  const needsSectionDownload = pipelineMode === "sections";
  emitProgress({ stage: "download", status: needsFullDownload ? "running" : needsSectionDownload ? "skipped" : "skipped", message: needsFullDownload ? `Downloading video...` : needsSectionDownload ? `Download deferred (sections mode — will fetch after analysis)` : `Download skipped (${pipelineMode} mode)` });
  emitProgress({ stage: "chat", status: "running", message: "Fetching chat..." });

  let downloadedVideo: Awaited<ReturnType<typeof downloadVideoWithYtDlp>> | null = null;
  let fetchedChat!: FetchChatDownloaderResult;
  // Check cache (in-memory LRU first, then filesystem) before fetching
  const videoId = metadata.id ?? url.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 60);

  const cachedChatMessages = await getCachedChat(videoId);

  const chatPromise = (async () => {
    if (cachedChatMessages && cachedChatMessages.length > 0) {
      emitProgress({ stage: "chat", status: "done", message: `Loaded ${cachedChatMessages.length.toLocaleString()} messages from cache` });
      return {
        ok: true as const,
        result: {
          source: "chat_downloader" as const,
          url,
          normalizedMessages: cachedChatMessages,
          normalizedPath: "",
          rawPath: "",
          commandPreview: "cached",
          fetchedAt: new Date().toISOString()
        } satisfies FetchChatDownloaderResult
      };
    }
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
      // Save to cache (in-memory LRU + filesystem compact JSON)
      setCachedChat(videoId, result.normalizedMessages).catch(() => {});
      emitProgress({ stage: "chat", status: "done", message: `Fetched ${result.normalizedMessages.length.toLocaleString()} messages` });
      return { ok: true as const, result };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      return { ok: false as const, error };
    }
  })();

  if (needsFullDownload) {
    try {
      downloadedVideo = await downloadVideoWithYtDlp({
        url,
        format: input.ytDlpFormat,
        prefetchedMetadata: metadata,
        timeStartSeconds: hasTimeRange ? timeStart : undefined,
        timeEndSeconds: hasTimeRange ? timeEnd : undefined,
        signal: input.signal,
        onProgress: (p) => {
          emitProgress({ stage: "download", status: "running", message: `Downloading... ${p.percent.toFixed(1)}% at ${p.speed}, ETA ${p.eta}` });
        }
      });
      emitProgress({ stage: "download", status: "done", message: `Downloaded ${downloadedVideo.filename}` });
    } catch (error) {
      await chatPromise.catch(() => undefined);
      throw error;
    }
  } else {
    emitProgress({ stage: "download", status: "skipped", message: `Download skipped (${pipelineMode} mode)` });
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

  // Expose fetched/cached chat messages to candidate processing for ASS
  // generation. If chat fetch failed, this will be an empty array.
  const cachedComments: ChatLogEntry[] = fetchedChat.normalizedMessages;

  // Filter chat messages to the selected time range (if specified).
  const filteredChat = hasTimeRange
    ? fetchedChat.normalizedMessages.filter(
        (msg) => msg.timestamp_seconds >= timeStart && msg.timestamp_seconds <= timeEnd
      )
    : fetchedChat.normalizedMessages;

  // Build a zero-candidate summary when chat data is missing so the pipeline
  // can finish gracefully instead of throwing inside analyzeChatEntries.
  const analysis =
    filteredChat.length > 0
      ? analyzeChatEntries(filteredChat, buildCandidatePrefix(metadata), { windowSeconds: windowSec, clipLength: input.clipLength, keywordWeight: input.keywordWeight, minGap: input.minGap })
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

  if (filteredChat.length === 0) {
    warnings.push({
      stage: "chat",
      message: "No chat messages were collected in the selected time range. Candidates cannot be generated from chat activity."
    });
  }

  emitProgress({
    stage: "analysis",
    status: "running",
    message:
      filteredChat.length > 0
        ? `Running rule-based chat analysis (${hasTimeRange ? `time range ${secondsToClock(timeStart)}-${secondsToClock(timeEnd)}, ` : ""}window ${windowSec}s)...`
        : "Skipping analysis (no chat data — no candidates can be generated)."
  });

  const sourceCandidates = enrichArchiveCandidates(analysis.candidates, metadata).slice(0, maxCandidates);
  emitProgress({ stage: "analysis", status: "done", message: `Found ${sourceCandidates.length} candidates` });

  // Pipeline mode branching: apply mode-specific processing after analysis.
  const modeContext: PipelineModeContext = {
    url,
    metadata,
    candidates: sourceCandidates,
    emitProgress,
    signal: input.signal,
  };

  if (pipelineMode === "links") {
    // Links mode: add VOD timestamp URLs to candidates, skip clip generation.
    emitProgress({ stage: "links", status: "running", message: "Generating VOD timestamp links..." });
    const linkedCandidates = generateVodTimestampUrls(modeContext);
    emitProgress({ stage: "links", status: "done", message: `Generated ${linkedCandidates.length} VOD timestamp links` });

    // Build lightweight candidates without clip generation.
    const candidates: ClipCandidate[] = [];
    for (const c of linkedCandidates) {
      candidates.push(c);
    }

    return {
      sourceUrl: url,
      metadata,
      downloadedVideo,
      chat: { source: fetchedChat.source, url: fetchedChat.url, normalizedPath: fetchedChat.normalizedPath, rawPath: fetchedChat.rawPath, messageCount: fetchedChat.normalizedMessages.length, commandPreview: fetchedChat.commandPreview, fetchedAt: fetchedChat.fetchedAt },
      summary: { ...analysis.summary, candidateCount: candidates.length },
      candidates,
      generatedClipCount: 0,
      transcribedCount: 0,
      commentAssetCount: 0,
      burnedCount: 0,
      packageCount: 0,
      pipelineWarnings: warnings,
    };
  }

  if (pipelineMode === "clips") {
    // Clips mode: create Twitch clips via Helix API, skip local clip generation.
    if (!input.oauthToken) {
      warnings.push({ stage: "clip", message: "OAuth token is required for Twitch Clips mode. Add TWITCH_OAUTH_TOKEN to .env or paste in the pipeline form." });
      emitProgress({ stage: "clip", status: "error", message: "Missing OAuth token for Twitch Clips mode" });
    } else {
      emitProgress({ stage: "clip", status: "running", message: "Creating Twitch clips via Helix API..." });
      try {
        const clipCandidates = await createTwitchClips(modeContext, input.oauthToken);
        emitProgress({ stage: "clip", status: "done", message: `Created ${clipCandidates.filter(c => c.twitchClip).length} Twitch clips` });

        const candidates: ClipCandidate[] = [];
        for (const c of clipCandidates) {
          candidates.push(c);
        }

        return {
          sourceUrl: url,
          metadata,
          downloadedVideo,
          chat: { source: fetchedChat.source, url: fetchedChat.url, normalizedPath: fetchedChat.normalizedPath, rawPath: fetchedChat.rawPath, messageCount: fetchedChat.normalizedMessages.length, commandPreview: fetchedChat.commandPreview, fetchedAt: fetchedChat.fetchedAt },
          summary: { ...analysis.summary, candidateCount: candidates.length },
          candidates,
          generatedClipCount: 0,
          transcribedCount: 0,
          commentAssetCount: 0,
          burnedCount: 0,
          packageCount: 0,
          pipelineWarnings: warnings,
        };
      } catch (error) {
        warnings.push({ stage: "clip", message: `Twitch clip creation failed: ${errorMessage(error, "Unknown error")}` });
        emitProgress({ stage: "clip", status: "error", message: errorMessage(error, "Twitch clip creation failed") });
      }
    }
  }

  // Phase 1.5: Section-mode parallel download.
  // In sections mode we now know which time ranges the candidates occupy.
  // Instead of downloading the full VOD, we fire off parallel yt-dlp
  // processes (one per candidate, capped at 4 concurrent) each with its
  // own --download-sections flag. This is dramatically faster than
  // downloading a multi-hour VOD when only a few minutes are needed.
  let sectionDownloads: Map<string, string> | null = null;
  if (needsSectionDownload && sourceCandidates.length > 0) {
    emitProgress({ stage: "download", status: "running", message: `Downloading ${sourceCandidates.length} sections in parallel...` });
    try {
      const sectionTotal = sourceCandidates.length;
      const sectionInputs: YtDlpSectionInput[] = sourceCandidates.map((c, idx) => {
        const v = c.variants.find((v) => v.id === c.selectedVariantId) ?? c.variants[0];
        const startSec = parseTimecode(v.start, "section start");
        const durationSec = parseTimecode(v.duration, "section duration");
        return {
          url,
          candidateId: c.id,
          startSeconds: startSec,
          endSeconds: startSec + durationSec,
          signal: input.signal,
          onProgress: (p) => {
            emitProgress({ stage: "download", status: "running", message: `Section ${idx + 1}/${sectionTotal} (${c.id}) — ${p.percent.toFixed(1)}% at ${p.speed}, ETA ${p.eta}` });
          },
        };
      });

      // Emit a "starting" event for each section so the UI shows activity
      // even when the download completes before the first progress tick.
      for (let i = 0; i < sectionInputs.length; i++) {
        const s = sectionInputs[i];
        const v = sourceCandidates[i].variants.find((v) => v.id === sourceCandidates[i].selectedVariantId) ?? sourceCandidates[i].variants[0];
        emitProgress({ stage: "download", status: "running", message: `Section ${i + 1}/${sectionTotal} (${s.candidateId}) — starting (${v.start} + ${v.duration})` });
      }

      const sectionResults = await downloadSectionsParallel(sectionInputs, 4, input.signal);
      sectionDownloads = new Map(sectionResults.map((r) => [r.candidateId, r.inputPath]));
      emitProgress({ stage: "download", status: "done", message: `Downloaded ${sectionResults.length} sections` });
    } catch (error) {
      await chatPromise.catch(() => undefined);
      throw error;
    }
  }

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
  const clipLimit = createLimiter(cpuCount);
  // Burn-in re-encodes the entire clip with ASS overlay, so it can use
  // all CPU cores when running in parallel with transcription.
  const burnLimit = createLimiter(cpuCount);
  // Transcription is gated separately because faster-whisper uses ~1GB RAM
  // per request. Limiting to 2 concurrent prevents OOM on the Python backend.
  const transcribeLimit = createLimiter(2);

  // Phase 2 prerequisite: ensure transcription backend is reachable before
  // processing any candidates.  If the backend is unreachable we do not
  // abort the entire pipeline — transcription is simply skipped for all
  // candidates (clips are still generated).
  let backendAvailable = !shouldTranscribe;
  if (shouldTranscribe) {
    const initialHealth = await checkBackendHealth();
    if (!initialHealth.alive) {
      const spawned = await spawnBackend();
      if (spawned) {
        backendAvailable = true;
      } else {
        warnings.push({ stage: "transcription", message: "Python transcription backend is not running and could not be auto-started. Transcription will be skipped for all candidates. Start the backend with: cd apps/api && uvicorn app.main:app --host 127.0.0.1 --port 8000" });
        shouldTranscribe = false;
      }
    } else {
      backendAvailable = true;
    }
  }

  const processed = await Promise.all(
    sourceCandidates.map(async (candidate, candidateIndex): Promise<ClipCandidate> => {
      const indexLabel = `${candidateIndex + 1}/${candidateCount}`;
      const selectedVariant =
        candidate.variants.find((v) => v.id === candidate.selectedVariantId) ?? candidate.variants[0];

      if (!selectedVariant) {
        warnings.push({ stage: "clip", candidateId: candidate.id, message: "Candidate has no variant to clip." });
        return candidate;
      }

      try {

      const clipStartSeconds = parseTimecode(selectedVariant.start, "clip start");
      const clipDurationSeconds = parseTimecode(selectedVariant.duration, "clip duration");

      // Step A: sourceVideoPath acquisition
      // "full" mode: the entire VOD was downloaded in Phase 1 — FFmpeg
      //   extracts each candidate's section locally.
      // "sections" mode: each candidate's section was downloaded in
      //   Phase 1.5 (parallel yt-dlp --download-sections). The section
      //   file IS the candidate's source — no FFmpeg extraction needed.
      let clipInputPath: string;
      let clipStartInSource: number;
      const sectionPath = sectionDownloads?.get(candidate.id);
      if (sectionPath) {
        // Section file was downloaded starting at the variant's start time,
        // so the candidate's clip starts at offset 0 in the section file.
        clipInputPath = sectionPath;
        clipStartInSource = 0;
      } else if (downloadedVideo?.inputPath) {
        clipInputPath = downloadedVideo.inputPath;
        clipStartInSource = clipStartSeconds;
      } else {
        warnings.push({ stage: "clip", candidateId: candidate.id, message: "No downloaded video available for clip generation. Phase 1 download may have failed." });
        return candidate;
      }

      // Step B: clipStartSec / clipDurationSec validation
      if (clipDurationSeconds <= 0) {
        warnings.push({ stage: "clip", candidateId: candidate.id, message: `Invalid clip duration: ${selectedVariant.duration} (${clipDurationSeconds}s)` });
        return candidate;
      }

      // Step C: Generate no-comment mp4
      let generatedClip: GeneratedClipReference | undefined;
      let generatedCandidate: ClipCandidate = { ...candidate, sourceVideoPath: clipInputPath };

      emitProgress({ stage: "clip", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Generating clip for candidate ${indexLabel}...` });
      const clipStartTime = Date.now();
      try {
        generatedClip = await clipLimit(() => generateClip({
          inputPath: clipInputPath,
          candidateId: candidate.id,
          variantId: selectedVariant.id,
          start: formatSeconds(clipStartInSource),
          duration: selectedVariant.duration,
          mode: clipMode,
          encoder: input.encoder,
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
        const detail = errorMessage(error, "Could not generate FFmpeg clip.");
        const clipError = [
          `Clip generation failed for candidate ${candidate.id}:`,
          `  sourceUrl: ${url}`,
          `  sourceVideoPath: ${clipInputPath}`,
          `  variant: ${selectedVariant.start} + ${selectedVariant.duration}`,
          `  error: ${detail}`,
          `  (Transcription and comments will be skipped for this candidate)`
        ].join("\n");
        warnings.push({ stage: "clip", candidateId: candidate.id, message: clipError });
        emitProgress({ stage: "clip", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: errorMessage(error, "Clip generation failed") });
      }

      // Step D: Comment JSON check + ASS generation (optional)
      // Comments are optional — if unavailable, we skip the ASS overlay
      // and produce a clean clip without danmaku.
      let commentsAssStr: string | undefined;
      let commentsJsonStr: string | undefined;
      let commentBundle: ReturnType<typeof createCommentExportBundle> | undefined;

      if (generatedClip && cachedComments && cachedComments.length > 0) {
        try {
          commentBundle = buildCommentBundle(
            generatedCandidate,
            selectedVariant.duration,
            cachedComments,
            clipStartSeconds,
            clipStartSeconds + clipDurationSeconds,
            input.commentSettings
          );
          commentsJsonStr = generateCommentsJson(commentBundle);
          commentsAssStr = generateScrollingCommentsAss(commentBundle);
        } catch (error) {
          warnings.push({ stage: "comments", candidateId: candidate.id, message: `Comment ASS generation failed: ${errorMessage(error, "Unknown error")}. Continuing without comments.` });
        }
      }

      // Step E + Transcription: run in parallel.
      // Both tasks only need the generated clip file and are independent of
      // each other. Running them concurrently cuts wall-clock time per
      // candidate from (burn + transcription) to max(burn, transcription).
      let commentBurnedClip = generatedCandidate.commentBurnedClip;
      let transcription: ClipTranscription | undefined;
      const postClipTasks: Promise<unknown>[] = [];

      // burn-in task
      if (input.burnComments !== false && generatedClip && commentsAssStr && !commentBurnedClip) {
        emitProgress({ stage: "burn", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Burning comments into clip ${indexLabel}...` });
        const burnStartTime = Date.now();
        postClipTasks.push(
          burnLimit(() => burnCommentsIntoClip({
            clipPath: generatedClip!.outputPath,
            candidateId: candidate.id,
            variantId: selectedVariant.id,
            assContent: commentsAssStr!,
            encoder: input.encoder,
          }))
            .then((burned) => {
              commentBurnedClip = burned;
              generatedCandidate = { ...generatedCandidate, commentBurnedClip: burned };
              const burnElapsed = Math.round((Date.now() - burnStartTime) / 1000);
              emitProgress({ stage: "burn", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Comments burned in ${burnElapsed}s` });
            })
            .catch((error) => {
              const burnErr = errorMessage(error, "Could not burn comments into clip.");
              warnings.push({ stage: "burn", candidateId: candidate.id, message: burnErr });
              emitProgress({ stage: "burn", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: errorMessage(error, "Comment burn-in failed") });
            })
        );
      }

      // transcription task
      if (generatedClip && shouldTranscribe) {
        emitProgress({ stage: "transcription", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Transcribing clip ${indexLabel}...` });
        postClipTasks.push(
          transcribeLimit(() => transcribeClip(generatedClip!.outputPath, input))
            .then((tx) => {
              transcription = tx;
              generatedCandidate = applyTranscription(generatedCandidate, tx);
              emitProgress({ stage: "transcription", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Transcribed ${tx.segments.length} segments` });
            })
            .catch((error) => {
              const detail = errorMessage(error, "Could not transcribe generated clip.");
              const hint = detail.includes("fetch failed") || detail.includes("ECONNREFUSED") || detail.includes("ECONNRESET")
                ? " (Start the Python FastAPI backend on http://127.0.0.1:8000, or uncheck 'transcribe' in the archive panel.)"
                : "";
              warnings.push({ stage: "transcription", candidateId: candidate.id, message: detail + hint });
              emitProgress({ stage: "transcription", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: errorMessage(error, "Transcription failed") });
            })
        );
      } else if (generatedClip) {
        emitProgress({ stage: "transcription", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: "Transcription skipped (disabled in panel)" });
      }

      await Promise.all(postClipTasks);

      // Comment assets (writes to disk for export package)
      if (generatedClip && commentBundle) {
        try {
          const commentAssets = await generateCandidateCommentAssets(generatedCandidate, commentBundle);
          generatedCandidate = { ...generatedCandidate, commentAssets, commentOverlayItems: commentBundle.comments as ClipCandidate["commentOverlayItems"] };
          emitProgress({ stage: "comments", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Comment assets generated` });
        } catch (error) {
          warnings.push({ stage: "comments", candidateId: candidate.id, message: errorMessage(error, "Could not generate comment assets.") });
          emitProgress({ stage: "comments", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: errorMessage(error, "Comment asset generation failed") });
        }
      }

      // Export package
      if (shouldGeneratePackages && generatedClip) {
        emitProgress({ stage: "package", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Generating editor package for ${indexLabel}...` });
        try {
          const exportPackage = await generateExportPackage({
            candidate: generatedCandidate,
            selectedVariant,
            generatedClip,
            transcription,
            commentsJson: commentsJsonStr,
            commentsAss: commentsAssStr,
            commentJsonFileName: commentBundle?.files.jsonFileName,
            commentAssFileName: commentBundle?.files.assFileName
          });
          generatedCandidate = { ...generatedCandidate, exportPackage };
          emitProgress({ stage: "package", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: `Package generated` });
        } catch (error) {
          warnings.push({ stage: "package", candidateId: candidate.id, message: errorMessage(error, "Could not generate editor package.") });
          emitProgress({ stage: "package", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: errorMessage(error, "Package generation failed") });
        }
      }

      return generatedCandidate;

      } catch (error) {
        const msg = errorMessage(error, "Unexpected candidate processing error");
        warnings.push({ stage: "clip", candidateId: candidate.id, message: msg });
        emitProgress({ stage: "clip", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: candidateCount, message: errorMessage(error, "Candidate processing failed") });
        return candidate;
      }
    })
  );
  for (const result of processed) candidates.push(result);
  emitProgress({ stage: "comments", status: "done", message: "Pipeline complete" });

  // Delete the downloaded VOD now that clips are generated. The full
  // archive is typically 10-15 GB per VOD. Use fire-and-forget so the
  // HTTP response isn't blocked waiting for the filesystem.
  if (downloadedVideo) {
    import("node:fs/promises").then(({ unlink }) =>
      unlink(downloadedVideo!.absolutePath).catch(() => undefined)
    );
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
    burnedCount: candidates.filter((candidate) => candidate.commentBurnedClip).length,
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
  bundle: ReturnType<typeof createCommentExportBundle>
) {
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
  clipEndSeconds: number,
  userSettings?: CommentOverlaySettings
) {
  const durationSeconds = Math.max(1, parseTimecode(duration, "comment duration"));
  const settings = userSettings ?? defaultCommentOverlaySettings;
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
  const MAX_RETRIES = 1;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { response, payload } = await proxyJsonRequest("/api/transcription/transcribe", {
        method: "POST",
        body: JSON.stringify({
          clip_path: clipPath,
          model: input.transcriptionModel?.trim() || undefined,
          language: input.transcriptionLanguage?.trim() || undefined
        }),
        timeoutMs: 5 * 60 * 1000,
        signal: input.signal
      });

      if (!response.ok) {
        throw new Error(readProxyError(payload, `Transcription backend returned ${response.status}.`));
      }

      return mapTranscriptionResponse(payload as TranscriptionResponse);
    } catch (error) {
      const isConnectionError = error instanceof Error && (
        error.message.includes("fetch failed") ||
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("ECONNRESET") ||
        error.message.includes("ENOTFOUND") ||
        error.message.includes("network") ||
        (error instanceof DOMException && error.name === "AbortError") ||
        error.message.includes("aborted") ||
        error.message.includes("timeout")
      );

      if (!isConnectionError || attempt >= MAX_RETRIES) {
        throw error;
      }

      // Attempt to restart the backend before retrying
      if (attempt === 0) {
        await spawnBackend();
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const health = await checkBackendHealth();
          if (health.alive) break;
        }
      }
    }
  }

  throw new Error("Transcription failed after retries.");
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
    highlight: segment.text.trim().length > 10 && (segment.no_speech_prob == null || segment.no_speech_prob < 0.5)
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


