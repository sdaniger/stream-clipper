"use client";

import React from "react";
import type { Candidate } from "@/lib/studio-jobs-api";
import { useI18n } from "@/lib/i18n";

interface Props {
  short: Candidate[];
  medium: Candidate[];
  long: Candidate[];
  selectedCandidateId: string | null;
  exportingCandidateIds: Set<string>;
  exportedCandidateIds: Set<string>;
  onSelect: (c: Candidate) => void;
  onExport: (c: Candidate) => void;
  maxScoreByKind?: { short: number; medium: number; long: number };
}

type Tab = "short" | "medium" | "long";

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
  if (s >= 60) return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;
  return `${Math.round(s)}s`;
}

const TAB_LABELS_JA: Record<Tab, string> = {
  short: "Shorts",
  medium: "通常",
  long: "長尺",
};
const TAB_LABELS_EN: Record<Tab, string> = {
  short: "Shorts",
  medium: "Standard",
  long: "Long",
};

const TAB_DESC_JA: Record<Tab, string> = {
  short: "45-90秒 / 9:16 / 単一ピーク",
  medium: "3-5分 / 16:9 / 2-3ピーク",
  long: "8-12分 / 16:9 / 複数ピーク+サマリー",
};
const TAB_DESC_EN: Record<Tab, string> = {
  short: "45-90s / 9:16 / single peak",
  medium: "3-5min / 16:9 / 2-3 peaks",
  long: "8-12min / 16:9 / multi-peak + summary",
};

const TAB_ICON: Record<Tab, string> = {
  short: "📱",
  medium: "🎬",
  long: "🎞️",
};

function CandidateRow({
  c,
  isSelected,
  isExporting,
  isExported,
  maxScore,
  onSelect,
  onExport,
}: {
  c: Candidate;
  isSelected: boolean;
  isExporting: boolean;
  isExported: boolean;
  maxScore: number;
  onSelect: () => void;
  onExport: () => void;
}) {
  const { t } = useI18n();
  const peakCenters = c.peak_centers?.length || 0;
  return (
    <div
      onClick={onSelect}
      className={`rounded-md p-2.5 mb-1.5 transition-all cursor-pointer ${
        isSelected
          ? "border border-cyan-500 shadow-[0_0_0_1px_#22d3ee] bg-slate-700/80"
          : "border border-slate-700/60 bg-slate-800/60 hover:border-slate-500"
      }`}
    >
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-sm font-bold text-cyan-300">#{c.rank}</span>
        <span className="text-[10px] text-slate-500">
          {c.kind === "short" ? "📱 Shorts" : c.kind === "long" ? "🎞️ Long" : "🎬 Standard"}
        </span>
        <span className="text-[10px] text-amber-400 font-semibold ml-1">
          score {Math.round(c.score)}
        </span>
        {peakCenters > 1 && (
          <span className="text-[10px] text-fuchsia-300">
            ⭐ {peakCenters} peaks
          </span>
        )}
        {isExported && (
          <span className="text-[9px] text-emerald-400 font-semibold px-1 py-0.5 rounded bg-emerald-500/10 ml-auto">
            ✓ {t("studio.exportedBadge")}
          </span>
        )}
      </div>

      {/* Score bar */}
      <div className="h-1 w-full bg-slate-800/60 rounded mb-1.5 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-600 to-amber-300"
          style={{
            width: `${Math.min(100, (c.score / Math.max(maxScore, 1)) * 100)}%`,
          }}
        />
      </div>

      {/* Time */}
      <div className="text-[11px] text-slate-200 font-mono font-semibold mb-0.5">
        {fmtClock(c.clip_start ?? 0)} – {fmtClock(c.clip_end ?? 0)}{" "}
        <span className="text-slate-500 font-normal">({fmtDur(c.clip_duration)})</span>
      </div>

      {/* Stats */}
      <div className="text-[10px] text-slate-500 flex items-center gap-2 mb-1">
        <span>Chat <span className="text-slate-300 font-semibold">{c.chat_count}</span></span>
        <span>KW <span className="text-slate-300 font-semibold">{c.keyword_hits}</span></span>
        <span>😂 <span className="text-slate-300 font-semibold">{Math.round(c.laugh_score)}</span></span>
        <span>😱 <span className="text-slate-300 font-semibold">{Math.round(c.surprise_score)}</span></span>
        <span>🔥 <span className="text-slate-300 font-semibold">{Math.round(c.clip_worthy_score)}</span></span>
      </div>

      {/* Reasons */}
      {c.reasons && c.reasons.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-1.5">
          {c.reasons.slice(0, 3).map((r, i) => (
            <span
              key={i}
              className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-sm whitespace-nowrap"
            >
              {r}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onSelect}
          className={`flex-1 px-1.5 py-1 text-[10px] rounded font-semibold ${
            isSelected
              ? "bg-cyan-600/40 border border-cyan-500/60 text-cyan-100"
              : "bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/30"
          }`}
        >
          {t("studio.writeRank")}
        </button>
        <button
          onClick={onExport}
          disabled={isExporting}
          className="flex-1 px-1.5 py-1 text-[10px] rounded bg-gradient-to-r from-fuchsia-600/30 to-cyan-600/30 border border-fuchsia-500/40 text-fuchsia-200 hover:from-fuchsia-500/40 hover:to-cyan-500/40 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
        >
          {isExporting ? "⏳" : "🎬 生成"}
        </button>
      </div>
    </div>
  );
}

export default function CandidateTabs({
  short,
  medium,
  long,
  selectedCandidateId,
  exportingCandidateIds,
  exportedCandidateIds,
  onSelect,
  onExport,
  maxScoreByKind,
}: Props) {
  const { locale } = useI18n();
  const isJa = locale === "ja";
  const [tab, setTab] = React.useState<Tab>("short");

  const counts: Record<Tab, number> = {
    short: short.length,
    medium: medium.length,
    long: long.length,
  };
  const lists: Record<Tab, Candidate[]> = { short, medium, long };
  const currentList = lists[tab];
  const maxScore = maxScoreByKind
    ? maxScoreByKind[tab]
    : Math.max(0, ...currentList.map((c) => c.score));

  return (
    <div className="bg-slate-900/60 rounded-lg border border-slate-700/40">
      {/* Tabs */}
      <div className="flex items-stretch border-b border-slate-700/40">
        {(["short", "medium", "long"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-2 py-2.5 text-[11px] font-semibold transition-colors ${
              tab === t
                ? "bg-slate-800/80 text-cyan-300 border-b-2 border-cyan-400"
                : "bg-slate-900/40 text-slate-400 hover:bg-slate-800/40"
            }`}
          >
            <div className="text-base mb-0.5">{TAB_ICON[t]}</div>
            <div>{isJa ? TAB_LABELS_JA[t] : TAB_LABELS_EN[t]}</div>
            <div className="text-[9px] text-slate-500 font-normal mt-0.5">
              {counts[t]} {isJa ? "本" : "cands"}
            </div>
          </button>
        ))}
      </div>

      {/* Tab description */}
      <div className="px-3 py-1.5 text-[10px] text-slate-500 border-b border-slate-800/40">
        {isJa ? TAB_DESC_JA[tab] : TAB_DESC_EN[tab]}
      </div>

      {/* Candidate list */}
      <div className="p-2 max-h-[60vh] overflow-y-auto">
        {currentList.length === 0 ? (
          <div className="text-center text-xs text-slate-500 py-8">
            {isJa ? "候補が見つかりませんでした" : "No candidates"}
          </div>
        ) : (
          currentList.map((c) => (
            <CandidateRow
              key={c.candidate_id}
              c={c}
              isSelected={selectedCandidateId === c.candidate_id}
              isExporting={exportingCandidateIds.has(c.candidate_id)}
              isExported={exportedCandidateIds.has(c.candidate_id)}
              maxScore={maxScore}
              onSelect={() => onSelect(c)}
              onExport={() => onExport(c)}
            />
          ))
        )}
      </div>
    </div>
  );
}
