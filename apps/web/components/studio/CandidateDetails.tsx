"use client";
import React from "react";
import type { HighlightCandidate } from "@/lib/twitch-time";
import { secondsToTwitchTime } from "@/lib/twitch-time";

function fmt(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDuration(s: number): string {
  if (s >= 60) return `${Math.floor(s / 60)}分${Math.floor(s % 60)}秒`;
  return `${s.toFixed(0)}秒`;
}

interface Props {
  candidate: HighlightCandidate | null;
}

export default function CandidateDetails({ candidate }: Props) {
  if (!candidate) {
    return (
      <div className="glass-panel rounded-lg p-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">候補の詳細</div>
        <div className="flex items-center justify-center h-16 text-slate-500 text-xs">
          候補を選択してください
        </div>
      </div>
    );
  }

  const startTime = candidate.clip_start ?? candidate.start ?? candidate.peak_time ?? 0;
  const endTime = candidate.end ?? (candidate.clip_start != null && candidate.clip_duration != null ? candidate.clip_start + candidate.clip_duration : undefined);
  const duration = endTime != null ? endTime - startTime : (candidate.clip_duration ?? 0);

  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
        候補 #{candidate.rank} の詳細
      </div>

      {/* Time info - more user friendly */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <div>
          <div className="text-[10px] text-slate-500 uppercase">開始</div>
          <div className="text-xs text-slate-200 font-mono font-semibold">{secondsToTwitchTime(startTime)}</div>
        </div>
        {endTime != null && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase">終了</div>
            <div className="text-xs text-slate-200 font-mono font-semibold">{secondsToTwitchTime(endTime)}</div>
          </div>
        )}
        <div>
          <div className="text-[10px] text-slate-500 uppercase">尺</div>
          <div className="text-xs text-slate-200 font-mono font-semibold">{fmtDuration(duration)}</div>
        </div>
      </div>

      {typeof candidate.peak_time === "number" && (
        <div className="mb-2">
          <div className="text-[10px] text-amber-400 uppercase">盛り上がりピーク</div>
          <div className="text-xs text-amber-300 font-mono font-semibold">{secondsToTwitchTime(candidate.peak_time)}</div>
        </div>
      )}

      {/* Score & stats - friendly labels */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        {typeof candidate.score === "number" && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase">総合スコア</div>
            <div className="text-xs text-amber-400 font-semibold">{candidate.score}</div>
          </div>
        )}
        {typeof candidate.chat_count === "number" && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase">コメント数</div>
            <div className="text-xs text-slate-200 font-semibold">{candidate.chat_count} 件</div>
          </div>
        )}
        {typeof candidate.keyword_hits === "number" && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase">リアクションKW</div>
            <div className="text-xs text-slate-200 font-semibold">{candidate.keyword_hits} 件</div>
          </div>
        )}
      </div>

      {/* All reasons */}
      {candidate.reasons && candidate.reasons.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] text-slate-500 uppercase mb-1">検出理由</div>
          <div className="flex flex-col gap-0.5">
            {candidate.reasons.map((r, i) => (
              <div key={i} className="text-[11px] text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded">{r}</div>
            ))}
          </div>
        </div>
      )}

      {/* Matched keywords */}
      {candidate.matched_keywords && candidate.matched_keywords.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-500 uppercase mb-1">検出されたキーワード</div>
          <div className="flex gap-1 flex-wrap">
            {candidate.matched_keywords.map((kw, i) => (
              <span key={i} className="text-[10px] text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded-sm">{kw}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
