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
  if (s >= 60) return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;
  return `${s.toFixed(0)}s`;
}

interface Props {
  candidate: HighlightCandidate | null;
}

export default function CandidateDetails({ candidate }: Props) {
  if (!candidate) {
    return (
      <div className="glass-panel rounded-lg p-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Candidate Details</div>
        <div className="flex items-center justify-center h-20 text-slate-500 text-xs">
          Select a candidate to view details
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
        Candidate #{candidate.rank} Details
      </div>

      {/* Time info */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">Start</div>
          <div className="text-xs text-slate-200 font-mono">
            {secondsToTwitchTime(startTime)}
            <span className="text-slate-500 ml-1">({startTime.toFixed(1)}s)</span>
          </div>
        </div>
        {endTime != null && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">End</div>
            <div className="text-xs text-slate-200 font-mono">
              {secondsToTwitchTime(endTime)}
              <span className="text-slate-500 ml-1">({endTime.toFixed(1)}s)</span>
            </div>
          </div>
        )}
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">Duration</div>
          <div className="text-xs text-slate-200 font-mono">
            {fmtDuration(duration)}
            <span className="text-slate-500 ml-1">({duration.toFixed(1)}s)</span>
          </div>
        </div>
      </div>

      {typeof candidate.peak_time === "number" && (
        <div className="mb-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">Peak Time</div>
          <div className="text-xs text-amber-400 font-mono">
            {secondsToTwitchTime(candidate.peak_time)}
            <span className="text-slate-500 ml-1">({candidate.peak_time.toFixed(1)}s)</span>
          </div>
        </div>
      )}

      {/* Score & stats */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        {typeof candidate.score === "number" && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">Score</div>
            <div className="text-xs text-amber-400">{candidate.score}</div>
          </div>
        )}
        {typeof candidate.chat_count === "number" && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">Chat</div>
            <div className="text-xs text-slate-200">{candidate.chat_count} messages</div>
          </div>
        )}
        {typeof candidate.keyword_hits === "number" && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">Keywords</div>
            <div className="text-xs text-slate-200">{candidate.keyword_hits} hits</div>
          </div>
        )}
      </div>

      {/* Reasons */}
      {candidate.reasons && candidate.reasons.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Reasons</div>
          <div className="flex flex-col gap-0.5">
            {candidate.reasons.map((r, i) => (
              <div key={i} className="text-xs text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-sm">{r}</div>
            ))}
          </div>
        </div>
      )}

      {/* Matched keywords */}
      {candidate.matched_keywords && candidate.matched_keywords.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Matched Keywords</div>
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
