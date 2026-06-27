import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CommentCanvasOverlay } from "@/components/comment-canvas-overlay";
import {
  createCommentExportPayload,
  defaultCommentOverlaySettings,
  downloadTextFile,
  generateCommentOverlayItems,
  generateCommentsJson,
  generateScrollingCommentsAss
} from "@/lib/comment-overlay";
import { useI18n } from "@/lib/i18n";
import { extractPostingAssets, formatPostingText, type ThumbnailTimestampCandidate } from "@/lib/posting-assets";
import type {
  CandidateStatus,
  CommentBurnedClipReference,
  ClipCandidate,
  ClipCandidateMarker,
  ClipCandidateNotes,
  ClipCandidateVariant,
  ExportPackageReference,
  CandidateWarning,
  RepresentativeComment,
  ThumbnailCandidateReference
} from "@/lib/mock-candidates";
import { cn } from "@/lib/utils";
import type { CommentOverlaySettings } from "@/types/comment-overlay";

type PreviewMode = "source" | "comments" | "subtitles" | "combined";

type ClipCandidatePreviewModalProps = {
  candidate: ClipCandidate | undefined;
  onClose: () => void;
  onStatusChange: (candidateId: string, status: CandidateStatus) => void;
  onNotesChange: (candidateId: string, field: keyof ClipCandidateNotes, value: string) => void;
  onAddMarker: (candidateId: string, marker: ClipCandidateMarker) => void;
  onMarkerLabelChange: (candidateId: string, markerId: string, label: string) => void;
  onRemoveMarker: (candidateId: string, markerId: string) => void;
  onVariantChange: (candidateId: string, variantId: string) => void;
  onCommentBurnedClipGenerated: (candidateId: string, clip: CommentBurnedClipReference) => void;
  onExportPackageGenerated: (candidateId: string, exportPackage: ExportPackageReference) => void;
  onThumbnailGenerated: (candidateId: string, thumbnail: ThumbnailCandidateReference) => void;
};

const previewModes: Array<{ value: PreviewMode; label: string; description: string }> = [
  { value: "source", label: "元動画", description: "Archive framing only" },
  { value: "comments", label: "コメントON", description: "Mock chat overlay" },
  { value: "subtitles", label: "字幕ON", description: "Mock subtitle layer" },
  { value: "combined", label: "コメント+字幕", description: "Both review layers" }
];

const markerKinds: Array<ClipCandidateMarker["kind"]> = ["setup", "funny", "peak", "ending", "note"];

const markerKindLabels: Record<ClipCandidateMarker["kind"], string> = {
  setup: "Setup",
  funny: "Funny",
  peak: "Peak",
  ending: "Ending",
  note: "Note"
};

const statusTone: Record<CandidateStatus, string> = {
  selected: "border-emerald-300/50 bg-emerald-400/15 text-emerald-100 shadow-[0_0_36px_rgba(16,185,129,0.12)]",
  pending: "border-cyan-300/50 bg-cyan-400/15 text-cyan-100 shadow-[0_0_36px_rgba(34,211,238,0.1)]",
  rejected: "border-rose-300/50 bg-rose-400/15 text-rose-100 shadow-[0_0_36px_rgba(244,63,94,0.1)]"
};

const statusDescriptions: Record<CandidateStatus, string> = {
  selected: "Ready to prepare for a manual edit pass.",
  pending: "Needs one more judgment before export prep.",
  rejected: "Kept for audit, but excluded from future export packages."
};

const markerKindTone: Record<ClipCandidateMarker["kind"], string> = {
  setup: "border-sky-300/35 bg-sky-400/12 text-sky-100",
  funny: "border-fuchsia-300/35 bg-fuchsia-400/12 text-fuchsia-100",
  peak: "border-amber-300/40 bg-amber-400/15 text-amber-100",
  ending: "border-emerald-300/35 bg-emerald-400/12 text-emerald-100",
  note: "border-white/15 bg-white/[0.06] text-slate-200"
};

const warningTone: Record<CandidateWarning["severity"], string> = {
  low: "border-sky-300/25 bg-sky-400/10 text-sky-100",
  medium: "border-amber-300/35 bg-amber-400/10 text-amber-100",
  high: "border-rose-300/40 bg-rose-400/12 text-rose-100"
};

const commentTone: Record<RepresentativeComment["intensity"], string> = {
  low: "border-white/10 bg-white/[0.04] text-slate-300",
  medium: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
  high: "border-fuchsia-300/35 bg-fuchsia-400/12 text-fuchsia-100"
};

export function ClipCandidatePreviewModal({
  candidate,
  onClose,
  onStatusChange,
  onNotesChange,
  onAddMarker,
  onMarkerLabelChange,
  onRemoveMarker,
  onVariantChange,
  onCommentBurnedClipGenerated,
  onExportPackageGenerated,
  onThumbnailGenerated
}: ClipCandidatePreviewModalProps) {
  const { t } = useI18n();
  const [previewMode, setPreviewMode] = useState<PreviewMode>("combined");
  const [mockTimeIndex, setMockTimeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [commentSettings, setCommentSettings] = useState<CommentOverlaySettings>(defaultCommentOverlaySettings);
  const [isBurningComments, setIsBurningComments] = useState(false);
  const [commentBurnError, setCommentBurnError] = useState<string | null>(null);
  const [commentBurnedClip, setCommentBurnedClip] = useState<CommentBurnedClipReference | null>(null);
  const [isGeneratingPackage, setIsGeneratingPackage] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [exportPackage, setExportPackage] = useState<ExportPackageReference | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
  const [generatedThumbnails, setGeneratedThumbnails] = useState<ThumbnailCandidateReference[]>([]);
  const [newMarkerKind, setNewMarkerKind] = useState<ClipCandidateMarker["kind"]>("note");
  const [newMarkerLabel, setNewMarkerLabel] = useState("");
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!candidate) {
      return;
    }

    setMockTimeIndex(indexForTime(candidate.peak.offset, candidate.duration, candidate.peak.sparkline.length));
    setIsPlaying(true);
    setNewMarkerKind("note");
    setNewMarkerLabel("");
    setCommentBurnError(null);
    setCommentBurnedClip(candidate.commentBurnedClip ?? null);
    setPackageError(null);
    setExportPackage(candidate.exportPackage ?? null);
    setCopyStatus(null);
    setThumbnailError(null);
    setGeneratedThumbnails(candidate.thumbnailCandidates ?? []);
    setVideoCurrentTime(0);
    setVideoDuration(0);
    setVideoError(null);
  }, [candidate?.id, candidate?.duration, candidate?.peak.offset, candidate?.peak.sparkline.length, candidate?.commentBurnedClip, candidate?.exportPackage, candidate?.thumbnailCandidates]);

  const showComments = previewMode === "comments" || previewMode === "combined";

  const durationSeconds = useMemo(() => {
    if (!candidate) return 1;
    const variant = candidate.variants.find((v) => v.id === candidate.selectedVariantId) ?? candidate.variants[0];
    return Math.max(1, parseTimeToSeconds(variant?.duration ?? candidate.duration));
  }, [candidate]);

  const overlayComments = useMemo(
    () => (candidate ? generateCommentOverlayItems(candidate, durationSeconds) : []),
    [candidate, durationSeconds]
  );

  const commentExportPayload = useMemo(
    () =>
      createCommentExportPayload({
        candidate: candidate ?? ({
          id: "",
          title: "",
          streamer: "",
          archiveTitle: "",
          detectedAt: "00:00",
          duration: "00:00",
          confidence: 0,
          status: "pending",
          summary: "",
          whyDetected: [],
          tags: [],
          chat: { messages: 0, peakPerMinute: 0, topPhrases: [], sentiment: "" },
          peak: { offset: "00:00", label: "", intensity: 0, sparkline: [] },
          transcript: [],
          transcriptSegments: [],
          representativeComments: [],
          detectionReasons: [],
          warnings: [],
          notes: { editPlan: "", titleIdea: "", thumbnailIdea: "", uploadText: "" },
          markers: [],
          variants: [],
          selectedVariantId: "",
          visualTone: ""
        } as ClipCandidate),
        comments: overlayComments,
        settings: { ...commentSettings, enabled: showComments && Boolean(candidate) },
        duration: durationSeconds
      }),
    [candidate, commentSettings, durationSeconds, overlayComments, showComments]
  );

  const commentsJson = useMemo(() => generateCommentsJson(commentExportPayload), [commentExportPayload]);
  const commentsAss = useMemo(() => generateScrollingCommentsAss(commentExportPayload), [commentExportPayload]);

  const postingAssets = useMemo(
    () => {
      if (!candidate) {
        return {
          titleMaterials: [],
          titleKeywords: [],
          thumbnailCandidates: [],
          thumbnailTextIdeas: [],
          oneLineSummary: ""
        };
      }
      const variant = candidate.variants.find((v) => v.id === candidate.selectedVariantId) ?? candidate.variants[0];
      return extractPostingAssets(candidate, variant);
    },
    [candidate]
  );

  if (!candidate) {
    return null;
  }

  const candidateId = candidate.id;
  const selectedVariant = candidate.variants.find((variant) => variant.id === candidate.selectedVariantId) ?? candidate.variants[0];
  const generatedClip = candidate.generatedClip;
  const selectedVariantDuration = selectedVariant?.duration ?? candidate.duration;
  const hasRealClip = Boolean(generatedClip?.outputPath);
  // When a real clip is loaded, drive overlay times from the actual <video>
  // currentTime so comments and subtitles stay in sync with playback. When
  // there's no clip, fall back to the sparkline-based mock timeline.
  const currentMockSeconds = hasRealClip
    ? Math.round(videoCurrentTime)
    : Math.round((mockTimeIndex / Math.max(candidate.peak.sparkline.length - 1, 1)) * durationSeconds);
  const currentMockTime = secondsToTime(currentMockSeconds);
  const playbackDuration = hasRealClip && videoDuration > 0 ? videoDuration : durationSeconds;
  const showSubtitles = previewMode === "subtitles" || previewMode === "combined";
  const sortedMarkers = [...candidate.markers].sort((a, b) => parseTimeToSeconds(a.time) - parseTimeToSeconds(b.time));
  const peakLabel = candidate.chat.peakPerMinute >= 500 ? "弾幕 高" : candidate.chat.peakPerMinute >= 250 ? "弾幕 中" : "弾幕 低";
  const moodLabel = candidate.tags.includes("funny") || candidate.tags.includes("comedy") ? "爆笑" : candidate.tags.includes("wholesome") ? "感動" : "盛り上がり";
  const activeSubtitle = getActiveSubtitle(candidate, currentMockSeconds);

  function togglePlayback() {
    const video = videoRef.current;
    if (video) {
      if (video.paused) {
        void video.play().catch((err) => setVideoError(err instanceof Error ? err.message : "Playback failed"));
      } else {
        video.pause();
      }
    } else {
      setIsPlaying((current) => !current);
    }
  }

  function handleScrubTo(index: number) {
    setMockTimeIndex(index);
    if (videoRef.current && videoDuration > 0 && candidate) {
      const targetSeconds = (index / Math.max(candidate.peak.sparkline.length - 1, 1)) * videoDuration;
      videoRef.current.currentTime = targetSeconds;
    }
  }

  function handleAddMarker() {
    const label = newMarkerLabel.trim() || `${markerKindLabels[newMarkerKind]} marker at ${currentMockTime}`;

    onAddMarker(candidateId, {
      id: `${candidateId}-marker-${Date.now()}`,
      time: currentMockTime,
      label,
      kind: newMarkerKind
    });
    setNewMarkerLabel("");
  }

  async function handleBurnCommentsIntoClip() {
    if (!generatedClip) {
      setCommentBurnError("Generate a local clip first from Local media dev tools, then burn comments into it.");
      return;
    }

    setIsBurningComments(true);
    setCommentBurnError(null);

    try {
      const response = await fetch("/api/media/clips-with-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipPath: generatedClip.outputPath,
          candidateId,
          variantId: selectedVariant?.id,
          assContent: commentsAss,
          assFileName: commentExportPayload.files.assFileName
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiError(data, "Could not burn comments into clip."));
      }

      const burnedClip = data as CommentBurnedClipReference;
      setCommentBurnedClip(burnedClip);
      onCommentBurnedClipGenerated(candidateId, burnedClip);
    } catch (caughtError) {
      setCommentBurnError(caughtError instanceof Error ? caughtError.message : "Could not burn comments into clip.");
    } finally {
      setIsBurningComments(false);
    }
  }

  async function handleGenerateExportPackage() {
    if (!candidate) {
      setPackageError("Select a candidate before generating an export package.");
      return;
    }

    const packageCandidate = candidate;
    const activeCommentBurnedClip = commentBurnedClip ?? packageCandidate.commentBurnedClip;

    setIsGeneratingPackage(true);
    setPackageError(null);

    try {
      const response = await fetch("/api/media/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate: {
            ...packageCandidate,
            commentBurnedClip: activeCommentBurnedClip,
            exportPackage: undefined
          },
          selectedVariant,
          generatedClip,
          commentBurnedClip: activeCommentBurnedClip,
          transcription: packageCandidate.transcription,
          commentsJson,
          commentsAss,
          commentJsonFileName: commentExportPayload.files.jsonFileName,
          commentAssFileName: commentExportPayload.files.assFileName,
          thumbnailCandidates: generatedThumbnails.length > 0 ? generatedThumbnails : undefined
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiError(data, "Could not generate export package."));
      }

      const generatedPackage = data as ExportPackageReference;
      setExportPackage(generatedPackage);
      onExportPackageGenerated(candidateId, generatedPackage);
    } catch (caughtError) {
      setPackageError(caughtError instanceof Error ? caughtError.message : "Could not generate export package.");
    } finally {
      setIsGeneratingPackage(false);
    }
  }

  async function handleCopyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(t("posting.copied", { label }));
    } catch {
      setCopyStatus(t("posting.copyFailed"));
    }
  }

  async function handleGenerateThumbnail(thumbnail: ThumbnailTimestampCandidate) {
    if (!generatedClip) {
      setThumbnailError("Generate a local clip first from Local media dev tools, then create thumbnail candidates.");
      return;
    }

    setIsGeneratingThumbnail(true);
    setThumbnailError(null);

    try {
      const response = await fetch("/api/media/thumbnails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipPath: generatedClip.outputPath,
          candidateId,
          timestamp: thumbnail.time,
          label: thumbnail.label
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiError(data, "Could not generate thumbnail candidate."));
      }

      const generatedThumbnail = data as ThumbnailCandidateReference;
      setGeneratedThumbnails((current) => [...current, generatedThumbnail]);
      onThumbnailGenerated(candidateId, generatedThumbnail);
    } catch (caughtError) {
      setThumbnailError(caughtError instanceof Error ? caughtError.message : "Could not generate thumbnail candidate.");
    } finally {
      setIsGeneratingThumbnail(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 p-2 backdrop-blur-xl sm:p-4" role="dialog" aria-modal="true" aria-label={`${candidate.title} preview`}>
      <section className="glass-panel mx-auto flex h-full max-w-[98rem] flex-col overflow-hidden rounded-[2rem]">
        <header className="flex flex-col gap-4 border-b border-white/10 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" onClick={onClose} className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 font-semibold text-slate-100 transition hover:bg-white/10">
              {t("common.close")}
            </button>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-300">{t("preview.candidate")} {candidate.id.toUpperCase()}</span>
            <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 font-semibold text-cyan-100">{t("preview.score")} {candidate.confidence}</span>
            <span className="rounded-full border border-fuchsia-300/25 bg-fuchsia-300/10 px-3 py-2 text-fuchsia-100">{moodLabel}</span>
            <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-amber-100">{peakLabel}</span>
            {selectedVariant && <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-emerald-100">{selectedVariant.label}</span>}
          </div>

          <div className="flex flex-wrap gap-2">
            {(["selected", "pending", "rejected"] as CandidateStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => onStatusChange(candidate.id, status)}
                className={cn(
                  "rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10",
                  candidate.status === status && statusTone[status]
                )}
              >
                {t(`status.${status}`)}
              </button>
            ))}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[21rem_minmax(0,1fr)_24rem]">
          <aside className="space-y-4 xl:overflow-y-auto xl:pr-1">
            <Panel title={t("preview.transcriptDetail")}>
              {candidate.transcription && (
                <div className="mb-3 rounded-2xl border border-fuchsia-300/30 bg-fuchsia-400/10 p-3 text-sm leading-6 text-fuchsia-100">
                  <p className="font-semibold text-white">faster-whisper transcript</p>
                  <p className="mt-1">Model {candidate.transcription.model} · {candidate.transcription.language ?? "auto language"}</p>
                  <p>TXT {candidate.transcription.outputs.txtPath}</p>
                  <p>SRT {candidate.transcription.outputs.srtPath}</p>
                </div>
              )}
              <div className="space-y-3">
                {candidate.transcriptSegments.map((segment) => (
                  <div key={`${segment.start}-${segment.text}`} className={cn("rounded-2xl border p-3", segment.highlight ? "border-cyan-300/35 bg-cyan-400/10" : "border-white/10 bg-white/[0.04]")}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-cyan-100">{segment.start} - {segment.end}</span>
                      <span className="text-slate-400">{segment.speaker}</span>
                    </div>
                    <p className="text-sm leading-6 text-slate-200">{segment.text}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title={t("preview.representativeComments")}>
              <div className="space-y-2">
                {candidate.representativeComments.map((comment) => (
                  <div key={`${comment.time}-${comment.text}`} className={cn("rounded-2xl border p-3", commentTone[comment.intensity])}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs opacity-80">
                      <span>{comment.time}</span>
                      <span>{comment.intensity.toUpperCase()}</span>
                    </div>
                    <p className="text-sm font-semibold">{comment.text}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title={t("preview.detectionReasons")}>
              <div className="space-y-3">
                {candidate.detectionReasons.map((reason) => (
                  <div key={reason.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">{reason.label}</p>
                      <span className="rounded-full bg-cyan-300/10 px-2.5 py-1 text-xs font-bold text-cyan-100">{reason.score}</span>
                    </div>
                    <p className="text-sm leading-6 text-slate-300">{reason.detail}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title={t("preview.warnings")}>
              {candidate.warnings.length > 0 ? (
                <div className="space-y-3">
                  {candidate.warnings.map((warning) => (
                    <div key={warning.label} className={cn("rounded-2xl border p-3", warningTone[warning.severity])}>
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold">{warning.label}</p>
                        <span className="text-xs uppercase tracking-[0.16em] opacity-75">{warning.severity}</span>
                      </div>
                      <p className="text-sm leading-6 opacity-90">{warning.detail}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">{t("preview.noWarnings")}</p>
              )}
            </Panel>
          </aside>

          <div className="min-w-0 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/70">{candidate.streamer}</p>
              <h2 className="mt-2 text-2xl font-semibold leading-tight text-white lg:text-4xl">{candidate.title}</h2>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300 lg:text-base">{candidate.summary}</p>
            </div>

            <div className={cn("relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br shadow-violet", candidate.visualTone)}>
              <div className="relative aspect-video min-h-64 bg-black/40">
                {hasRealClip && generatedClip ? (
                  <video
                    ref={videoRef}
                    src={`/api/media/files?path=${encodeURIComponent(generatedClip.outputPath)}`}
                    className="absolute inset-0 h-full w-full bg-black object-contain"
                    controls
                    playsInline
                    preload="metadata"
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onTimeUpdate={(event) => setVideoCurrentTime(event.currentTarget.currentTime)}
                    onLoadedMetadata={(event) => {
                      setVideoDuration(event.currentTarget.duration);
                      setVideoError(null);
                    }}
                    onError={() => {
                      setVideoError(
                        t("preview.currentMockTime", { time: currentMockTime })
                      );
                    }}
                  />
                ) : (
                  <>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(255,255,255,0.22),transparent_18rem)]" />
                    {showComments && (
                      <CommentCanvasOverlay
                        comments={overlayComments}
                        currentTime={currentMockSeconds}
                        duration={durationSeconds}
                        settings={{ ...commentSettings, enabled: showComments }}
                        playing={isPlaying}
                      />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <button
                          type="button"
                          onClick={togglePlayback}
                          className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/30 bg-white/10 text-3xl text-white shadow-2xl backdrop-blur-xl transition hover:scale-105 hover:bg-white/15 lg:h-24 lg:w-24"
                        >
                          {isPlaying ? "Ⅱ" : "▶"}
                        </button>
                        <p className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-white/80">{t("preview.mockPreview")}</p>
                        <p className="mt-2 rounded-full border border-white/15 bg-black/25 px-3 py-1 text-xs text-white/80 backdrop-blur">{t("preview.currentMockTime", { time: currentMockTime })}</p>
                      </div>
                    </div>
                  </>
                )}
                {hasRealClip && showComments && (
                  <CommentCanvasOverlay
                    comments={overlayComments}
                    currentTime={currentMockSeconds}
                    duration={playbackDuration}
                    settings={{ ...commentSettings, enabled: showComments }}
                    playing={isPlaying}
                  />
                )}
                {showSubtitles && (
                  <div className="absolute inset-x-5 bottom-6 z-20 rounded-2xl border border-white/15 bg-black/60 px-4 py-3 text-center text-sm font-semibold text-white backdrop-blur-md lg:text-lg">
                    {activeSubtitle}
                  </div>
                )}
              </div>
              <div className="border-t border-white/10 bg-black/40 p-4 backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between gap-3 text-xs text-white/75">
                  <span>{selectedVariant?.start ?? candidate.detectedAt}</span>
                  <span>{hasRealClip && videoDuration > 0 ? secondsToTime(videoDuration) : (selectedVariant?.duration ?? candidate.duration)}</span>
                </div>
                <div className="relative h-3 overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-fuchsia-200 to-amber-200"
                    style={{ width: `${hasRealClip && videoDuration > 0 ? Math.min(100, (videoCurrentTime / videoDuration) * 100) : candidate.peak.intensity}%` }}
                  />
                  {hasRealClip && videoDuration > 0 && (
                    <div
                      className="absolute top-0 h-full w-1 rounded-full bg-white shadow-[0_0_16px_rgba(255,255,255,0.9)]"
                      style={{ left: `${Math.min(100, (videoCurrentTime / videoDuration) * 100)}%` }}
                    />
                  )}
                </div>
              </div>
            </div>

            <Panel title={t("preview.clipFile")}>
              {hasRealClip && generatedClip ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <MiniStat label={t("preview.clipPath")} value={generatedClip.outputPath} />
                    <MiniStat label={t("preview.clipDuration")} value={generatedClip.duration} />
                    <MiniStat label={t("preview.clipMode")} value={generatedClip.mode} />
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3 font-mono text-xs leading-6 text-slate-300">
                    <p className="text-slate-500">{t("media.absolutePath")}:</p>
                    <p className="break-all text-slate-100">{generatedClip.absoluteOutputPath}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/api/media/files?path=${encodeURIComponent(generatedClip.outputPath)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-2xl border border-cyan-200/40 bg-cyan-300/15 px-4 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/25"
                    >
                      {t("preview.clipOpenInPlayer")}
                    </a>
                    <a
                      href={`/api/media/files?path=${encodeURIComponent(generatedClip.outputPath)}`}
                      download={generatedClip.outputPath.split("/").pop()}
                      className="rounded-2xl border border-emerald-200/40 bg-emerald-300/15 px-4 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-300/25"
                    >
                      MP4 ダウンロード
                    </a>
                  </div>
                  {videoError && (
                    <p className="rounded-xl border border-rose-300/35 bg-rose-400/10 p-2 text-xs leading-5 text-rose-100">
                      動画読み込みエラー: {videoError}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-400">{t("preview.noClipYet")}</p>
              )}
            </Panel>

            <Panel title={t("preview.lengthVariants")}>
              <div className="grid gap-3 lg:grid-cols-3">
                {candidate.variants.map((variant) => (
                  <VariantButton
                    key={variant.id}
                    variant={variant}
                    selected={variant.id === candidate.selectedVariantId}
                    onClick={() => onVariantChange(candidate.id, variant.id)}
                  />
                ))}
              </div>
            </Panel>

            <Panel title={t("preview.previewMode")}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {previewModes.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setPreviewMode(mode.value)}
                    className={cn(
                      "rounded-2xl border p-3 text-left transition",
                      previewMode === mode.value
                        ? "border-cyan-200/60 bg-cyan-300/15 text-cyan-50 shadow-[0_0_24px_rgba(103,232,249,0.15)]"
                        : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                    )}
                  >
                    <p className="text-sm font-semibold">{mode.label}</p>
                    <p className="mt-1 text-xs opacity-70">{mode.description}</p>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title={t("preview.postingAssets")}>
              <PostingAssetsPanel
                assets={postingAssets}
                notes={candidate.notes}
                onNotesChange={(field, value) => onNotesChange(candidate.id, field, value)}
                generatedClipPath={generatedClip?.outputPath}
                generatedThumbnails={generatedThumbnails}
                isGeneratingThumbnail={isGeneratingThumbnail}
                thumbnailError={thumbnailError}
                copyStatus={copyStatus}
                onCopy={handleCopyText}
                onGenerateThumbnail={handleGenerateThumbnail}
              />
            </Panel>

            <Panel title={t("preview.heatmap")}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MiniStat label="Peak" value={`+${candidate.peak.offset}`} />
                <MiniStat label={hasRealClip ? t("preview.currentTime", { time: "" }) : t("preview.currentMockTime", { time: currentMockTime })} value={`+${currentMockTime}`} />
                <MiniStat label="Intensity" value={`${candidate.peak.intensity}/100`} />
                <MiniStat label="Chat / min" value={candidate.chat.peakPerMinute.toString()} />
              </div>
              <div className="mt-4 grid grid-cols-12 gap-1.5">
                {candidate.peak.sparkline.map((value, index) => {
                  const markerCount = sortedMarkers.filter((marker) => bucketForTime(marker.time, durationSeconds, candidate.peak.sparkline.length) === index).length;

                  return (
                    <button key={`${candidate.id}-heat-${index}`} type="button" onClick={() => handleScrubTo(index)} className="group space-y-2 text-left">
                      <span
                        className={cn(
                          "relative block h-20 rounded-xl border border-white/10 transition group-hover:border-white/30",
                          value > 85 ? "bg-fuchsia-300 shadow-[0_0_22px_rgba(217,70,239,0.35)]" : value > 65 ? "bg-cyan-300/80" : value > 40 ? "bg-sky-400/45" : "bg-white/10",
                          mockTimeIndex === index && "ring-2 ring-white/80"
                        )}
                        style={{ opacity: Math.max(0.35, value / 100) }}
                        title={`${value}% intensity`}
                      >
                        {markerCount > 0 && (
                          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/75 px-1 text-[0.65rem] font-bold text-white">
                            {markerCount}
                          </span>
                        )}
                      </span>
                      <span className="block text-center text-[0.65rem] text-slate-500">{index + 1}</span>
                    </button>
                  );
                })}
              </div>
              <input
                type="range"
                min="0"
                max={candidate.peak.sparkline.length - 1}
                step="1"
                value={mockTimeIndex}
                onChange={(event) => handleScrubTo(Number(event.target.value))}
                className="mt-4 w-full accent-cyan-300"
              />
              <p className="mt-3 text-sm text-slate-400">Click the heatmap or scrubber to change the mock current time, then add a marker from the marker panel.</p>
            </Panel>
          </div>

          <aside className="space-y-4 xl:overflow-y-auto xl:pl-1">
            <Panel title={t("preview.statusDecision")}>
              <div className={cn("rounded-2xl border p-4", statusTone[candidate.status])}>
                <p className="text-xs uppercase tracking-[0.2em] opacity-75">{t("preview.currentDecision")}</p>
                <p className="mt-2 text-2xl font-bold">{t(`status.${candidate.status}`)}</p>
                <p className="mt-2 text-sm opacity-90">{statusDescriptions[candidate.status]}</p>
              </div>
              <div className="mt-3 grid gap-2">
                {(["selected", "pending", "rejected"] as CandidateStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => onStatusChange(candidate.id, status)}
                    className={cn(
                      "rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-left text-sm font-semibold text-slate-200 transition hover:bg-white/10",
                      candidate.status === status && statusTone[status]
                    )}
                  >
                    {t("preview.markAs", { status: t(`status.${status}`) })}
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title={t("preview.editingNotes")}>
              <div className="space-y-3">
                <NoteField
                  label="Edit plan"
                  value={candidate.notes.editPlan}
                  rows={5}
                  onChange={(value) => onNotesChange(candidate.id, "editPlan", value)}
                  placeholder="Timing, pacing, context to preserve, and cut strategy."
                />
                <NoteField
                  label="Title idea"
                  value={candidate.notes.titleIdea}
                  rows={2}
                  onChange={(value) => onNotesChange(candidate.id, "titleIdea", value)}
                  placeholder="Working title angle."
                />
                <NoteField
                  label="Thumbnail idea"
                  value={candidate.notes.thumbnailIdea}
                  rows={3}
                  onChange={(value) => onNotesChange(candidate.id, "thumbnailIdea", value)}
                  placeholder="Face, text, crop, emotion, or visual gag."
                />
                <NoteField
                  label="Upload text"
                  value={candidate.notes.uploadText}
                  rows={3}
                  onChange={(value) => onNotesChange(candidate.id, "uploadText", value)}
                  placeholder="Description notes, credits, warnings, or pinned comment ideas."
                />
              </div>
              <p className="mt-3 text-xs text-slate-500">Saved locally in client state for this mock prototype.</p>
            </Panel>

            <Panel title={t("preview.timestampMarkers")}>
              <div className="rounded-2xl border border-cyan-300/25 bg-cyan-400/10 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/75">Add from current mock time</p>
                <p className="mt-1 text-2xl font-bold text-cyan-50">+{currentMockTime}</p>
                <div className="mt-3 grid grid-cols-[0.85fr_1.15fr] gap-2">
                  <select
                    value={newMarkerKind}
                    onChange={(event) => setNewMarkerKind(event.target.value as ClipCandidateMarker["kind"])}
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-200/60"
                  >
                    {markerKinds.map((kind) => (
                      <option key={kind} value={kind}>{markerKindLabels[kind]}</option>
                    ))}
                  </select>
                  <button type="button" onClick={handleAddMarker} className="rounded-2xl border border-cyan-200/45 bg-cyan-300/15 px-3 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/25">
                    {t("preview.addMarker")}
                  </button>
                </div>
                <input
                  value={newMarkerLabel}
                  onChange={(event) => setNewMarkerLabel(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-200/60"
                  placeholder="Optional marker label"
                />
              </div>

              <div className="mt-3 space-y-2">
                {sortedMarkers.map((marker) => (
                  <div key={marker.id} className="rounded-2xl border border-white/10 bg-black/15 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">+{marker.time}</span>
                        <MarkerKindBadge kind={marker.kind} />
                      </div>
                      <button type="button" onClick={() => onRemoveMarker(candidate.id, marker.id)} className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-400 transition hover:border-rose-300/40 hover:text-rose-100">
                        Remove
                      </button>
                    </div>
                    <input
                      value={marker.label}
                      onChange={(event) => onMarkerLabelChange(candidate.id, marker.id, event.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-200/60"
                      aria-label={`Marker label at ${marker.time}`}
                    />
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title={t("preview.commentSettings")}>
              <div className="space-y-4">
                <RangeField
                  label={`同期: ${commentSettings.syncOffsetSeconds.toFixed(1)}s`}
                  min={-8}
                  max={8}
                  step={0.5}
                  value={commentSettings.syncOffsetSeconds}
                  onChange={(value) => setCommentSettings((current) => ({ ...current, syncOffsetSeconds: value }))}
                />
                <SegmentedControl
                  label="密度"
                  value={commentSettings.density}
                  options={[
                    ["low", "低"],
                    ["medium", "中"],
                    ["high", "高"],
                    ["danmaku", "弾幕"]
                  ]}
                  onChange={(value) => setCommentSettings((current) => ({ ...current, density: value as CommentOverlaySettings["density"] }))}
                />
                <SegmentedControl
                  label="表示範囲"
                  value={commentSettings.displayArea}
                  options={[
                    ["full", "全体"],
                    ["top", "上部のみ"],
                    ["bottom", "下部のみ"]
                  ]}
                  onChange={(value) => setCommentSettings((current) => ({ ...current, displayArea: value as CommentOverlaySettings["displayArea"] }))}
                />
                <SegmentedControl
                  label="サイズ"
                  value={commentSettings.fontSize}
                  options={[
                    ["small", "小"],
                    ["medium", "中"],
                    ["large", "大"]
                  ]}
                  onChange={(value) => setCommentSettings((current) => ({ ...current, fontSize: value as CommentOverlaySettings["fontSize"] }))}
                />
                <SegmentedControl
                  label="色"
                  value={commentSettings.colorMode}
                  options={[
                    ["white", "白のみ"],
                    ["reaction", "反応別カラー"]
                  ]}
                  onChange={(value) => setCommentSettings((current) => ({ ...current, colorMode: value as CommentOverlaySettings["colorMode"] }))}
                />
                <div className="grid grid-cols-2 gap-2">
                  <ToggleButton label="URL除外" enabled={commentSettings.filterUrls} onClick={() => setCommentSettings((current) => ({ ...current, filterUrls: !current.filterUrls }))} />
                  <ToggleButton label="長文除外" enabled={commentSettings.filterLongComments} onClick={() => setCommentSettings((current) => ({ ...current, filterLongComments: !current.filterLongComments }))} />
                  <ToggleButton label="連投除外" enabled={commentSettings.filterRepeatedComments} onClick={() => setCommentSettings((current) => ({ ...current, filterRepeatedComments: !current.filterRepeatedComments }))} />
                  <ToggleButton label="ユーザー名非表示" enabled={commentSettings.hideUserNames} onClick={() => setCommentSettings((current) => ({ ...current, hideUserNames: !current.hideUserNames }))} />
                </div>

                <div className="space-y-2 rounded-2xl border border-white/10 bg-black/15 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">フォント</p>
                  <input
                    value={commentSettings.fontName}
                    onChange={(event) => setCommentSettings((current) => ({ ...current, fontName: event.target.value }))}
                    placeholder="Noto Sans JP"
                    className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none focus:border-cyan-200/60"
                  />
                  <p className="text-[0.65rem] leading-4 text-slate-500">FFmpeg burn-in で使用。MS PGothic や Noto Sans CJK を推奨。</p>
                </div>

                <RangeField
                  label={`縁取り: ${commentSettings.outlineWidth}px`}
                  min={0}
                  max={8}
                  step={1}
                  value={commentSettings.outlineWidth}
                  onChange={(value) => setCommentSettings((current) => ({ ...current, outlineWidth: value }))}
                />
                <RangeField
                  label={`秒あたり上限: ${commentSettings.maxPerSecond}コメ`}
                  min={1}
                  max={30}
                  step={1}
                  value={commentSettings.maxPerSecond}
                  onChange={(value) => setCommentSettings((current) => ({ ...current, maxPerSecond: value }))}
                />
              </div>
            </Panel>

            <Panel title={t("preview.commentExport")}>
              <div className="space-y-3 text-sm text-slate-300">
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat label="Comments" value={commentExportPayload.comments.length.toString()} />
                  <MiniStat label="ASS lines" value={commentExportPayload.comments.length.toString()} />
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3 font-mono text-xs leading-5 text-slate-400">
                  <p>{`candidateId: ${commentExportPayload.candidateId}`}</p>
                  <p>{`duration: ${commentExportPayload.clipDurationSeconds}s`}</p>
                  <p>{`density: ${commentExportPayload.settings.density}`}</p>
                  <p>{`syncOffset: ${commentExportPayload.settings.syncOffsetSeconds}s`}</p>
                  <p>{`json: ${commentExportPayload.files.jsonFileName}`}</p>
                  <p>{`ass: ${commentExportPayload.files.assFileName}`}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => downloadTextFile(commentExportPayload.files.jsonFileName, commentsJson, "application/json;charset=utf-8")}
                    className="rounded-2xl border border-cyan-200/40 bg-cyan-300/15 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/25"
                  >
                    JSON保存
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadTextFile(commentExportPayload.files.assFileName, commentsAss, "text/plain;charset=utf-8")}
                    className="rounded-2xl border border-fuchsia-200/40 bg-fuchsia-300/15 px-3 py-2 text-xs font-semibold text-fuchsia-50 transition hover:bg-fuchsia-300/25"
                  >
                    ASS保存
                  </button>
                </div>
                <div className="rounded-2xl border border-violet-300/25 bg-violet-400/10 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-100/75">FFmpeg burn-in</p>
                  <p className="mt-2 text-xs leading-5 text-violet-100/80">
                    Uses the generated local clip and current ASS comments to create an MP4 under `media/output/clips_with_comments/`.
                  </p>
                  <button
                    type="button"
                    onClick={handleBurnCommentsIntoClip}
                    disabled={isBurningComments || !generatedClip}
                    className="mt-3 w-full rounded-2xl border border-violet-200/45 bg-violet-300/15 px-3 py-2 text-xs font-semibold text-violet-50 transition hover:bg-violet-300/25 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isBurningComments ? "コメント焼き込み中..." : "コメント付きMP4生成"}
                  </button>
                  {!generatedClip && <p className="mt-2 text-xs leading-5 text-amber-100">Local media dev toolsで先にclipを生成してください。</p>}
                  {commentBurnError && <p className="mt-2 rounded-xl border border-rose-300/35 bg-rose-400/10 p-2 text-xs leading-5 text-rose-100">{commentBurnError}</p>}
                  {commentBurnedClip && (
                    <div className="mt-3 rounded-xl border border-emerald-300/30 bg-emerald-400/10 p-2 font-mono text-xs leading-5 text-emerald-100">
                      <p>{`input: ${commentBurnedClip.inputClipPath}`}</p>
                      <p>{`ass: ${commentBurnedClip.assPath}`}</p>
                      <p>{`output: ${commentBurnedClip.outputPath}`}</p>
                    </div>
                  )}
                </div>
                <details className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">ASS preview</summary>
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-[0.65rem] leading-4 text-slate-300">{commentsAss.slice(0, 2400)}</pre>
                </details>
              </div>
            </Panel>

            <Panel title={t("preview.exportPackage")}>
              <ExportPackagePreview
                candidate={candidate}
                selectedVariant={selectedVariant}
                markerCount={candidate.markers.length}
                generatedClip={generatedClip}
                commentBurnedClip={commentBurnedClip ?? candidate.commentBurnedClip}
                exportPackage={exportPackage}
                isGenerating={isGeneratingPackage}
                error={packageError}
                onGenerate={handleGenerateExportPackage}
              />
            </Panel>
          </aside>
        </div>
      </section>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-5 text-slate-100">{value}</p>
    </div>
  );
}

function NoteField({ label, value, rows, placeholder, onChange }: { label: string; value: string; rows: number; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-none rounded-2xl border border-white/10 bg-black/20 p-3 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-200/60 focus:bg-black/30"
        placeholder={placeholder}
      />
    </label>
  );
}

function RangeField({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-cyan-300" />
    </label>
  );
}

function SegmentedControl({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <div className="flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-black/15 p-1">
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            className={cn(
              "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
              value === optionValue ? "bg-cyan-300/20 text-cyan-50" : "text-slate-400 hover:text-slate-200"
            )}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleButton({ label, enabled, onClick }: { label: string; enabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-2xl border px-3 py-2 text-xs font-semibold transition",
        enabled ? "border-cyan-300/35 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/[0.04] text-slate-400 hover:text-slate-200"
      )}
    >
      {label}
    </button>
  );
}

function VariantButton({ variant, selected, onClick }: { variant: ClipCandidateVariant; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-2xl border p-4 text-left transition",
        selected
          ? "border-emerald-200/60 bg-emerald-300/15 text-emerald-50 shadow-[0_0_24px_rgba(52,211,153,0.15)]"
          : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{variant.label}</p>
          <p className="mt-1 text-xs text-slate-400">{variant.start} - {variant.end} · {variant.duration}</p>
        </div>
        {variant.recommended && <span className="rounded-full bg-amber-300/15 px-2 py-1 text-[0.65rem] font-bold text-amber-100">Recommended</span>}
      </div>
      <p className="mt-3 text-sm leading-6">{variant.description}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{variant.tradeoff}</p>
    </button>
  );
}

function MarkerKindBadge({ kind }: { kind: ClipCandidateMarker["kind"] }) {
  return <span className={cn("rounded-full border px-2 py-1 text-[0.65rem] font-bold uppercase tracking-[0.12em]", markerKindTone[kind])}>{markerKindLabels[kind]}</span>;
}

function PostingAssetsPanel({
  assets,
  notes,
  generatedClipPath,
  generatedThumbnails,
  isGeneratingThumbnail,
  thumbnailError,
  copyStatus,
  onNotesChange,
  onCopy,
  onGenerateThumbnail
}: {
  assets: ReturnType<typeof extractPostingAssets>;
  notes: ClipCandidateNotes;
  generatedClipPath: string | undefined;
  generatedThumbnails: ThumbnailCandidateReference[];
  isGeneratingThumbnail: boolean;
  thumbnailError: string | null;
  copyStatus: string | null;
  onNotesChange: (field: keyof ClipCandidateNotes, value: string) => void;
  onCopy: (label: string, text: string) => void;
  onGenerateThumbnail: (thumbnail: ThumbnailTimestampCandidate) => void;
}) {
  const { t } = useI18n();
  const compiledText = formatPostingText(assets);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-[1fr_0.85fr]">
        <div className="rounded-2xl border border-cyan-300/25 bg-cyan-400/10 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-cyan-50">{t("posting.titleMaterials")}</p>
            <button type="button" onClick={() => onCopy(t("posting.postingMaterials"), compiledText)} className="rounded-full border border-cyan-200/40 bg-cyan-300/15 px-3 py-1 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/25">
              {t("common.copyAll")}
            </button>
          </div>
          <div className="space-y-2">
            {assets.titleMaterials.map((material) => (
              <div key={`${material.label}-${material.value}`} className="rounded-xl border border-white/10 bg-black/15 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100/70">{material.label}</p>
                    <p className="mt-1 text-sm font-semibold leading-5 text-white">{material.value}</p>
                  </div>
                  <button type="button" onClick={() => onCopy(material.label, material.value)} className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300 transition hover:bg-white/10">
                    {t("common.copy")}
                  </button>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-400">{material.reason}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {assets.titleKeywords.map((keyword) => (
              <span key={keyword} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-200">{keyword}</span>
            ))}
          </div>
          {copyStatus && <p className="mt-3 text-xs text-cyan-100/80">{copyStatus}</p>}
        </div>

        <div className="rounded-2xl border border-fuchsia-300/25 bg-fuchsia-400/10 p-4">
          <p className="text-sm font-semibold text-fuchsia-50">{t("posting.thumbnailTextIdeas")}</p>
          <div className="mt-3 space-y-2">
            {assets.thumbnailTextIdeas.map((idea) => (
              <button key={idea} type="button" onClick={() => onCopy("Thumbnail text", idea)} className="block w-full rounded-xl border border-white/10 bg-black/15 p-3 text-left text-sm font-semibold text-white transition hover:bg-white/10">
                {idea}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-fuchsia-100/75">{t("posting.thumbnailTextNote")}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-amber-50">{t("posting.thumbnailTimestamps")}</p>
            <p className="mt-1 text-xs text-amber-100/75">{t("posting.thumbnailTimestampsNote")}</p>
          </div>
          <span className={cn("rounded-full px-2 py-1 text-xs font-bold", generatedClipPath ? "bg-emerald-300/15 text-emerald-100" : "bg-amber-300/15 text-amber-100")}>{generatedClipPath ? t("posting.clipReady") : t("posting.needsClip")}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {assets.thumbnailCandidates.map((thumbnail) => (
            <div key={`${thumbnail.source}-${thumbnail.time}-${thumbnail.label}`} className="rounded-xl border border-white/10 bg-black/15 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-amber-100/70">+{thumbnail.time}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{thumbnail.label}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onGenerateThumbnail(thumbnail)}
                  disabled={!generatedClipPath || isGeneratingThumbnail}
                  className="rounded-full border border-amber-200/35 bg-amber-300/10 px-2 py-1 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  JPG
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400">{thumbnail.reason}</p>
            </div>
          ))}
        </div>
        {thumbnailError && <p className="mt-3 rounded-xl border border-rose-300/35 bg-rose-400/10 p-2 text-xs leading-5 text-rose-100">{thumbnailError}</p>}
        {generatedThumbnails.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {generatedThumbnails.map((thumbnail) => (
              <a key={`${thumbnail.outputPath}-${thumbnail.createdAt}`} href={`/api/media/files?path=${encodeURIComponent(thumbnail.outputPath)}`} download className="group overflow-hidden rounded-xl border border-emerald-300/25 bg-emerald-400/10">
                <img src={`/api/media/files?path=${encodeURIComponent(thumbnail.outputPath)}`} alt={`Thumbnail candidate ${thumbnail.timestamp}`} className="aspect-video w-full bg-black/30 object-cover transition group-hover:scale-[1.02]" />
                <div className="p-2 font-mono text-xs leading-5 text-emerald-100">
                  <p>{`+${thumbnail.timestamp}`}</p>
                  <p className="truncate">{thumbnail.outputPath}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <NoteField label={t("posting.titleIdea")} value={notes.titleIdea} rows={3} onChange={(value) => onNotesChange("titleIdea", value)} placeholder="Manual title candidates or framing." />
        <NoteField label={t("posting.thumbnailIdea")} value={notes.thumbnailIdea} rows={3} onChange={(value) => onNotesChange("thumbnailIdea", value)} placeholder="Face, text, crop, emotion, chat phrase." />
        <NoteField label={t("posting.uploadText")} value={notes.uploadText} rows={3} onChange={(value) => onNotesChange("uploadText", value)} placeholder="Description notes, credits, pinned comment ideas." />
      </div>
    </div>
  );
}

function ExportPackagePreview({
  candidate,
  selectedVariant,
  markerCount,
  generatedClip,
  commentBurnedClip,
  exportPackage,
  isGenerating,
  error,
  onGenerate
}: {
  candidate: ClipCandidate;
  selectedVariant: ClipCandidateVariant | undefined;
  markerCount: number;
  generatedClip: ClipCandidate["generatedClip"];
  commentBurnedClip: ClipCandidate["commentBurnedClip"];
  exportPackage: ExportPackageReference | null;
  isGenerating: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  const checks = [
    { label: "Status selected", ready: candidate.status === "selected" },
    { label: "Length variant chosen", ready: Boolean(selectedVariant) },
    { label: "Markers added", ready: markerCount > 0 },
    { label: "Title idea drafted", ready: candidate.notes.titleIdea.trim().length > 0 },
    { label: "Clean clip generated", ready: Boolean(generatedClip) },
    { label: "Comment-burned clip generated", ready: Boolean(commentBurnedClip) },
    { label: "Transcript generated", ready: Boolean(candidate.transcription) }
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-black/20 p-3 font-mono text-xs leading-6 text-slate-300">
        <p>{`candidateId: ${candidate.id}`}</p>
        <p>{`status: ${candidate.status}`}</p>
        <p>{`variant: ${selectedVariant?.label ?? "none"}`}</p>
        <p>{`markers: ${markerCount}`}</p>
        <p>{`warnings: ${candidate.warnings.length}`}</p>
        <p>{`cleanClip: ${generatedClip ? generatedClip.outputPath : "not generated"}`}</p>
        <p>{`commentClip: ${commentBurnedClip ? commentBurnedClip.outputPath : "not generated"}`}</p>
        <p>{`transcript: ${candidate.transcription ? candidate.transcription.outputs.srtPath : "not generated"}`}</p>
      </div>

      <div className="space-y-2">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
            <span className="text-slate-300">{check.label}</span>
            <span className={cn("rounded-full px-2 py-1 text-xs font-bold", check.ready ? "bg-emerald-300/15 text-emerald-100" : "bg-amber-300/15 text-amber-100")}>{check.ready ? "Ready" : "Missing"}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-300">
        <p className="font-semibold text-white">Package contents</p>
        <p>metadata.json</p>
        <p>notes.md</p>
        <p>assets/video/clean_clip.mp4 when available</p>
        <p>assets/video/comments_burned.mp4 when available</p>
        <p>assets/transcripts/* when available</p>
        <p>assets/comments/comments.json</p>
        <p>assets/comments/comments.ass</p>
      </div>

      <button
        type="button"
        onClick={onGenerate}
        disabled={isGenerating}
        className="w-full rounded-2xl border border-emerald-200/45 bg-emerald-300/15 px-4 py-3 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-300/25 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isGenerating ? "Generating package..." : "Generate editor package"}
      </button>

      {error && <div className="rounded-2xl border border-rose-300/35 bg-rose-400/10 p-3 text-sm leading-6 text-rose-100">{error}</div>}

      {exportPackage && (
        <div className="rounded-2xl border border-emerald-300/35 bg-emerald-400/10 p-3 font-mono text-xs leading-5 text-emerald-100">
          <p>{`package: ${exportPackage.packagePath}`}</p>
          <p>{`metadata: ${exportPackage.metadataPath}`}</p>
          <p>{`notes: ${exportPackage.notesPath}`}</p>
          <p>{`assets: ${exportPackage.copiedAssets.length}`}</p>
        </div>
      )}
    </div>
  );
}

function parseTimeToSeconds(time: string) {
  const parts = time.split(":").map(Number);

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return Number.isFinite(parts[0]) ? parts[0] : 0;
}

function getActiveSubtitle(candidate: ClipCandidate, currentTime: number) {
  const activeSegment = candidate.transcriptSegments.find((segment) => {
    const start = parseTimeToSeconds(segment.start);
    const end = parseTimeToSeconds(segment.end);
    return currentTime >= start && currentTime <= Math.max(end, start + 1);
  });

  return activeSegment?.text ?? candidate.transcriptSegments.find((segment) => segment.highlight)?.text ?? candidate.transcript[0] ?? "字幕プレビュー";
}

function secondsToTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function indexForTime(time: string, duration: string, bucketCount: number) {
  const durationSeconds = Math.max(1, parseTimeToSeconds(duration));
  const timeSeconds = Math.min(parseTimeToSeconds(time), durationSeconds);

  return Math.round((timeSeconds / durationSeconds) * Math.max(bucketCount - 1, 1));
}

function bucketForTime(time: string, durationSeconds: number, bucketCount: number) {
  const clampedSeconds = Math.min(parseTimeToSeconds(time), durationSeconds);

  return Math.round((clampedSeconds / Math.max(durationSeconds, 1)) * Math.max(bucketCount - 1, 1));
}

function readApiError(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    return (data as { error: string }).error;
  }

  return fallback;
}
