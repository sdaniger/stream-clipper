"use client";
import React from "react";
import type { HighlightCandidate } from "@/lib/twitch-time";
import type { DanmakuChatMessage, DanmakuDensity, DanmakuExportOptions } from "@/lib/studio-api";

interface Props {
  candidate: HighlightCandidate;
  chatInRange: DanmakuChatMessage[];
  hasLocalVideo: boolean;
  localVideoPath: string;
  isExporting: "with" | "without" | "ass" | null;
  lastResult: {
    output_file?: string;
    ass_file?: string;
    comment_count?: number;
    in_range_count?: number;
    skipped_ng?: number;
    skipped_too_short?: number;
    skipped_duplicate?: number;
  } | null;
  onExportWithDanmaku: (options: DanmakuExportOptions) => void;
  onExportWithoutDanmaku: () => void;
  onExportAssOnly: (options: DanmakuExportOptions) => void;
  // Form state lifted to parent
  density: DanmakuDensity;
  setDensity: (v: DanmakuDensity) => void;
  maxComments: number;
  setMaxComments: (v: number) => void;
  fontSize: number;
  setFontSize: (v: number) => void;
  commentDuration: number;
  setCommentDuration: (v: number) => void;
  opacity: number;
  setOpacity: (v: number) => void;
  ngWords: string;
  setNgWords: (v: string) => void;
  minMessageLength: number;
  setMinMessageLength: (v: number) => void;
  deduplicateConsecutive: boolean;
  setDeduplicateConsecutive: (v: boolean) => void;
}

export default function DanmakuPanel({
  candidate,
  chatInRange,
  hasLocalVideo,
  isExporting,
  lastResult,
  onExportWithDanmaku,
  onExportWithoutDanmaku,
  onExportAssOnly,
  density,
  setDensity,
  maxComments,
  setMaxComments,
  fontSize,
  setFontSize,
  commentDuration,
  setCommentDuration,
  opacity,
  setOpacity,
  ngWords,
  setNgWords,
  minMessageLength,
  setMinMessageLength,
  deduplicateConsecutive,
  setDeduplicateConsecutive,
}: Props) {
  const disabled = !hasLocalVideo;
  const disabledReason = !hasLocalVideo
    ? "ローカル動画ファイルが必要です"
    : null;

  const buildOptions = (): DanmakuExportOptions => ({
    density,
    max_comments: maxComments,
    font_size: fontSize,
    comment_duration: commentDuration,
    opacity,
    ng_words: ngWords.split(",").map((s) => s.trim()).filter(Boolean),
    min_message_length: minMessageLength,
    deduplicate_consecutive: deduplicateConsecutive,
  });

  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">
          🎬 弾幕コメント付き出力
        </h3>
        {chatInRange.length > 0 && (
          <span className="text-[10px] text-slate-400">
            範囲内コメント: <span className="text-slate-200 font-semibold">{chatInRange.length}</span> 件
          </span>
        )}
      </div>

      {/* Status row */}
      <div className="grid grid-cols-2 gap-1 mb-2 text-[10px]">
        <div className={`px-2 py-1 rounded ${
          hasLocalVideo
            ? "bg-emerald-500/10 text-emerald-300"
            : "bg-amber-500/10 text-amber-300"
        }`}>
          <span className="text-[9px] uppercase tracking-wider">Local video:</span>{" "}
          {hasLocalVideo ? "指定済み" : "未指定"}
        </div>
        <div className="px-2 py-1 rounded bg-slate-800/50 text-slate-400">
          <span className="text-[9px] uppercase tracking-wider">Danmaku export:</span>{" "}
          {hasLocalVideo ? (
            <span className="text-emerald-400">Ready</span>
          ) : (
            <span className="text-amber-400">Disabled</span>
          )}
        </div>
      </div>

      {disabledReason && (
        <div className="mb-2 px-2 py-1.5 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded">
          ⚠ {disabledReason}
        </div>
      )}

      {/* Options grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] text-slate-500 uppercase">密度</label>
          <select
            value={density}
            onChange={(e) => setDensity(e.target.value as DanmakuDensity)}
            className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-cyan-500"
          >
            <option value="low">low (50)</option>
            <option value="medium">medium (120)</option>
            <option value="high">high (250)</option>
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] text-slate-500 uppercase">最大コメント数</label>
          <input
            type="number"
            value={maxComments}
            min={1}
            max={1000}
            onChange={(e) => setMaxComments(Number(e.target.value) || 120)}
            className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-cyan-500"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] text-slate-500 uppercase">フォントサイズ</label>
          <input
            type="number"
            value={fontSize}
            min={8}
            max={96}
            onChange={(e) => setFontSize(Number(e.target.value) || 32)}
            className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-cyan-500"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] text-slate-500 uppercase">表示秒数</label>
          <input
            type="number"
            value={commentDuration}
            min={0.5}
            max={30}
            step={0.5}
            onChange={(e) => setCommentDuration(Number(e.target.value) || 4.0)}
            className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-cyan-500"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] text-slate-500 uppercase">不透明度 (0-1)</label>
          <input
            type="number"
            value={opacity}
            min={0}
            max={1}
            step={0.1}
            onChange={(e) => setOpacity(Number(e.target.value) || 0.9)}
            className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-cyan-500"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] text-slate-500 uppercase">短すぎるコメントを除外 (chars)</label>
          <input
            type="number"
            value={minMessageLength}
            min={0}
            max={10}
            onChange={(e) => setMinMessageLength(Number(e.target.value) || 1)}
            className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-cyan-500"
          />
        </div>
        <div className="flex flex-col gap-0.5 col-span-2">
          <label className="text-[9px] text-slate-500 uppercase">NGワード (カンマ区切り)</label>
          <input
            type="text"
            value={ngWords}
            placeholder="例: NG,スパム"
            onChange={(e) => setNgWords(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-cyan-500"
          />
        </div>
        <div className="flex flex-col gap-0.5 col-span-2 justify-end">
          <label className="flex items-center gap-1.5 text-[10px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={deduplicateConsecutive}
              onChange={(e) => setDeduplicateConsecutive(e.target.checked)}
              className="accent-cyan-500"
            />
            同一コメント連投を間引く
          </label>
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5 mt-2">
        <button
          onClick={() => onExportWithDanmaku(buildOptions())}
          disabled={disabled || isExporting !== null}
          className="px-3 py-2 text-xs font-semibold rounded-md bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-500/30 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all"
          title={disabledReason ?? "弾幕コメントを焼き込んだmp4を出力"}
        >
          {isExporting === "with" ? "⏳ 出力中..." : "🎬 弾幕付きで出力"}
        </button>
        <button
          onClick={() => onExportWithoutDanmaku()}
          disabled={disabled || isExporting !== null}
          className="px-3 py-2 text-xs font-semibold rounded-md bg-slate-700/60 border border-slate-600 text-slate-200 hover:bg-slate-600/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={disabledReason ?? "弾幕なしで範囲のみを切り出し"}
        >
          {isExporting === "without" ? "⏳ 出力中..." : "📹 弾幕なしで出力"}
        </button>
        <button
          onClick={() => onExportAssOnly(buildOptions())}
          disabled={disabled || isExporting !== null || chatInRange.length === 0}
          className="px-3 py-2 text-xs font-semibold rounded-md bg-slate-700/60 border border-slate-600 text-slate-200 hover:bg-slate-600/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="ASS字幕ファイルのみ生成"
        >
          {isExporting === "ass" ? "⏳ 生成中..." : "📄 ASSのみ生成"}
        </button>
      </div>

      {/* Result */}
      {lastResult && (lastResult.output_file || lastResult.ass_file) && (
        <div className="mt-2 px-2 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded text-[10px]">
          {lastResult.output_file && (
            <div className="text-emerald-300">
              <span className="font-semibold">出力:</span> <code className="text-emerald-200">{lastResult.output_file}</code>
            </div>
          )}
          {lastResult.ass_file && (
            <div className="text-emerald-300 mt-0.5">
              <span className="font-semibold">ASS:</span> <code className="text-emerald-200">{lastResult.ass_file}</code>
            </div>
          )}
          {lastResult.comment_count !== undefined && lastResult.in_range_count !== undefined && (
            <div className="text-slate-400 mt-0.5">
              使用 {lastResult.comment_count} / 範囲内 {lastResult.in_range_count} 件
              {lastResult.skipped_ng !== undefined && lastResult.skipped_ng > 0 && ` · NG ${lastResult.skipped_ng}`}
              {lastResult.skipped_too_short !== undefined && lastResult.skipped_too_short > 0 && ` · 短 ${lastResult.skipped_too_short}`}
              {lastResult.skipped_duplicate !== undefined && lastResult.skipped_duplicate > 0 && ` · 重複 ${lastResult.skipped_duplicate}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
