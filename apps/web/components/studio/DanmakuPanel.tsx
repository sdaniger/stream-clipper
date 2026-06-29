"use client";
import React from "react";
import type { HighlightCandidate } from "@/lib/twitch-time";
import type { DanmakuChatMessage, DanmakuDensity, DanmakuExportOptions, DanmakuExportSource, DanmakuFallback } from "@/lib/studio-api";

interface Props {
  candidate: HighlightCandidate;
  chatInRange: DanmakuChatMessage[];
  hasLocalVideo: boolean;
  hasVodUrl: boolean;
  localVideoPath: string;
  isExporting: "with" | "without" | "ass" | null;
  lastResult: {
    source?: DanmakuExportSource;
    output_file?: string;
    temporary_video_file?: string;
    ass_file?: string;
    comment_count?: number;
    in_range_count?: number;
    skipped_ng?: number;
    skipped_too_short?: number;
    skipped_duplicate?: number;
    fallback?: DanmakuFallback;
  } | null;
  exportSource: DanmakuExportSource;
  setExportSource: (s: DanmakuExportSource) => void;
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
  hasVodUrl,
  isExporting,
  lastResult,
  exportSource,
  setExportSource,
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
  // ── Source availability ──────────────────────────────────────────────
  const twitchAvailable = hasVodUrl;
  const localAvailable = hasLocalVideo;
  const chatAvailable = chatInRange.length > 0;
  const candidateAvailable = !!candidate;

  // Source disabled reasons
  const twitchDisabled = !twitchAvailable;
  const localDisabled = !localAvailable;
  const assAlwaysAvailable = candidateAvailable; // ass_only needs only a candidate

  // Button enable logic per source
  const enableWithDanmaku =
    (exportSource === "twitch_vod" && twitchAvailable) ||
    (exportSource === "local_file" && localAvailable);
  const enableWithoutDanmaku = enableWithDanmaku;
  const enableAssOnly = (exportSource === "ass_only" || exportSource === "twitch_vod" || exportSource === "local_file") && candidateAvailable;

  // Build disable reason for the current source
  const sourceDisabledReason = (() => {
    if (exportSource === "twitch_vod" && !twitchAvailable) {
      return "Twitch VOD URLが必要です";
    }
    if (exportSource === "local_file" && !localAvailable) {
      return "ローカル動画ファイルのパスを入力してください";
    }
    if (!candidateAvailable) {
      return "候補を選択してください";
    }
    return null;
  })();

  const withDanmakuReason = (() => {
    if (sourceDisabledReason) return sourceDisabledReason;
    if (exportSource !== "ass_only" && !chatAvailable) {
      return "範囲内コメントが0件です";
    }
    return null;
  })();

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

      {/* Source availability grid */}
      <div className="grid grid-cols-3 gap-1 mb-2 text-[10px]">
        <div className={`px-2 py-1 rounded ${
          twitchAvailable ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-800/50 text-slate-500"
        }`}>
          <span className="text-[9px] uppercase tracking-wider">Twitch VOD:</span>{" "}
          {twitchAvailable ? "Available" : "N/A"}
        </div>
        <div className={`px-2 py-1 rounded ${
          chatAvailable ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-800/50 text-slate-500"
        }`}>
          <span className="text-[9px] uppercase tracking-wider">Chat:</span>{" "}
          {chatAvailable ? `${chatInRange.length} msgs` : "0 msgs"}
        </div>
        <div className={`px-2 py-1 rounded ${
          localAvailable ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-800/50 text-slate-500"
        }`}>
          <span className="text-[9px] uppercase tracking-wider">Local file:</span>{" "}
          {localAvailable ? "Ready" : "未指定"}
        </div>
      </div>

      {/* Source picker */}
      <div className="mb-2">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Export Source</div>
        <div className="space-y-1">
          <label className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${
            exportSource === "twitch_vod" ? "bg-cyan-600/30 border border-cyan-500/60" : "bg-slate-800/40 border border-slate-700/40 hover:bg-slate-700/40"
          }`}>
            <input
              type="radio"
              name="export-source"
              value="twitch_vod"
              checked={exportSource === "twitch_vod"}
              onChange={() => setExportSource("twitch_vod")}
              className="accent-cyan-500"
              disabled={twitchDisabled}
            />
            <span className={`text-[11px] ${twitchDisabled ? "text-slate-500" : "text-cyan-100"}`}>
              Twitch VODから出力
            </span>
            {!twitchDisabled && (
              <span className="text-[9px] text-emerald-400 ml-1">推奨</span>
            )}
            {twitchDisabled && (
              <span className="text-[9px] text-slate-500 ml-1">URL必要</span>
            )}
          </label>
          <label className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${
            exportSource === "local_file" ? "bg-cyan-600/30 border border-cyan-500/60" : "bg-slate-800/40 border border-slate-700/40 hover:bg-slate-700/40"
          }`}>
            <input
              type="radio"
              name="export-source"
              value="local_file"
              checked={exportSource === "local_file"}
              onChange={() => setExportSource("local_file")}
              className="accent-cyan-500"
              disabled={localDisabled}
            />
            <span className={`text-[11px] ${localDisabled ? "text-slate-500" : "text-slate-200"}`}>
              ローカル動画から出力
            </span>
            {localDisabled && (
              <span className="text-[9px] text-amber-400 ml-1">ファイル未指定</span>
            )}
          </label>
          <label className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${
            exportSource === "ass_only" ? "bg-cyan-600/30 border border-cyan-500/60" : "bg-slate-800/40 border border-slate-700/40 hover:bg-slate-700/40"
          }`}>
            <input
              type="radio"
              name="export-source"
              value="ass_only"
              checked={exportSource === "ass_only"}
              onChange={() => setExportSource("ass_only")}
              className="accent-cyan-500"
            />
            <span className="text-[11px] text-slate-200">ASSのみ出力</span>
            <span className="text-[9px] text-slate-500 ml-1">動画不要</span>
          </label>
        </div>
      </div>

      {sourceDisabledReason && (
        <div className="mb-2 px-2 py-1.5 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded">
          ⚠ {sourceDisabledReason}
        </div>
      )}

      {/* Fallback hint from last failed export */}
      {lastResult && !lastResult.output_file && lastResult.fallback && (
        <div className="mb-2 px-2 py-1.5 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded">
          ⚠ フォールバック可能:
          {lastResult.fallback.local_file && <span className="ml-1">ローカル動画</span>}
          {lastResult.fallback.twitch_vod && <span className="ml-1">Twitch VOD</span>}
          {lastResult.fallback.ass_only && <span className="ml-1">ASSのみ</span>}
        </div>
      )}

      {/* Options grid - only show when danmaku is relevant */}
      {exportSource !== "ass_only" && (
        <>
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
        </>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5 mt-2">
        <button
          onClick={() => onExportWithDanmaku(buildOptions())}
          disabled={!enableWithDanmaku || !!withDanmakuReason || isExporting !== null}
          className="px-3 py-2 text-xs font-semibold rounded-md bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-500/30 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all"
          title={withDanmakuReason ?? "弾幕コメントを焼き込んだmp4を出力"}
        >
          {isExporting === "with" ? "⏳ 出力中..." : "🎬 弾幕付きで出力"}
        </button>
        <button
          onClick={() => onExportWithoutDanmaku()}
          disabled={!enableWithoutDanmaku || !!sourceDisabledReason || isExporting !== null}
          className="px-3 py-2 text-xs font-semibold rounded-md bg-slate-700/60 border border-slate-600 text-slate-200 hover:bg-slate-600/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={sourceDisabledReason ?? "弾幕なしで範囲のみを切り出し"}
        >
          {isExporting === "without" ? "⏳ 出力中..." : "📹 弾幕なしで出力"}
        </button>
        <button
          onClick={() => onExportAssOnly(buildOptions())}
          disabled={!enableAssOnly || chatInRange.length === 0 || isExporting !== null}
          className="px-3 py-2 text-xs font-semibold rounded-md bg-slate-700/60 border border-slate-600 text-slate-200 hover:bg-slate-600/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="ASS字幕ファイルのみ生成"
        >
          {isExporting === "ass" ? "⏳ 生成中..." : "📄 ASSのみ生成"}
        </button>
      </div>

      {/* Result */}
      {lastResult && (lastResult.output_file || lastResult.ass_file) && (
        <div className="mt-2 px-2 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded text-[10px]">
          {lastResult.source && (
            <div className="text-cyan-300 font-semibold mb-0.5">
              Export source: {lastResult.source}
            </div>
          )}
          {lastResult.temporary_video_file && (
            <div className="text-slate-400">
              <span className="font-semibold">一時動画:</span> <code className="text-slate-300">{lastResult.temporary_video_file}</code>
            </div>
          )}
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

      {/* Right notice */}
      <div className="mt-2 text-[9px] text-slate-600 leading-relaxed">
        ⚠ Twitch VODからの出力は、あなたが権利を持つ、または利用許可のあるコンテンツでのみ使用してください。
      </div>
    </div>
  );
}
