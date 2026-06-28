import React from "react";
import type { HighlightCandidate } from "../api";
import { fmt, fmtDuration } from "../utils";

interface Props {
  highlight: HighlightCandidate;
  isSelected: boolean;
  hasOutput: boolean;
  onClick: () => void;
  onExport: () => void;
  onCreateShort: () => void;
}

export default function HighlightCard({ highlight: h, isSelected, hasOutput, onClick, onExport, onCreateShort }: Props) {
  return (
    <div
      className={`card ${isSelected ? "card-active" : ""}`}
      onClick={onClick}
    >
      <div className="card-row">
        <span className="rank-badge">#{h.rank}</span>
        <span className="score-badge">score {h.score}</span>
        {hasOutput && <span className="badge-success">✓ done</span>}
      </div>
      <div className="card-meta">
        {fmt(h.start)} – {fmt(h.end)} · {fmtDuration(h.clip_duration)} · {h.chat_count} msgs · {h.keyword_hits} kw
      </div>
      {h.matched_keywords.length > 0 && (
        <div className="card-keywords">
          keywords: {h.matched_keywords.slice(0, 5).join(", ")}
        </div>
      )}
      {h.reasons.length > 0 && (
        <div className="card-reasons">
          {h.reasons.slice(0, 3).map((r, i) => (
            <span key={i} className="reason-tag">{r}</span>
          ))}
        </div>
      )}
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-xs btn-primary" onClick={onExport}>
          Export
        </button>
        <button className="btn btn-xs btn-green" onClick={onCreateShort}>
          Short
        </button>
      </div>
    </div>
  );
}
