"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";

interface Props {
  vodUrl: string;
  setVodUrl: (v: string) => void;
  videoId: string | null;
  isAnalyzing: boolean;
  progressLabel: string;
  progress: number;
  errorMessage: string | null;
  vodTitle: string | null;
  onLoad: () => void;
  onAutoAnalyze: () => void;
}

export default function Step1VodInput({
  vodUrl,
  setVodUrl,
  isAnalyzing,
  progressLabel,
  progress,
  errorMessage,
  vodTitle,
  onAutoAnalyze,
}: Props) {
  const { t } = useI18n();
  const isLoaded = !!vodTitle;

  return (
    <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-700/40">
      <div className="text-base font-semibold text-slate-200 mb-1">
        🎯 {t("studio.step1Title") || "Step 1: 配信URL を入力"}
      </div>
      <div className="text-[11px] text-slate-400 mb-3">
        Twitch / YouTube のVOD URLを貼って「自動解析」を押すだけ。
        チャット取得 → 解析 → Shorts / 通常 / 長尺 候補まで一気に進めます。
      </div>

      {/* VOD URL input */}
      <div className="flex gap-2 mb-2">
        <input
          type="url"
          value={vodUrl}
          onChange={(e) => setVodUrl(e.target.value)}
          placeholder="https://www.twitch.tv/videos/1234567890"
          className="flex-1 px-3 py-2 bg-slate-800/60 border border-slate-700/40 rounded text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60"
          disabled={isAnalyzing}
        />
      </div>

      {/* Big analyze button */}
      <button
        type="button"
        onClick={onAutoAnalyze}
        disabled={isAnalyzing || !vodUrl.trim()}
        className="w-full mb-2 px-4 py-3 text-base font-bold rounded-lg bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-lg shadow-cyan-500/30 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
      >
        {isAnalyzing ? (
          <>
            <div className="animate-spin w-4 h-4 border-2 border-white/40 border-t-white rounded-full" />
            <span>{progressLabel || "解析中..."}</span>
          </>
        ) : (
          <>🎬 自動解析して候補を出す</>
        )}
      </button>

      {/* Progress bar (during analysis) */}
      {isAnalyzing && (
        <div className="mb-2">
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-slate-500">
            <span>{progressLabel}</span>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>
      )}

      {/* Loaded info */}
      {isLoaded && !isAnalyzing && (
        <div className="mt-2 px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded text-[11px] text-emerald-300">
          ✓ {vodTitle}
        </div>
      )}

      {/* Error */}
      {errorMessage && !isAnalyzing && (
        <div className="mt-2 px-2.5 py-1.5 bg-red-500/10 border border-red-500/30 rounded text-[11px] text-red-300">
          ✗ {errorMessage}
        </div>
      )}

      <div className="mt-3 text-[10px] text-slate-500">
        ※ Twitch VOD を標準ソースとして解析 → 出力まで行います。
        ローカルファイルは Advanced 設定から利用可能です。
      </div>
    </div>
  );
}
