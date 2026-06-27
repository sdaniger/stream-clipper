import type { CandidateStatus, ClipCandidate } from "@/lib/mock-candidates";
import { useI18n } from "@/lib/i18n";
import { extractPostingAssets } from "@/lib/posting-assets";
import { cn } from "@/lib/utils";

type ClipCandidateCardProps = {
  candidate: ClipCandidate;
  isNew?: boolean;
  onPreview: (candidateId: string) => void;
  onStatusChange: (candidateId: string, status: CandidateStatus) => void;
};

const statusTone: Record<CandidateStatus, string> = {
  selected: "border-emerald-300/40 bg-emerald-400/15 text-emerald-100",
  pending: "border-cyan-300/30 bg-cyan-400/10 text-cyan-100",
  rejected: "border-rose-300/35 bg-rose-400/12 text-rose-100"
};

const statusButtonTone: Record<CandidateStatus, string> = {
  selected: "hover:border-emerald-300/70 hover:bg-emerald-400/20",
  pending: "hover:border-cyan-300/70 hover:bg-cyan-400/20",
  rejected: "hover:border-rose-300/70 hover:bg-rose-400/20"
};

const cardStatusTone: Record<CandidateStatus, string> = {
  selected: "border-emerald-300/25 shadow-[0_0_48px_rgba(16,185,129,0.12)]",
  pending: "border-cyan-300/18",
  rejected: "border-rose-300/20 opacity-75 grayscale-[0.25]"
};

export function ClipCandidateCard({ candidate, isNew, onPreview, onStatusChange }: ClipCandidateCardProps) {
  const { t } = useI18n();
  const selectedVariant = candidate.variants.find((variant) => variant.id === candidate.selectedVariantId) ?? candidate.variants[0];
  const postingAssets = extractPostingAssets(candidate, selectedVariant);
  const titleHint = postingAssets.titleMaterials[1]?.value ?? postingAssets.titleMaterials[0]?.value ?? candidate.title;
  const thumbnailHint = postingAssets.thumbnailCandidates[0];

  return (
    <article className={cn("glass-panel group relative flex min-h-full flex-col overflow-hidden rounded-3xl transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:shadow-glow", cardStatusTone[candidate.status], isNew && "ring-2 ring-cyan-300/60 animate-pulse")}>
      {isNew && (
        <span className="absolute right-3 top-3 z-20 rounded-full border border-cyan-200/60 bg-cyan-300/20 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-cyan-50 shadow-[0_0_18px_rgba(103,232,249,0.4)]">
          {t("common.newBadge")}
        </span>
      )}
      <button
        type="button"
        onClick={() => onPreview(candidate.id)}
        className={cn(
          "relative h-44 overflow-hidden bg-gradient-to-br text-left",
          candidate.visualTone
        )}
        aria-label={`Preview ${candidate.title}`}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.36),transparent_16rem)]" />
        <div className="absolute inset-x-4 top-4 flex items-center justify-between">
          <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", statusTone[candidate.status])}>
            {t(`status.${candidate.status}`)}
          </span>
          <span className="rounded-full border border-white/15 bg-black/25 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
            {candidate.duration}
          </span>
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex items-center justify-center rounded-full border border-white/25 bg-white/10 px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-white shadow-2xl backdrop-blur-xl transition group-hover:scale-105">
            Preview
          </span>
        </div>
        <div className="absolute inset-x-4 bottom-4">
          <div className="flex items-center justify-between rounded-2xl border border-white/15 bg-black/25 px-3 py-2 text-xs text-white/80 backdrop-blur-xl">
            <span>{candidate.detectedAt}</span>
            <span>{candidate.peak.label} +{candidate.peak.offset}</span>
          </div>
        </div>
      </button>

      <div className="flex flex-1 flex-col gap-5 p-5">
        <div>
          <div className="mb-2 flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/70">{candidate.streamer}</p>
            <p className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold text-white">{candidate.confidence}%</p>
          </div>
          <h2 className="text-xl font-semibold leading-tight text-white">{candidate.title}</h2>
          <p className="mt-2 text-sm text-slate-300">{candidate.summary}</p>
          {candidate.transcription && (
            <p className="mt-3 rounded-2xl border border-fuchsia-300/25 bg-fuchsia-400/10 p-3 text-sm leading-6 text-fuchsia-100">
              {candidate.transcript[0] ?? candidate.transcription.text.slice(0, 120)}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs text-slate-400">
            <span>{t("card.excitementPeak")}</span>
            <span className="font-semibold text-cyan-100">{candidate.peak.intensity}/100</span>
          </div>
          <div className="flex h-16 items-end gap-1.5">
            {candidate.peak.sparkline.map((value, index) => (
              <div
                key={`${candidate.id}-${index}`}
                className={cn(
                  "flex-1 rounded-t-full bg-cyan-300/25",
                  value === Math.max(...candidate.peak.sparkline) && "bg-cyan-200 shadow-[0_0_18px_rgba(103,232,249,0.55)]"
                )}
                style={{ height: `${Math.max(16, value)}%` }}
                title={`${value}% intensity`}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs text-slate-400">{t("card.chatMessages")}</p>
            <p className="mt-1 text-lg font-semibold text-white">{candidate.chat.messages.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs text-slate-400">{t("card.peakPerMin")}</p>
            <p className="mt-1 text-lg font-semibold text-white">{candidate.chat.peakPerMinute}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs text-slate-400">{t("card.markers")}</p>
            <p className="mt-1 text-lg font-semibold text-white">{candidate.markers.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs text-slate-400">{t("card.variant")}</p>
            <p className="mt-1 truncate text-sm font-semibold text-white">{selectedVariant?.label ?? "-"}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400">{t("card.transcript")}</p>
            <p className={cn("text-xs font-semibold", candidate.transcription ? "text-fuchsia-100" : "text-slate-500")}>{candidate.transcription ? t("common.ready") : t("card.mock")}</p>
          </div>
          <p className="mt-1 truncate text-sm text-slate-200">{candidate.transcript[0] ?? t("card.noTranscript")}</p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("card.whyDetected")}</p>
          <div className="flex flex-wrap gap-2">
            {candidate.whyDetected.map((reason) => (
              <span key={reason} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-slate-200">
                {reason}
              </span>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("card.chatReaction")}</p>
          <div className="flex flex-wrap gap-2">
            {candidate.chat.topPhrases.map((phrase) => (
              <span key={phrase} className="rounded-full bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                {phrase}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-100/70">{t("card.postingHints")}</p>
            <p className="text-xs text-amber-100">+{thumbnailHint?.time ?? candidate.peak.offset}</p>
          </div>
          <p className="mt-2 truncate font-semibold text-white">{titleHint}</p>
          <p className="mt-1 truncate text-xs text-amber-100/75">{t("card.thumb")}: {thumbnailHint?.label ?? candidate.peak.label}</p>
        </div>

        <div className="mt-auto grid grid-cols-3 gap-2 pt-1">
          {(["selected", "pending", "rejected"] as CandidateStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => onStatusChange(candidate.id, status)}
              className={cn(
                "rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200 transition",
                statusButtonTone[status],
                candidate.status === status && statusTone[status]
              )}
            >
              {t(`status.${status}`)}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}
