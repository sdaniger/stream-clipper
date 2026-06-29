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
  isDanmakuExported: boolean;
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
  isDanmakuExported,
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
          ? "border border-cyan-500 shadow-[0_0_0_1px_#22d3ee] bg-slate-700/80"
          : "border border-slate-700/60 bg-slate-800/60 hover:border-slate-500"
      }`}
    >
      {/* Row 1: rank · score · exported badges */}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-sm font-bold text-cyan-300">#{c.rank}</span>
        {typeof c.score === "number" && (
          <span className="text-[10px] text-amber-400 font-semibold">score {c.score}</span>
        )}
        {isDanmakuExported && (
          <span className="text-[9px] text-fuchsia-400 font-semibold px-1 py-0.5 rounded bg-fuchsia-500/10">🎬 弾幕出力済</span>
        )}
        {isExported && (
          <span className="text-[9px] text-emerald-400 font-semibold px-1 py-0.5 rounded bg-emerald-500/10 ml-auto">✓ 書き出し済み</span>
        )}
      </div>

      {/* Row 2: time range */}
      <div className="text-[11px] text-slate-200 font-mono font-semibold mb-0.5">
        {fmt(startTime)} – {fmt(endTime)} <span className="text-slate-500 font-normal">({fmtDuration(duration)})</span>
      </div>

      {/* Row 3: chat_count · keyword_hits */}
      <div className="text-[10px] text-slate-500 flex items-center gap-2 mb-0.5">
        {typeof c.chat_count === "number" && (
          <span>コメント <span className="text-slate-300 font-semibold">{c.chat_count}</span></span>
        )}
        {typeof c.keyword_hits === "number" && (
          <span>KW <span className="text-slate-300 font-semibold">{c.keyword_hits}</span></span>
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

      {/* Row 5: action buttons - 見る / 調整 / 書き出し */}
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onSelect}
          className={`flex-1 px-1.5 py-0.5 text-[10px] rounded font-semibold ${
            isSelected
              ? "bg-cyan-600/40 border border-cyan-500/60 text-cyan-100"
              : "bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/30"
          }`}
        >
          見る
        </button>
        <button
          onClick={onEdit}
          className="flex-1 px-1.5 py-0.5 text-[10px] rounded bg-slate-600/30 border border-slate-500/40 text-slate-300 hover:bg-slate-500/30 font-semibold"
        >
          調整
        </button>
        <button
          onClick={onExport}
          disabled={!canExport || isExporting}
          title={!canExport ? "ローカル動画が必要です" : isExported ? "再書き出し" : "書き出し"}
          className="flex-1 px-1.5 py-0.5 text-[10px] rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
        >
          {isExporting ? "⏳" : "書き出し"}
        </button>
      </div>
    </div>
  );
}
