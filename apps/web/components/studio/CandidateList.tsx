"use client";
import React from "react";
import type { HighlightCandidate } from "@/lib/twitch-time";
import CandidateCard from "./CandidateCard";

interface Props {
  candidates: HighlightCandidate[];
  selectedCandidateId: string | number | null;
  exportedCandidateIds: Set<string | number>;
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
  exportingCandidateId,
  canExport,
  onSelectCandidate,
  onEditCandidate,
  onExportCandidate,
}: Props) {
  return (
    <div className="glass-panel rounded-lg p-3 flex flex-col flex-1 min-h-0">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Candidates ({candidates.length})
        </span>
        {exportedCandidateIds.size > 0 && (
          <span className="text-[10px] text-emerald-400">
            ✓ {exportedCandidateIds.size} exported
          </span>
        )}
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
              isExporting={exportingCandidateId === id}
              canExport={canExport}
              onSelect={() => onSelectCandidate(c)}
              onEdit={() => onEditCandidate(c)}
              onExport={() => onExportCandidate(c)}
            />
          );
        }) : (
          <div className="flex items-center justify-center h-[100px] text-slate-500 text-xs">
            No candidates yet — run analysis
          </div>
        )}
      </div>
    </div>
  );
}
