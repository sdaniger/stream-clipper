"use client";
import React, { useCallback, useMemo } from "react";
import type { TimelineRow } from "@/lib/studio-api";
import type { HighlightCandidate } from "@/lib/twitch-time";
import { useI18n } from "@/lib/i18n";

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

function fmtDur(v: number): string {
  if (v >= 60) {
    const min = Math.floor(v / 60);
    return `${min}分`;
  }
  return `${Math.round(v)}秒`;
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

function getDuration(c: HighlightCandidate): number {
  return (c.clip_duration ?? (getEnd(c) - getStart(c))) || 30;
}

export default function TimelineGraph({
  timeline, candidates, selectedCandidate, currentTime, duration, maxTime,
  onSeek, onSelectCandidate,
}: Props) {
  const { locale } = useI18n();
  const isJa = locale === "ja";
  const max = maxTime > 0 ? maxTime : Math.max(duration, ...timeline.map((t) => t.end ?? 0), ...candidates.map((c) => getEnd(c)), 1);
  const maxScore = Math.max(1, ...timeline.map((t) => t.score ?? 0));

  const selectedStart = selectedCandidate ? getStart(selectedCandidate) : null;
  const selectedEnd = selectedCandidate ? getEnd(selectedCandidate) : null;
  const selectedPeak = selectedCandidate ? getPeak(selectedCandidate) : null;

  // Peak centers for selected candidate (from score or peak_centers)
  const peakCenters = useMemo(() => {
    if (!selectedCandidate) return [];
    if (selectedCandidate.peak_centers && selectedCandidate.peak_centers.length > 0) {
      return selectedCandidate.peak_centers;
    }
    if (selectedPeak != null) return [selectedPeak];
    return [];
  }, [selectedCandidate, selectedPeak]);

  const handleBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const time = ratio * max;
    onSeek(time);
  }, [max, onSeek]);

  return (
    <div className="bg-slate-900/60 rounded-xl p-3 sm:p-4 border border-slate-700/40">
      {/* Header: title + selected range info */}
      <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
        <h3 className="text-[10px] sm:text-xs text-slate-400 font-semibold uppercase tracking-wider">
          {isJa ? "タイムライン" : "Timeline"}
        </h3>
      </div>

      {/* Selected range info */}
      {selectedCandidate && selectedStart != null && selectedEnd != null && (
        <div className="mb-2 px-2 py-1.5 bg-slate-800/60 border border-slate-700/40 rounded-lg text-[10px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-cyan-300 font-semibold">{isJa ? "選択範囲" : "Selected"}:</span>
            <span className="text-slate-200 font-mono">{fmtTime(selectedStart)} – {fmtTime(selectedEnd)}</span>
            <span className="text-slate-500">/ {fmtDur(getDuration(selectedCandidate))}</span>
            {selectedPeak != null && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-amber-300 font-semibold">{isJa ? "ピーク" : "Peak"}: {fmtTime(selectedPeak)}</span>
              </>
            )}
            {peakCenters.length > 1 && (
              <span className="text-slate-500">({peakCenters.length}{isJa ? "ピーク" : " peaks"})</span>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-2 sm:gap-3 mb-2 text-[8px] sm:text-[9px] text-slate-500 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-violet-500/60 inline-block" />
          {isJa ? "チャット量" : "Chat activity"}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" />
          {isJa ? "候補範囲" : "Candidate"}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-1 rounded-sm bg-cyan-400 inline-block" />
          {isJa ? "選択中" : "Selected"}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          {isJa ? "再生位置" : "Playhead"}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-300 inline-block ring-1 ring-amber-300/50" />
          {isJa ? "最大ピーク" : "Max peak"}
        </span>
      </div>

      {/* Timeline bar */}
      <div
        className="relative h-20 sm:h-24 bg-slate-950/80 rounded cursor-pointer overflow-hidden border border-slate-800"
        onClick={handleBarClick}
      >
        {/* Chat activity bars */}
        {timeline.map((t, i) => {
          const left = ((t.start ?? 0) / max) * 100;
          const width = Math.max((((t.end ?? t.start ?? 0) - (t.start ?? 0)) / max) * 100, 0.5);
          const height = ((t.score ?? 0) / maxScore) * 100;
          return (
            <div
              key={`tl-${i}`}
              className="absolute bottom-0 bg-violet-500/60 hover:bg-violet-400/80 transition-colors"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                height: `${Math.max(2, height)}%`,
              }}
              title={`${fmtTime(t.start ?? 0)} - ${fmtTime(t.end ?? 0)}: ${(t.score ?? 0).toFixed(1)} · ${(t.chat_count ?? 0)} msgs`}
            />
          );
        })}

        {/* Candidate range markers (non-selected) */}
        {candidates.map((c) => {
          const start = getStart(c);
          const end = getEnd(c);
          const isSelected = selectedCandidate && (selectedCandidate.id ?? selectedCandidate.rank) === (c.id ?? c.rank);
          if (isSelected) return null;
          const rangeLeft = (start / max) * 100;
          const rangeWidth = ((end - start) / max) * 100;
          return (
            <div
              key={`cand-range-${c.id ?? c.rank}`}
              className="absolute top-0 bottom-0 border-l border-r border-amber-500/30"
              style={{
                left: `${rangeLeft}%`,
                width: `${rangeWidth}%`,
                backgroundColor: "rgba(217, 119, 6, 0.06)",
              }}
            />
          );
        })}

        {/* SELECTED CANDIDATE highlight */}
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

        {/* Peak markers for selected candidate */}
        {peakCenters.map((peak: number, idx: number) => (
          <div
            key={`peak-${idx}`}
            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 pointer-events-none z-20"
            style={{ left: `${(peak / max) * 100}%` }}
          >
            <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-amber-400 rounded-full ring-2 ring-amber-300/50" />
            {idx === 0 && (
              <div className="absolute -top-4 left-2 text-[8px] font-bold text-amber-300 bg-slate-900/80 px-1 rounded whitespace-nowrap">
                {isJa ? "ピーク" : "PEAK"}
              </div>
            )}
          </div>
        ))}

        {/* Candidate rank markers */}
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
              title={`#${c.rank} (${isJa ? "クリックで選択" : "click to select"})`}
              className={`absolute top-0 pointer-events-auto z-10 group ${
                isSelected ? "opacity-0" : "opacity-100"
              }`}
              style={{ left: `${peakLeft}%`, transform: "translateX(-50%)" }}
            >
              <div className="relative flex flex-col items-center">
                <div className="text-[9px] font-bold text-amber-200 bg-slate-900/90 border border-amber-500/60 rounded-full w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center group-hover:scale-110 group-hover:bg-amber-500/30 transition-transform">
                  {c.rank}
                </div>
                <div className="w-px h-2 sm:h-3 bg-amber-400/50" />
              </div>
            </button>
          );
        })}

        {/* Current time indicator */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 pointer-events-none z-30"
          style={{ left: `${(currentTime / max) * 100}%` }}
        >
          <div className="absolute -top-1 -left-1 w-2 h-2 bg-emerald-400 rounded-full ring-2 ring-emerald-300/50" />
          <div className="absolute -top-5 left-1 text-[8px] font-mono text-emerald-300 bg-slate-900/80 px-1 rounded whitespace-nowrap">
            {fmtTime(currentTime)}
          </div>
        </div>
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-[8px] sm:text-[9px] text-slate-600 mt-1.5 px-px">
        <span>0:00</span>
        <span>{fmtTime(max / 4)}</span>
        <span>{fmtTime(max / 2)}</span>
        <span>{fmtTime((max * 3) / 4)}</span>
        <span>{fmtTime(max)}</span>
      </div>

      {/* Candidate info footer */}
      {selectedCandidate && (
        <div className="mt-1.5 flex items-center gap-2 text-[9px] text-slate-500 border-t border-slate-800/60 pt-1.5">
          <span>{isJa ? "候補" : "Candidate"} #{selectedCandidate.rank}</span>
          <span>🔥 {(selectedCandidate.score ?? 0).toFixed(1)}</span>
          {selectedCandidate.chat_count != null && (
            <span>💬 {selectedCandidate.chat_count}</span>
          )}
        </div>
      )}
    </div>
  );
}
