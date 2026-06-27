"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { ClipCandidate, ClipTranscription, GeneratedClipReference, TranscriptSegment } from "@/lib/mock-candidates";
import { cn } from "@/lib/utils";

type ToolStatus = {
  available: boolean;
  command: string;
  version?: string;
  error?: string;
};

type MediaRuntimeStatus = {
  mediaRoot: string;
  inputDir: string;
  outputClipsDir: string;
  outputCommentAssDir: string;
  outputClipsWithCommentsDir: string;
  outputChatLogsDir: string;
  outputPackagesDir: string;
  outputThumbnailsDir: string;
  ffmpeg: ToolStatus;
  ffprobe: ToolStatus;
  ytDlp: ToolStatus;
};

type VideoMetadata = {
  inputPath: string;
  absolutePath: string;
  filename: string;
  sizeBytes: number;
  durationSeconds: number | null;
  duration: string | null;
  formatName: string | null;
  bitrate: number | null;
  video: {
    codec: string | null;
    width: number | null;
    height: number | null;
    fps: number | null;
  } | null;
  audio: {
    codec: string | null;
    sampleRate: number | null;
    channels: number | null;
  } | null;
};

type GeneratedClip = {
  inputPath: string;
  outputPath: string;
  absoluteOutputPath: string;
  start: string;
  duration: string;
  mode: "copy" | "reencode";
  commandPreview: string;
};

type YtDlpMetadata = {
  source: "yt_dlp_url";
  url: string;
  id: string | null;
  title: string | null;
  uploader: string | null;
  durationSeconds: number | null;
  duration: string | null;
  webpageUrl: string | null;
  thumbnail: string | null;
  extractor: string | null;
  isLive: boolean;
  commandPreview: string;
};

type DownloadedVideo = {
  source: "yt_dlp_url";
  url: string;
  inputPath: string;
  absolutePath: string;
  filename: string;
  metadataPath: string;
  commandPreview: string;
  downloadedAt: string;
  metadata: YtDlpMetadata;
  probe: VideoMetadata;
};

type TranscriptionHealth = {
  available: boolean;
  engine: string;
  default_model: string;
  device: string;
  compute_type: string;
  version?: string | null;
  error?: string | null;
};

type TranscriptionResponseSegment = {
  id: number;
  start: number;
  end: number;
  start_time: string;
  end_time: string;
  text: string;
  avg_logprob?: number | null;
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

type LocalVideoPanelProps = {
  candidates: ClipCandidate[];
  onClipGenerated: (candidateId: string, clip: GeneratedClipReference) => void;
  onTranscriptionComplete: (candidateId: string, transcription: ClipTranscription) => void;
};

export function LocalVideoPanel({ candidates, onClipGenerated, onTranscriptionComplete }: LocalVideoPanelProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputPath, setInputPath] = useState("input/archive.mp4");
  const [status, setStatus] = useState<MediaRuntimeStatus | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState(candidates[0]?.id ?? "");
  const [clipMode, setClipMode] = useState<"copy" | "reencode">("copy");
  const [isChecking, setIsChecking] = useState(false);
  const [isCheckingTranscription, setIsCheckingTranscription] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExtractingUrlMetadata, setIsExtractingUrlMetadata] = useState(false);
  const [isDownloadingUrl, setIsDownloadingUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlImportError, setUrlImportError] = useState<string | null>(null);
  const [generatedClip, setGeneratedClip] = useState<GeneratedClip | null>(null);
  const [generatedClipCandidateId, setGeneratedClipCandidateId] = useState<string | null>(null);
  const [transcriptionHealth, setTranscriptionHealth] = useState<TranscriptionHealth | null>(null);
  const [modelName, setModelName] = useState("small");
  const [language, setLanguage] = useState("");
  const [lastTranscript, setLastTranscript] = useState<ClipTranscription | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [ytDlpFormat, setYtDlpFormat] = useState("bv*+ba/best");
  const [urlMetadata, setUrlMetadata] = useState<YtDlpMetadata | null>(null);
  const [downloadedVideo, setDownloadedVideo] = useState<DownloadedVideo | null>(null);

  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId) ?? candidates[0];
  const selectedVariant = selectedCandidate?.variants.find((variant) => variant.id === selectedCandidate.selectedVariantId) ?? selectedCandidate?.variants[0];
  const activeGeneratedClip = generatedClipCandidateId === selectedCandidate?.id ? generatedClip : selectedCandidate?.generatedClip;

  useEffect(() => {
    if (!selectedCandidateId && candidates[0]) {
      setSelectedCandidateId(candidates[0].id);
    }
  }, [candidates, selectedCandidateId]);

  async function refreshStatus() {
    setIsChecking(true);
    setError(null);

    try {
      const response = await fetch("/api/media/status");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiError(data, "Could not check media runtime."));
      }

      setStatus(data as MediaRuntimeStatus);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not check media runtime.");
    } finally {
      setIsChecking(false);
    }
  }

  async function refreshTranscriptionHealth() {
    setIsCheckingTranscription(true);
    setError(null);

    try {
      const response = await fetch("/api/transcription/health");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiError(data, "Could not check transcription runtime."));
      }

      setTranscriptionHealth(data as TranscriptionHealth);
      if (typeof data.default_model === "string") {
        setModelName(data.default_model);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not check transcription runtime.");
    } finally {
      setIsCheckingTranscription(false);
    }
  }

  async function probeInput() {
    setIsProbing(true);
    setError(null);
    setGeneratedClip(null);
    setGeneratedClipCandidateId(null);

    try {
      const response = await fetch("/api/media/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputPath })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiError(data, "Could not probe input video."));
      }

      setMetadata(data as VideoMetadata);
    } catch (caughtError) {
      setMetadata(null);
      setError(caughtError instanceof Error ? caughtError.message : "Could not probe input video.");
    } finally {
      setIsProbing(false);
    }
  }

  async function extractUrlMetadata() {
    setIsExtractingUrlMetadata(true);
    setUrlImportError(null);
    setUrlMetadata(null);

    try {
      const response = await fetch("/api/media/yt-dlp/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoUrl })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiError(data, "Could not extract URL metadata with yt-dlp."));
      }

      setUrlMetadata(data as YtDlpMetadata);
    } catch (caughtError) {
      setUrlImportError(caughtError instanceof Error ? caughtError.message : "Could not extract URL metadata with yt-dlp.");
    } finally {
      setIsExtractingUrlMetadata(false);
    }
  }

  async function downloadUrlVideo() {
    setIsDownloadingUrl(true);
    setUrlImportError(null);
    setDownloadedVideo(null);

    try {
      const response = await fetch("/api/media/yt-dlp/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoUrl, format: ytDlpFormat.trim() || undefined })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiError(data, "Could not download URL video with yt-dlp."));
      }

      const downloaded = data as DownloadedVideo;
      setDownloadedVideo(downloaded);
      setUrlMetadata(downloaded.metadata);
      setInputPath(downloaded.inputPath);
      setMetadata(downloaded.probe);
      setGeneratedClip(null);
      setGeneratedClipCandidateId(null);
    } catch (caughtError) {
      setUrlImportError(caughtError instanceof Error ? caughtError.message : "Could not download URL video with yt-dlp.");
    } finally {
      setIsDownloadingUrl(false);
    }
  }

  async function generateSelectedClip() {
    if (!selectedCandidate || !selectedVariant) {
      setError("Select a candidate with a length variant before generating a clip.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedClip(null);

    try {
      const response = await fetch("/api/media/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputPath,
          candidateId: selectedCandidate.id,
          variantId: selectedVariant.id,
          start: selectedVariant.start,
          duration: selectedVariant.duration,
          mode: clipMode
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiError(data, "Could not generate clip."));
      }

      const clip = data as GeneratedClip;
      setGeneratedClip(clip);
      setGeneratedClipCandidateId(selectedCandidate.id);
      setLastTranscript(null);
      onClipGenerated(selectedCandidate.id, clip);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not generate clip.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function transcribeGeneratedClip() {
    if (!selectedCandidate) {
      setError("Select a candidate before transcribing.");
      return;
    }

    const clip = activeGeneratedClip;
    if (!clip) {
      setError("Generate a clip first, or select a candidate that already has a generated clip.");
      return;
    }

    setIsTranscribing(true);
    setError(null);
    setLastTranscript(null);

    try {
      const response = await fetch("/api/transcription/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_path: clip.outputPath,
          model: modelName.trim() || undefined,
          language: language.trim() || undefined
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiError(data, "Could not transcribe clip."));
      }

      const transcription = mapTranscriptionResponse(data as TranscriptionResponse);
      setLastTranscript(transcription);
      onTranscriptionComplete(selectedCandidate.id, transcription);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not transcribe clip.");
    } finally {
      setIsTranscribing(false);
    }
  }

  return (
    <section className="glass-panel rounded-3xl p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.26em] text-emerald-200/70">{t("media.eyebrow")}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{t("media.title")}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            {t("media.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsExpanded((current) => !current);
            if (!status) {
              void refreshStatus();
            }
            if (!transcriptionHealth) {
              void refreshTranscriptionHealth();
            }
          }}
          className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
        >
          {isExpanded ? t("media.hide") : t("media.open")}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="space-y-5">
            <div className="rounded-3xl border border-sky-300/25 bg-sky-400/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-100/75">{t("media.urlImport")}</p>
              <p className="mt-2 text-sm leading-6 text-sky-100/80">
                {t("media.urlImportDescription")}
              </p>
              <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.45fr]">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-sky-100/75">{t("media.archiveUrl")}</span>
                  <input
                    value={videoUrl}
                    onChange={(event) => {
                      setVideoUrl(event.target.value);
                      setUrlImportError(null);
                    }}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-200/60"
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-sky-100/75">{t("media.ytDlpFormat")}</span>
                  <input
                    value={ytDlpFormat}
                    onChange={(event) => setYtDlpFormat(event.target.value)}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-200/60"
                    placeholder="bv*+ba/best"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={extractUrlMetadata} disabled={isExtractingUrlMetadata || isDownloadingUrl} className="rounded-2xl border border-sky-200/45 bg-sky-300/15 px-4 py-2 text-sm font-semibold text-sky-50 transition hover:bg-sky-300/25 disabled:cursor-not-allowed disabled:opacity-60">
                  {isExtractingUrlMetadata ? t("media.readingMetadata") : t("media.readMetadata")}
                </button>
                <button type="button" onClick={downloadUrlVideo} disabled={isDownloadingUrl || isExtractingUrlMetadata} className="rounded-2xl border border-emerald-200/45 bg-emerald-300/15 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-300/25 disabled:cursor-not-allowed disabled:opacity-60">
                  {isDownloadingUrl ? t("media.downloadingVideo") : t("media.downloadAndRegister")}
                </button>
              </div>
              {urlImportError && <div className="mt-3 rounded-2xl border border-rose-300/35 bg-rose-400/10 p-3 text-sm leading-6 text-rose-100">{urlImportError}</div>}
              {urlMetadata && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <MiniStat label="Title" value={urlMetadata.title ?? t("common.unknown")} />
                  <MiniStat label="Uploader" value={urlMetadata.uploader ?? t("common.unknown")} />
                  <MiniStat label={t("media.duration")} value={urlMetadata.duration ?? t("common.unknown")} />
                  <MiniStat label="Extractor" value={urlMetadata.extractor ?? t("common.unknown")} />
                </div>
              )}
              {downloadedVideo && (
                <div className="mt-3 rounded-2xl border border-emerald-300/35 bg-emerald-400/10 p-3 font-mono text-xs leading-5 text-emerald-100">
                  <p>{`inputPath: ${downloadedVideo.inputPath}`}</p>
                  <p>{`metadata: ${downloadedVideo.metadataPath}`}</p>
                  <p>{`absolute: ${downloadedVideo.absolutePath}`}</p>
                </div>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("media.inputPath")}</span>
                <input
                  value={inputPath}
                  onChange={(event) => setInputPath(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 font-mono text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-200/60 focus:bg-white/[0.09]"
                  placeholder="input/archive.mp4"
                />
              </label>
              <div className="flex items-end gap-2">
                <button type="button" onClick={refreshStatus} disabled={isChecking} className="h-12 rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60">
                  {isChecking ? t("media.checking") : t("media.checkFfmpeg")}
                </button>
                <button type="button" onClick={refreshTranscriptionHealth} disabled={isCheckingTranscription} className="h-12 rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60">
                  {isCheckingTranscription ? t("media.checking") : t("media.checkWhisper")}
                </button>
                <button type="button" onClick={probeInput} disabled={isProbing} className="h-12 rounded-2xl border border-emerald-200/45 bg-emerald-300/15 px-4 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-300/25 disabled:cursor-not-allowed disabled:opacity-60">
                  {isProbing ? t("media.probing") : t("media.probeVideo")}
                </button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("media.candidateVariant")}</span>
                <select
                  value={selectedCandidate?.id ?? ""}
                  onChange={(event) => setSelectedCandidateId(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none focus:border-emerald-200/60"
                >
                  {candidates.map((candidate) => {
                    const variant = candidate.variants.find((item) => item.id === candidate.selectedVariantId) ?? candidate.variants[0];
                    return (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.title} · {variant?.label ?? "No variant"}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("media.generationMode")}</span>
                <select
                  value={clipMode}
                  onChange={(event) => setClipMode(event.target.value as "copy" | "reencode")}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none focus:border-emerald-200/60"
                >
                  <option value="copy">{t("media.copyMode")}</option>
                  <option value="reencode">{t("media.reencodeMode")}</option>
                </select>
              </label>
            </div>

            {selectedCandidate && selectedVariant && (
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("media.selectedRange")}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <MiniStat label={t("media.candidate")} value={selectedCandidate.id} />
                  <MiniStat label={t("media.variant")} value={selectedVariant.label} />
                  <MiniStat label={t("media.start")} value={selectedVariant.start} />
                  <MiniStat label={t("media.duration")} value={selectedVariant.duration} />
                </div>
                <button
                  type="button"
                  onClick={generateSelectedClip}
                  disabled={isGenerating}
                  className="mt-4 rounded-2xl border border-cyan-200/45 bg-cyan-300/15 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGenerating ? t("media.generatingClip") : t("media.generateClip")}
                </button>
              </div>
            )}

            {error && (
              <div className="rounded-2xl border border-rose-300/35 bg-rose-400/10 p-4 text-sm leading-6 text-rose-100">
                {error}
              </div>
            )}

            {activeGeneratedClip && (
              <div className="rounded-3xl border border-emerald-300/35 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">
                <p className="font-semibold text-white">{t("media.clipReady")}</p>
                <p className="mt-2 font-mono">{activeGeneratedClip.outputPath}</p>
                <p className="mt-2 text-emerald-100/80">{t("media.absolutePath")}: {activeGeneratedClip.absoluteOutputPath}</p>
              </div>
            )}

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("media.transcription")}</p>
              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_0.7fr_auto]">
                <label className="block">
                  <span className="mb-2 block text-xs text-slate-500">faster-whisper model</span>
                  <input
                    value={modelName}
                    onChange={(event) => setModelName(event.target.value)}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none focus:border-cyan-200/60"
                    placeholder="small"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs text-slate-500">Language hint</span>
                  <input
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none focus:border-cyan-200/60"
                    placeholder="ja, en, blank auto"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={transcribeGeneratedClip}
                    disabled={isTranscribing}
                    className="h-11 rounded-2xl border border-fuchsia-200/45 bg-fuchsia-300/15 px-4 text-sm font-semibold text-fuchsia-50 transition hover:bg-fuchsia-300/25 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isTranscribing ? t("media.transcribing") : t("media.transcribeClip")}
                  </button>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">Requires the FastAPI backend running on `TRANSCRIPTION_API_BASE_URL` or `http://127.0.0.1:8000`.</p>
            </div>

            {lastTranscript && (
              <div className="rounded-3xl border border-fuchsia-300/35 bg-fuchsia-400/10 p-4 text-sm leading-6 text-fuchsia-100">
                <p className="font-semibold text-white">Transcript saved</p>
                <p className="mt-2">Segments: {lastTranscript.segments.length}</p>
                <p>TXT: {lastTranscript.outputs.txtPath}</p>
                <p>SRT: {lastTranscript.outputs.srtPath}</p>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("media.runtimeStatus")}</h3>
              {status ? (
                <div className="mt-3 space-y-3">
                  <ToolBadge status={status.ffmpeg} />
                  <ToolBadge status={status.ffprobe} />
                  <ToolBadge status={status.ytDlp} />
                  <MiniStat label="MEDIA_ROOT" value={status.mediaRoot} />
                  <MiniStat label="Input directory" value={status.inputDir} />
                  <MiniStat label="Output clips" value={status.outputClipsDir} />
                  <MiniStat label="Chat logs" value={status.outputChatLogsDir} />
                  <MiniStat label="Comment ASS" value={status.outputCommentAssDir} />
                  <MiniStat label="Clips with comments" value={status.outputClipsWithCommentsDir} />
                  <MiniStat label="Packages" value={status.outputPackagesDir} />
                  <MiniStat label="Thumbnails" value={status.outputThumbnailsDir} />
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">{t("media.open")}</p>
              )}
            </div>

            {metadata && (
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("media.metadata")}</h3>
                <div className="mt-3 space-y-3">
                  <MiniStat label="File" value={metadata.filename} />
                  <MiniStat label={t("media.duration")} value={metadata.duration ?? t("common.unknown")} />
                  <MiniStat label="Format" value={metadata.formatName ?? t("common.unknown")} />
                  <MiniStat label="Video" value={metadata.video ? `${metadata.video.codec ?? "?"} · ${metadata.video.width ?? "?"}x${metadata.video.height ?? "?"} · ${metadata.video.fps ?? "?"} fps` : "No video stream"} />
                  <MiniStat label="Audio" value={metadata.audio ? `${metadata.audio.codec ?? "?"} · ${metadata.audio.channels ?? "?"} ch` : "No audio stream"} />
                </div>
              </div>
            )}

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("media.transcriptionStatus")}</h3>
              {transcriptionHealth ? (
                <div className="mt-3 space-y-3">
                  <div className={cn("rounded-2xl border p-3", transcriptionHealth.available ? "border-fuchsia-300/35 bg-fuchsia-400/10 text-fuchsia-100" : "border-rose-300/35 bg-rose-400/10 text-rose-100")}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">{transcriptionHealth.engine}</p>
                      <span className="rounded-full bg-black/20 px-2 py-1 text-xs font-bold">{transcriptionHealth.available ? "Available" : "Missing"}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 opacity-85">{transcriptionHealth.error ?? `model ${transcriptionHealth.default_model} · ${transcriptionHealth.device} · ${transcriptionHealth.compute_type}`}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">Check Whisper to load transcription status.</p>
              )}
            </div>

            <div className="rounded-3xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
              {t("media.streamCopyNote")}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
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

function ToolBadge({ status }: { status: ToolStatus }) {
  return (
    <div className={cn("rounded-2xl border p-3", status.available ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-100" : "border-rose-300/35 bg-rose-400/10 text-rose-100")}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{status.command}</p>
        <span className="rounded-full bg-black/20 px-2 py-1 text-xs font-bold">{status.available ? "Available" : "Missing"}</span>
      </div>
      <p className="mt-2 text-xs leading-5 opacity-85">{status.version ?? status.error}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold leading-5 text-slate-100">{value}</p>
    </div>
  );
}

function readApiError(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    return (data as { error: string }).error;
  }

  return fallback;
}
