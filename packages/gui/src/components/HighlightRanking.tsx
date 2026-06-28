import React from "react";
import type { HighlightCandidate } from "../api";
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
    <div className="panel ranking-panel">
      <div className="panel-header">
        <span className="panel-title">Candidates ({highlights.length})</span>
        {generatedFiles.length > 0 && (
          <span className="badge-success">{generatedFiles.length} exported</span>
        )}
      </div>
      <div className="ranking-scroll">
        {highlights.length > 0 ? highlights.map((h) => (
          <HighlightCard
            key={h.rank}
            highlight={h}
            isSelected={selectedRank === h.rank}
            hasOutput={!!h.output_file}
            onClick={() => onSelect(h.rank)}
            onExport={() => onExport(h)}
            onCreateShort={() => onCreateShort(h)}
          />
        )) : (
          <div className="empty-state" style={{ height: 100 }}>
            Run analysis to see candidates
          </div>
        )}
      </div>
    </div>
  );
}
