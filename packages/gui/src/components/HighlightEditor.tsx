import React from "react";
import type { HighlightCandidate } from "../api";
import { fmt, fmtDuration } from "../utils";

interface Props {
  highlight: HighlightCandidate | null;
  editedStart: number;
  editedEnd: number;
  isGenerating: boolean;
  encoder: string;
  clipMode: string;
  onStartChange: (v: number) => void;
  onEndChange: (v: number) => void;
  onEncoderChange: (v: string) => void;
  onClipModeChange: (v: string) => void;
  onSetStartToCurrent: () => void;
  onSetEndToCurrent: () => void;
  onPreviewPlay: () => void;
  onExport: () => void;
  onTranscribe: () => void;
  isTranscribing: boolean;
  transcriptText: string | null;
}

export default function HighlightEditor({
  highlight, editedStart, editedEnd, isGenerating,
  encoder, clipMode,
  onStartChange, onEndChange, onEncoderChange, onClipModeChange,
  onSetStartToCurrent, onSetEndToCurrent,
  onPreviewPlay, onExport,
  onTranscribe, isTranscribing, transcriptText,
}: Props) {
  if (!highlight) {
    return (
      <div className="panel" style={{ flex: 1 }}>
        <div className="panel-title" style={{ marginBottom: 4 }}>Highlight Editor</div>
        <div className="empty-state" style={{ height: 80 }}>
          Select a candidate to edit
        </div>
      </div>
    );
  }

  const duration = Math.max(0, editedEnd - editedStart);

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-title" style={{ marginBottom: 6 }}>Highlight Editor — #{highlight.rank}</div>

      {/* Reasons */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>Why selected</div>
        {highlight.reasons.length > 0 ? (
          <div className="reasons-list">
            {highlight.reasons.map((r, i) => (
              <div key={i} className="reason-item">{r}</div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#666" }}>No specific reason</div>
        )}
        {highlight.matched_keywords.length > 0 && (
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
            Matched: {highlight.matched_keywords.join(", ")}
          </div>
        )}
      </div>

      {/* Edit fields */}
      <div className="edit-grid">
        <div>
          <label className="field-label">Start (s)</label>
          <input type="number" value={editedStart}
            onChange={(e) => onStartChange(Number(e.target.value))}
            className="input input-sm" step={0.1} />
        </div>
        <div>
          <label className="field-label">End (s)</label>
          <input type="number" value={editedEnd}
            onChange={(e) => onEndChange(Number(e.target.value))}
            className="input input-sm" step={0.1} />
        </div>
        <div>
          <label className="field-label">Duration</label>
          <div style={{ fontSize: 12, color: "#ccc", padding: "4px 0" }}>
            {fmtDuration(duration)} ({duration.toFixed(1)}s)
          </div>
        </div>
      </div>

      {/* Encoder / mode */}
      <div className="edit-grid" style={{ margin: "6px 0" }}>
        <div>
          <label className="field-label">Encoder</label>
          <select value={encoder} onChange={(e) => onEncoderChange(e.target.value)}
            className="input input-sm">
            <option value="auto">Auto (NVENC)</option>
            <option value="h264_nvenc">NVENC</option>
            <option value="libx264">libx264</option>
          </select>
        </div>
        <div>
          <label className="field-label">Mode</label>
          <select value={clipMode} onChange={(e) => onClipModeChange(e.target.value)}
            className="input input-sm">
            <option value="reencode">Re-encode</option>
            <option value="copy">Stream Copy</option>
          </select>
        </div>
      </div>

      {/* Action buttons */}
      <div className="edit-actions">
        <button className="btn btn-xs btn-ghost" onClick={onSetStartToCurrent}>
          📍 Start = now ({fmt(editedStart)})
        </button>
        <button className="btn btn-xs btn-ghost" onClick={onSetEndToCurrent}>
          📍 End = now ({fmt(editedEnd)})
        </button>
        <button className="btn btn-xs btn-green" onClick={onPreviewPlay}>
          ▶ Preview ({fmt(duration)})
        </button>
        <button className="btn btn-xs btn-primary" onClick={onExport} disabled={isGenerating}>
          {isGenerating ? "Exporting..." : "💾 Export"}
        </button>
        <button className="btn btn-xs btn-accent" onClick={onTranscribe} disabled={isTranscribing}>
          {isTranscribing ? "⏳" : "📝 Transcribe"}
        </button>
      </div>

      {/* Transcript */}
      {isTranscribing && (
        <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>Transcribing audio (GPU)...</div>
      )}
      {transcriptText && (
        <div className="transcript-box" style={{ marginTop: 6 }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>Transcription</div>
          <div style={{ fontSize: 12, color: "#ccc", lineHeight: 1.5, maxHeight: 100, overflowY: "auto" }}>
            {transcriptText}
          </div>
        </div>
      )}
    </div>
  );
}
