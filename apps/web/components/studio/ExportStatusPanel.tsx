"use client";
import React from "react";

interface Props {
  mode: "twitch" | "local";
  videoPath: string;
  twitchVodId: string | null;
  exportedCount: number;
  totalCandidates: number;
  onSelectLocalFile: () => void;
}

export default function ExportStatusPanel({
  mode,
  videoPath,
  twitchVodId,
  exportedCount,
  totalCandidates,
  onSelectLocalFile,
}: Props) {
  const twitchReady = mode === "twitch" && !!twitchVodId;
  const localReady = mode === "local" && videoPath.trim().length > 0;
  const canExport = localReady;

  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2">書き出しステータス</div>

      {/* Twitch Preview */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={twitchReady ? "text-emerald-400" : "text-slate-600"}>
            {twitchReady ? "✓" : "○"}
          </span>
          <span className="text-[11px] text-slate-300">Twitch プレビュー</span>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          twitchReady
            ? "text-emerald-400 bg-emerald-500/10"
            : "text-slate-500 bg-slate-700/30"
        }`}>
          {twitchReady ? "利用可" : "VOD未読込"}
        </span>
      </div>

      {/* Local File */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={localReady ? "text-emerald-400" : "text-amber-400"}>
            {localReady ? "✓" : "△"}
          </span>
          <span className="text-[11px] text-slate-300">MP4 書き出し</span>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          localReady
            ? "text-emerald-400 bg-emerald-500/10"
            : "text-amber-400 bg-amber-500/10"
        }`}>
          {localReady ? "ローカル動画あり" : "ローカル動画が必要"}
        </span>
      </div>

      {/* Disabled reason */}
      {!canExport && (
        <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[10px] text-amber-200">
          <div className="font-semibold mb-1">⚠ MP4 書き出しは無効です</div>
          <div className="text-amber-300/80">
            {mode === "twitch"
              ? "Twitch VOD はプレビュー専用です。MP4 書き出しには「Local File」モードで動画ファイルを指定してください。"
              : "動画ファイルのパスを入力してください。"}
          </div>
          {mode === "twitch" && (
            <button
              onClick={onSelectLocalFile}
              className="mt-1.5 w-full px-2 py-1 text-[10px] rounded bg-amber-600/30 border border-amber-500/50 text-amber-100 hover:bg-amber-500/40 font-semibold"
            >
              Local File モードに切替 →
            </button>
          )}
        </div>
      )}

      {/* Stats */}
      {totalCandidates > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center justify-between text-[10px] text-slate-500">
          <span>候補 {totalCandidates}件</span>
          <span className="text-emerald-400">
            書き出し済み {exportedCount}件
          </span>
        </div>
      )}
    </div>
  );
}
