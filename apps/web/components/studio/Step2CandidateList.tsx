"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";
import type { HighlightCandidate } from "@/lib/twitch-time";
import CandidateCard from "./CandidateCard";

interface Props {
  candidates: HighlightCandidate[];
  selectedCandidateId: string | number | null;
  exportedCandidateIds: Set<string | number>;
  danmakuExportedIds: Set<string | number>;
  exportingCandidateId: string | number | null;
  canExport: boolean;
  /** Max score across all candidates, used to scale the score bar. */
  maxScore: number;
  onSelect: (c: HighlightCandidate) => void;
  onExport: (c: HighlightCandidate) => void;
  onExportTop5: () => void;
  isExportingTop5: boolean;
}

export default function Step2CandidateList({
  candidates,
  selectedCandidateId,
  exportedCandidateIds,
  danmakuExportedIds,
  exportingCandidateId,
  canExport,
  maxScore,
  onSelect,
  onExport,
  onExportTop5,
  isExportingTop5,
}: Props) {
  const { t } = useI18n();

  if (candidates.length === 0) {
    return (
      <div className="glass-panel rounded-lg p-4">
        <div className="text-base font-semibold text-slate-200 mb-2">
          {t("studio.step2Title")}
        </div>
        <div className="text-xs text-slate-400 mb-3">
          {t("studio.step2Description")}
        </div>
        <div className="bg-slate-900/40 rounded p-4 text-center text-xs text-slate-500 border border-slate-700/30">
          {t("studio.step2NoCandidates")}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-lg p-4">
      <div className="text-base font-semibold text-slate-200 mb-1">
        {t("studio.step2Title")}
      </div>
      <div className="text-xs text-slate-400 mb-3">
        {t("studio.step2Description")}
      </div>

      {/* Big "Export top 5" button — primary action */}
      <button
        type="button"
        onClick={onExportTop5}
        disabled={isExportingTop5 || !canExport}
        className="w-full mb-3 px-4 py-3 text-base font-bold rounded-lg bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-lg shadow-cyan-500/30 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
      >
        {isExportingTop5 ? (
          <>
            <div className="animate-spin w-4 h-4 border-2 border-white/40 border-t-white rounded-full" />
            <span>{t("studio.preparing")}</span>
          </>
        ) : (
          <>🎬 {t("studio.btnExportTop5")}（上位 {Math.min(5, candidates.length)}）</>
        )}
      </button>

      <div className="text-[10px] text-slate-500 mb-2 text-center">
        {t("studio.step2SelectHint")}
      </div>

      {/* Candidate list */}
      <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
        {candidates.map((c) => {
          const id = c.id ?? c.rank;
          return (
            <CandidateCard
              key={id}
              candidate={c}
              isSelected={id === selectedCandidateId}
              isExported={exportedCandidateIds.has(id)}
              isDanmakuExported={danmakuExportedIds.has(id)}
              isExporting={exportingCandidateId === id}
              canExport={canExport}
              maxScore={maxScore}
              onSelect={() => onSelect(c)}
              onEdit={() => onSelect(c)}
              onExport={() => onExport(c)}
            />
          );
        })}
      </div>
    </div>
  );
}
