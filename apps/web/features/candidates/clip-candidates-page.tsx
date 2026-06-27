"use client";

import { useState } from "react";
import { ArchiveAutoPanel } from "@/components/archive-auto-panel";
import { ChatJsonImportPanel } from "@/components/chat-json-import-panel";
import { ClipCandidateCard } from "@/components/clip-candidate-card";
import { ClipCandidatePreviewModal } from "@/components/clip-candidate-preview-modal";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LocalVideoPanel } from "@/components/local-video-panel";
import { useI18n } from "@/lib/i18n";
import type { ChatAnalysisSummary, ChatImportMode } from "@/lib/chat-analysis";
import type {
  CandidateStatus,
  CommentBurnedClipReference,
  ClipCandidate,
  ClipCandidateMarker,
  ClipCandidateNotes,
  ClipTranscription,
  ExportPackageReference,
  GeneratedClipReference,
  ThumbnailCandidateReference
} from "@/lib/mock-candidates";
import { mockCandidates } from "@/lib/mock-candidates";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | CandidateStatus;

const filters: StatusFilter[] = [
  "all",
  "selected",
  "pending",
  "rejected"
];

export function ClipCandidatesPage() {
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<ClipCandidate[]>(mockCandidates);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [minimumConfidence, setMinimumConfidence] = useState(60);
  const [search, setSearch] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [lastImportSummary, setLastImportSummary] = useState<ChatAnalysisSummary | null>(null);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredCandidates = candidates.filter((candidate) => {
    const matchesStatus = statusFilter === "all" || candidate.status === statusFilter;
    const matchesConfidence = candidate.confidence >= minimumConfidence;
    const searchableText = [
      candidate.title,
      candidate.streamer,
      candidate.archiveTitle,
      candidate.summary,
      candidate.notes.editPlan,
      candidate.notes.titleIdea,
      candidate.notes.thumbnailIdea,
      candidate.notes.uploadText,
      candidate.transcription?.text ?? "",
      ...candidate.tags,
      ...candidate.whyDetected,
      ...candidate.markers.map((marker) => `${marker.time} ${marker.label} ${marker.kind}`),
      ...candidate.variants.map((variant) => `${variant.label} ${variant.description} ${variant.tradeoff}`),
      ...candidate.chat.topPhrases,
      ...candidate.detectionReasons.map((reason) => `${reason.label} ${reason.detail}`),
      ...candidate.representativeComments.map((comment) => comment.text)
    ]
      .join(" ")
      .toLowerCase();

    return matchesStatus && matchesConfidence && (!normalizedSearch || searchableText.includes(normalizedSearch));
  });

  const selectedCount = candidates.filter((candidate) => candidate.status === "selected").length;
  const pendingCount = candidates.filter((candidate) => candidate.status === "pending").length;
  const rejectedCount = candidates.filter((candidate) => candidate.status === "rejected").length;
  const previewCandidate = previewId ? candidates.find((candidate) => candidate.id === previewId) : undefined;

  function updateStatus(candidateId: string, status: CandidateStatus) {
    setCandidates((current) =>
      current.map((candidate) => (candidate.id === candidateId ? { ...candidate, status } : candidate))
    );
  }

  function updateNotes(candidateId: string, field: keyof ClipCandidateNotes, value: string) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === candidateId ? { ...candidate, notes: { ...candidate.notes, [field]: value } } : candidate
      )
    );
  }

  function addMarker(candidateId: string, marker: ClipCandidateMarker) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === candidateId ? { ...candidate, markers: [...candidate.markers, marker] } : candidate
      )
    );
  }

  function updateMarker(candidateId: string, markerId: string, label: string) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === candidateId
          ? {
              ...candidate,
              markers: candidate.markers.map((marker) => (marker.id === markerId ? { ...marker, label } : marker))
            }
          : candidate
      )
    );
  }

  function removeMarker(candidateId: string, markerId: string) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === candidateId
          ? { ...candidate, markers: candidate.markers.filter((marker) => marker.id !== markerId) }
          : candidate
      )
    );
  }

  function selectVariant(candidateId: string, variantId: string) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === candidateId ? { ...candidate, selectedVariantId: variantId } : candidate
      )
    );
  }

  function updateGeneratedClip(candidateId: string, clip: GeneratedClipReference) {
    setCandidates((current) =>
      current.map((candidate) => (candidate.id === candidateId ? { ...candidate, generatedClip: clip } : candidate))
    );
  }

  function updateCommentBurnedClip(candidateId: string, clip: CommentBurnedClipReference) {
    setCandidates((current) =>
      current.map((candidate) => (candidate.id === candidateId ? { ...candidate, commentBurnedClip: clip } : candidate))
    );
  }

  function updateExportPackage(candidateId: string, exportPackage: ExportPackageReference) {
    setCandidates((current) =>
      current.map((candidate) => (candidate.id === candidateId ? { ...candidate, exportPackage } : candidate))
    );
  }

  function addThumbnailCandidate(candidateId: string, thumbnail: ThumbnailCandidateReference) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === candidateId
          ? { ...candidate, thumbnailCandidates: [...(candidate.thumbnailCandidates ?? []), thumbnail] }
          : candidate
      )
    );
  }

  function updateTranscription(candidateId: string, transcription: ClipTranscription) {
    const excerpt = transcription.segments.slice(0, 3).map((segment) => segment.text);

    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === candidateId
          ? {
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
            }
          : candidate
      )
    );
  }

  function importCandidates(importedCandidates: ClipCandidate[], mode: ChatImportMode, summary: ChatAnalysisSummary) {
    setCandidates((current) => (mode === "replace" ? importedCandidates : [...importedCandidates, ...current]));
    setLastImportSummary(summary);
    setPreviewId(importedCandidates[0]?.id ?? null);
    setStatusFilter("all");
    setMinimumConfidence(0);
  }

  function countForFilter(filter: StatusFilter) {
    if (filter === "all") {
      return candidates.length;
    }

    return candidates.filter((candidate) => candidate.status === filter).length;
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <AppHeader selectedCount={selectedCount} pendingCount={pendingCount} rejectedCount={rejectedCount} />

        <ChatJsonImportPanel onImport={importCandidates} />

        <ArchiveAutoPanel onImport={importCandidates} />

        <LocalVideoPanel candidates={candidates} onClipGenerated={updateGeneratedClip} onTranscriptionComplete={updateTranscription} />

        <section className="glass-panel rounded-3xl p-4 sm:p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.26em] text-cyan-200/70">{t("review.eyebrow")}</p>
              <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{t("review.title")}</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                {t("review.description")}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center sm:min-w-96">
              <Metric label={t("status.selected")} value={selectedCount} tone="text-emerald-200" />
              <Metric label={t("status.pending")} value={pendingCount} tone="text-cyan-200" />
              <Metric label={t("status.rejected")} value={rejectedCount} tone="text-rose-200" />
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_0.7fr_0.7fr]">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("review.search")}</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("review.searchPlaceholder")}
                className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-200/60 focus:bg-white/[0.09]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                {t("review.minConfidence", { value: minimumConfidence })}
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={minimumConfidence}
                onChange={(event) => setMinimumConfidence(Number(event.target.value))}
                className="h-12 w-full accent-cyan-300"
              />
            </label>

            <div>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("review.sort")}</span>
              <div className="flex h-12 items-center rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-sm text-slate-200">
                {t("review.strongestFirst")}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {filters.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-semibold transition",
                  statusFilter === filter
                    ? "border-cyan-200/70 bg-cyan-300/15 text-cyan-50 shadow-[0_0_24px_rgba(103,232,249,0.2)]"
                    : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:bg-white/[0.08]"
                )}
              >
                {t(`status.${filter}`)} <span className="text-white/55">{countForFilter(filter)}</span>
              </button>
            ))}
          </div>

          {lastImportSummary && (
            <div className="mt-5 rounded-2xl border border-fuchsia-300/25 bg-fuchsia-400/10 p-4 text-sm text-fuchsia-100">
              {t("review.lastImport", { candidates: lastImportSummary.candidateCount, messages: lastImportSummary.analyzedMessages.toLocaleString(), peak: lastImportSummary.peakPerMinute })}
            </div>
          )}
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between gap-4 px-1">
            <p className="text-sm text-slate-300">
                {t("review.showing", { shown: filteredCandidates.length, total: candidates.length })}
              </p>
            <p className="hidden text-sm text-slate-400 sm:block">{t("review.ffmpegDev")}</p>
          </div>

          {filteredCandidates.length > 0 ? (
            <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
              {filteredCandidates.map((candidate) => (
                <ClipCandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  onPreview={setPreviewId}
                  onStatusChange={updateStatus}
                />
              ))}
            </div>
          ) : (
            <div className="glass-panel rounded-3xl p-10 text-center">
              <p className="text-lg font-semibold text-white">{t("review.noMatchesTitle")}</p>
              <p className="mt-2 text-sm text-slate-400">{t("review.noMatchesHelp")}</p>
            </div>
          )}
        </section>
      </div>

      <ClipCandidatePreviewModal
        candidate={previewCandidate}
        onClose={() => setPreviewId(null)}
        onStatusChange={updateStatus}
        onNotesChange={updateNotes}
        onAddMarker={addMarker}
        onMarkerLabelChange={updateMarker}
        onRemoveMarker={removeMarker}
        onVariantChange={selectVariant}
        onCommentBurnedClipGenerated={updateCommentBurnedClip}
        onExportPackageGenerated={updateExportPackage}
        onThumbnailGenerated={addThumbnailCandidate}
      />
    </main>
  );
}

function AppHeader({ selectedCount, pendingCount, rejectedCount }: { selectedCount: number; pendingCount: number; rejectedCount: number }) {
  const { t } = useI18n();

  return (
    <header className="flex flex-col gap-4 rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-200/30 bg-cyan-300/10 text-lg font-black text-cyan-100 shadow-glow">
          SC
        </div>
        <div>
          <p className="text-lg font-semibold text-white">{t("common.appName")}</p>
          <p className="text-sm text-slate-400">{t("header.subtitle")}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <LanguageSwitcher />
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">{t("header.selectedReady", { count: selectedCount })}</span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">{t("header.pendingNeed", { count: pendingCount })}</span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">{t("header.rejectedSkipped", { count: rejectedCount })}</span>
      </div>
    </header>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
      <p className={cn("text-2xl font-bold", tone)}>{value}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
    </div>
  );
}
