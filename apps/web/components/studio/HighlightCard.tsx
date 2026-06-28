"use client";
import React from "react";
import type { HighlightCandidate } from "@/lib/studio-api";

function fmt(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDuration(s: number): string {
  if (s >= 60) return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;
  return `${s.toFixed(0)}s`;
}

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
    <div className={`rounded-md p-2 mb-1 cursor-pointer transition-all duration-100 ${
      isSelected
        ? "border border-violet-500 shadow-[0_0_0_1px_#7c3aed]"
        : "border border-slate-700/60"
    } ${isSelected ? "bg-slate-700/80" : "bg-slate-800/60 hover:border-slate-500"}`}
      onClick={onClick}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-violet-300">#{h.rank}</span>
        <span className="text-xs font-semibold text-amber-400">score {h.score}</span>
        {hasOutput && <span className="text-[10px] text-emerald-500 ml-auto">✓ done</span>}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">
        {fmt(h.start)} – {fmt(h.end)} · {fmtDuration(h.clip_duration)} · {h.chat_count} msgs · {h.keyword_hits} kw
      </div>
      {h.matched_keywords.length > 0 && (
        <div className="text-[10px] text-slate-500 mt-px">
          keywords: {h.matched_keywords.slice(0, 5).join(", ")}
        </div>
      )}
      {h.reasons.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-0.5">
          {h.reasons.slice(0, 3).map((r, i) => (
            <span key={i} className="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 rounded-sm whitespace-nowrap">{r}</span>
          ))}
        </div>
      )}
      <div className="flex gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
        <button onClick={onExport}
          className="px-2 py-0.5 text-[10px] rounded bg-violet-600 text-white hover:brightness-110">
          Export
        </button>
        <button onClick={onCreateShort}
          className="px-2 py-0.5 text-[10px] rounded bg-emerald-600 text-white hover:brightness-110">
          Short
        </button>
      </div>
    </div>
  );
}
