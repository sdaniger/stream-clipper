"use client";
import React from "react";
import type { HighlightCandidate } from "@/lib/twitch-time";
import { secondsToTwitchTime } from "@/lib/twitch-time";
import { useI18n } from "@/lib/i18n";

type ExportStatus = "idle" | "exporting" | "exported" | "error";

interface Props {
  candidate: HighlightCandidate;
  hasLocalVideo: boolean;
  localVideoPath: string | null;
  currentTime: number;
  isPlayerAvailable: boolean;
  singleExportStatus: ExportStatus;
  batchExportStatus: ExportStatus;
  onJumpStart: () => void;
  onJumpPeak: () => void;
  onJumpEnd: () => void;
  onPreviewRange: () => void;
  onSetStartFromCurrent: () => void;
  onSetEndFromCurrent: () => void;
  onExportThisClip: () => void;
  onExportTop5: () => void;
  onSelectLocalVideo: () => void;
}

function fmtClock(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getStart(c: HighlightCandidate): number {
  return c.clip_start ?? c.start ?? c.peak_time ?? 0;
}

function getEnd(c: HighlightCandidate): number {
  return c.end ?? (c.clip_start != null && c.clip_duration != null ? c.clip_start + c.clip_duration : getStart(c) + 30);
}

export default function ClipActionPanel({
  candidate: c,
  hasLocalVideo,
  currentTime,
  isPlayerAvailable,
  singleExportStatus,
  batchExportStatus,
  onJumpStart,
  onJumpPeak,
  onJumpEnd,
  onPreviewRange,
  onSetStartFromCurrent,
  onSetEndFromCurrent,
  onExportThisClip,
  onExportTop5,
  onSelectLocalVideo,
}: Props) {
  const startTime = getStart(c);
  const endTime = getEnd(c);
  const peakTime = c.peak_time ?? (startTime + endTime) / 2;
  const duration = endTime - startTime;
  const { t } = useI18n();

  const inRange = currentTime >= startTime && currentTime <= endTime;
  const canSetFromCurrent = isPlayerAvailable && !inRange;

  const exportDisabledReason = !hasLocalVideo
    ? t("studio.errorNoLocalFile")
    : null;

  return (
    <div className="glass-panel rounded-lg p-3">
      {/* Header: rank + score + status */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-violet-300">{t("studio.rank", { rank: c.rank })}</span>
          {typeof c.score === "number" && (
            <span className="text-[10px] text-amber-400 font-semibold px-1.5 py-0.5 rounded bg-amber-500/10">
              score {c.score}
            </span>
          )}
          {c.output_file && (
            <span className="text-[10px] text-emerald-400 font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10">
              ✓ {t("studio.exportedBadge")}
            </span>
          )}
        </div>
        <div className="text-[10px] text-slate-500 font-mono">
          {t("studio.now", { time: fmtClock(currentTime) })}
        </div>
      </div>

      {/* Time range summary */}
      <div className="grid grid-cols-4 gap-1 mb-3 text-center bg-slate-900/40 rounded p-2">
        <div>
          <div className="text-[9px] text-slate-500 uppercase">{t("studio.positionStart")}</div>
          <div className="text-[12px] text-slate-200 font-mono font-semibold">{secondsToTwitchTime(startTime)}</div>
        </div>
        <div>
          <div className="text-[9px] text-amber-400 uppercase">{t("studio.positionPeak")}</div>
          <div className="text-[12px] text-amber-300 font-mono font-semibold">{secondsToTwitchTime(peakTime)}</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500 uppercase">{t("studio.positionEnd")}</div>
          <div className="text-[12px] text-slate-200 font-mono font-semibold">{secondsToTwitchTime(endTime)}</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500 uppercase">{t("studio.positionDuration")}</div>
          <div className="text-[12px] text-slate-200 font-mono font-semibold">{fmtClock(duration)}</div>
        </div>
      </div>

      {/* PRIMARY ACTION: Preview */}
      <button
        onClick={onPreviewRange}
        disabled={!isPlayerAvailable}
        className="w-full mb-2 px-4 py-2.5 text-sm font-bold rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-500/30 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all"
      >
        ▶ {t("studio.previewRange")}
      </button>

      {/* SECONDARY ACTION: Export This Clip */}
      <button
        onClick={onExportThisClip}
        disabled={!!exportDisabledReason || singleExportStatus === "exporting"}
        className="w-full mb-2 px-4 py-2 text-sm font-semibold rounded-md bg-emerald-600/40 border border-emerald-500/60 text-emerald-100 hover:bg-emerald-500/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title={exportDisabledReason ?? "MP4 export"}
      >
        {singleExportStatus === "exporting" ? (
          <span>⏳ {t("studio.btnExporting")}</span>
        ) : singleExportStatus === "exported" ? (
          <span>📥 {t("studio.writeRankShort")}</span>
        ) : (
          <span>📥 {t("studio.writeRankShort")}</span>
        )}
      </button>

      {exportDisabledReason && (
        <div className="mb-2 px-2 py-1.5 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded flex items-center gap-1">
          <span>⚠</span>
          <span>{exportDisabledReason}</span>
        </div>
      )}

      {/* Auxiliary controls - small */}
      <div className="border-t border-slate-700/50 pt-2 mt-1">
        <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-1.5">Jump</div>
        <div className="grid grid-cols-3 gap-1 mb-2">
          <button
            onClick={onJumpStart}
            disabled={!isPlayerAvailable}
            className="px-2 py-1 text-[10px] rounded bg-slate-700/50 border border-slate-600/50 text-slate-300 hover:bg-slate-600/50 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("studio.jumpStart")}
          >
            ⏮ {t("studio.jumpStart")}
          </button>
          <button
            onClick={onJumpPeak}
            disabled={!isPlayerAvailable}
            className="px-2 py-1 text-[10px] rounded bg-amber-600/30 border border-amber-500/50 text-amber-200 hover:bg-amber-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("studio.jumpPeak")}
          >
            ⭐ {t("studio.jumpPeak")}
          </button>
          <button
            onClick={onJumpEnd}
            disabled={!isPlayerAvailable}
            className="px-2 py-1 text-[10px] rounded bg-slate-700/50 border border-slate-600/50 text-slate-300 hover:bg-slate-600/50 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("studio.jumpEnd")}
          >
            ⏭ {t("studio.jumpEnd")}
          </button>
        </div>

        <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-1.5">Set range from current</div>
        <div className="grid grid-cols-2 gap-1 mb-2">
          <button
            onClick={onSetStartFromCurrent}
            disabled={!canSetFromCurrent}
            className="px-2 py-1 text-[10px] rounded bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("studio.setStartCurrent")}
          >
            ⊙ {t("studio.setStartCurrent")}
          </button>
          <button
            onClick={onSetEndFromCurrent}
            disabled={!canSetFromCurrent}
            className="px-2 py-1 text-[10px] rounded bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("studio.setEndCurrent")}
          >
            {t("studio.setEndCurrent")} ⊙
          </button>
        </div>
      </div>

      {/* Batch export - smaller secondary */}
      <div className="border-t border-slate-700/50 pt-2 mt-1">
        <button
          onClick={onExportTop5}
          disabled={!!exportDisabledReason || batchExportStatus === "exporting"}
          className="w-full px-3 py-1.5 text-[11px] rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title={exportDisabledReason ?? "Batch export top 5"}
        >
          {batchExportStatus === "exporting" ? `⏳ ${t("studio.btnExporting")}` : "📥 Top 5"}
        </button>
        {!hasLocalVideo && (
          <button
            onClick={onSelectLocalVideo}
            className="w-full mt-1 px-3 py-1 text-[10px] rounded bg-slate-700/40 border border-slate-600/50 text-slate-300 hover:bg-slate-600/40"
          >
            {t("studio.logFallbackLocal")} →
          </button>
        )}
      </div>
    </div>
  );
}
