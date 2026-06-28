"use client";
import React from "react";
import type { HighlightCandidate } from "@/lib/twitch-time";
import CandidateCard from "./CandidateCard";

interface Props {
  candidates: HighlightCandidate[];
  selectedCandidateId: string | number | null;
  onSelectCandidate: (candidate: HighlightCandidate) => void;
}

export default function CandidateList({ candidates, selectedCandidateId, onSelectCandidate }: Props) {
  return (
    <div className="glass-panel rounded-lg p-3 flex flex-col flex-1 min-h-0">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Candidates ({candidates.length})
        </span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {candidates.length > 0 ? candidates.map((c) => (
          <CandidateCard
            key={c.id ?? c.rank}
            candidate={c}
            isSelected={(c.id ?? c.rank) === selectedCandidateId}
            onSelect={() => onSelectCandidate(c)}
          />
        )) : (
          <div className="flex items-center justify-center h-[100px] text-slate-500 text-xs">
            No candidates yet — run analysis
          </div>
        )}
      </div>
    </div>
  );
}
