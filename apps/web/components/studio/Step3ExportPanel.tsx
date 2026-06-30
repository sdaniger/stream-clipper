"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";
import type { Candidate } from "@/lib/studio-jobs-api";
import JobProgress from "./JobProgress";
import type { JobState } from "@/lib/studio-jobs-api";

interface Props {
  candidate: Candidate | null;
  selectedCandidates: Candidate[];  // for top-N batch
  chatInRangeCount: number;
  outputDir: string;
  withDanmaku: boolean;
  setWithDanmaku: (v: boolean) => void;
  ffmpegPreset: "ultrafast" | "veryfast" | "fast" | "medium" | "slow";
  setFfmpegPreset: (v: "ultrafast" | "veryfast" | "fast" | "medium" | "slow") => void;
  ffmpegCrf: number;
  setFfmpegCrf: (v: number) => void;
  sourceMode: "twitch_vod" | "local_file" | "ass_only";
  setSourceMode: (v: "twitch_vod" | "local_file" | "ass_only") => void;
  localFilePath: string;
  setLocalFilePath: (v: string) => void;
  // Job progress
  currentJob: JobState | null;
  // Last result for the most recent render
  lastResult: {
    output_file?: string;
    ass_file?: string;
    metadata_path?: string;
    youtube?: {
      title: string;
      description: string;
      tags: string[];
    };
  } | null;
  // Actions
  onExportSelected: () => void;
  onExportTop5: () => void;
  onExportAllShort: () => void;
  onExportAllMedium: () => void;
  onExportAllLong: () => void;
  onCancel: () => void;
  onDismissJob: () => void;
  // Source availability
  vodUrlAvailable: boolean;
  counts: { short: number; medium: number; long: number };
}

function fmtClock(v: number): string {
  const safe = Math.max(0, v);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Step3ExportPanel({
  candidate,
  selectedCandidates,
  chatInRangeCount,
  outputDir,
  withDanmaku,
  setWithDanmaku,
  ffmpegPreset,
  setFfmpegPreset,
  ffmpegCrf,
  setFfmpegCrf,
  sourceMode,
  setSourceMode,
  localFilePath,
  setLocalFilePath,
  currentJob,
  lastResult,
  onExportSelected,
  onExportTop5,
  onExportAllShort,
  onExportAllMedium,
  onExportAllLong,
  onCancel,
  onDismissJob,
  vodUrlAvailable,
  counts,
}: Props) {
  const { t } = useI18n();

  if (!candidate && selectedCandidates.length === 0) {
    return (
      <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-700/40">
        <div className="text-base font-semibold text-slate-200 mb-2">
          🎬 {t("studio.step3Title") || "Step 3: 生成"}
        </div>
        <div className="text-xs text-slate-400 mb-3">
          Step 2 で候補を選ぶと生成オプションが出ます。
          「上位5本を一括生成」ボタンで Shorts / 通常 / 長尺 をまとめて書き出せます。
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-700/40 space-y-3">
      <div>
        <div className="text-base font-semibold text-slate-200 mb-1">
          🎬 Step 3: 生成 & 進捗
        </div>
        <div className="text-[11px] text-slate-400">
          単一候補の生成・上位5本一括・Shorts/通常/長尺 別の一括生成を選べます。
        </div>
      </div>

      {/* Selected candidate summary */}
      {candidate && (
        <div className="bg-slate-800/60 rounded p-2.5 border border-slate-700/40">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
            選択中の候補
          </div>
          <div className="text-sm text-slate-100 font-mono font-semibold">
            #{candidate.rank} · {candidate.kind === "short" ? "Shorts" : candidate.kind === "long" ? "長尺" : "通常"} ·{" "}
            {fmtClock(candidate.clip_start)} – {fmtClock(candidate.clip_end)}{" "}
            <span className="text-slate-500 font-normal">
              ({Math.round(candidate.clip_duration)}秒)
            </span>
          </div>
          <div className="mt-1.5 text-[10px] text-slate-500">
            Chat in range: <span className="text-cyan-300 font-semibold">{chatInRangeCount}</span>
          </div>
        </div>
      )}

      {/* Source */}
      <div>
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
          ソース
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-slate-800/40 text-[11px]">
            <input
              type="radio"
              name="source"
              checked={sourceMode === "twitch_vod"}
              onChange={() => setSourceMode("twitch_vod")}
            />
            <span>📺 Twitch VOD (推奨)</span>
            {!vodUrlAvailable && (
              <span className="text-[9px] text-amber-400 ml-1">URL未設定</span>
            )}
          </label>
          <label className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-slate-800/40 text-[11px]">
            <input
              type="radio"
              name="source"
              checked={sourceMode === "local_file"}
              onChange={() => setSourceMode("local_file")}
            />
            <span>📁 ローカルファイル</span>
          </label>
          <label className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-slate-800/40 text-[11px]">
            <input
              type="radio"
              name="source"
              checked={sourceMode === "ass_only"}
              onChange={() => setSourceMode("ass_only")}
            />
            <span>📄 ASS のみ生成 (動画なし)</span>
          </label>
        </div>
        {sourceMode === "local_file" && (
          <input
            type="text"
            value={localFilePath}
            onChange={(e) => setLocalFilePath(e.target.value)}
            placeholder="/path/to/video.mp4"
            className="w-full mt-1.5 px-2 py-1.5 bg-slate-800/60 border border-slate-700/40 rounded text-[11px] text-slate-200 focus:outline-none focus:border-cyan-500/60"
          />
        )}
      </div>

      {/* Danmaku + FFmpeg options */}
      <div>
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
          出力オプション
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-slate-800/40 text-[11px] cursor-pointer">
            <input
              type="checkbox"
              checked={withDanmaku}
              onChange={(e) => setWithDanmaku(e.target.checked)}
            />
            <span>弾幕あり (ハードエンコード)</span>
          </label>
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-slate-800/40 text-[11px]">
            <span>preset</span>
            <select
              value={ffmpegPreset}
              onChange={(e) => setFfmpegPreset(e.target.value as any)}
              className="bg-slate-900/60 border border-slate-700/40 rounded text-[11px] px-1 py-0.5"
            >
              <option value="ultrafast">ultrafast</option>
              <option value="veryfast">veryfast</option>
              <option value="fast">fast</option>
              <option value="medium">medium</option>
              <option value="slow">slow</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-slate-800/40 text-[11px]">
            <span>crf</span>
            <input
              type="number"
              value={ffmpegCrf}
              onChange={(e) => setFfmpegCrf(Number(e.target.value))}
              min={15}
              max={35}
              className="w-12 bg-slate-900/60 border border-slate-700/40 rounded text-[11px] px-1 py-0.5"
            />
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-slate-800/40 text-[11px]">
            <span>📂</span>
            <span className="truncate" title={outputDir}>{outputDir}</span>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      {!currentJob && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onExportSelected}
            disabled={!candidate}
            className="px-3 py-2.5 text-sm font-bold rounded bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-lg shadow-cyan-500/30 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            🎬 この候補を生成
          </button>
          <button
            type="button"
            onClick={onExportTop5}
            disabled={selectedCandidates.length === 0}
            className="px-3 py-2.5 text-sm font-bold rounded bg-gradient-to-r from-amber-500 to-pink-500 text-white shadow-lg shadow-amber-500/30 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ⚡ 上位5本を一括生成
          </button>
        </div>
      )}

      {!currentJob && (
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={onExportAllShort}
            disabled={counts.short === 0}
            className="px-2 py-1.5 text-[11px] font-semibold rounded bg-slate-700/40 border border-slate-600/40 text-slate-200 hover:bg-slate-600/40 disabled:opacity-30"
          >
            📱 Shorts 全部 ({counts.short})
          </button>
          <button
            type="button"
            onClick={onExportAllMedium}
            disabled={counts.medium === 0}
            className="px-2 py-1.5 text-[11px] font-semibold rounded bg-slate-700/40 border border-slate-600/40 text-slate-200 hover:bg-slate-600/40 disabled:opacity-30"
          >
            🎬 通常 全部 ({counts.medium})
          </button>
          <button
            type="button"
            onClick={onExportAllLong}
            disabled={counts.long === 0}
            className="px-2 py-1.5 text-[11px] font-semibold rounded bg-slate-700/40 border border-slate-600/40 text-slate-200 hover:bg-slate-600/40 disabled:opacity-30"
          >
            🎞️ 長尺 全部 ({counts.long})
          </button>
        </div>
      )}

      {/* Job progress */}
      {currentJob && (
        <JobProgress
          job={currentJob}
          onCancel={onCancel}
          onDismiss={onDismissJob}
        />
      )}

      {/* Last result */}
      {lastResult && !currentJob && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-2.5 text-[11px] space-y-2">
          <div className="text-emerald-300 font-semibold">✓ 生成完了</div>
          {lastResult.output_file && (
            <div className="flex items-center gap-2">
              <span className="text-emerald-300">MP4:</span>
              <code className="text-emerald-200 truncate flex-1">{lastResult.output_file}</code>
              <a
                href={`/api/media/files?path=${encodeURIComponent(lastResult.output_file)}`}
                download
                className="px-1.5 py-0.5 rounded bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/40 text-[10px]"
              >
                ⬇
              </a>
            </div>
          )}
          {lastResult.ass_file && (
            <div className="flex items-center gap-2">
              <span className="text-emerald-300">ASS:</span>
              <code className="text-emerald-200 truncate flex-1">{lastResult.ass_file}</code>
              <a
                href={`/api/media/files?path=${encodeURIComponent(lastResult.ass_file)}`}
                download
                className="px-1.5 py-0.5 rounded bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/40 text-[10px]"
              >
                ⬇
              </a>
            </div>
          )}
          {lastResult.youtube && (
            <details className="mt-1">
              <summary className="text-emerald-300 font-semibold cursor-pointer text-[11px]">
                📺 YouTube メタデータ
              </summary>
              <div className="mt-1.5 p-2 bg-slate-900/60 rounded text-[10px] space-y-1">
                <div><span className="text-amber-300">title:</span> {lastResult.youtube.title}</div>
                <div>
                  <div className="text-amber-300">description:</div>
                  <pre className="text-slate-300 whitespace-pre-wrap font-sans">{lastResult.youtube.description}</pre>
                </div>
                <div>
                  <div className="text-amber-300">tags:</div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {lastResult.youtube.tags.map((t, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-300">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
