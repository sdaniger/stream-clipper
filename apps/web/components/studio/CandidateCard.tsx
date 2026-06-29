"use client";
import React from "react";
import type { HighlightCandidate } from "@/lib/twitch-time";

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
  candidate: HighlightCandidate;
  isSelected: boolean;
  isExporting: boolean;
  isExported: boolean;
  canExport: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onExport: () => void;
}

export default function CandidateCard({
  candidate: c,
  isSelected,
  isExporting,
  isExported,
  canExport,
  onSelect,
  onEdit,
  onExport,
}: Props) {
  const startTime = c.clip_start ?? c.start ?? c.peak_time ?? 0;
  const endTime = c.end ?? (c.clip_start != null && c.clip_duration != null ? c.clip_start + c.clip_duration : startTime + 30);
  const duration = endTime - startTime;

  return (
    <div
      onClick={onSelect}
      className={`rounded-md p-2 mb-1 transition-all duration-100 cursor-pointer ${
        isSelected
          ? "border border-violet-500 shadow-[0_0_0_1px_#7c3aed] bg-slate-700/80"
          : "border border-slate-700/60 bg-slate-800/60 hover:border-slate-500"
      }`}
    >
      {/* Row 1: rank · score · exported badge */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-bold text-violet-300">#{c.rank}</span>
        {typeof c.score === "number" && (
          <span className="text-[10px] text-amber-400 font-semibold">score {c.score}</span>
        )}
        {isExported && (
          <span className="text-[9px] text-emerald-400 font-semibold px-1 py-0.5 rounded bg-emerald-500/10 ml-auto">✓ exported</span>
        )}
      </div>

      {/* Row 2: time range */}
      <div className="text-[11px] text-slate-300 font-mono mb-0.5">
        {fmt(startTime)} – {fmt(endTime)} <span className="text-slate-500">({fmtDuration(duration)})</span>
      </div>

      {/* Row 3: chat_count · keyword_hits */}
      <div className="text-[10px] text-slate-500 flex items-center gap-2 mb-0.5">
        {typeof c.chat_count === "number" && (
          <span><span className="text-slate-400">{c.chat_count}</span> msgs</span>
        )}
        {typeof c.keyword_hits === "number" && (
          <span><span className="text-slate-400">{c.keyword_hits}</span> kw</span>
        )}
      </div>

      {/* Row 4: top 2 reasons */}
      {c.reasons && c.reasons.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-1.5">
          {c.reasons.slice(0, 2).map((r, i) => (
            <span
              key={i}
              className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-sm whitespace-nowrap"
            >
              {r}
            </span>
          ))}
        </div>
      )}

      {/* Row 5: action buttons */}
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onSelect}
          className="flex-1 px-1.5 py-0.5 text-[9px] rounded bg-violet-600/20 border border-violet-500/40 text-violet-200 hover:bg-violet-500/30"
        >
          確認
        </button>
        <button
          onClick={onEdit}
          className="flex-1 px-1.5 py-0.5 text-[9px] rounded bg-slate-600/30 border border-slate-500/40 text-slate-300 hover:bg-slate-500/30"
        >
          編集
        </button>
        <button
          onClick={onExport}
          disabled={!canExport || isExporting}
          title={!canExport ? "ローカル動画が必要です" : isExported ? "再書き出し" : "書き出し"}
          className="flex-1 px-1.5 py-0.5 text-[9px] rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isExporting ? "⏳" : isExported ? "再書出" : "書出"}
        </button>
      </div>
    </div>
  );
}
