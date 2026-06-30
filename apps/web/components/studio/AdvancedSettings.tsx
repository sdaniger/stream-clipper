"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";

export type ExportSource = "twitch_vod" | "local_file" | "ass_only";
export type FfmpegQuality = "high_speed" | "standard" | "high_quality";

export interface ScoringWeights {
  chat: number;
  unique_author: number;
  keyword: number;
  laugh: number;
  surprise: number;
  clip_worthy: number;
  reaction: number;
  burst: number;
}

interface Props {
  isOpen: boolean;
  onToggle: () => void;

  // Detection parameters
  windowSec: number; setWindowSec: (v: number) => void;
  step: number; setStep: (v: number) => void;
  topShort: number; setTopShort: (v: number) => void;
  topMedium: number; setTopMedium: (v: number) => void;
  topLong: number; setTopLong: (v: number) => void;
  minGap: number; setMinGap: (v: number) => void;
  keywordWeight: number; setKeywordWeight: (v: number) => void;
  keywordsText: string; setKeywordsText: (v: string) => void;

  // Scoring weights (advanced)
  scoringWeights: ScoringWeights;
  setScoringWeights: (v: ScoringWeights) => void;

  // Export source selection
  exportSource: ExportSource;
  setExportSource: (s: ExportSource) => void;
  vodUrl: string;
  videoPath: string;
  setVideoPath: (v: string) => void;
  logPath: string;
  setLogPath: (v: string) => void;
  mode: "twitch" | "local";

  // Danmaku options
  density: "low" | "medium" | "high"; setDensity: (v: "low" | "medium" | "high") => void;
  fontSize: number; setFontSize: (v: number) => void;
  commentDuration: number; setCommentDuration: (v: number) => void;
  opacity: number; setOpacity: (v: number) => void;
  ngWords: string; setNgWords: (v: string) => void;
  minMessageLength: number; setMinMessageLength: (v: number) => void;
  deduplicateConsecutive: boolean;
  setDeduplicateConsecutive: (v: boolean) => void;
  safetyCommentLimit: number | null; setSafetyCommentLimit: (v: number | null) => void;

  // FFmpeg quality
  quality: FfmpegQuality;
  setQuality: (v: FfmpegQuality) => void;
  outputDir: string;
  setOutputDir: (v: string) => void;
}

const QUALITY_PRESETS: Record<FfmpegQuality, { preset: string; crf: number; label: string }> = {
  high_speed: { preset: "ultrafast", crf: 26, label: "高速" },
  standard: { preset: "veryfast", crf: 23, label: "標準" },
  high_quality: { preset: "medium", crf: 20, label: "高品質" },
};

const DEFAULT_WEIGHTS: ScoringWeights = {
  chat: 1.0,
  unique_author: 0.5,
  keyword: 2.0,
  laugh: 1.2,
  surprise: 1.5,
  clip_worthy: 1.8,
  reaction: 1.3,
  burst: 1.5,
};

export default function AdvancedSettings({
  isOpen,
  onToggle,
  windowSec, setWindowSec,
  step, setStep,
  topShort, setTopShort,
  topMedium, setTopMedium,
  topLong, setTopLong,
  minGap, setMinGap,
  keywordWeight, setKeywordWeight,
  keywordsText, setKeywordsText,
  scoringWeights, setScoringWeights,
  exportSource, setExportSource,
  vodUrl, videoPath, setVideoPath, logPath, setLogPath, mode,
  density, setDensity,
  fontSize, setFontSize,
  commentDuration, setCommentDuration,
  opacity, setOpacity,
  ngWords, setNgWords,
  minMessageLength, setMinMessageLength,
  deduplicateConsecutive, setDeduplicateConsecutive,
  safetyCommentLimit, setSafetyCommentLimit,
  quality, setQuality,
  outputDir, setOutputDir,
}: Props) {
  const { t } = useI18n();
  const updateWeight = (key: keyof ScoringWeights, v: number) => {
    setScoringWeights({ ...scoringWeights, [key]: v });
  };

  return (
    <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-1.5 text-left hover:bg-slate-800/40 flex items-center gap-2 transition-colors"
      >
        <span className="text-[10px] text-slate-500">{isOpen ? "▼" : "▶"}</span>
        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
          Advanced Settings
        </span>
        <span className="text-[10px] text-slate-500">
          window / step / scoring weights / local file / ASS only / safety
        </span>
      </button>

      {isOpen && (
        <div className="px-3 pb-3 pt-2 border-t border-slate-800/50 space-y-3">
          {/* Section: Detection parameters */}
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">
              Detection
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-400">Window (s)</span>
                <input
                  type="number"
                  value={windowSec}
                  onChange={(e) => setWindowSec(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-400">Step (s)</span>
                <input
                  type="number"
                  value={step}
                  onChange={(e) => setStep(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-400">Min gap (s)</span>
                <input
                  type="number"
                  value={minGap}
                  onChange={(e) => setMinGap(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-400">Keyword weight</span>
                <input
                  type="number"
                  step="0.1"
                  value={keywordWeight}
                  onChange={(e) => setKeywordWeight(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-400">Top short</span>
                <input
                  type="number"
                  value={topShort}
                  onChange={(e) => setTopShort(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-400">Top medium</span>
                <input
                  type="number"
                  value={topMedium}
                  onChange={(e) => setTopMedium(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-400">Top long</span>
                <input
                  type="number"
                  value={topLong}
                  onChange={(e) => setTopLong(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                />
              </label>
            </div>

            <label className="flex flex-col gap-0.5 mt-2 text-[11px]">
              <span className="text-slate-400">Extra keywords (comma-separated)</span>
              <input
                type="text"
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                placeholder="草, 笑, lol, 神, ... (default keywords are always included)"
                className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
              />
            </label>
          </div>

          {/* Section: Scoring weights */}
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold flex items-center justify-between">
              <span>Scoring weights</span>
              <button
                type="button"
                onClick={() => setScoringWeights(DEFAULT_WEIGHTS)}
                className="text-[9px] text-cyan-400 hover:text-cyan-300 normal-case tracking-normal"
              >
                Reset
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-[11px]">
              {(
                [
                  ["chat", "chat"],
                  ["unique_author", "unique_author"],
                  ["keyword", "keyword"],
                  ["laugh", "laugh"],
                  ["surprise", "surprise"],
                  ["clip_worthy", "clip_worthy"],
                  ["reaction", "reaction"],
                  ["burst", "burst"],
                ] as [keyof ScoringWeights, string][]
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-0.5">
                  <span className="text-slate-400 text-[10px]">{label}</span>
                  <input
                    type="number"
                    step="0.1"
                    value={scoringWeights[key]}
                    onChange={(e) => updateWeight(key, Number(e.target.value))}
                    className="px-1.5 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Section: Source */}
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">
              Source
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-slate-800/40">
                <input
                  type="radio"
                  name="adv-source"
                  checked={exportSource === "twitch_vod"}
                  onChange={() => setExportSource("twitch_vod")}
                />
                <span className="text-[11px]">📺 Twitch VOD (default)</span>
              </label>
              <label className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-slate-800/40">
                <input
                  type="radio"
                  name="adv-source"
                  checked={exportSource === "local_file"}
                  onChange={() => setExportSource("local_file")}
                />
                <span className="text-[11px]">📁 Local file (fallback)</span>
              </label>
              <label className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-slate-800/40">
                <input
                  type="radio"
                  name="adv-source"
                  checked={exportSource === "ass_only"}
                  onChange={() => setExportSource("ass_only")}
                />
                <span className="text-[11px]">📄 ASS only (no video)</span>
              </label>
            </div>
            {exportSource === "local_file" && (
              <input
                type="text"
                value={videoPath}
                onChange={(e) => setVideoPath(e.target.value)}
                placeholder="/path/to/video.mp4"
                className="w-full mt-1.5 px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-[11px] text-slate-200"
              />
            )}
          </div>

          {/* Section: Danmaku */}
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">
              Danmaku
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-400">Density</span>
                <select
                  value={density}
                  onChange={(e) => setDensity(e.target.value as "low" | "medium" | "high")}
                  className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-400">Font size</span>
                <input
                  type="number"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-400">Duration (s)</span>
                <input
                  type="number"
                  step="0.1"
                  value={commentDuration}
                  onChange={(e) => setCommentDuration(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-400">Opacity</span>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-400">Min message length</span>
                <input
                  type="number"
                  value={minMessageLength}
                  onChange={(e) => setMinMessageLength(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 mt-2 text-[11px]">
              <input
                type="checkbox"
                checked={deduplicateConsecutive}
                onChange={(e) => setDeduplicateConsecutive(e.target.checked)}
              />
              <span>Deduplicate consecutive comments</span>
            </label>
            <label className="flex flex-col gap-0.5 mt-2 text-[11px]">
              <span className="text-slate-400">NG words (comma-separated)</span>
              <input
                type="text"
                value={ngWords}
                onChange={(e) => setNgWords(e.target.value)}
                className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-0.5 mt-2 text-[11px]">
              <span className="text-slate-400">Safety comment limit (empty=unlimited)</span>
              <input
                type="number"
                value={safetyCommentLimit ?? ""}
                onChange={(e) => setSafetyCommentLimit(e.target.value ? Number(e.target.value) : null)}
                className="px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100"
              />
            </label>
          </div>

          {/* Section: FFmpeg */}
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">
              FFmpeg
            </div>
            <div className="space-y-1">
              {(
                [
                  ["high_speed", "高速 (ultrafast / crf 26)"],
                  ["standard", "標準 (veryfast / crf 23)"],
                  ["high_quality", "高品質 (medium / crf 20)"],
                ] as [FfmpegQuality, string][]
              ).map(([q, label]) => (
                <label key={q} className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-slate-800/40">
                  <input
                    type="radio"
                    name="adv-quality"
                    checked={quality === q}
                    onChange={() => setQuality(q)}
                  />
                  <span className="text-[11px]">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Section: Output */}
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">
              Output
            </div>
            <input
              type="text"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              className="w-full px-2 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-[11px] text-slate-200"
            />
          </div>
        </div>
      )}
    </div>
  );
}
