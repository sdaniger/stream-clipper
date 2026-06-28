"use client";
import React from "react";
import type { HighlightCandidate } from "@/lib/studio-api";

function fmt(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDuration(s: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}m${sec}s`;
  }
  return `${s.toFixed(0)}s`;
}

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
      <div className="glass-panel rounded-lg p-3 flex-1">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Highlight Editor</div>
        <div className="flex items-center justify-center h-20 text-slate-500 text-xs">Select a candidate to edit</div>
      </div>
    );
  }

  const duration = Math.max(0, editedEnd - editedStart);

  return (
    <div className="glass-panel rounded-lg p-3 flex-1">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Highlight Editor — #{highlight.rank}</div>

      {/* Reasons */}
      <div className="mb-2">
        <div className="text-[11px] text-slate-500 mb-0.5">Why selected</div>
        {highlight.reasons.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {highlight.reasons.map((r, i) => (
              <div key={i} className="text-xs text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-sm">{r}</div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-600">No specific reason</div>
        )}
        {highlight.matched_keywords.length > 0 && (
          <div className="text-[11px] text-slate-400 mt-1">Matched: {highlight.matched_keywords.join(", ")}</div>
        )}
      </div>

      {/* Edit fields */}
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wide">Start (s)</label>
          <input type="number" value={editedStart}
            onChange={(e) => onStartChange(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" step={0.1} />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wide">End (s)</label>
          <input type="number" value={editedEnd}
            onChange={(e) => onEndChange(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" step={0.1} />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wide">Duration</label>
          <div className="text-xs text-slate-300 pt-1">{fmtDuration(duration)} ({duration.toFixed(1)}s)</div>
        </div>
      </div>

      {/* Encoder / mode */}
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wide">Encoder</label>
          <select value={encoder} onChange={(e) => onEncoderChange(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500">
            <option value="auto">Auto (NVENC)</option>
            <option value="h264_nvenc">NVENC</option>
            <option value="libx264">libx264</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wide">Mode</label>
          <select value={clipMode} onChange={(e) => onClipModeChange(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500">
            <option value="reencode">Re-encode</option>
            <option value="copy">Stream Copy</option>
          </select>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-1 flex-wrap">
        <button onClick={onSetStartToCurrent}
          className="px-2 py-0.5 text-[10px] rounded bg-slate-700/60 border border-slate-600 text-slate-300 hover:brightness-110">
          📍 Start = now ({fmt(editedStart)})
        </button>
        <button onClick={onSetEndToCurrent}
          className="px-2 py-0.5 text-[10px] rounded bg-slate-700/60 border border-slate-600 text-slate-300 hover:brightness-110">
          📍 End = now ({fmt(editedEnd)})
        </button>
        <button onClick={onPreviewPlay}
          className="px-2 py-0.5 text-[10px] rounded bg-emerald-600 text-white hover:brightness-110">
          ▶ Preview ({fmt(duration)})
        </button>
        <button onClick={onExport} disabled={isGenerating}
          className="px-2 py-0.5 text-[10px] rounded bg-violet-600 text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">
          {isGenerating ? "Exporting..." : "💾 Export"}
        </button>
        <button onClick={onTranscribe} disabled={isTranscribing}
          className="px-2 py-0.5 text-[10px] rounded bg-blue-600 text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">
          {isTranscribing ? "⏳" : "📝 Transcribe"}
        </button>
      </div>

      {/* Transcript */}
      {isTranscribing && (
        <div className="text-[11px] text-slate-500 mt-1.5">Transcribing audio (GPU)...</div>
      )}
      {transcriptText && (
        <div className="mt-1.5">
          <div className="text-[11px] text-slate-500 mb-0.5">Transcription</div>
          <div className="text-xs text-slate-300 leading-relaxed max-h-[100px] overflow-y-auto">{transcriptText}</div>
        </div>
      )}
    </div>
  );
}
