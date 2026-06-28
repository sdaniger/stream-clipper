"use client";
import React from "react";
import type { HighlightCandidate } from "@/lib/studio-api";
import HighlightCard from "./HighlightCard";

interface Props {
  highlights: HighlightCandidate[];
  selectedRank: number | null;
  generatedFiles: string[];
  onSelect: (rank: number) => void;
  onExport: (h: HighlightCandidate) => void;
  onCreateShort: (h: HighlightCandidate) => void;
}

export default function HighlightRanking({
  highlights, selectedRank, generatedFiles, onSelect, onExport, onCreateShort,
}: Props) {
  return (
    <div className="glass-panel rounded-lg p-3 flex flex-col flex-1 min-h-0">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Candidates ({highlights.length})</span>
        {generatedFiles.length > 0 && (
          <span className="text-[10px] text-emerald-500">{generatedFiles.length} exported</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {highlights.length > 0 ? highlights.map((h) => (
          <HighlightCard
            key={h.rank} highlight={h}
            isSelected={selectedRank === h.rank}
            hasOutput={!!h.output_file}
            onClick={() => onSelect(h.rank)}
            onExport={() => onExport(h)}
            onCreateShort={() => onCreateShort(h)} />
        )) : (
          <div className="flex items-center justify-center h-[100px] text-slate-500 text-xs">Run analysis to see candidates</div>
        )}
      </div>
    </div>
  );
}
