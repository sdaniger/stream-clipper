"use client";
import React from "react";
import type { HighlightCandidate } from "@/lib/twitch-time";
import CandidateCard from "./CandidateCard";
import { useI18n } from "@/lib/i18n";

interface Props {
  candidates: HighlightCandidate[];
  selectedCandidateId: string | number | null;
  exportedCandidateIds: Set<string | number>;
  danmakuExportedIds: Set<string | number>;
  exportingCandidateId: string | number | null;
  canExport: boolean;
  onSelectCandidate: (candidate: HighlightCandidate) => void;
  onEditCandidate: (candidate: HighlightCandidate) => void;
  onExportCandidate: (candidate: HighlightCandidate) => void;
}

export default function CandidateList({
  candidates,
  selectedCandidateId,
  exportedCandidateIds,
  danmakuExportedIds,
  exportingCandidateId,
  canExport,
  onSelectCandidate,
  onEditCandidate,
  onExportCandidate,
}: Props) {
  const { t } = useI18n();
  // Max score across all candidates, used to scale the score bar.
  const maxScore = candidates.reduce(
    (m, c) => (typeof c.score === "number" && c.score > m ? c.score : m),
    0,
  );
  return (
    <div className="glass-panel rounded-lg p-3 flex flex-col flex-1 min-h-0">
      <div className="flex justify-between items-center mb-1.5 gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {t("studio.candidatesTitle", { count: candidates.length })}
        </span>
        <div className="flex items-center gap-2 text-[10px]">
          {danmakuExportedIds.size > 0 && (
            <span className="text-fuchsia-400">🎬 {danmakuExportedIds.size}</span>
          )}
          {exportedCandidateIds.size > 0 && (
            <span className="text-emerald-400">✓ {exportedCandidateIds.size}</span>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {candidates.length > 0 ? candidates.map((c) => {
          const id = c.id ?? c.rank;
          return (
            <CandidateCard
              key={id}
              candidate={c}
              isSelected={id === selectedCandidateId}
              isExported={exportedCandidateIds.has(id)}
              isDanmakuExported={danmakuExportedIds.has(id)}
              isExporting={exportingCandidateId === id}
              maxScore={maxScore}
              canExport={canExport}
              onSelect={() => onSelectCandidate(c)}
              onEdit={() => onEditCandidate(c)}
              onExport={() => onExportCandidate(c)}
            />
          );
        }) : (
          <div className="flex items-center justify-center h-[100px] text-slate-500 text-xs">
            {t("studio.noCandidatesList")}
          </div>
        )}
      </div>
    </div>
  );
}
