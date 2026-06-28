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
  onSelect: () => void;
}

export default function CandidateCard({ candidate: c, isSelected, onSelect }: Props) {
  const startTime = c.clip_start ?? c.start ?? c.peak_time ?? 0;
  const endTime = c.end ?? (c.clip_start != null && c.clip_duration != null ? c.clip_start + c.clip_duration : undefined);

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-md p-2 mb-1 transition-all duration-100 ${
        isSelected
          ? "border border-violet-500 shadow-[0_0_0_1px_#7c3aed] bg-slate-700/80"
          : "border border-slate-700/60 bg-slate-800/60 hover:border-slate-500"
      }`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-violet-300">#{c.rank}</span>
        {typeof c.score === "number" && (
          <span className="text-xs font-semibold text-amber-400">score {c.score}</span>
        )}
        {c.output_file && <span className="text-[10px] text-emerald-500 ml-auto">✓ done</span>}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">
        {fmt(startTime)}
        {endTime != null && endTime > startTime && <> – {fmt(endTime)}</>}
        {typeof c.clip_duration === "number" && <> · {fmtDuration(c.clip_duration)}</>}
        {typeof c.chat_count === "number" && <> · {c.chat_count} msgs</>}
        {typeof c.keyword_hits === "number" && <> · {c.keyword_hits} kw</>}
      </div>
      {c.matched_keywords && c.matched_keywords.length > 0 && (
        <div className="text-[10px] text-slate-500 mt-px">
          keywords: {c.matched_keywords.slice(0, 5).join(", ")}
        </div>
      )}
      {c.reasons && c.reasons.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-0.5">
          {c.reasons.slice(0, 3).map((r, i) => (
            <span key={i} className="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 rounded-sm whitespace-nowrap">{r}</span>
          ))}
        </div>
      )}
    </button>
  );
}
