"use client";
import React, { useCallback, useMemo } from "react";
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
  onSelectCandidate: (candidate: HighlightCandidate) => void;
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

function getPeak(c: HighlightCandidate): number {
  return c.peak_time ?? (getStart(c) + getEnd(c)) / 2;
}

export default function TimelineGraph({
  timeline,
  candidates,
  selectedCandidate,
  currentTime,
  duration,
  maxTime,
  onSeek,
  onSelectCandidate,
}: Props) {
  const max = maxTime > 0 ? maxTime : Math.max(duration, ...timeline.map((t) => t.end), ...candidates.map((c) => getEnd(c)), 1);
  const maxScore = Math.max(1, ...timeline.map((t) => t.score));

  const selectedStart = selectedCandidate ? getStart(selectedCandidate) : null;
  const selectedEnd = selectedCandidate ? getEnd(selectedCandidate) : null;
  const selectedPeak = selectedCandidate ? getPeak(selectedCandidate) : null;

  const handleBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const time = ratio * max;
    onSeek(time);
  }, [max, onSeek]);

  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs text-slate-400 font-semibold uppercase tracking-wider">タイムライン</h3>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-slate-500">クリック: 動画位置 / 候補: 候補選択</span>
          {selectedCandidate && selectedStart != null && selectedEnd != null && (
            <span className="text-cyan-300 font-mono font-semibold">
              選択範囲: {fmtTime(selectedStart)} – {fmtTime(selectedEnd)}
            </span>
          )}
        </div>
      </div>

      {/* Timeline bar */}
      <div
        className="relative h-24 bg-slate-900/60 rounded cursor-pointer overflow-hidden border border-slate-800"
        onClick={handleBarClick}
      >
        {/* Chat activity bars (background) */}
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

        {/* Candidate peak markers (subtle) */}
        {candidates.map((c) => {
          const start = getStart(c);
          const end = getEnd(c);
          const peak = getPeak(c);
          const isSelected = selectedCandidate && (selectedCandidate.id ?? selectedCandidate.rank) === (c.id ?? c.rank);
          const rangeLeft = (start / max) * 100;
          const rangeWidth = ((end - start) / max) * 100;
          return (
            <div
              key={`cand-range-${c.id ?? c.rank}`}
              className={`absolute top-0 bottom-0 border pointer-events-none ${
                isSelected ? "opacity-0" : "opacity-100"
              }`}
              style={{
                left: `${rangeLeft}%`,
                width: `${rangeWidth}%`,
                borderColor: "rgba(139, 92, 246, 0.4)",
                backgroundColor: "rgba(139, 92, 246, 0.06)",
              }}
            />
          );
        })}

        {/* SELECTED CANDIDATE - prominent highlight band */}
        {selectedStart != null && selectedEnd != null && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `${(selectedStart / max) * 100}%`,
              width: `${((selectedEnd - selectedStart) / max) * 100}%`,
              backgroundColor: "rgba(34, 211, 238, 0.20)",
              borderLeft: "2px solid #22d3ee",
              borderRight: "2px solid #22d3ee",
            }}
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-cyan-400/50" />
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-cyan-400/50" />
          </div>
        )}

        {/* SELECTED PEAK marker - prominent */}
        {selectedPeak != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 pointer-events-none z-20"
            style={{ left: `${(selectedPeak / max) * 100}%` }}
          >
            <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-amber-400 rounded-full ring-2 ring-amber-300/50" />
            <div className="absolute -top-4 left-2 text-[9px] font-bold text-amber-300 bg-slate-900/80 px-1 rounded">PEAK</div>
          </div>
        )}

        {/* Candidate rank markers (clickable) */}
        {candidates.map((c) => {
          const isSelected = selectedCandidate && (selectedCandidate.id ?? selectedCandidate.rank) === (c.id ?? c.rank);
          const peak = getPeak(c);
          const peakLeft = (peak / max) * 100;

          return (
            <button
              key={`cand-marker-${c.id ?? c.rank}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectCandidate(c);
              }}
              title={`#${c.rank} (クリックで選択)`}
              className={`absolute top-0 pointer-events-auto z-10 group ${
                isSelected ? "opacity-0" : "opacity-100"
              }`}
              style={{
                left: `${peakLeft}%`,
                transform: "translateX(-50%)",
              }}
            >
              <div className="relative flex flex-col items-center">
                <div className="text-[10px] font-bold text-amber-200 bg-slate-900/90 border border-amber-500/60 rounded-full w-5 h-5 flex items-center justify-center group-hover:scale-110 group-hover:bg-amber-500/30 transition-transform">
                  {c.rank}
                </div>
                <div className="w-px h-3 bg-amber-400/50" />
              </div>
            </button>
          );
        })}

        {/* Current time indicator (playhead) */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 pointer-events-none z-30"
          style={{ left: `${(currentTime / max) * 100}%` }}
        >
          <div className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-emerald-400 rounded-full ring-2 ring-emerald-300/50" />
          <div className="absolute -top-6 left-1 text-[9px] font-mono text-emerald-300 bg-slate-900/80 px-1 rounded whitespace-nowrap">
            {fmtTime(currentTime)}
          </div>
        </div>
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-[9px] text-slate-600 mt-2 px-px">
        <span>0:00</span>
        <span>{fmtTime(max / 4)}</span>
        <span>{fmtTime(max / 2)}</span>
        <span>{fmtTime((max * 3) / 4)}</span>
        <span>{fmtTime(max)}</span>
      </div>
    </div>
  );
}
