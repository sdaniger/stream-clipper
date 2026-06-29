"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";
import type { HighlightCandidate } from "@/lib/twitch-time";

export type ExportStage = "vod_fetch" | "comment_extract" | "ass_generate" | "mp4_burn" | "complete";

interface Props {
  candidate: HighlightCandidate | null;
  chatInRangeCount: number;
  burnedCount: number;
  outputDir: string;
  isExporting: boolean;
  isExportingTop5: boolean;
  currentStage: ExportStage | null;
  fallbackAvailable: boolean;
  lastResult: {
    output_file?: string;
    ass_file?: string;
    range_comment_count?: number;
    burned_comment_count?: number;
  } | null;
  onExportSingle: () => void;
  onExportTop5: () => void;
  onCancel: () => void;
  onShowAdvanced: () => void;
}

const STAGE_KEYS: { value: ExportStage; key: string }[] = [
  { value: "vod_fetch", key: "step3StageVodFetch" },
  { value: "comment_extract", key: "step3StageCommentExtract" },
  { value: "ass_generate", key: "step3StageAssGenerate" },
  { value: "mp4_burn", key: "step3StageMp4Burn" },
  { value: "complete", key: "step3StageComplete" },
];

function fmtClock(v: number): string {
  const safe = Math.max(0, v);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}` : `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Step3ExportPanel({
  candidate,
  chatInRangeCount,
  burnedCount,
  outputDir,
  isExporting,
  isExportingTop5,
  currentStage,
  fallbackAvailable,
  lastResult,
  onExportSingle,
  onExportTop5,
  onCancel,
  onShowAdvanced,
}: Props) {
  const { t } = useI18n();

  if (!candidate) {
    return (
      <div className="glass-panel rounded-lg p-4">
        <div className="text-base font-semibold text-slate-200 mb-2">
          {t("studio.step3Title")}
        </div>
        <div className="text-xs text-slate-400 mb-3">
          {t("studio.step3Description")}
        </div>
        <div className="bg-slate-900/40 rounded p-4 text-center text-xs text-slate-500 border border-slate-700/30">
          {t("studio.noCandidates")}
        </div>
      </div>
    );
  }

  const startTime = candidate.clip_start ?? candidate.start ?? candidate.peak_time ?? 0;
  const endTime = candidate.end ?? (candidate.clip_start != null && candidate.clip_duration != null ? candidate.clip_start + candidate.clip_duration : startTime + 30);
  const duration = Math.max(0, endTime - startTime);

  return (
    <div className="glass-panel rounded-lg p-4">
      <div className="text-base font-semibold text-slate-200 mb-1">
        {t("studio.step3Title")}
      </div>
      <div className="text-xs text-slate-400 mb-3">
        {t("studio.step3Description")}
      </div>

      {/* Stage indicators */}
      {(isExporting || isExportingTop5) && (
        <div className="mb-3 p-3 bg-slate-900/60 rounded-md border border-slate-700/40">
          <div className="text-xs text-cyan-300 font-semibold mb-2 flex items-center gap-2">
            <div className="animate-spin w-3.5 h-3.5 border-2 border-cyan-500 border-t-transparent rounded-full" />
            <span>{t("studio.step3Exporting")}</span>
          </div>
          <ol className="space-y-1.5 text-[11px]">
            {STAGE_KEYS.map((stage, i) => {
              const currentIdx = currentStage
                ? STAGE_KEYS.findIndex((s) => s.value === currentStage)
                : -1;
              const done = currentIdx > i;
              const active = currentStage === stage.value;
              return (
                <li
                  key={stage.value}
                  className={`flex items-center gap-2 ${
                    done
                      ? "text-emerald-400"
                      : active
                        ? "text-cyan-300"
                        : "text-slate-500"
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                    done
                      ? "bg-emerald-500/30"
                      : active
                        ? "bg-cyan-500/30"
                        : "bg-slate-700/40"
                  }`}>
                    {done ? "✓" : i + 1}
                  </span>
                  <span>{t(`studio.${stage.key}`)}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-2 text-[10px] text-slate-400">
            {t("studio.step3ExportBurning", { count: chatInRangeCount })}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="mt-2 w-full px-3 py-1.5 text-xs font-semibold rounded bg-red-700/60 hover:bg-red-600/70 text-white transition-colors"
          >
            ⛔ {t("studio.btnCancel")}
          </button>
        </div>
      )}

      {/* Selected candidate summary */}
      <div className="bg-slate-900/60 rounded-md p-3 border border-slate-700/40 mb-3">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">
          {t("studio.step2SelectedTitle")}
        </div>
        <div className="text-sm text-slate-100 font-mono font-semibold">
          #{candidate.rank} · {fmtClock(startTime)} – {fmtClock(endTime)}{" "}
          <span className="text-slate-500 font-normal">({duration.toFixed(0)}秒)</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
          <div className="px-2 py-1.5 rounded bg-slate-800/60">
            <div className="text-slate-500">📨 {t("studio.step3CommentCount", { count: chatInRangeCount })}</div>
          </div>
          <div className="px-2 py-1.5 rounded bg-cyan-500/10">
            <div className="text-cyan-300 font-semibold">🎬 {t("studio.step3BurnCount", { count: burnedCount })}</div>
          </div>
        </div>
      </div>

      {/* Default action explanation */}
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-md p-2.5 mb-3 text-[11px] text-emerald-300">
        ✓ {t("studio.step3OutputTarget")}
      </div>

      {/* Fallback hint */}
      {fallbackAvailable && !isExporting && (
        <div className="mb-3 px-2 py-1.5 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded">
          ⚠ {t("studio.advancedSourceFallbackHint")}
        </div>
      )}

      {/* Big primary button */}
      {!isExporting && !isExportingTop5 && (
        <button
          type="button"
          onClick={onExportSingle}
          className="w-full mb-2 px-4 py-3.5 text-base font-bold rounded-lg bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-lg shadow-cyan-500/30 hover:brightness-110 transition-all"
        >
          🎬 {t("studio.btnExportSingle")}
        </button>
      )}

      {/* Secondary: top 5 batch */}
      {!isExporting && !isExportingTop5 && (
        <button
          type="button"
          onClick={onExportTop5}
          className="w-full mb-2 px-3 py-2 text-sm font-semibold rounded-md bg-cyan-700/30 border border-cyan-600/40 text-cyan-200 hover:bg-cyan-600/40 transition-colors"
        >
          🎬 {t("studio.btnExportTop5")}
        </button>
      )}

      {/* Output target display */}
      <div className="text-[10px] text-slate-500 mb-3">
        📂 {t("studio.step3OutputDir", { path: outputDir })}
      </div>

      {/* Result */}
      {lastResult && (lastResult.output_file || lastResult.ass_file) && !isExporting && !isExportingTop5 && (
        <div className="mt-2 px-2 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded text-[10px] space-y-1">
          <div className="text-emerald-300 font-semibold">✓ {t("studio.step3CompleteTitle")}</div>
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
              <a
                href={`/api/media/files?path=${encodeURIComponent(lastResult.output_file)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-1.5 py-0.5 rounded bg-slate-700/40 border border-slate-600/40 text-slate-200 hover:bg-slate-600/40 text-[10px]"
              >
                ▶
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
        </div>
      )}

      {/* Advanced link */}
      <button
        type="button"
        onClick={onShowAdvanced}
        className="mt-2 text-[10px] text-slate-500 hover:text-slate-300 underline w-full text-center"
      >
        ⚙ Advanced Settings
      </button>
    </div>
  );
}
