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
  onAutoAnalyze: () => void;
}

export default function Step1VodInput({
  vodUrl, setVodUrl, isAnalyzing, progressLabel, progress, errorMessage, vodTitle, onAutoAnalyze,
}: Props) {
  const { t, locale } = useI18n();
  const isJa = locale === "ja";
  const isLoaded = !!vodTitle;

  return (
    <div>
      {/* Show subtitle only when no VOD is loaded yet */}
      {!isLoaded && !isAnalyzing && (
        <p className="text-[11px] sm:text-xs text-slate-400 mb-2 leading-relaxed">
          {isJa
            ? "Twitch/YouTubeのVOD URLを貼り付けると、チャット解析から切り抜き候補の生成まで自動で行います。"
            : "Paste a Twitch/YouTube VOD URL to automatically analyze chat and generate clip candidates."}
        </p>
      )}

      {/* URL input + button */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="url" value={vodUrl} onChange={(e) => setVodUrl(e.target.value)}
          placeholder={isJa ? "https://www.twitch.tv/videos/1234567890" : "https://www.twitch.tv/videos/1234567890"}
          className="flex-1 px-4 py-3 bg-slate-800/60 border border-slate-700/40 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60"
          disabled={isAnalyzing}
        />
        <button
          type="button" onClick={onAutoAnalyze} disabled={isAnalyzing || !vodUrl.trim()}
          className="w-full sm:w-auto shrink-0 px-6 py-3 text-sm font-bold rounded-lg bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-lg shadow-cyan-500/30 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 min-h-[48px]"
        >
          {isAnalyzing ? (
            <>
              <div className="animate-spin w-4 h-4 border-2 border-white/40 border-t-white rounded-full" />
              <span>{progressLabel || (isJa ? "解析中..." : "Analyzing...")}</span>
            </>
          ) : (
            <>{isJa ? "自動解析する" : "Auto-analyze"}</>
          )}
        </button>
      </div>

      {/* Loaded state: VOD title */}
      {isLoaded && !isAnalyzing && !errorMessage && (
        <div className="mt-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-sm text-emerald-300 flex items-center gap-2">
          <span>✓</span>
          <span className="truncate">{vodTitle}</span>
        </div>
      )}

      {/* Error state */}
      {errorMessage && !isAnalyzing && (
        <div className="mt-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300">
          ✗ {errorMessage}
        </div>
      )}
    </div>
  );
}
