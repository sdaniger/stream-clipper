import React, { useEffect, useRef } from "react";
import { fmt } from "../utils";

export interface Segment {
  start: number;
  end: number;
  text: string;
}

interface Props {
  transcribing: boolean;
  transcript: string | null;
  transcriptSegments: Segment[];
  sceneQuery: string;
  sceneResults: Segment[];
  onTranscribe: () => void;
  onSceneQueryChange: (v: string) => void;
  onSceneSearch: () => void;
  onSceneResultClick: (start: number) => void;
}

export default function TranscriptionPanel({
  transcribing, transcript, transcriptSegments,
  sceneQuery, sceneResults,
  onTranscribe, onSceneQueryChange, onSceneSearch, onSceneResultClick,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sceneQuery && searchRef.current) {
      const timer = setTimeout(() => onSceneSearch(), 300);
      return () => clearTimeout(timer);
    }
  }, [sceneQuery, onSceneSearch]);

  return (
    <div className="panel" style={{ maxHeight: 280, overflow: "auto" }}>
      <div className="panel-header">
        <span className="panel-title">Transcription</span>
        <button className="btn btn-sm btn-ghost" onClick={onTranscribe} disabled={transcribing}>
          {transcribing ? "Transcribing..." : "Transcribe"}
        </button>
      </div>
      {transcript && (
        <div className="transcript-preview">
          {transcript.slice(0, 500)}{transcript.length > 500 ? "..." : ""}
        </div>
      )}
      <div style={{ display: "flex", gap: 4, marginTop: transcript ? 6 : 0 }}>
        <input ref={searchRef} value={sceneQuery} onChange={(e) => onSceneQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSceneSearch()}
          placeholder="Search transcript..." className="input input-sm" style={{ flex: 1 }} />
        <button className="btn btn-xs btn-ghost" onClick={onSceneSearch}
          disabled={transcriptSegments.length === 0}>
          Search
        </button>
      </div>
      {sceneResults.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {sceneResults.slice(0, 15).map((r, i) => (
            <div key={i} className="scene-row"
              onClick={() => onSceneResultClick(r.start)}>
              <span className="scene-time">{fmt(r.start)}</span>
              <span className="scene-text">{r.text.slice(0, 80)}</span>
            </div>
          ))}
          {sceneResults.length > 15 && (
            <div className="scene-more">...and {sceneResults.length - 15} more</div>
          )}
        </div>
      )}
    </div>
  );
}
