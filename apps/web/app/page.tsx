"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommentCanvasOverlay } from "@/components/comment-canvas-overlay";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  createCommentExportPayload,
  defaultCommentOverlaySettings,
  generateCommentOverlayItems,
  generateScrollingCommentsAss
} from "@/lib/comment-overlay";
import { clearCandidates, loadCandidates, saveCandidates } from "@/lib/candidate-storage";
import { cn } from "@/lib/utils";
import type { ClipCandidate } from "@/lib/mock-candidates";
import type { CommentOverlayItem, CommentOverlaySettings } from "@/types/comment-overlay";

// ── SSE pipeline stage types ──

type StageStatus = "pending" | "running" | "done" | "error" | "cancelled";

type Stage = {
  id: string;
  label: string;
  status: StageStatus;
  detail?: string;
};

type PipelineResult = {
  sourceUrl: string;
  metadata: { title: string | null; uploader: string | null; duration: string | null };
  chat: { messageCount: number };
  summary: { candidateCount: number; analyzedMessages: number };
  candidates: ClipCandidate[];
  generatedClipCount: number;
  transcribedCount: number;
  pipelineWarnings: Array<{ stage: string; candidateId?: string; message: string }>;
};

type SSEProgressEvent = {
  stage: string;
  status: string;
  message?: string;
  candidateId?: string;
  candidateIndex?: number;
  candidateTotal?: number;
};

// ── constants ──

const STAGE_ORDER = ["metadata", "download", "chat", "analysis", "clip", "transcription", "comments", "package"];
const STAGE_LABELS: Record<string, string> = {
  metadata: "メタデータ取得",
  download: "動画ダウンロード",
  chat: "チャット取得",
  analysis: "候補解析",
  clip: "クリップ生成",
  transcription: "文字起こし",
  comments: "コメント生成",
  package: "パッケージ"
};

const MAX_CANDIDATES_PRESETS = [1, 2, 3, 6, 12, 24];

// ── main page ──

export default function Home() {
  // input
  const [url, setUrl] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [maxCandidates, setMaxCandidates] = useState(6);
  const [customMax, setCustomMax] = useState("");
  const [transcribe, setTranscribe] = useState(true);
  const [withComments, setWithComments] = useState(true);
  const [encoder, setEncoder] = useState<"libx264" | "h264_nvenc" | "hevc_nvenc">("h264_nvenc");

  // pipeline
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [stages, setStages] = useState<Stage[]>(
    STAGE_ORDER.map((id) => ({ id, label: STAGE_LABELS[id] ?? id, status: "pending" as StageStatus }))
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);

  // candidates
  const [candidates, setCandidates] = useState<ClipCandidate[]>(() => loadCandidates() ?? []);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // timers
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // clean up
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (saveRef.current) clearTimeout(saveRef.current);
    };
  }, []);

  // auto-save (silent)
  useEffect(() => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => saveCandidates(candidates), 600);
  }, [candidates]);

  const effectiveMax = customMax.trim() ? Math.max(1, parseInt(customMax, 10) || maxCandidates) : maxCandidates;

  // ── run pipeline with proper SSE parsing ──

  const handleRun = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setResult(null);
    setIsRunning(true);
    setElapsed(0);
    setProgress(0);
    setStages(STAGE_ORDER.map((id) => ({ id, label: STAGE_LABELS[id] ?? id, status: "pending" })));

    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);
    tickRef.current = tick;
    const abort = new AbortController();
    abortRef.current = abort;

    const stageStatus: Record<string, StageStatus> = {};
    let downloadedMessages = 0;

    try {
      const response = await fetch("/api/archive/analyze/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmed,
          maxCandidates: effectiveMax,
          transcribe,
          generatePackages: withComments,
          encoder,
          clipMode: encoder !== "libx264" ? "reencode" : "copy"
        }),
        signal: abort.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const match = text.match(/data:\s*(.+)/);
        const errorData = match ? JSON.parse(match[1]) : null;
        throw new Error(errorData?.error ?? `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No streaming body");

      const decoder = new TextDecoder();
      let buffer = "";

      // SSE parser — same logic as archive-auto-panel.tsx
      function processLines(lines: string[]) {
        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const raw = line.slice(6);
            try {
              const data = JSON.parse(raw);

              if (currentEvent === "progress") {
                const evt = data as SSEProgressEvent;
                if (evt.stage && evt.status) {
                  const newStatus: StageStatus =
                    evt.status === "running" ? "running"
                    : evt.status === "done" ? "done"
                    : evt.status === "error" ? "error"
                    : "pending";
                  stageStatus[evt.stage] = newStatus;

                  if (evt.stage === "chat" && evt.status === "running" && evt.message) {
                    const m = evt.message.match(/([\d,]+)\s*\/\s*[\d,]+/);
                    if (m) downloadedMessages = parseInt(m[1].replace(/,/g, ""), 10);
                  }

                  const doneCount = Object.values(stageStatus).filter((s) => s === "done").length;
                  setProgress(Math.round((doneCount / STAGE_ORDER.length) * 100));

                  setStages(STAGE_ORDER.map((id) => ({
                    id,
                    label: STAGE_LABELS[id] ?? id,
                    status: stageStatus[id] ?? "pending",
                    detail: evt.stage === id ? evt.message : undefined
                  })));
                }
              } else if (currentEvent === "complete") {
                const res = data as PipelineResult;
                setResult(res);
                setCandidates(res.candidates);
                setProgress(100);
                setStages(STAGE_ORDER.map((id) => ({ id, label: STAGE_LABELS[id] ?? id, status: "done" })));
              } else if (currentEvent === "error") {
                setError(data?.error ?? "パイプラインでエラーが発生しました");
              } else if (currentEvent === "cancelled") {
                setError("キャンセルされました");
              }
            } catch {
              // skip unparsable data lines
            }
          }
          // blank line resets event
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        processLines(lines);
      }
      if (buffer.trim()) processLines([buffer]);
    } catch (err) {
      if (abort.signal.aborted) {
        setError("キャンセルされました");
      } else {
        const msg = err instanceof Error ? err.message : "Unknown pipeline error";
        setError(humanizeError(msg));
      }
    } finally {
      clearInterval(tick);
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [url, effectiveMax, transcribe, withComments]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── render ──

  const totalCandidates = candidates.length;
  const withClips = candidates.filter((c) => c.generatedClip).length;
  const withTranscriptions = candidates.filter((c) => c.transcription).length;

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-200/30 bg-cyan-300/10 text-base font-black text-cyan-100 shadow-glow">
              SC
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Stream Clipper</h1>
              <p className="text-xs text-slate-400">配信アーカイブの自動切り抜き</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <a href="/dev" className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-500 transition hover:text-slate-300">
              dev
            </a>
          </div>
        </header>

        {/* Step 1: URL input */}
        <section className="glass-panel rounded-3xl p-5 sm:p-6">
          <div className="flex flex-col gap-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <input
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setError(null); }}
                  placeholder="Twitch の VOD URL を貼り付け..."
                  disabled={isRunning}
                  className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 text-base text-white outline-none placeholder:text-slate-500 focus:border-cyan-200/60 disabled:opacity-50"
                  onKeyDown={(e) => e.key === "Enter" && handleRun()}
                />
              </div>
              <button
                type="button"
                onClick={handleRun}
                disabled={isRunning || !url.trim()}
                className={cn(
                  "h-14 w-32 shrink-0 rounded-2xl text-base font-bold transition disabled:cursor-not-allowed disabled:opacity-40",
                  isRunning
                    ? "border border-rose-300/40 bg-rose-400/10 text-rose-100"
                    : "border border-cyan-200/45 bg-cyan-300/15 text-cyan-50 hover:bg-cyan-300/25"
                )}
              >
                {isRunning ? "停止" : "▶ 開始"}
              </button>
            </div>

            {/* detail settings */}
            <div>
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                className="text-xs text-slate-500 transition hover:text-slate-300"
              >
                {showSettings ? "▲ 詳細設定" : "▼ 詳細設定"}
              </button>
              {showSettings && (
                <div className="mt-3 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-3">
                  <div>
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      最大候補数: {effectiveMax}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {MAX_CANDIDATES_PRESETS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => { setMaxCandidates(v); setCustomMax(""); }}
                          className={cn(
                            "rounded-xl px-2.5 py-1.5 text-xs font-semibold transition",
                            effectiveMax === v && customMax === ""
                              ? "border border-cyan-200/60 bg-cyan-300/15 text-cyan-50"
                              : "border border-white/10 text-slate-400 hover:text-slate-200"
                          )}
                        >
                          {v}
                        </button>
                      ))}
                      <input
                        value={customMax}
                        onChange={(e) => setCustomMax(e.target.value.replace(/\D/g, "").slice(0, 3))}
                        placeholder="自由"
                        className={cn(
                          "w-12 rounded-xl border px-2 py-1.5 text-xs text-slate-100 bg-slate-950/40 outline-none placeholder:text-slate-600 focus:border-cyan-200/60",
                          customMax ? "border-cyan-200/40" : "border-white/10"
                        )}
                      />
                    </div>
                  </div>
                  <div className="flex items-end gap-3">
                    <label className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition",
                      transcribe ? "border-fuchsia-300/40 bg-fuchsia-400/10 text-fuchsia-100" : "border-white/10 text-slate-400"
                    )}>
                      <input type="checkbox" checked={transcribe} onChange={(e) => setTranscribe(e.target.checked)} className="h-3.5 w-3.5 accent-fuchsia-300" />
                      文字起こし
                    </label>
                    <label className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition",
                      withComments ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100" : "border-white/10 text-slate-400"
                    )}>
                      <input type="checkbox" checked={withComments} onChange={(e) => setWithComments(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-300" />
                      コメント付き
                    </label>
                    <select
                      value={encoder}
                      onChange={(e) => setEncoder(e.target.value as typeof encoder)}
                      className="h-[34px] rounded-xl border border-white/10 bg-slate-950/60 px-2 text-xs text-slate-100 outline-none focus:border-cyan-200/60 cursor-pointer"
                    >
                      <option value="h264_nvenc">GPU (nvenc) 🚀</option>
                      <option value="hevc_nvenc">GPU (hevc)</option>
                      <option value="libx264">CPU (libx264)</option>
                    </select>
                  </div>
                  {result && (
                    <button
                      type="button"
                      onClick={() => { clearCandidates(); setCandidates([]); setResult(null); setExpandedId(null); }}
                      className="self-end rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-slate-400 transition hover:text-rose-300"
                    >
                      すべてクリア
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Step 2: pipeline progress */}
        {isRunning && (
          <section className="glass-panel rounded-3xl p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">解析中...</p>
              <p className="font-mono text-xs text-slate-400">
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
              </p>
            </div>
            <div className="mb-5 h-2.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-300 via-cyan-200 to-emerald-200 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="space-y-2">
              {stages.map((stage) => (
                <div key={stage.id} className={cn(
                  "flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm",
                  stage.status === "running" && "border border-cyan-300/15 bg-cyan-900/10"
                )}>
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot status={stage.status} />
                    <span className="truncate text-slate-200">{stage.label}</span>
                    {stage.detail && stage.status === "running" && (
                      <span className="hidden truncate text-xs text-slate-500 sm:inline">{stage.detail}</span>
                    )}
                  </div>
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                    stage.status === "done" && "bg-emerald-300/15 text-emerald-100",
                    stage.status === "running" && "bg-cyan-300/15 text-cyan-100",
                    stage.status === "error" && "bg-rose-300/15 text-rose-100",
                    stage.status === "pending" && "bg-white/5 text-slate-500"
                  )}>
                    {stage.status === "done" ? "完了" : stage.status === "running" ? "実行中" : stage.status === "error" ? "エラー" : "待機"}
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="mt-4 rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm text-rose-100 transition hover:bg-rose-400/20"
            >
              キャンセル
            </button>
          </section>
        )}

        {/* errors */}
        {error && (
          <section className="glass-panel rounded-3xl border border-rose-300/30 bg-rose-400/10 p-5 sm:p-6">
            <p className="text-sm font-semibold text-rose-100">エラー</p>
            <p className="mt-1 text-sm text-rose-200/80">{error}</p>
            <button
              type="button"
              onClick={handleRun}
              className="mt-3 rounded-xl border border-cyan-200/40 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/20"
            >
              再試行
            </button>
          </section>
        )}

        {/* Step 3: results */}
        {!isRunning && (result || candidates.length > 0) && (
          <section className="space-y-4">
            {/* summary */}
            {result && (
              <div className="glass-panel rounded-3xl border border-emerald-300/25 bg-emerald-400/10 p-4">
                <p className="text-sm font-semibold text-emerald-50">
                  解析完了 · {totalCandidates} 件の候補 · {withClips} 件クリップ · {withTranscriptions} 件文字起こし
                </p>
                {result.metadata.title && (
                  <p className="mt-1 truncate text-xs text-emerald-100/70">
                    {result.metadata.title} · {result.metadata.uploader ?? ""} · {result.chat.messageCount.toLocaleString()} メッセージ
                  </p>
                )}
                {result.pipelineWarnings.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-amber-100/80">
                      {result.pipelineWarnings.length} 件の警告
                    </summary>
                    <div className="mt-1 space-y-1">
                      {result.pipelineWarnings.map((w, i) => (
                        <p key={i} className="text-[0.65rem] leading-4 text-amber-100/60">
                          {w.candidateId && <span className="font-semibold">[{w.candidateId}]</span>} {w.message}
                        </p>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* candidate grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {candidates.map((candidate) => (
                <SimpleCandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  isExpanded={expandedId === candidate.id}
                  onToggle={() => setExpandedId((id) => (id === candidate.id ? null : candidate.id))}
                  onUpdate={(updated) => {
                    setCandidates((prev) =>
                      prev.map((c) => (c.id === updated.id ? updated : c))
                    );
                  }}
                  onDelete={() => {
                    setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
                    if (expandedId === candidate.id) setExpandedId(null);
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* empty state */}
        {!isRunning && candidates.length === 0 && !error && (
          <div className="py-20 text-center">
            <div className="mx-auto max-w-md space-y-4">
              <p className="text-lg font-semibold text-white">URL を入力して開始</p>
              <p className="text-sm leading-6 text-slate-400">
                Twitch VOD の URL を入れると、チャット解析・ハイライト検出・クリップ生成・NicoNico風コメント付き書き出しまで自動で行います。
              </p>
              <p className="text-xs text-slate-500">▸ 解析には数分かかります · 文字起こしはさらに時間がかかります</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// ── status dot ──

function StatusDot({ status }: { status: StageStatus }) {
  const color = status === "done" ? "bg-emerald-400"
    : status === "running" ? "bg-cyan-400 animate-pulse"
    : status === "error" || status === "cancelled" ? "bg-rose-400"
    : "bg-slate-600";
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", color)} />;
}

// ── simplified candidate card ──

function SimpleCandidateCard({
  candidate,
  isExpanded,
  onToggle,
  onUpdate,
  onDelete
}: {
  candidate: ClipCandidate;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (c: ClipCandidate) => void;
  onDelete: () => void;
}) {
  const hasClip = Boolean(candidate.generatedClip);
  const hasTranscription = Boolean(candidate.transcription);
  const hasBurnedClip = Boolean(candidate.commentBurnedClip);
  const variant = candidate.variants.find((v) => v.id === candidate.selectedVariantId) ?? candidate.variants[0];

  return (
    <div className={cn(
      "glass-panel rounded-2xl overflow-hidden transition",
      isExpanded && "ring-2 ring-cyan-400/30"
    )}>
      {/* preview area — NOT a button */}
      <div className="relative aspect-video w-full cursor-pointer bg-black/40" onClick={onToggle}>
        {hasClip && candidate.generatedClip ? (
          isExpanded ? (
            <VideoWithComments candidate={candidate} variant={variant} />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-2xl text-white backdrop-blur">
                ▶
              </div>
            </div>
          )
        ) : (
          <div className={cn("flex h-full w-full items-center justify-center bg-gradient-to-br", candidate.visualTone)}>
            <div className="text-center">
              <div className="mx-auto h-14 w-14 rounded-xl border border-white/20 bg-white/10 flex items-center justify-center text-2xl font-bold text-white/70">
                {candidate.confidence}
              </div>
              <p className="mt-2 text-xs text-white/50">クリップ未生成</p>
            </div>
          </div>
        )}

        {/* delete button — top left corner */}
        <div className="absolute top-2 left-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white/50 text-xs backdrop-blur transition hover:bg-red-900/70 hover:text-rose-200"
            aria-label="削除"
            title="候補を削除"
          >
            ✕
          </button>
        </div>

        {/* toggle button — top right corner */}
        <div className="absolute top-2 right-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white/70 text-xs backdrop-blur transition hover:bg-black/70 hover:text-white"
            aria-label={isExpanded ? "折り畳み" : "展開"}
          >
            {isExpanded ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* info + actions */}
      <div className="p-3">
        <p className="text-sm font-semibold leading-snug text-white truncate">{candidate.title}</p>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <span className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-xs font-bold text-cyan-100">
            {candidate.confidence}%
          </span>
          <span className="text-xs text-slate-400">{candidate.detectedAt}</span>
          <span className="text-xs text-slate-400">{candidate.duration}</span>
          {hasBurnedClip && (
            <span className="rounded-full bg-emerald-300/10 px-2 py-0.5 text-xs text-emerald-100">コメ付き</span>
          )}
          {hasTranscription && (
            <span className="rounded-full bg-fuchsia-300/10 px-2 py-0.5 text-xs text-fuchsia-100">文字起こし</span>
          )}
        </div>

        {/* expanded details */}
        {isExpanded && (
          <div className="mt-3 space-y-3">

            {/* variant selector */}
            {candidate.variants.length > 1 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">バリアント</p>
                <div className="flex flex-wrap gap-1">
                  {candidate.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        onUpdate({ ...candidate, selectedVariantId: v.id });
                      }}
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-xs transition",
                        v.id === candidate.selectedVariantId
                          ? "border-cyan-200/60 bg-cyan-300/15 text-cyan-50"
                          : "border-white/10 text-slate-400 hover:text-slate-200"
                      )}
                    >
                      <span className="font-semibold">{v.label}</span>
                      <span className="ml-1 opacity-70">{v.duration}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* clip actions */}
            {hasClip && candidate.generatedClip && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">クリップ</p>
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={`/api/media/files?path=${encodeURIComponent(candidate.generatedClip.outputPath)}`}
                    download
                    className="rounded-xl border border-cyan-200/40 bg-cyan-300/15 px-3 py-2 text-center text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/25"
                  >
                    MP4 ダウンロード
                  </a>
                  <BurnButton
                    candidate={candidate}
                    onDone={(clip) => onUpdate({ ...candidate, commentBurnedClip: clip })}
                  />
                </div>
                <p className="mt-1.5 truncate font-mono text-[0.6rem] text-slate-500">
                  {candidate.generatedClip.outputPath}
                </p>
              </div>
            )}

            {/* transcription display */}
            {hasTranscription && candidate.transcription && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-100/70">
                  文字起こし · {candidate.transcription.segments.length} セグメント · {candidate.transcription.model}
                </p>
                <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2.5">
                  {candidate.transcription.segments.map((seg, idx) => (
                    <div key={idx} className="flex gap-2 text-xs leading-5">
                      <span className="shrink-0 font-mono text-slate-500">{seg.start}-{seg.end}</span>
                      <span className={cn(
                        "text-slate-200",
                        seg.highlight && "text-fuchsia-200 font-semibold"
                      )}>
                        {seg.text}
                      </span>
                    </div>
                  ))}
                </div>
                {candidate.transcription.outputs && (
                  <p className="mt-1 font-mono text-[0.6rem] text-slate-500">
                    TXT: {candidate.transcription.outputs.txtPath}
                  </p>
                )}
              </div>
            )}

            {/* LLM evaluation — always visible when expanded */}
            <LlmEvaluationBox
              candidate={candidate}
              onEvaluated={(evaluation) => onUpdate({ ...candidate, llmEvaluation: evaluation })}
            />

            {/* warnings */}
            {candidate.warnings.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100/70">
                  警告 · {candidate.warnings.length} 件
                </p>
                <div className="space-y-1">
                  {candidate.warnings.map((w, idx) => (
                    <div key={idx} className="rounded-lg border border-amber-300/20 bg-amber-400/10 px-2.5 py-1.5 text-xs leading-5 text-amber-100/80">
                      <span className="font-semibold">{w.label}</span>
                      <span className="ml-1 opacity-70">{w.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* no clip */}
            {!hasClip && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-slate-400">
                「開始」ボタンでパイプラインを実行してクリップを生成してください。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── video with comments ──

function VideoWithComments({
  candidate,
  variant
}: {
  candidate: ClipCandidate;
  variant: ClipCandidate["variants"][0] | undefined;
}) {
  const clip = candidate.generatedClip;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const clipDuration = Math.max(1, parseTime(variant?.duration ?? candidate.duration));

  // Use real pipeline-generated comments when available (chat at real
  // timestamps, full clip span). Fall back to the synthetic representative
  // comment generator for clips from localStorage or /dev manual imports.
  const comments = useMemo(() => {
    if (candidate.commentOverlayItems && candidate.commentOverlayItems.length > 0) {
      return candidate.commentOverlayItems as CommentOverlayItem[];
    }
    return generateCommentOverlayItems(candidate, clipDuration);
  }, [candidate, clipDuration]);

  const commentSettings: CommentOverlaySettings = {
    ...defaultCommentOverlaySettings,
    enabled: true,
    syncOffsetSeconds: 0
  };

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => setError("再生に失敗しました"));
    else v.pause();
  };

  if (!clip?.outputPath) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black/40">
        <p className="text-xs text-slate-500">クリップがありません</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black">
      <video
        ref={videoRef}
        src={`/api/media/files?path=${encodeURIComponent(clip.outputPath)}`}
        className="h-full w-full object-contain"
        playsInline
        preload="metadata"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={() => setError("動画を読み込めませんでした")}
      />
      <CommentCanvasOverlay
        comments={comments}
        currentTime={currentTime}
        duration={Math.max(clipDuration, duration)}
        settings={commentSettings}
        playing={isPlaying}
      />
      {/* play/pause overlay — outside the parent div click handler */}
      <button
        type="button"
        onClick={togglePlay}
        className="absolute inset-0 flex items-center justify-center"
      >
        {!isPlaying && (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-2xl text-white backdrop-blur hover:bg-white/30 transition">
            ▶
          </div>
        )}
      </button>
      {error && (
        <p className="absolute bottom-2 left-2 rounded-lg bg-black/60 px-2 py-1 text-xs text-rose-300">{error}</p>
      )}
      {duration > 0 && (
        <p className="absolute bottom-2 right-2 rounded-lg bg-black/60 px-2 py-1 font-mono text-xs text-white/60">
          {secondsToClock(currentTime)} / {secondsToClock(duration)}
        </p>
      )}
    </div>
  );
}

// ── burn button ──

function BurnButton({
  candidate,
  onDone
}: {
  candidate: ClipCandidate;
  onDone: (clip: NonNullable<ClipCandidate["commentBurnedClip"]>) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done && candidate.commentBurnedClip) {
    return (
      <a
        href={`/api/media/files?path=${encodeURIComponent(candidate.commentBurnedClip.outputPath)}`}
        download
        className="rounded-xl border border-emerald-300/40 bg-emerald-400/10 px-3 py-2 text-center text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/20"
      >
        コメ付き DL
      </a>
    );
  }

  const handleBurn = async () => {
    if (!candidate.generatedClip) return;
    setIsLoading(true);
    setError(null);
    try {
      const variant = candidate.variants.find((v) => v.id === candidate.selectedVariantId) ?? candidate.variants[0];
      const duration = Math.max(1, parseTime(variant?.duration ?? candidate.duration));
      const overlay = generateCommentOverlayItems(candidate, duration);
      const bundle = createCommentExportPayload({
        candidate,
        comments: overlay,
        settings: defaultCommentOverlaySettings,
        duration
      });

      const response = await fetch("/api/media/clips-with-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipPath: candidate.generatedClip.outputPath,
          candidateId: candidate.id,
          variantId: variant?.id,
          assContent: generateScrollingCommentsAss(bundle),
          assFileName: bundle.files.assFileName,
          encoder: "h264_nvenc"
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Burn-in failed");
      onDone(data);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Burn-in failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleBurn}
        disabled={isLoading || !candidate.generatedClip}
        className="w-full rounded-xl border border-violet-200/40 bg-violet-300/15 px-3 py-2 text-center text-xs font-semibold text-violet-50 transition hover:bg-violet-300/25 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isLoading ? "生成中..." : "コメント付き生成"}
      </button>
      {error && <p className="mt-1 text-[0.6rem] leading-4 text-rose-300">{error}</p>}
    </div>
  );
}

// ── LLM evaluation box ──

function LlmEvaluationBox({
  candidate,
  onEvaluated
}: {
  candidate: ClipCandidate;
  onEvaluated: (evaluation: NonNullable<ClipCandidate["llmEvaluation"]>) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusChecked, setStatusChecked] = useState<boolean | null>(null);

  // Check LLM availability on mount
  useEffect(() => {
    fetch("/api/transcription/summarize")
      .then((r) => r.json())
      .then((d) => setStatusChecked(d.available === true))
      .catch(() => setStatusChecked(false));
  }, []);

  // Already evaluated
  if (candidate.llmEvaluation) {
    const eval_ = candidate.llmEvaluation;
    return (
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100/70">
          AI 評価 · {eval_.interestingness}/100
        </p>
        <div className="rounded-xl border border-amber-300/25 bg-amber-400/10 p-3 space-y-2">
          <p className="text-xs leading-5 text-amber-100/90">{eval_.summary}</p>
          {eval_.highlights.length > 0 && (
            <div className="space-y-1">
              {eval_.highlights.map((h, i) => (
                <p key={i} className="text-[0.65rem] leading-4 text-amber-100/70">▸ {h}</p>
              ))}
            </div>
          )}
          <p className="text-[0.65rem] leading-4 text-amber-100/50">{eval_.reason}</p>
        </div>
      </div>
    );
  }

  // Not yet checked
  if (statusChecked === null) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-500">
        確認中...
      </div>
    );
  }

  // Transcription required but not yet available
  if (!candidate.transcription) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-500">
        AI 評価には文字起こしが必要です。「詳細設定」で文字起こしを ON にしてパイプラインを再実行してください。
      </div>
    );
  }

  // LLM not available
  if (!statusChecked) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-500">
        LLM API 未設定 · .env に LLM_API_KEY を追加すると AI 評価が使えます
      </div>
    );
  }

  const handleEvaluate = async () => {
    if (!candidate.transcription) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/transcription/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: candidate.transcription.segments
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "LLM evaluation failed");
      onEvaluated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "LLM error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleEvaluate}
        disabled={isLoading}
        className="w-full rounded-xl border border-amber-200/40 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isLoading ? "AI 評価中..." : "✨ AI に面白さを評価させる"}
      </button>
      {error && (
        <p className="mt-1 text-[0.6rem] leading-4 text-rose-300">{error}</p>
      )}
    </div>
  );
}

// ── helpers ──

function parseTime(time: string): number {
  const parts = time.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number.isFinite(parts[0]) ? parts[0] : 0;
}

function secondsToClock(total: number): string {
  const s = Math.max(0, Math.round(total));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function humanizeError(raw: string): string {
  const text = raw.toLowerCase();
  if (/fetch failed|econnreset|etimedout|enetunreach|network error|failed to fetch/.test(text)) return "ネットワーク接続が切断されました。";
  if (/abort/i.test(text)) return "キャンセルされました。";
  if (/timeout/i.test(text)) return "タイムアウトしました。";
  if (!raw.trim()) return "不明なエラー";
  return raw;
}
