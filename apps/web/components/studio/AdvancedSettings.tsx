"use client";
import React from "react";
import { useI18n } from "@/lib/i18n";

interface Props {
  isOpen: boolean;
  onToggle: () => void;
  windowSec: number;
  setWindowSec: (v: number) => void;
  step: number;
  setStep: (v: number) => void;
  topN: number;
  setTopN: (v: number) => void;
  minGap: number;
  setMinGap: (v: number) => void;
  clipDuration: number;
  setClipDuration: (v: number) => void;
  clipOffset: number;
  setClipOffset: (v: number) => void;
  keywordWeight: number;
  setKeywordWeight: (v: number) => void;
  keywordsText: string;
  setKeywordsText: (v: string) => void;
}

export default function AdvancedSettings({
  isOpen,
  onToggle,
  windowSec,
  setWindowSec,
  step,
  setStep,
  topN,
  setTopN,
  minGap,
  setMinGap,
  clipDuration,
  setClipDuration,
  clipOffset,
  setClipOffset,
  keywordWeight,
  setKeywordWeight,
  keywordsText,
  setKeywordsText,
}: Props) {
  const { t } = useI18n();
  // Human-readable summary
  const summary = t("studio.advancedSummary", {
    topN,
    window: windowSec,
    step,
    minGap,
    duration: clipDuration,
    offset: clipOffset,
  });

  return (
    <div className="bg-slate-900/60 border-b border-slate-700/40">
      <button
        onClick={onToggle}
        className="w-full px-5 py-1.5 text-left hover:bg-slate-800/40 flex items-center gap-2 transition-colors"
      >
        <span className="text-[10px] text-slate-500">{isOpen ? "▼" : "▶"}</span>
        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">{t("studio.advancedSettings")}</span>
        {!isOpen && (
          <span className="text-[10px] text-slate-500 normal-case tracking-normal truncate">
            {summary}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="px-5 pb-3 pt-2 border-t border-slate-800/50">
          <div className="grid grid-cols-4 md:grid-cols-8 gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">候補数 (top_n)</label>
              <input type="number" value={topN} min={1} max={50} step={1}
                onChange={(e) => setTopN(Number(e.target.value) || 10)}
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-violet-500 w-full" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">区間幅 (window)</label>
              <input type="number" value={windowSec} min={10} step={5}
                onChange={(e) => setWindowSec(Number(e.target.value) || 30)}
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-violet-500 w-full" />
              <span className="text-[9px] text-slate-600">秒</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">ステップ</label>
              <input type="number" value={step} min={5} step={5}
                onChange={(e) => setStep(Number(e.target.value) || 10)}
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-violet-500 w-full" />
              <span className="text-[9px] text-slate-600">秒</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">最低間隔</label>
              <input type="number" value={minGap} min={0} step={5}
                onChange={(e) => setMinGap(Number(e.target.value) || 45)}
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-violet-500 w-full" />
              <span className="text-[9px] text-slate-600">秒</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">切り抜き尺</label>
              <input type="number" value={clipDuration} min={10} max={120} step={5}
                onChange={(e) => setClipDuration(Number(e.target.value) || 30)}
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-violet-500 w-full" />
              <span className="text-[9px] text-slate-600">秒</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">ピーク前</label>
              <input type="number" value={clipOffset} min={0} max={60} step={5}
                onChange={(e) => setClipOffset(Number(e.target.value) || 10)}
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-violet-500 w-full" />
              <span className="text-[9px] text-slate-600">秒</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">KW重み</label>
              <input type="number" value={keywordWeight} min={0.5} max={5.0} step={0.5}
                onChange={(e) => setKeywordWeight(Number(e.target.value) || 2.0)}
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-violet-500 w-full" />
              <span className="text-[9px] text-slate-600">×</span>
            </div>
            <div className="flex flex-col gap-1 col-span-4 md:col-span-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">追加KW</label>
              <input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)}
                placeholder="カンマ区切り"
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-violet-500 w-full" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
