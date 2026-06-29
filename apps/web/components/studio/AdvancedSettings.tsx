"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";
import type { DanmakuDensity } from "@/lib/studio-api";

export type ExportSource = "twitch_vod" | "local_file" | "ass_only";
export type FfmpegQuality = "high_speed" | "standard" | "high_quality";

interface Props {
  isOpen: boolean;
  onToggle: () => void;

  // Detection parameters
  windowSec: number; setWindowSec: (v: number) => void;
  step: number; setStep: (v: number) => void;
  topN: number; setTopN: (v: number) => void;
  minGap: number; setMinGap: (v: number) => void;
  keywordWeight: number; setKeywordWeight: (v: number) => void;
  keywordsText: string; setKeywordsText: (v: string) => void;

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
  density: DanmakuDensity; setDensity: (v: DanmakuDensity) => void;
  fontSize: number; setFontSize: (v: number) => void;
  commentDuration: number; setCommentDuration: (v: number) => void;
  opacity: number; setOpacity: (v: number) => void;
  ngWords: string; setNgWords: (v: string) => void;
  minMessageLength: number; setMinMessageLength: (v: number) => void;
  deduplicateConsecutive: boolean; setDeduplicateConsecutive: (v: boolean) => void;
  safetyCommentLimit: number | null; setSafetyCommentLimit: (v: number | null) => void;

  // FFmpeg quality
  quality: FfmpegQuality; setQuality: (v: FfmpegQuality) => void;
  outputDir: string; setOutputDir: (v: string) => void;
}

const QUALITY_PRESETS: Record<FfmpegQuality, { preset: string; crf: number; label: string }> = {
  high_speed: { preset: "ultrafast", crf: 26, label: "高速" },
  standard: { preset: "veryfast", crf: 23, label: "標準" },
  high_quality: { preset: "medium", crf: 20, label: "高品質" },
};

export default function AdvancedSettings({
  isOpen,
  onToggle,
  windowSec, setWindowSec,
  step, setStep,
  topN, setTopN,
  minGap, setMinGap,
  keywordWeight, setKeywordWeight,
  keywordsText, setKeywordsText,
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

  return (
    <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-1.5 text-left hover:bg-slate-800/40 flex items-center gap-2 transition-colors"
      >
        <span className="text-[10px] text-slate-500">{isOpen ? "▼" : "▶"}</span>
        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
          {t("studio.advancedTitle")}
        </span>
        <span className="text-[10px] text-slate-500">{t("studio.advancedDescription")}</span>
      </button>

      {isOpen && (
        <div className="px-3 pb-3 pt-2 border-t border-slate-800/50 space-y-3">
          {/* Section: Export source */}
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">
              {t("studio.advancedExportSource")}
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-slate-800/40">
                <input
                  type="radio"
                  name="export-source"
                  value="twitch_vod"
                  checked={exportSource === "twitch_vod"}
                  onChange={() => setExportSource("twitch_vod")}
                  className="accent-cyan-500"
                />
                <span className="text-[11px] text-slate-200">{t("studio.advancedSourceTwitchVod")}</span>
                <span className="text-[9px] text-emerald-400 ml-1">推奨</span>
              </label>
              <label className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-slate-800/40">
                <input
                  type="radio"
                  name="export-source"
                  value="local_file"
                  checked={exportSource === "local_file"}
                  onChange={() => setExportSource("local_file")}
                  className="accent-cyan-500"
                />
                <span className="text-[11px] text-slate-200">{t("studio.advancedSourceLocalFile")}</span>
              </label>
              <label className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-slate-800/40">
                <input
                  type="radio"
                  name="export-source"
                  value="ass_only"
                  checked={exportSource === "ass_only"}
                  onChange={() => setExportSource("ass_only")}
                  className="accent-cyan-500"
                />
                <span className="text-[11px] text-slate-200">{t("studio.advancedSourceAss")}</span>
              </label>
            </div>
            <div className="text-[9px] text-slate-500 mt-1 ml-1">
              {t("studio.advancedSourceFallbackHint")}
            </div>
            {exportSource === "local_file" && (
              <div className="mt-2 space-y-1.5">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-slate-500 uppercase">{t("studio.advancedLocalFileLabel")}</label>
                  <input
                    value={videoPath}
                    onChange={(e) => setVideoPath(e.target.value)}
                    placeholder={mode === "local" ? "/path/to/video.mp4" : vodUrl}
                    className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-cyan-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-slate-500 uppercase">Chat log path</label>
                  <input
                    value={logPath}
                    onChange={(e) => setLogPath(e.target.value)}
                    placeholder="/path/to/chat.json"
                    className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Section: Detection parameters */}
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">検出パラメータ</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedTopN")}</label>
                <input type="number" value={topN} min={1} max={50}
                  onChange={(e) => setTopN(Number(e.target.value) || 10)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedWindow")}</label>
                <input type="number" value={windowSec} min={10} step={5}
                  onChange={(e) => setWindowSec(Number(e.target.value) || 30)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedStep")}</label>
                <input type="number" value={step} min={5} step={5}
                  onChange={(e) => setStep(Number(e.target.value) || 10)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedMinGap")}</label>
                <input type="number" value={minGap} min={0} step={5}
                  onChange={(e) => setMinGap(Number(e.target.value) || 45)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedKeywordWeight")}</label>
                <input type="number" value={keywordWeight} min={0.5} max={5.0} step={0.5}
                  onChange={(e) => setKeywordWeight(Number(e.target.value) || 2.0)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500" />
              </div>
              <div className="flex flex-col gap-0.5 col-span-2">
                <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedKeywords")}</label>
                <input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)}
                  placeholder="カンマ区切り"
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500" />
              </div>
            </div>
          </div>

          {/* Section: Quality preset */}
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">FFmpeg 品質</div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["high_speed", "standard", "high_quality"] as FfmpegQuality[]).map((q) => (
                <label
                  key={q}
                  className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded cursor-pointer transition-colors ${
                    quality === q
                      ? "bg-cyan-600/30 border border-cyan-500/60"
                      : "bg-slate-800/40 border border-slate-700/40 hover:bg-slate-700/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="quality"
                    value={q}
                    checked={quality === q}
                    onChange={() => setQuality(q)}
                    className="sr-only"
                  />
                  <span className="text-[11px] font-semibold text-slate-200">{QUALITY_PRESETS[q].label}</span>
                  <span className="text-[9px] text-slate-500 font-mono">
                    {QUALITY_PRESETS[q].preset} crf={QUALITY_PRESETS[q].crf}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Section: Danmaku options */}
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">弾幕表示</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedDensity")}</label>
                <select
                  value={density}
                  onChange={(e) => setDensity(e.target.value as DanmakuDensity)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500"
                >
                  <option value="low">low (見やすさ)</option>
                  <option value="medium">medium (標準)</option>
                  <option value="high">high (多め)</option>
                </select>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedFontSize")}</label>
                <input type="number" value={fontSize} min={8} max={96}
                  onChange={(e) => setFontSize(Number(e.target.value) || 32)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedCommentDuration")}</label>
                <input type="number" value={commentDuration} min={0.5} max={30} step={0.5}
                  onChange={(e) => setCommentDuration(Number(e.target.value) || 4.0)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedOpacity")}</label>
                <input type="number" value={opacity} min={0} max={1} step={0.1}
                  onChange={(e) => setOpacity(Number(e.target.value) || 0.9)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedMinLength")}</label>
                <input type="number" value={minMessageLength} min={0} max={10}
                  onChange={(e) => setMinMessageLength(Number(e.target.value) || 1)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500" />
              </div>
              <div className="flex flex-col gap-0.5 col-span-2">
                <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedNgWords")}</label>
                <input value={ngWords} onChange={(e) => setNgWords(e.target.value)}
                  placeholder="カンマ区切り"
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500" />
              </div>
            </div>
            <label className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={deduplicateConsecutive}
                onChange={(e) => setDeduplicateConsecutive(e.target.checked)}
                className="accent-cyan-500"
              />
              {t("studio.advancedDeduplicate")}
            </label>
            <div className="mt-1 flex flex-col gap-0.5">
              <label className="text-[9px] text-slate-500 uppercase">{t("studio.advancedSafetyLimit")}</label>
              <input
                type="number"
                value={safetyCommentLimit ?? ""}
                placeholder="空=無制限"
                onChange={(e) => {
                  const v = e.target.value;
                  setSafetyCommentLimit(v === "" ? null : Number(v));
                }}
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-500 w-32"
              />
            </div>
          </div>

          {/* Section: Output directory */}
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">{t("studio.advancedOutputDir")}</div>
            <input
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="output/danmaku-clips"
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-cyan-500"
            />
          </div>
        </div>
      )}
    </div>
  );
}
