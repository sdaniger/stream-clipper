import { analyzeChatEntries, type ChatAnalysisSummary } from "@/lib/chat-analysis";
import {
  createCommentExportBundle,
  defaultCommentOverlaySettings,
  generateCommentOverlayItems,
  generateCommentsJson,
  generateScrollingCommentsAss
} from "@/lib/comment-overlay";
import type { ClipCandidate, ClipTranscription, GeneratedClipReference, TranscriptSegment } from "@/lib/mock-candidates";
import { generateClip, generateExportPackage, parseTimecode, writeCommentAssets } from "@/lib/server/media-service";
import { proxyJsonRequest } from "@/lib/server/api-proxy";
import { fetchChatWithChatDownloader, type FetchChatDownloaderResult } from "@/lib/server/chat-downloader-service";
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
  const maxCandidates = clampInteger(input.maxCandidates ?? 3, 1, 6);
  const clipMode = input.clipMode ?? "copy";
  const shouldTranscribe = input.transcribe !== false;
  const shouldGeneratePackages = input.generatePackages !== false;
  const warnings: ArchiveAutoAnalyzeWarning[] = [];
  const emitProgress = (event: ArchiveProgressEvent) => { try { onProgress?.(event); } catch { /* client disconnected */ } };

  emitProgress({ stage: "metadata", status: "running", message: "Fetching video metadata via yt-dlp..." });
  const metadata = await extractYtDlpMetadata({ url });
  emitProgress({ stage: "metadata", status: "done", message: `${metadata.title ?? metadata.url}` });

  emitProgress({ stage: "download", status: "running", message: `Downloading video...` });
  const downloadedVideo = await downloadVideoWithYtDlp({
    url,
    format: input.ytDlpFormat,
    onProgress: (p) => {
      emitProgress({ stage: "download", status: "running", message: `Downloading... ${p.percent.toFixed(1)}% at ${p.speed}, ETA ${p.eta}` });
    }
  });
  emitProgress({ stage: "download", status: "done", message: `Downloaded ${downloadedVideo.filename}` });

  emitProgress({ stage: "chat", status: "running", message: "Fetching chat..." });
  const fetchedChat = await fetchChatWithChatDownloader({
    url,
    maxMessages: input.maxMessages,
    onProgress: (count) => {
      emitProgress({ stage: "chat", status: "running", message: `Fetching chat... ${count} messages` });
    }
  });
  emitProgress({ stage: "chat", status: "done", message: `Fetched ${fetchedChat.normalizedMessages.length} messages` });

  emitProgress({ stage: "analysis", status: "running", message: "Running rule-based chat analysis..." });
  const analysis = analyzeChatEntries(fetchedChat.normalizedMessages, buildCandidatePrefix(metadata));
  const sourceCandidates = enrichArchiveCandidates(analysis.candidates, metadata).slice(0, maxCandidates);
  emitProgress({ stage: "analysis", status: "done", message: `Found ${sourceCandidates.length} candidates` });

  const candidates: ClipCandidate[] = [];

  for (let candidateIndex = 0; candidateIndex < sourceCandidates.length; candidateIndex += 1) {
    const candidate = sourceCandidates[candidateIndex];
    const selectedVariant = candidate.variants.find((variant) => variant.id === candidate.selectedVariantId) ?? candidate.variants[0];
    let generatedCandidate = candidate;
    let generatedClip: GeneratedClipReference | undefined;
    let transcription: ClipTranscription | undefined;

    if (!selectedVariant) {
      warnings.push({ stage: "clip", candidateId: candidate.id, message: "Candidate has no variant to clip." });
      candidates.push(generatedCandidate);
      continue;
    }

    const clipDurationSeconds = parseTimecode(selectedVariant.duration, "clip duration");
    const clipStartTime = Date.now();
    emitProgress({ stage: "clip", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: `Generating clip for candidate ${candidateIndex + 1}/${sourceCandidates.length}...` });
    try {
      generatedClip = await generateClip({
        inputPath: downloadedVideo.inputPath,
        candidateId: candidate.id,
        variantId: selectedVariant.id,
        start: selectedVariant.start,
        duration: selectedVariant.duration,
        mode: clipMode,
        onProgress: (ffmpegProgress) => {
          const elapsed = Math.round((Date.now() - clipStartTime) / 1000);
          const eta = Math.round(ffmpegProgress.etaSeconds);
          const pct = Math.round(ffmpegProgress.percent);
          emitProgress({ stage: "clip", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: `Clip ${candidateIndex + 1}/${sourceCandidates.length} — ${pct}% done, ETA ${eta}s (elapsed ${elapsed}s)` });
        }
      });
      generatedCandidate = { ...generatedCandidate, generatedClip };
      const totalElapsed = Math.round((Date.now() - clipStartTime) / 1000);
      emitProgress({ stage: "clip", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: `Clip generated in ${totalElapsed}s` });
    } catch (error) {
      warnings.push({ stage: "clip", candidateId: candidate.id, message: errorMessage(error, "Could not generate FFmpeg clip.") });
      emitProgress({ stage: "clip", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: errorMessage(error, "Clip generation failed") });
    }

    if (generatedClip && shouldTranscribe) {
      emitProgress({ stage: "transcription", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: `Transcribing clip...` });
      try {
        transcription = await transcribeClip(generatedClip.outputPath, input);
        generatedCandidate = applyTranscription(generatedCandidate, transcription);
        emitProgress({ stage: "transcription", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: `Transcribed ${transcription.segments.length} segments` });
      } catch (error) {
        warnings.push({ stage: "transcription", candidateId: candidate.id, message: errorMessage(error, "Could not transcribe generated clip.") });
        emitProgress({ stage: "transcription", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: errorMessage(error, "Transcription failed") });
      }
    }

    emitProgress({ stage: "comments", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: `Generating comment JSON/ASS assets...` });
    try {
      const commentAssets = await generateCandidateCommentAssets(generatedCandidate, selectedVariant.duration);
      generatedCandidate = { ...generatedCandidate, commentAssets };
      emitProgress({ stage: "comments", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: `Comment assets generated` });
    } catch (error) {
      warnings.push({ stage: "comments", candidateId: candidate.id, message: errorMessage(error, "Could not generate comment assets.") });
      emitProgress({ stage: "comments", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: errorMessage(error, "Comment asset generation failed") });
    }

    if (shouldGeneratePackages) {
      emitProgress({ stage: "package", status: "running", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: `Generating editor package...` });
      try {
        const commentBundle = buildCommentBundle(generatedCandidate, selectedVariant.duration);
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
        emitProgress({ stage: "package", status: "done", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: `Package generated` });
      } catch (error) {
        warnings.push({ stage: "package", candidateId: candidate.id, message: errorMessage(error, "Could not generate editor package.") });
        emitProgress({ stage: "package", status: "error", candidateId: candidate.id, candidateIndex: candidateIndex + 1, candidateTotal: sourceCandidates.length, message: errorMessage(error, "Package generation failed") });
      }
    }

    candidates.push(generatedCandidate);
  }

  emitProgress({ stage: "comments", status: "done", message: "Pipeline complete" });

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

async function generateCandidateCommentAssets(candidate: ClipCandidate, duration: string) {
  const bundle = buildCommentBundle(candidate, duration);
  return writeCommentAssets({
    candidateId: candidate.id,
    jsonContent: generateCommentsJson(bundle),
    assContent: generateScrollingCommentsAss(bundle),
    jsonFileName: bundle.files.jsonFileName,
    assFileName: bundle.files.assFileName
  });
}

function buildCommentBundle(candidate: ClipCandidate, duration: string) {
  const durationSeconds = Math.max(1, parseTimecode(duration, "comment duration"));
  const comments = generateCommentOverlayItems(candidate, durationSeconds);

  return createCommentExportBundle({
    candidate,
    comments,
    settings: defaultCommentOverlaySettings,
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
  const sourceId = metadata.extractor && metadata.id ? `${metadata.extractor}-${metadata.id}` : metadata.id ?? `archive-${Date.now()}`;
  return `archive-${sourceId}`.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
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
