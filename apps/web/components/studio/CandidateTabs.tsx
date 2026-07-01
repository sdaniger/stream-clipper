"use client";
import React, { useMemo, useState } from "react";
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
  onFeedback?: (candidateId: string, value: "good" | "bad" | "maybe") => void;
  feedbackById?: Record<string, "good" | "bad" | "maybe">;
  onAiEvaluate?: (c: Candidate) => void;
  aiEvaluatingIds?: Set<string>;
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
  if (s >= 60) {
    const min = Math.floor(s / 60);
    return `${min}分`;
  }
  return `${Math.round(s)}秒`;
}

function fmtDurPrecise(s: number): string {
  if (s >= 60) {
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return sec > 0 ? `${min}分${sec}秒` : `${min}分`;
  }
  return `${Math.round(s)}秒`;
}

function kindLabel(kind: string, isJa: boolean): string {
  if (kind === "short") return isJa ? "Shorts" : "Shorts";
  if (kind === "medium") return isJa ? "通常" : "Standard";
  return isJa ? "長尺" : "Long";
}

function categoryLabel(category: string | undefined, isJa: boolean): string {
  const c = category || "general";
  const ja: Record<string, string> = {
    funny: "爆笑", surprise: "驚き", clip_worthy: "切り抜き向き", hype: "神展開",
    accident: "事故/ハプニング", cute: "かわいい", chat_spike: "盛り上がり", general: "総合",
  };
  const en: Record<string, string> = {
    funny: "Funny", surprise: "Surprise", clip_worthy: "Clip-worthy", hype: "Hype",
    accident: "Accident", cute: "Cute", chat_spike: "Chat spike", general: "General",
  };
  return (isJa ? ja[c] : en[c]) || c;
}

const TAB_LABELS_JA: Record<Tab, string> = { short: "Shorts", medium: "通常", long: "長尺" };
const TAB_LABELS_EN: Record<Tab, string> = { short: "Shorts", medium: "Standard", long: "Long" };
const TAB_DESC_JA: Record<Tab, string> = {
  short: "45〜90秒 / 9:16 / SNS向け",
  medium: "3〜5分 / 16:9 / YouTube向け",
  long: "8〜12分 / 16:9 / 複数ピーク・話題のまとめ",
};
const TAB_DESC_EN: Record<Tab, string> = {
  short: "45-90s / 9:16 / vertical / for Shorts/Reels",
  medium: "3-5min / 16:9 / landscape / for YouTube",
  long: "8-12min / 16:9 / multi-peak / summary clip",
};

function extractTitle(c: Candidate): string | null {
  if (c.title) return c.title;
  if (c.reasons) {
    for (const r of c.reasons) {
      if (r.startsWith("📺 ")) return r.replace("📺 ", "");
    }
  }
  return null;
}

function getNonTitleReasons(c: Candidate): string[] {
  if (!c.reasons) return [];
  return c.reasons.filter(r => !r.startsWith("📺 "));
}

const GRADE_CONFIG = [
  { min: 0.9, label: "S", color: "text-amber-300", bg: "bg-amber-500/15" },
  { min: 0.7, label: "A", color: "text-emerald-300", bg: "bg-emerald-500/15" },
  { min: 0.5, label: "B", color: "text-cyan-300", bg: "bg-cyan-500/15" },
  { min: 0.3, label: "C", color: "text-blue-300", bg: "bg-blue-500/15" },
  { min: 0, label: "D", color: "text-slate-400", bg: "bg-slate-500/15" },
];

function getGrade(ratio: number): { label: string; color: string; bg: string } {
  for (const g of GRADE_CONFIG) {
    if (ratio >= g.min) return g;
  }
  return GRADE_CONFIG[GRADE_CONFIG.length - 1];
}

function CandidateCard({ c, isSelected, isExporting, isExported, maxScore, onSelect, onExport, onFeedback, feedback, onAiEvaluate, isAiEvaluating }: {
  c: Candidate; isSelected: boolean; isExporting: boolean; isExported: boolean;
  maxScore: number; onSelect: () => void; onExport: () => void;
  onFeedback?: (value: "good" | "bad" | "maybe") => void;
  feedback?: "good" | "bad" | "maybe";
  onAiEvaluate?: () => void;
  isAiEvaluating?: boolean;
}) {
  const { locale } = useI18n();
  const isJa = locale === "ja";
  const [showDetail, setShowDetail] = useState(false);

  const ratio = maxScore > 0 ? c.score / maxScore : 0;
  const grade = getGrade(ratio);
  const stars = Math.round(ratio * 5);
  const pct = Math.round(c.confidence ?? ratio * 100);
  const title = extractTitle(c);
  const reasons = getNonTitleReasons(c);
  const peakCount = c.peak_count || c.peak_centers?.length || 1;

  const isActiveCandidate = isSelected || isExporting;

  return (
    <div className={`rounded-xl p-4 mb-3 transition-all ${
      isActiveCandidate && !showDetail
        ? "border-2 border-cyan-400 bg-slate-800/80 shadow-lg shadow-cyan-500/10"
        : "border border-slate-700/50 bg-slate-800/50 hover:border-slate-500"
    }`}>
      {/* Row 1: Rank + Type badge + Grade */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base font-bold text-slate-100 shrink-0">#{c.rank}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            c.kind === "short" ? "bg-cyan-500/15 text-cyan-300" :
            c.kind === "medium" ? "bg-fuchsia-500/15 text-fuchsia-300" :
            "bg-amber-500/15 text-amber-300"
          }`}>{kindLabel(c.kind, isJa)}</span>
          {peakCount > 1 && (
            <span className="text-[10px] text-slate-400 whitespace-nowrap">
              {peakCount}{isJa ? "ピーク" : " peaks"}
            </span>
          )}
          {isExported && (
            <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full shrink-0">
              ✓ {isJa ? "生成済み" : "Done"}
            </span>
          )}
          <span className="text-[9px] text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded-full shrink-0">
            {categoryLabel(c.category, isJa)}
          </span>
        </div>
        <div className={`text-lg font-bold ${grade.color} shrink-0`}>{grade.label}</div>
      </div>

      {/* Stars */}
      <div className="text-sm tracking-wider mb-1">
        {"⭐".repeat(Math.max(1, Math.min(5, stars)))}
      </div>

      {/* Recommendation % */}
      <div className="text-[10px] text-slate-400 mb-2">
        {isJa ? "おすすめ度" : "Recommendation"}: <span className={`font-semibold ${grade.color}`}>{pct}%</span>
      </div>

      {/* Title suggestion */}
      {title && (
        <div className="mb-2 px-3 py-2 bg-slate-700/30 border border-slate-600/30 rounded-lg">
          <div className="text-[9px] text-slate-500 mb-0.5">{isJa ? "タイトル案" : "Title idea"}</div>
          <div className="text-[12px] text-slate-100 leading-relaxed">{title}</div>
        </div>
      )}

      {c.llm_evaluation && (
        <div className="mb-2 px-3 py-2 bg-violet-500/10 border border-violet-500/30 rounded-lg space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[9px] text-violet-300 font-semibold">AI編集者</div>
            <div className="text-[9px] text-slate-400">
              面白さ {c.llm_evaluation.interestingness} / 拡散 {c.llm_evaluation.viralPotential}
            </div>
          </div>
          <div className="text-[12px] text-slate-100 leading-relaxed">{c.llm_evaluation.title}</div>
          <div className="text-[10px] text-slate-300 leading-relaxed">{c.llm_evaluation.reasoning || c.llm_evaluation.summary}</div>
          <div className="flex flex-wrap gap-1">
            <span className="text-[9px] text-cyan-200 bg-cyan-500/10 px-1.5 py-0.5 rounded-full">{c.llm_evaluation.recommendation}</span>
            <span className="text-[9px] text-emerald-200 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">{c.llm_evaluation.bestFormat}</span>
            {c.llm_evaluation.fallback && <span className="text-[9px] text-amber-200 bg-amber-500/10 px-1.5 py-0.5 rounded-full">fallback</span>}
          </div>
        </div>
      )}

      {c.llm_post_package && (
        <div className="mb-2 px-3 py-2 bg-cyan-500/10 border border-cyan-500/25 rounded-lg space-y-1">
          <div className="text-[9px] text-cyan-300 font-semibold">{isJa ? "AI投稿パッケージ" : "AI post package"}</div>
          <div className="text-[11px] text-slate-100">{c.llm_post_package.titles[0]}</div>
          <div className="text-[10px] text-slate-400 line-clamp-2">{c.llm_post_package.socialPost}</div>
          <div className="flex flex-wrap gap-1">
            {c.llm_post_package.tags.slice(0, 5).map((tag) => (
              <span key={tag} className="text-[9px] text-cyan-200 bg-cyan-500/10 px-1.5 py-0.5 rounded-full">#{tag}</span>
            ))}
          </div>
        </div>
      )}

      {/* Time range */}
      <div className="text-xs text-slate-300 font-mono mb-1">
        {fmtClock(c.clip_start ?? 0)} – {fmtClock(c.clip_end ?? 0)}
        <span className="text-slate-500 ml-2 font-normal">({fmtDur(c.clip_duration)})</span>
      </div>

      {/* Aspect ratio + orientation */}
      <div className="text-[10px] text-slate-500 mb-2">
        {c.kind === "short" ? "9:16" : "16:9"} · {c.kind === "short" ? (isJa ? "縦長" : "vertical") : isJa ? "横長" : "landscape"}
        {c.kind === "short" ? " · " + (isJa ? "Shorts/Reels向け" : "for Shorts") : ""}
        {c.kind === "medium" ? " · " + (isJa ? "YouTube向け" : "for YouTube") : ""}
        {c.kind === "long" ? " · " + (isJa ? "長尺" : "long-form") : ""}
      </div>

      {/* Peak timestamps for long */}
      {c.kind === "long" && c.peak_centers && c.peak_centers.length > 1 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {c.peak_centers.slice(0, 5).map((p, i) => (
            <span key={i} className="text-[9px] text-cyan-300 bg-cyan-500/10 px-1.5 py-0.5 rounded-full">▶ {fmtClock(p)}</span>
          ))}
          {c.peak_centers.length > 5 && <span className="text-[9px] text-slate-500 px-1.5 py-0.5">+{c.peak_centers.length - 5}</span>}
        </div>
      )}

      {/* Long candidate summary */}
      {c.kind === "long" && c.topic_coherence_score != null && (
        <div className="text-[10px] text-slate-400 mb-2 space-y-0.5">
          {c.sustained_chat_score != null && (
            <div>{isJa ? "継続的な盛り上がり" : "Sustained activity"}: <span className="text-cyan-300 font-semibold">{Math.round(c.sustained_chat_score)}%</span></div>
          )}
          {c.topic_coherence_score != null && (
            <div>{isJa ? "話題のまとまり" : "Topic coherence"}: <span className="text-cyan-300 font-semibold">{Math.round(c.topic_coherence_score * 100)}%</span></div>
          )}
          {c.dead_air_penalty != null && c.dead_air_penalty < 0 && (
            <div>{isJa ? "低反応区間" : "Low-activity gaps"}: <span className="text-emerald-300 font-semibold">{isJa ? "少ない" : "Minimal"}</span></div>
          )}
        </div>
      )}

      {/* Reason tags */}
      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {reasons.slice(0, 4).map((r, i) => (
            <span key={i} className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full whitespace-nowrap">{r}</span>
          ))}
          {reasons.length > 4 && (
            <span className="text-[9px] text-slate-500 px-1.5 py-0.5">+{reasons.length - 4}</span>
          )}
        </div>
      )}

      {c.representative_comments && c.representative_comments.length > 0 && (
        <div className="mb-2 space-y-1">
          <div className="text-[9px] text-slate-500">{isJa ? "代表コメント" : "Representative comments"}</div>
          {c.representative_comments.slice(0, 3).map((comment, i) => (
            <div key={`${comment.time_sec}-${i}`} className="text-[10px] text-slate-300 bg-slate-900/40 border border-slate-700/40 rounded px-2 py-1 leading-snug">
              <span className="text-cyan-300 font-mono mr-1">{fmtClock(comment.time_sec)}</span>
              {comment.author && <span className="text-slate-500 mr-1">{comment.author}:</span>}
              <span>{comment.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Quick stat row (subtle) */}
      <div className="flex items-center gap-2 text-[9px] text-slate-600 mb-2">
        <span>💬 {c.chat_count}</span>
        <span>👤 {c.unique_author_count}</span>
        <span>🔥 {c.keyword_hits}{isJa ? "反応" : " reactions"}</span>
        {c.overlap_group && <span>🔗 {c.overlap_group}</span>}
      </div>

      {onFeedback && (
        <div className="flex gap-1 mb-2">
          {([
            ["good", isJa ? "良い" : "Good"],
            ["maybe", isJa ? "微妙" : "Maybe"],
            ["bad", isJa ? "違う" : "Bad"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={(e) => { e.stopPropagation(); onFeedback(value); }}
              className={`px-2 py-1 rounded-full text-[9px] border transition-colors ${
                feedback === value
                  ? "border-cyan-400/70 bg-cyan-500/15 text-cyan-200"
                  : "border-slate-700/50 bg-slate-900/30 text-slate-500 hover:text-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className={`flex-1 px-3 py-2.5 text-xs font-semibold rounded-lg transition-all min-h-[40px] ${
            isSelected
              ? "bg-cyan-600/30 border border-cyan-500/50 text-cyan-200"
              : "bg-slate-700/40 border border-slate-600/40 text-slate-200 hover:bg-slate-600/40"
          }`}>
          {isJa ? "プレビュー" : "Preview"}
        </button>
        {onAiEvaluate && (
          <button onClick={(e) => { e.stopPropagation(); onAiEvaluate(); }} disabled={isAiEvaluating}
            className="px-3 py-2.5 text-xs font-semibold rounded-lg bg-violet-500/15 border border-violet-500/40 text-violet-200 hover:bg-violet-500/25 disabled:opacity-40 min-h-[40px]">
            {isAiEvaluating ? "AI…" : "AI"}
          </button>
        )}
        <button onClick={(e) => { e.stopPropagation(); onExport(); }} disabled={isExporting}
          className="flex-[2] px-3 py-2.5 text-xs font-bold rounded-lg bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-lg shadow-cyan-500/20 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all min-h-[40px]">
          {isExporting ? "⏳" : isJa ? "この候補を生成" : "Generate"}
        </button>
        <button onClick={(e) => { e.stopPropagation(); setShowDetail(!showDetail); }}
          className="px-2.5 py-2.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors min-h-[40px]"
          title={isJa ? "詳細メトリクス" : "Detail metrics"}>
          {showDetail ? "▲" : "▼"}
        </button>
      </div>

      {/* Detail metrics */}
      {showDetail && (
        <div className="mt-2 p-2.5 bg-slate-900/60 rounded-lg border border-slate-700/40">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
            <div className="flex justify-between"><span className="text-slate-500">{isJa ? "スコア" : "Score"}</span><span className="text-slate-200 font-mono">{c.score.toFixed(1)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{isJa ? "チャット数" : "Chat count"}</span><span className="text-slate-200 font-mono">{c.chat_count}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{isJa ? "ピーク数" : "Peaks"}</span><span className="text-slate-200 font-mono">{peakCount}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{isJa ? "ユニーク投稿者" : "Unique chatters"}</span><span className="text-slate-200 font-mono">{c.unique_author_count}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">😂 {isJa ? "笑い" : "Laugh"}</span><span className="text-slate-200 font-mono">{Math.round(c.laugh_score)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">😱 {isJa ? "驚き" : "Surprise"}</span><span className="text-slate-200 font-mono">{Math.round(c.surprise_score)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">🔥 {isJa ? "切り抜き価値" : "Clip value"}</span><span className="text-slate-200 font-mono">{Math.round(c.clip_worthy_score)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{isJa ? "反応ワード" : "Keywords"}</span><span className="text-slate-200 font-mono">{c.keyword_hits}</span></div>
          </div>
          {c.kind === "long" && c.long_score != null && (
            <div className="mt-1.5 pt-1.5 border-t border-slate-800/60 text-[10px]">
              <div className="flex justify-between"><span className="text-slate-500">{isJa ? "長尺スコア" : "Long score"}</span><span className="text-amber-300 font-mono">{c.long_score.toFixed(2)}</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CandidateTabs({ short, medium, long, selectedCandidateId, exportingCandidateIds, exportedCandidateIds, onSelect, onExport, onFeedback, feedbackById = {}, onAiEvaluate, aiEvaluatingIds = new Set() }: Props) {
  const { locale } = useI18n();
  const isJa = locale === "ja";
  const [tab, setTab] = useState<Tab>("short");

  const counts: Record<Tab, number> = { short: short.length, medium: medium.length, long: long.length };
  const lists: Record<Tab, Candidate[]> = { short, medium, long };
  const currentList = lists[tab];
  const maxScore = Math.max(0, ...currentList.map((c) => c.score));

  return (
    <div>
      {/* Tab buttons */}
      <div className="flex gap-1 mb-2">
        {(["short", "medium", "long"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 px-2 py-2 text-xs font-semibold rounded-lg transition-all ${
              tab === t
                ? "bg-slate-800/80 text-cyan-300 border border-cyan-500/40"
                : "bg-slate-900/60 text-slate-400 border border-slate-700/40 hover:bg-slate-800/40"
            }`}>
            <div>{isJa ? TAB_LABELS_JA[t] : TAB_LABELS_EN[t]}</div>
            <div className="text-[9px] text-slate-500 font-normal mt-0.5">{counts[t]}{isJa ? "本" : ""}</div>
          </button>
        ))}
      </div>

      {/* Tab description */}
      <div className="mb-3 text-[10px] text-slate-500 px-1">
        {isJa ? TAB_DESC_JA[tab] : TAB_DESC_EN[tab]}
      </div>

      {/* Candidate list */}
      {currentList.length === 0 ? (
        <div className="text-center text-xs text-slate-500 py-8">
          {isJa ? "候補が見つかりませんでした" : "No candidates found"}
        </div>
      ) : (
        currentList.map((c) => (
          <CandidateCard key={c.candidate_id} c={c}
            isSelected={selectedCandidateId === c.candidate_id}
            isExporting={exportingCandidateIds.has(c.candidate_id)}
            isExported={exportedCandidateIds.has(c.candidate_id)}
            maxScore={maxScore} onSelect={() => onSelect(c)} onExport={() => onExport(c)}
            onFeedback={onFeedback ? (value) => onFeedback(c.candidate_id, value) : undefined}
            feedback={feedbackById[c.candidate_id]}
            onAiEvaluate={onAiEvaluate ? () => onAiEvaluate(c) : undefined}
            isAiEvaluating={aiEvaluatingIds.has(c.candidate_id)} />
        ))
      )}
    </div>
  );
}
