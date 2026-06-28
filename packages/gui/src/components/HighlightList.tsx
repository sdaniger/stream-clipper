import React from "react";
import type { HighlightCandidate } from "../api";
import { fmt } from "../utils";

interface Props {
  highlights: HighlightCandidate[];
  selectedHighlight: HighlightCandidate | null;
  clipping: boolean;
  shortGen: boolean;
  generatedFiles: string[];
  onSelect: (h: HighlightCandidate) => void;
  onSelectAndSeek: (h: HighlightCandidate) => void;
  onGenerateClip: (h: HighlightCandidate) => void;
  onCreateShort: (h: HighlightCandidate) => void;
}

export default function HighlightList({
  highlights, selectedHighlight, clipping, shortGen,
  generatedFiles, onSelect, onSelectAndSeek, onGenerateClip, onCreateShort,
}: Props) {
  return (
    <div className="panel" style={{ flex: 1, overflow: "auto" }}>
      <div className="panel-header">
        <span className="panel-title">Highlights</span>
        {generatedFiles.length > 0 && <span className="badge-success">{generatedFiles.length} generated</span>}
      </div>
      {highlights.length > 0 ? highlights.map((h) => (
        <div key={h.rank}
          onClick={() => onSelectAndSeek(h)}
          className={`card ${selectedHighlight?.rank === h.rank ? "card-active" : ""}`}>
          <div className="card-row">
            <span className="rank-badge">#{h.rank}</span>
            <span className="score-badge">score: {h.score}</span>
          </div>
          <div className="card-meta">
            {fmt(h.start)} – {fmt(h.end)} · {h.chat_count} msgs · {h.keyword_hits} kw hits
          </div>
          {h.reasons.length > 0 && (
            <div className="card-reasons">
              {h.reasons.slice(0, 2).join(" · ")}
            </div>
          )}
          {h.matched_keywords.length > 0 && (
            <div className="card-keywords">
              keywords: {h.matched_keywords.slice(0, 5).join(", ")}
            </div>
          )}
          <div className="card-actions">
            <button className="btn btn-xs btn-ghost" onClick={(e) => { e.stopPropagation(); onSelect(h); }}>
              Select
            </button>
            <button className="btn btn-xs btn-primary" onClick={(e) => { e.stopPropagation(); onGenerateClip(h); }}
              disabled={clipping}>
              Generate
            </button>
            <button className="btn btn-xs btn-green" onClick={(e) => { e.stopPropagation(); onCreateShort(h); }}
              disabled={shortGen}>
              {shortGen ? "..." : "Short"}
            </button>
            {h.output_file && <span className="check-icon">✓</span>}
          </div>
        </div>
      )) : (
        <div className="empty-state" style={{ height: 120 }}>
          Results appear here
        </div>
      )}
    </div>
  );
}
