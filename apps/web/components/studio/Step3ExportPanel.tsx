"use client";

import React, { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { Candidate } from "@/lib/studio-jobs-api";
import JobProgress from "./JobProgress";
import type { JobState, BatchItem } from "@/lib/studio-jobs-api";
import {
  BURN_IN_MODE_LABEL_JA,
  BURN_IN_MODE_LABEL_EN,
  BURN_IN_MODE_DESCRIPTION_JA,
  BURN_IN_MODE_DESCRIPTION_EN,
  STYLE_PRESET_LABEL_JA,
  STYLE_PRESET_LABEL_EN,
  STYLE_PRESET_DESCRIPTION_JA,
  STYLE_PRESET_DESCRIPTION_EN,
  type CommentBurnInMode,
  type DanmakuStylePreset,
  type DanmakuDensity,
  type DanmakuCommentSize,
  type DanmakuRenderOptions,
} from "@/types/danmaku-render";

interface Props {
  candidate: Candidate | null;
  selectedCandidates: Candidate[];
  chatInRangeCount: number;
  outputDir: string;
  // New: comment display mode (replaces legacy withDanmaku boolean)
  commentBurnInMode: CommentBurnInMode;
  setCommentBurnInMode: (v: CommentBurnInMode) => void;
  // Style preset + fine-tune options
  danmakuStylePreset: DanmakuStylePreset;
  setDanmakuStylePreset: (v: DanmakuStylePreset) => void;
  danmakuRenderOptions: DanmakuRenderOptions;
  setDanmakuRenderOptions: (v: DanmakuRenderOptions | ((p: DanmakuRenderOptions) => DanmakuRenderOptions)) => void;
  // Legacy fields kept for back-compat (still respected by the parent)
  withDanmaku?: boolean;
  setWithDanmaku?: (v: boolean) => void;
  ffmpegPreset: "ultrafast" | "veryfast" | "fast" | "medium" | "slow";
  setFfmpegPreset: (v: "ultrafast" | "veryfast" | "fast" | "medium" | "slow") => void;
  ffmpegCrf: number;
  setFfmpegCrf: (v: number) => void;
  sourceMode: "twitch_vod" | "local_file" | "ass_only";
  setSourceMode: (v: "twitch_vod" | "local_file" | "ass_only") => void;
  localFilePath: string;
  setLocalFilePath: (v: string) => void;
  currentJob: JobState | null;
  previewJob: JobState | null;
  batchItems: BatchItem[];
  onExportSelected: () => void;
  onExportTop5: () => void;
  onExportAllShort: () => void;
  onExportAllMedium: () => void;
  onExportAllLong: () => void;
  onGeneratePreview: () => void;
  onCancel: () => void;
  onCancelPreview: () => void;
  onRetry: () => void;
  onDismissJob: () => void;
  vodUrlAvailable: boolean;
  counts: { short: number; medium: number; long: number };
  // Danmaku detail settings
  danmakuNgWords: string;
  setDanmakuNgWords: (v: string) => void;
  transcriptionProvider: "auto" | "existing" | "whisper_cpp" | "disabled";
  setTranscriptionProvider: (v: "auto" | "existing" | "whisper_cpp" | "disabled") => void;
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

function fmtDur(s: number): string {
  if (s >= 60) {
    const min = Math.floor(s / 60);
    return `${min}分`;
  }
  return `${Math.round(s)}秒`;
}

function kindLabel(kind: string, isJa: boolean): string {
  if (kind === "short") return isJa ? "Shorts" : "Shorts";
  if (kind === "medium") return isJa ? "通常" : "Standard";
  return isJa ? "長尺" : "Long";
}

function BatchItemRow({ item }: { item: BatchItem }) {
  const { locale } = useI18n();
  const isJa = locale === "ja";
  const icon = item.status === "completed" ? "✓" :
    item.status === "failed" ? "✗" :
    item.status === "active" ? "●" : "○";
  const color = item.status === "completed" ? "text-emerald-400" :
    item.status === "failed" ? "text-red-300" :
    item.status === "active" ? "text-cyan-300" : "text-slate-500";
  const badge = item.status === "completed" ? (isJa ? "完了" : "done") :
    item.status === "failed" ? (isJa ? "失敗" : "failed") :
    item.status === "active" ? (isJa ? "生成中..." : "rendering...") :
    (isJa ? "待機" : "pending");
  return (
    <div className={`flex items-center gap-2 text-[10px] ${color} ${item.status === "active" ? "animate-pulse" : ""}`}>
      <span className="w-4 text-center shrink-0">{icon}</span>
      <span className="font-semibold shrink-0">#{item.rank}</span>
      <span className="text-slate-400 shrink-0">{kindLabel(item.kind, isJa)}</span>
      <span className="flex-1 text-right">{badge}</span>
      {item.status === "failed" && item.error_message && (
        <span className="text-red-400/70 truncate max-w-[120px]" title={item.error_message}>· {item.error_message}</span>
      )}
    </div>
  );
}

export default function Step3ExportPanel({
  candidate, selectedCandidates, chatInRangeCount,
  outputDir,
  commentBurnInMode, setCommentBurnInMode,
  danmakuStylePreset, setDanmakuStylePreset,
  danmakuRenderOptions, setDanmakuRenderOptions,
  withDanmaku, setWithDanmaku,
  ffmpegPreset, setFfmpegPreset, ffmpegCrf, setFfmpegCrf,
  sourceMode, setSourceMode, localFilePath, setLocalFilePath,
  currentJob, previewJob, batchItems,
  onExportSelected, onExportTop5, onExportAllShort, onExportAllMedium, onExportAllLong,
  onGeneratePreview, onCancel, onCancelPreview, onRetry, onDismissJob,
  vodUrlAvailable, counts,
  danmakuNgWords, setDanmakuNgWords,
  transcriptionProvider, setTranscriptionProvider,
}: Props) {
  const { t, locale } = useI18n();
  const isJa = locale === "ja";
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const isBatchActive = batchItems.length > 0;

  // No candidate selected and no batch active
  if (!candidate && selectedCandidates.length === 0 && !isBatchActive && !currentJob) {
    return (
      <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-700/40">
        <div className="text-sm font-semibold text-slate-200 mb-2">
          🎬 {isJa ? "3. 生成" : "3. Generate"}
        </div>
        <div className="text-xs text-slate-400">
          {isJa ? "候補を選んで「この候補を生成」を押してください。" : "Select a candidate and click \"Generate\"."}
        </div>
      </div>
    );
  }

  // Helper: update one field of danmakuRenderOptions immutably
  const updateDanmaku = (patch: Partial<DanmakuRenderOptions>) => {
    setDanmakuRenderOptions((p) => ({ ...p, ...patch }));
  };

  const batchDone = batchItems.filter(i => i.status === "completed").length;
  const batchFailed = batchItems.filter(i => i.status === "failed").length;
  const batchTotal = batchItems.length;

  const isRenderActive = !!currentJob || isBatchActive;

  return (
    <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-700/40 space-y-4">
      {/* ── Selected candidate summary ── */}
      {candidate && !isRenderActive && (
        <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/40">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">
            {isJa ? "選択中の候補" : "Selected Candidate"}
          </div>
          <div className="text-sm text-slate-100 font-semibold">
            #{candidate.rank} {kindLabel(candidate.kind, isJa)} {isJa ? "切り抜き" : "Clip"}
          </div>
          <div className="text-xs text-slate-400 font-mono mt-1">
            {fmtClock(candidate.clip_start ?? 0)} – {fmtClock(candidate.clip_end ?? 0)}
            <span className="text-slate-500 ml-2">({fmtDur(candidate.clip_duration)})</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1.5 flex-wrap">
            <span className="text-slate-400">
              {candidate.kind === "short" ? "9:16" : "16:9"} / MP4
            </span>
            {commentBurnInMode === "off" && (
              <span className="text-slate-500">· {isJa ? "コメントなし" : "no comments"}</span>
            )}
            {commentBurnInMode === "preview_overlay" && (
              <span className="text-cyan-300">· {isJa ? "軽量プレビュー" : "lightweight preview"}</span>
            )}
            {commentBurnInMode === "hard_burn" && (
              <span className="text-emerald-300">· {isJa ? "コメントMP4に焼き込み" : "burned to MP4"}</span>
            )}
            <span className="text-slate-600">· {isJa ? "メタデータ付き" : "with metadata"}</span>
          </div>
          {candidate.reasons && candidate.reasons.filter((r) => !r.startsWith("📺")).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {candidate.reasons.filter((r) => !r.startsWith("📺")).slice(0, 3).map((r, i) => (
                <span key={i} className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Batch progress header ── */}
      {isBatchActive && (
        <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/40">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">⚡</span>
              <span className="text-sm font-semibold text-slate-100">
                {isJa ? "一括生成" : "Batch Render"}
              </span>
            </div>
            <div className="text-xs font-mono font-bold text-cyan-300">
              {batchDone}/{batchTotal}
              {batchFailed > 0 && <span className="text-red-400 ml-1">({batchFailed}{isJa ? "失敗" : " failed"})</span>}
            </div>
          </div>
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 transition-all duration-300"
              style={{ width: `${batchTotal > 0 ? (batchDone / batchTotal) * 100 : 0}%` }} />
          </div>
          <div className="space-y-1">
            {batchItems.map(item => (
              <BatchItemRow key={item.candidate_id} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* ── Comment display mode ── */}
      {!isRenderActive && (
        <div className="space-y-2">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            {isJa ? "コメント表示" : "Comment Display"}
          </div>
          <div className="space-y-1.5">
            {(["off", "preview_overlay", "hard_burn"] as CommentBurnInMode[]).map((mode) => {
              const isSelected = commentBurnInMode === mode;
              const label = isJa ? BURN_IN_MODE_LABEL_JA[mode] : BURN_IN_MODE_LABEL_EN[mode];
              const desc = isJa ? BURN_IN_MODE_DESCRIPTION_JA[mode] : BURN_IN_MODE_DESCRIPTION_EN[mode];
              return (
                <label
                  key={mode}
                  className={`flex items-start gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors border ${
                    isSelected
                      ? "border-cyan-500/60 bg-cyan-500/10"
                      : "border-slate-700/40 hover:bg-slate-800/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="comment-burn-in-mode"
                    checked={isSelected}
                    onChange={() => {
                      setCommentBurnInMode(mode);
                      if (setWithDanmaku) setWithDanmaku(mode !== "off");
                    }}
                    className="accent-cyan-500 mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className={`text-xs font-semibold ${isSelected ? "text-cyan-200" : "text-slate-200"}`}>
                      {label}
                    </div>
                    <div className="text-[10px] text-slate-400 leading-snug">{desc}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Main CTA ── */}
      {!isRenderActive && (
        <div className="space-y-2">
          {commentBurnInMode !== "off" && (
            <button
              type="button"
              onClick={onGeneratePreview}
              disabled={!candidate || !!previewJob}
              className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all min-h-[40px]"
            >
              🖼️ {isJa ? "焼き込みプレビューを生成" : "Generate burn-in preview"}
            </button>
          )}
          <button
            type="button"
            onClick={onExportSelected}
            disabled={!candidate}
            className="w-full px-4 py-3.5 text-sm font-bold rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-lg shadow-cyan-500/30 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all min-h-[48px]"
          >
            🎬 {isJa ? "動画を生成する" : "Generate Video"}
          </button>

          {/* Batch options (weaker CTA) */}
          <details className="text-[11px]">
            <summary className="text-slate-500 cursor-pointer hover:text-slate-300 transition-colors py-1">
              {isJa ? "一括生成オプション" : "Batch options"}
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button onClick={onExportTop5} disabled={selectedCandidates.length === 0}
                className="px-2 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-amber-500 to-pink-500 text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                ⚡ {isJa ? "上位5本" : "Top 5"}
              </button>
              <button onClick={onExportAllShort} disabled={counts.short === 0}
                className="px-2 py-1.5 text-xs font-semibold rounded-lg bg-slate-700/40 border border-slate-600/40 text-slate-200 hover:bg-slate-600/40 disabled:opacity-30 transition-all">
                📱 {isJa ? "Shorts全" : "All Shorts"} ({counts.short})
              </button>
              <button onClick={onExportAllMedium} disabled={counts.medium === 0}
                className="px-2 py-1.5 text-xs font-semibold rounded-lg bg-slate-700/40 border border-slate-600/40 text-slate-200 hover:bg-slate-600/40 disabled:opacity-30 transition-all">
                🎬 {isJa ? "通常全" : "All Standard"} ({counts.medium})
              </button>
              <button onClick={onExportAllLong} disabled={counts.long === 0}
                className="px-2 py-1.5 text-xs font-semibold rounded-lg bg-slate-700/40 border border-slate-600/40 text-slate-200 hover:bg-slate-600/40 disabled:opacity-30 transition-all">
                🎞️ {isJa ? "長尺全" : "All Long"} ({counts.long})
              </button>
            </div>
          </details>

          <div className="text-[9px] text-slate-600 text-center">
            {isJa
              ? "処理時間は動画の長さや設定によって変動します"
              : "Processing time varies by video length and settings"}
          </div>
        </div>
      )}

      {/* ── Preview job progress ── */}
      {previewJob && (
        <JobProgress
          job={previewJob}
          candidate={candidate}
          onCancel={onCancelPreview}
          onDismiss={onDismissJob}
        />
      )}

      {/* ── Job progress (single or batch) ── */}
      {currentJob && (
        <JobProgress
          job={currentJob}
          candidate={candidate}
          onCancel={onCancel}
          onRetry={onRetry}
          onDismiss={onDismissJob}
        />
      )}

      {/* ── Batch completed summary ── */}
      {isBatchActive && batchDone > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">
            ✓ {batchDone}/{batchTotal} {isJa ? "完了" : "complete"}
          </span>
          {batchFailed > 0 && (
            <span className="text-[9px] text-red-400 bg-red-500/10 px-2 py-1 rounded-full">
              ✗ {batchFailed} {isJa ? "失敗" : "failed"}
            </span>
          )}
          {onDismissJob && (
            <button onClick={onDismissJob}
              className="text-[9px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded-full bg-slate-800/40">
              {isJa ? "閉じる" : "Dismiss"}
            </button>
          )}
        </div>
      )}

      {/* ── Advanced settings (collapsible) ── */}
      {!isRenderActive && (
        <div className="border-t border-slate-800/60 pt-2">
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="w-full text-left text-[10px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5 py-1"
          >
            <span>{advancedOpen ? "▼" : "▶"}</span>
            <span>{isJa ? "詳細設定" : "Advanced Settings"}</span>
          </button>

          {advancedOpen && (
            <div className="mt-2 space-y-2 text-[11px]">
              {/* Source selection */}
              <div>
                <div className="text-[10px] text-slate-500 mb-1 font-semibold">{isJa ? "ソース" : "Source"}</div>
                <div className="space-y-1">
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-slate-800/40">
                    <input type="radio" name="adv-source" checked={sourceMode === "twitch_vod"} onChange={() => setSourceMode("twitch_vod")} className="accent-cyan-500" />
                    <span>📺 Twitch VOD</span>
                  </label>
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-slate-800/40">
                    <input type="radio" name="adv-source" checked={sourceMode === "local_file"} onChange={() => setSourceMode("local_file")} className="accent-cyan-500" />
                    <span>📁 {isJa ? "ローカルファイル" : "Local file"}</span>
                  </label>
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-slate-800/40">
                    <input type="radio" name="adv-source" checked={sourceMode === "ass_only"} onChange={() => setSourceMode("ass_only")} className="accent-cyan-500" />
                    <span>📄 ASS {isJa ? "のみ（動画なし）" : "only (no video)"}</span>
                  </label>
                </div>
                {sourceMode === "local_file" && (
                  <input type="text" value={localFilePath} onChange={(e) => setLocalFilePath(e.target.value)}
                    placeholder="/path/to/video.mp4"
                    className="w-full mt-1.5 px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-xs text-slate-200" />
                )}
              </div>

              {/* FFmpeg quality */}
              <div>
                <div className="text-[10px] text-slate-500 mb-1 font-semibold">FFmpeg {isJa ? "品質" : "Quality"}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-slate-800/40">
                    <span className="text-slate-400 shrink-0">{isJa ? "画質" : "Quality"}</span>
                    <select value={`${ffmpegPreset}/${ffmpegCrf}`} onChange={(e) => {
                      const [p, c] = e.target.value.split("/");
                      setFfmpegPreset(p as any);
                      setFfmpegCrf(Number(c));
                    }} className="bg-slate-900/60 border border-slate-700/40 rounded text-[10px] px-1 py-0.5 flex-1 text-slate-200">
                      <option value="ultrafast/26">{isJa ? "高速" : "Fast"}</option>
                      <option value="veryfast/23">{isJa ? "標準" : "Standard"}</option>
                      <option value="medium/20">{isJa ? "高品質" : "High Quality"}</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-slate-800/40">
                    <span className="text-slate-400 shrink-0">{isJa ? "出力先" : "Output"}</span>
                    <span className="truncate text-[9px] text-slate-300" title={outputDir}>{outputDir}</span>
                  </div>
                </div>
              </div>

              {/* Style preset + danmaku detail settings */}
              {commentBurnInMode !== "off" && (
                <div className="space-y-2">
                  <div>
                    <div className="text-[10px] text-slate-500 mb-1 font-semibold">{isJa ? "弾幕スタイル" : "Danmaku Style"}</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(["niconico_classic", "twitch_extension_like", "minimal", "dense"] as DanmakuStylePreset[]).map((preset) => {
                        const isSelected = danmakuStylePreset === preset;
                        const label = isJa ? STYLE_PRESET_LABEL_JA[preset] : STYLE_PRESET_LABEL_EN[preset];
                        const desc = isJa ? STYLE_PRESET_DESCRIPTION_JA[preset] : STYLE_PRESET_DESCRIPTION_EN[preset];
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setDanmakuStylePreset(preset)}
                            className={`text-left px-2 py-1.5 rounded-lg border transition-colors ${
                              isSelected
                                ? "border-cyan-500/60 bg-cyan-500/10"
                                : "border-slate-700/40 hover:bg-slate-800/40"
                            }`}
                          >
                            <div className={`text-[11px] font-semibold ${isSelected ? "text-cyan-200" : "text-slate-200"}`}>
                              {label}
                            </div>
                            <div className="text-[9px] text-slate-400 leading-snug">{desc}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-slate-500 mb-1 font-semibold">{isJa ? "弾幕詳細" : "Danmaku Details"}</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-slate-400">{isJa ? "コメントサイズ" : "Comment size"}</span>
                        <select
                          value={danmakuRenderOptions.size}
                          onChange={(e) => updateDanmaku({ size: e.target.value as DanmakuCommentSize })}
                          className="bg-slate-800/60 border border-slate-700/40 rounded text-[10px] px-1 py-1 text-slate-200"
                        >
                          <option value="small">{isJa ? "小" : "Small"}</option>
                          <option value="medium">{isJa ? "標準" : "Standard"}</option>
                          <option value="large">{isJa ? "大" : "Large"}</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-slate-400">{isJa ? "密度" : "Density"}</span>
                        <select
                          value={danmakuRenderOptions.density}
                          onChange={(e) => updateDanmaku({ density: e.target.value as DanmakuDensity })}
                          className="bg-slate-800/60 border border-slate-700/40 rounded text-[10px] px-1 py-1 text-slate-200"
                        >
                          <option value="low">{isJa ? "少なめ" : "Low"}</option>
                          <option value="normal">{isJa ? "標準" : "Normal"}</option>
                          <option value="high">{isJa ? "多め" : "High"}</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-slate-400">{isJa ? "フォント名" : "Font family"}</span>
                        <input
                          type="text"
                          value={danmakuRenderOptions.fontFamily ?? ""}
                          onChange={(e) => updateDanmaku({ fontFamily: e.target.value })}
                          placeholder="Noto Sans JP"
                          className="bg-slate-800/60 border border-slate-700/40 rounded text-[10px] px-1 py-1 text-slate-200"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-slate-400">{isJa ? "不透明度" : "Opacity"}</span>
                        <input
                          type="number" step="0.05" min="0" max="1"
                          value={danmakuRenderOptions.opacity ?? 0.9}
                          onChange={(e) => updateDanmaku({ opacity: Number(e.target.value) })}
                          className="bg-slate-800/60 border border-slate-700/40 rounded text-[10px] px-1 py-1 text-slate-200"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-slate-400">{isJa ? "アウトライン" : "Outline"}</span>
                        <input
                          type="number" step="0.5" min="0" max="6"
                          value={danmakuRenderOptions.outline ?? 2}
                          onChange={(e) => updateDanmaku({ outline: Number(e.target.value) })}
                          className="bg-slate-800/60 border border-slate-700/40 rounded text-[10px] px-1 py-1 text-slate-200"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-slate-400">{isJa ? "シャドウ" : "Shadow"}</span>
                        <input
                          type="number" step="0.5" min="0" max="4"
                          value={danmakuRenderOptions.shadow ?? 1}
                          onChange={(e) => updateDanmaku({ shadow: Number(e.target.value) })}
                          className="bg-slate-800/60 border border-slate-700/40 rounded text-[10px] px-1 py-1 text-slate-200"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-slate-400">{isJa ? "表示秒数" : "Duration"}(s)</span>
                        <input
                          type="number" step="0.1" min="0.3" max="20"
                          value={danmakuRenderOptions.durationSec ?? 4}
                          onChange={(e) => updateDanmaku({ durationSec: Number(e.target.value) })}
                          className="bg-slate-800/60 border border-slate-700/40 rounded text-[10px] px-1 py-1 text-slate-200"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-slate-400">{isJa ? "最大レーン" : "Max lanes"}</span>
                        <input
                          type="number" min="1" max="40"
                          value={danmakuRenderOptions.maxLanes ?? ""}
                          placeholder={isJa ? "自動" : "auto"}
                          onChange={(e) => updateDanmaku({ maxLanes: e.target.value === "" ? undefined : Number(e.target.value) })}
                          className="bg-slate-800/60 border border-slate-700/40 rounded text-[10px] px-1 py-1 text-slate-200"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-0.5 mt-1.5">
                      <span className="text-[9px] text-slate-400">{isJa ? "NGワード（カンマ区切り）" : "NG words (comma-separated)"}</span>
                      <input type="text" value={danmakuNgWords} onChange={(e) => setDanmakuNgWords(e.target.value)}
                        placeholder="ng, badword"
                        className="bg-slate-800/60 border border-slate-700/40 rounded text-[10px] px-1 py-1 text-slate-200" />
                    </label>
                  </div>
                </div>
              )}

              {/* Transcription provider */}
              <div>
                <div className="text-[10px] text-slate-500 mb-1 font-semibold">{isJa ? "文字起こし" : "Transcription"}</div>
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-slate-800/40">
                  <span className="text-slate-400 shrink-0">{isJa ? "エンジン" : "Engine"}</span>
                  <select value={transcriptionProvider} onChange={(e) => setTranscriptionProvider(e.target.value as any)}
                    className="bg-slate-900/60 border border-slate-700/40 rounded text-[10px] px-1 py-0.5 flex-1 text-slate-200">
                    <option value="auto">{isJa ? "自動選択" : "Auto"}</option>
                    <option value="existing">faster-whisper</option>
                    <option value="whisper_cpp">whisper.cpp</option>
                    <option value="disabled">{isJa ? "無効" : "Disabled"}</option>
                  </select>
                </div>
                <div className="text-[8px] text-slate-600 mt-0.5">
                  {isJa
                    ? "Android端末では自動的にwhisper.cppに切り替わります"
                    : "On Android devices, whisper.cpp is used automatically"}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
