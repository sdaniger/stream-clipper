"use client";
import React from "react";
import type { HighlightCandidate } from "@/lib/twitch-time";
import { secondsToTwitchTime } from "@/lib/twitch-time";

type ExportStatus = "idle" | "exporting" | "exported" | "error";

interface Props {
  candidate: HighlightCandidate;
  hasLocalVideo: boolean;
  localVideoPath: string | null;
  currentTime: number;
  isPlayerAvailable: boolean;
  singleExportStatus: ExportStatus;
  batchExportStatus: ExportStatus;
  onJumpStart: () => void;
  onJumpPeak: () => void;
  onJumpEnd: () => void;
  onPreviewRange: () => void;
  onSetStartFromCurrent: () => void;
  onSetEndFromCurrent: () => void;
  onExportThisClip: () => void;
  onExportTop5: () => void;
  onSelectLocalVideo: () => void;
}

function fmtClock(v: number): string {
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

export default function ClipActionPanel({
  candidate: c,
  hasLocalVideo,
  localVideoPath,
  currentTime,
  isPlayerAvailable,
  singleExportStatus,
  batchExportStatus,
  onJumpStart,
  onJumpPeak,
  onJumpEnd,
  onPreviewRange,
  onSetStartFromCurrent,
  onSetEndFromCurrent,
  onExportThisClip,
  onExportTop5,
  onSelectLocalVideo,
}: Props) {
  const startTime = getStart(c);
  const endTime = getEnd(c);
  const peakTime = c.peak_time ?? (startTime + endTime) / 2;
  const duration = endTime - startTime;

  const inRange = currentTime >= startTime && currentTime <= endTime;
  const canSetStart = isPlayerAvailable && !inRange;
  const canSetEnd = isPlayerAvailable && !inRange;

  const exportDisabledReason = !hasLocalVideo
    ? "MP4 書き出しにはローカル動画ファイルが必要です"
    : !localVideoPath
      ? "ローカル動画ファイルが指定されていません"
      : null;

  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-violet-300">#{c.rank}</span>
          {typeof c.score === "number" && (
            <span className="text-[10px] text-amber-400 font-semibold">score {c.score}</span>
          )}
          {c.output_file && (
            <span className="text-[10px] text-emerald-400 font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10">✓ exported</span>
          )}
        </div>
        <div className="text-[10px] text-slate-500 font-mono">
          now: {fmtClock(currentTime)}
        </div>
      </div>

      {/* Time range summary */}
      <div className="grid grid-cols-4 gap-1 mb-2 text-center">
        <div>
          <div className="text-[9px] text-slate-500 uppercase">Start</div>
          <div className="text-[11px] text-slate-200 font-mono">{secondsToTwitchTime(startTime)}</div>
        </div>
        <div>
          <div className="text-[9px] text-amber-400 uppercase">Peak</div>
          <div className="text-[11px] text-amber-300 font-mono">{secondsToTwitchTime(peakTime)}</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500 uppercase">End</div>
          <div className="text-[11px] text-slate-200 font-mono">{secondsToTwitchTime(endTime)}</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500 uppercase">Dur</div>
          <div className="text-[11px] text-slate-200 font-mono">{fmtClock(duration)}</div>
        </div>
      </div>

      {/* Jump buttons */}
      <div className="grid grid-cols-4 gap-1 mb-2">
        <button
          onClick={onJumpStart}
          disabled={!isPlayerAvailable}
          className="px-2 py-1 text-[11px] rounded bg-slate-700/70 border border-slate-600 text-slate-200 hover:bg-slate-600/70 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Jump to start of clip"
        >
          ⏮ Start
        </button>
        <button
          onClick={onJumpPeak}
          disabled={!isPlayerAvailable}
          className="px-2 py-1 text-[11px] rounded bg-amber-600/30 border border-amber-500/50 text-amber-200 hover:bg-amber-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Jump to peak time"
        >
          ⭐ Peak
        </button>
        <button
          onClick={onJumpEnd}
          disabled={!isPlayerAvailable}
          className="px-2 py-1 text-[11px] rounded bg-slate-700/70 border border-slate-600 text-slate-200 hover:bg-slate-600/70 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Jump to end of clip"
        >
          ⏭ End
        </button>
        <button
          onClick={onPreviewRange}
          disabled={!isPlayerAvailable}
          className="px-2 py-1 text-[11px] rounded bg-violet-600/30 border border-violet-500/50 text-violet-200 hover:bg-violet-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Play from start to end"
        >
          ▶ Preview
        </button>
      </div>

      {/* Set from current */}
      <div className="grid grid-cols-2 gap-1 mb-2">
        <button
          onClick={onSetStartFromCurrent}
          disabled={canSetStart}
          className="px-2 py-1 text-[11px] rounded bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Set start time to current playhead"
        >
          ⊙ Start ← current
        </button>
        <button
          onClick={onSetEndFromCurrent}
          disabled={canSetEnd}
          className="px-2 py-1 text-[11px] rounded bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Set end time to current playhead"
        >
          End ← current ⊙
        </button>
      </div>

      {/* Export buttons */}
      <div className="border-t border-slate-700/50 pt-2 mt-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">書き出し</span>
          {exportDisabledReason && (
            <span className="text-[9px] text-amber-400">⚠ {exportDisabledReason}</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button
            onClick={onExportThisClip}
            disabled={!!exportDisabledReason || singleExportStatus === "exporting"}
            className="px-2 py-1.5 text-[11px] rounded bg-emerald-600/30 border border-emerald-500/50 text-emerald-200 hover:bg-emerald-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
            title={exportDisabledReason ?? "Export this candidate as MP4"}
          >
            {singleExportStatus === "exporting" ? "⏳ 書き出し中..." : "📥 この候補を書き出し"}
          </button>
          <button
            onClick={onExportTop5}
            disabled={!!exportDisabledReason || batchExportStatus === "exporting"}
            className="px-2 py-1.5 text-[11px] rounded bg-emerald-600/30 border border-emerald-500/50 text-emerald-200 hover:bg-emerald-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
            title={exportDisabledReason ?? "Export top 5 candidates as MP4"}
          >
            {batchExportStatus === "exporting" ? "⏳ 一括書き出し中..." : "📥 Top 5 を一括書き出し"}
          </button>
        </div>
        {!hasLocalVideo && (
          <button
            onClick={onSelectLocalVideo}
            className="w-full mt-1 px-2 py-1 text-[10px] rounded bg-slate-700/40 border border-slate-600/50 text-slate-300 hover:bg-slate-600/40"
          >
            ローカル動画を指定 →
          </button>
        )}
      </div>
    </div>
  );
}
