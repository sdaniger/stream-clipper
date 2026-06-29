"use client";
import React from "react";

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
  return (
    <div className="bg-slate-900/60 border-b border-slate-700/40">
      <button
        onClick={onToggle}
        className="w-full px-5 py-1 text-[10px] text-slate-400 uppercase tracking-wider hover:text-slate-200 flex items-center gap-1"
      >
        <span>{isOpen ? "▼" : "▶"}</span>
        <span>Advanced Settings</span>
        <span className="text-slate-600 normal-case tracking-normal">
          (window {windowSec}s, step {step}s, top {topN}, min gap {minGap}s, clip {clipDuration}s, offset {clipOffset}s, kw wt {keywordWeight})
        </span>
      </button>
      {isOpen && (
        <div className="px-5 pb-2.5 pt-1 flex gap-1.5 items-end flex-wrap border-t border-slate-800/50">
          <div className="flex flex-col gap-px w-14">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Window</label>
            <input type="number" value={windowSec} min={10} step={5}
              onChange={(e) => setWindowSec(Number(e.target.value) || 30)}
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
          <div className="flex flex-col gap-px w-12">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Step</label>
            <input type="number" value={step} min={5} step={5}
              onChange={(e) => setStep(Number(e.target.value) || 10)}
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
          <div className="flex flex-col gap-px w-12">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Top N</label>
            <input type="number" value={topN} min={1} max={50} step={1}
              onChange={(e) => setTopN(Number(e.target.value) || 10)}
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
          <div className="flex flex-col gap-px w-14">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Min gap</label>
            <input type="number" value={minGap} min={0} step={5}
              onChange={(e) => setMinGap(Number(e.target.value) || 45)}
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
          <div className="flex flex-col gap-px w-12">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Clip</label>
            <input type="number" value={clipDuration} min={10} max={120} step={5}
              onChange={(e) => setClipDuration(Number(e.target.value) || 30)}
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
          <div className="flex flex-col gap-px w-12">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Offset</label>
            <input type="number" value={clipOffset} min={0} max={60} step={5}
              onChange={(e) => setClipOffset(Number(e.target.value) || 10)}
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
          <div className="flex flex-col gap-px w-14">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">KW Wt</label>
            <input type="number" value={keywordWeight} min={0.5} max={5.0} step={0.5}
              onChange={(e) => setKeywordWeight(Number(e.target.value) || 2.0)}
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
          <div className="flex flex-col gap-px w-48">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Keywords</label>
            <input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)}
              placeholder="comma,separated,keywords"
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
        </div>
      )}
    </div>
  );
}
