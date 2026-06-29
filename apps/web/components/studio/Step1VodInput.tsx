"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";

interface Props {
  vodUrl: string;
  setVodUrl: (v: string) => void;
  videoId: string | null;
  chatLoaded: boolean;
  messageCount: number;
  candidatesCount: number;
  vodTitle: string | null;
  isAnalyzing: boolean;
  progressLabel: string;
  progress: number;
  errorMessage: string | null;
  onLoad: () => void;
  onAutoAnalyze: () => void;
}

export default function Step1VodInput({
  vodUrl,
  setVodUrl,
  videoId,
  chatLoaded,
  messageCount,
  candidatesCount,
  vodTitle,
  isAnalyzing,
  progressLabel,
  progress,
  errorMessage,
  onLoad,
  onAutoAnalyze,
}: Props) {
  const { t } = useI18n();
  const isLoaded = !!videoId;

  return (
    <div className="glass-panel rounded-lg p-4">
      <div className="text-base font-semibold text-slate-200 mb-2">
        {t("studio.step1Title")}
      </div>
      <div className="text-xs text-slate-400 mb-3">
        {t("studio.step1Description")}
      </div>

      {!isLoaded ? (
        // Pre-load state: URL input + Load button
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 items-end">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">
                {t("studio.step1UrlLabel")}
              </label>
              <input
                value={vodUrl}
                onChange={(e) => setVodUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && vodUrl.trim()) onLoad();
                }}
                placeholder={t("studio.step1UrlPlaceholder")}
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1.5 text-sm outline-none focus:border-cyan-500"
              />
            </div>
            <button
              type="button"
              onClick={onLoad}
              disabled={!vodUrl.trim()}
              className="px-3 py-1.5 text-sm rounded bg-slate-700/60 border border-slate-600 text-slate-200 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("studio.step1LoadButton")}
            </button>
          </div>
        </div>
      ) : (
        // Loaded state: VOD title + chat info + big Auto-analyze button
        <div className="flex flex-col gap-3">
          <div className="bg-slate-900/60 rounded-md p-3 border border-slate-700/40">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
              {t("studio.step1LoadedHeading")}
            </div>
            <div className="text-sm text-slate-200 font-semibold truncate">
              {vodTitle || videoId}
            </div>
            {chatLoaded && (
              <div className="text-[11px] text-emerald-400 mt-1.5">
                ✓ {t("studio.step1ChatLoaded")} ({messageCount.toLocaleString()} msgs)
              </div>
            )}
          </div>

          {errorMessage && (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
              ⚠ {errorMessage}
            </div>
          )}

          {isAnalyzing ? (
            <div>
              <div className="flex items-center gap-2 text-sm text-cyan-300 mb-1.5">
                <div className="animate-spin w-3.5 h-3.5 border-2 border-cyan-500 border-t-transparent rounded-full" />
                <span>{progressLabel || t("studio.preparing")}</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-400 transition-all duration-300"
                  style={{ width: `${Math.max(1, progress)}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onAutoAnalyze}
              className="w-full px-4 py-3 text-base font-bold rounded-lg bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-lg shadow-cyan-500/30 hover:brightness-110 transition-all"
            >
              {t("studio.step1AutoAnalyzeButton")}
            </button>
          )}

          <div className="text-[10px] text-slate-500 text-center">
            {t("studio.step1AutoAnalyzeHint")}
          </div>

          {candidatesCount > 0 && (
            <div className="text-xs text-emerald-400 text-center">
              ✓ {t("studio.candidateCount", { count: candidatesCount })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
