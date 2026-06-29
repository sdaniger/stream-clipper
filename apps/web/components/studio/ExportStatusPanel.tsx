"use client";
import React from "react";
import { useI18n } from "@/lib/i18n";

interface Props {
  mode: "twitch" | "local";
  videoPath: string;
  twitchVodId: string | null;
  exportedCount: number;
  totalCandidates: number;
  onSelectLocalFile: () => void;
}

export default function ExportStatusPanel({
  mode,
  videoPath,
  twitchVodId,
  exportedCount,
  totalCandidates,
  onSelectLocalFile,
}: Props) {
  const { t } = useI18n();
  const twitchReady = mode === "twitch" && !!twitchVodId;
  const localReady = mode === "local" && videoPath.trim().length > 0;
  const canExport = localReady;

  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2">Export Status</div>

      {/* Twitch Preview */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={twitchReady ? "text-emerald-400" : "text-slate-600"}>
            {twitchReady ? "✓" : "○"}
          </span>
          <span className="text-[11px] text-slate-300">{t("studio.twitchBadge")}</span>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          twitchReady
            ? "text-emerald-400 bg-emerald-500/10"
            : "text-slate-500 bg-slate-700/30"
        }`}>
          {twitchReady ? t("studio.sourceAvailable") : t("studio.titleBarEmpty")}
        </span>
      </div>

      {/* Local File */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={localReady ? "text-emerald-400" : "text-amber-400"}>
            {localReady ? "✓" : "△"}
          </span>
          <span className="text-[11px] text-slate-300">MP4 {t("studio.writeRankShort")}</span>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          localReady
            ? "text-emerald-400 bg-emerald-500/10"
            : "text-amber-400 bg-amber-500/10"
        }`}>
          {localReady ? t("studio.sourceReady") : t("studio.sourceNotSelected")}
        </span>
      </div>

      {/* Disabled reason */}
      {!canExport && (
        <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[10px] text-amber-200">
          <div className="font-semibold mb-1">⚠ MP4 {t("studio.writeRankShort")} disabled</div>
          <div className="text-amber-300/80">
            {mode === "twitch"
              ? "Twitch VOD is preview-only. For MP4 export, switch to Local File mode and specify a local video file."
              : t("studio.errorNoLocalFile")}
          </div>
          {mode === "twitch" && (
            <button
              onClick={onSelectLocalFile}
              className="mt-1.5 w-full px-2 py-1 text-[10px] rounded bg-amber-600/30 border border-amber-500/50 text-amber-100 hover:bg-amber-500/40 font-semibold"
            >
              {t("studio.modeLocal")} →
            </button>
          )}
        </div>
      )}

      {/* Stats */}
      {totalCandidates > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center justify-between text-[10px] text-slate-500">
          <span>{t("studio.candidatesCount", { count: totalCandidates })}</span>
          <span className="text-emerald-400">
            {t("studio.exportedBadge")} {exportedCount}
          </span>
        </div>
      )}
    </div>
  );
}
