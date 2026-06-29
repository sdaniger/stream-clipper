"use client";
import React from "react";
import type { TimelineRow } from "@/lib/studio-api";
import type { HighlightCandidate } from "@/lib/twitch-time";

interface Props {
  timeline: TimelineRow[];
  candidates: HighlightCandidate[];
  selectedCandidate: HighlightCandidate | null;
  currentTime: number;
  duration: number;
  maxTime: number;
  onSeek: (time: number) => void;
}

function fmtTime(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getStart(c: HighlightCandidate): number {
  return c.clip_start ?? c.start ?? c.peak_time ?? 0;
}

function getEnd(c: HighlightCandidate): number {
  return c.end ?? (c.clip_start != null && c.clip_duration != null ? c.clip_start + c.clip_duration : getStart(c) + 30);
}

export default function TimelineGraph({
  timeline,
  candidates,
  selectedCandidate,
  currentTime,
  duration,
  maxTime,
  onSeek,
}: Props) {
  const max = maxTime > 0 ? maxTime : Math.max(duration, ...timeline.map((t) => t.end), ...candidates.map((c) => getEnd(c)), 1);
  const maxScore = Math.max(1, ...timeline.map((t) => t.score));

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const time = ratio * max;
    onSeek(time);
  };

  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs text-slate-400 font-semibold uppercase tracking-wider">タイムライン</h3>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-slate-500">バー: クリックして seek</span>
          {selectedCandidate && (
            <span className="text-amber-400 font-mono">
              選択中: {fmtTime(getStart(selectedCandidate))} – {fmtTime(getEnd(selectedCandidate))}
            </span>
          )}
        </div>
      </div>

      {/* Timeline bar */}
      <div
        className="relative h-20 bg-slate-900/60 rounded cursor-pointer overflow-hidden border border-slate-800"
        onClick={handleBarClick}
      >
        {/* Chat activity bars */}
        {timeline.map((t, i) => {
          const left = (t.start / max) * 100;
          const width = Math.max(((t.end - t.start) / max) * 100, 0.5);
          const height = (t.score / maxScore) * 100;
          return (
            <div
              key={`tl-${i}`}
              className="absolute bottom-0 bg-violet-500/60 hover:bg-violet-400/80 transition-colors"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                height: `${Math.max(2, height)}%`,
              }}
              title={`${fmtTime(t.start)} - ${fmtTime(t.end)}: score ${t.score.toFixed(1)} · ${t.chat_count} msgs · ${t.keyword_hits} kw`}
            />
          );
        })}

        {/* Candidate peak markers */}
        {candidates.map((c) => {
          const start = getStart(c);
          const end = getEnd(c);
          const peak = c.peak_time ?? (start + end) / 2;
          const isSelected = selectedCandidate && (selectedCandidate.id ?? selectedCandidate.rank) === (c.id ?? c.rank);
          const left = (peak / max) * 100;
          const rangeLeft = (start / max) * 100;
          const rangeWidth = ((end - start) / max) * 100;
          return (
            <React.Fragment key={`cand-${c.id ?? c.rank}`}>
              {/* Highlight range */}
              <div
                className="absolute top-0 bottom-0 border-2 pointer-events-none"
                style={{
                  left: `${rangeLeft}%`,
                  width: `${rangeWidth}%`,
                  borderColor: isSelected ? "#22d3ee" : "rgba(139, 92, 246, 0.5)",
                  backgroundColor: isSelected ? "rgba(34, 211, 238, 0.15)" : "rgba(139, 92, 246, 0.08)",
                }}
              />
              {/* Peak marker */}
              <div
                className="absolute top-0 bottom-0 w-px pointer-events-none"
                style={{
                  left: `${left}%`,
                  backgroundColor: isSelected ? "#fbbf24" : "#a78bfa",
                }}
                title={`#${c.rank} peak at ${fmtTime(peak)}`}
              />
              {/* Rank label */}
              <div
                className="absolute top-0 text-[9px] font-bold pointer-events-none"
                style={{
                  left: `calc(${left}% + 2px)`,
                  color: isSelected ? "#fbbf24" : "#c4b5fd",
                }}
              >
                #{c.rank}
              </div>
            </React.Fragment>
          );
        })}

        {/* Current time indicator */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 pointer-events-none z-10"
          style={{ left: `${(currentTime / max) * 100}%` }}
        >
          <div className="absolute -top-1 -left-1 w-2 h-2 bg-emerald-400 rounded-full" />
        </div>
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-[9px] text-slate-600 mt-1 px-px">
        <span>0:00</span>
        <span>{fmtTime(max / 4)}</span>
        <span>{fmtTime(max / 2)}</span>
        <span>{fmtTime((max * 3) / 4)}</span>
        <span>{fmtTime(max)}</span>
      </div>
    </div>
  );
}
