"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommentCanvasOverlay } from "@/components/comment-canvas-overlay";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n";
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
const STAGE_KEYS: Record<string, string> = {
  metadata: "archive.stageMetadata",
  download: "archive.stageDownload",
  chat: "archive.stageChat",
  analysis: "archive.stageAnalysis",
  clip: "archive.stageClip",
  transcription: "archive.stageTranscription",
  comments: "archive.stageComments",
  package: "archive.stagePackage"
};

const MAX_CANDIDATES_PRESETS = [1, 2, 3, 6, 12, 24];

type SortMode = "confidence" | "timestamp" | "duration";

// ── undo stack ──

type UndoAction = {
  type: "delete" | "clear";
  snapshot: ClipCandidate[];
  message: string;
};

const UNDO_TIMEOUT_MS = 5000;

// ── main page ──

export default function Home() {
  const { t } = useI18n();

  // localStorage persistence helper
  const usePersistedState = <T,>(key: string, defaultValue: T) => {
    const [state, setState] = useState<T>(() => {
      if (typeof window === "undefined") return defaultValue;
      try { return JSON.parse(localStorage.getItem(`stream-clipper:${key}`) ?? "null") ?? defaultValue; }
      catch { return defaultValue; }
    });
    useEffect(() => {
      try { localStorage.setItem(`stream-clipper:${key}`, JSON.stringify(state)); }
      catch { /* ignore quota errors */ }
    }, [key, state]);
    return [state, setState] as const;
  };

  // input
  const [url, setUrl] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [maxCandidates, setMaxCandidates] = usePersistedState("maxCandidates", 6);
  const [customMax, setCustomMax] = usePersistedState("customMax", "");
  const [transcribe, setTranscribe] = usePersistedState("transcribe", true);
  const [withComments, setWithComments] = usePersistedState("withComments", true);
  const [encoder, setEncoder] = usePersistedState<"libx264" | "h264_nvenc" | "hevc_nvenc">("encoder", "h264_nvenc");
  const [keepFilter, setKeepFilter] = useState<"all" | "keep" | "discard" | "unreviewed">("all");
  const [minConfidence, setMinConfidence] = usePersistedState("minConfidence", 50);
  const [batchBurning, setBatchBurning] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");
  const [stageTimestamps, setStageTimestamps] = useState<Record<string, number>>({});
  const [sortBy, setSortBy] = usePersistedState<SortMode>("sortBy", "confidence");
  const [searchQuery, setSearchQuery] = useState("");
  const [commentSettings, setCommentSettings] = useState<CommentOverlaySettings>(defaultCommentOverlaySettings);

  // pipeline
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [stages, setStages] = useState<Stage[]>(
    STAGE_ORDER.map((id) => ({ id, label: "", status: "pending" as StageStatus }))
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [downloadPoints, setDownloadPoints] = useState<Array<{ percent: number; speed: string; ts: number; elapsed: number }>>([]);
  const downloadStartRef = useRef<number>(0);

  // candidates
  const [candidates, setCandidates] = useState<ClipCandidate[]>(() => loadCandidates() ?? []);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // undo
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // localStorage warning
  const [saveWarning, setSaveWarning] = useState<string | null>(null);

  // keyboard help
  const [showKeyHelp, setShowKeyHelp] = useState(false);

  // timers
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // clean up
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (saveRef.current) clearTimeout(saveRef.current);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // auto-save (silent) with quota warning
  useEffect(() => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      const result = saveCandidates(candidates);
      if (!result.ok) {
        setSaveWarning(result.reason);
      } else {
        setSaveWarning(null);
      }
    }, 600);
  }, [candidates]);

  // ── keyboard shortcuts ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Toggle help overlay
      if (e.key === "?" && (e.shiftKey || e.metaKey)) {
        e.preventDefault();
        setShowKeyHelp(v => !v);
        return;
      }
      if (showKeyHelp && e.key === "Escape") {
        setShowKeyHelp(false);
        return;
      }

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (!candidates.length) return;

      const sorted = getSortedCandidates(candidates, sortBy);
      const filtered = getFilteredCandidates(sorted, keepFilter, minConfidence, searchQuery);
      const currentIdx = filtered.findIndex(c => c.id === expandedId);

      if (e.key === "ArrowRight" || e.key === "j") {
        e.preventDefault();
        const next = currentIdx < filtered.length - 1 ? currentIdx + 1 : 0;
        setExpandedId(filtered[next]?.id ?? null);
      } else if (e.key === "ArrowLeft" || e.key === "k") {
        e.preventDefault();
        const prev = currentIdx > 0 ? currentIdx - 1 : filtered.length - 1;
        setExpandedId(filtered[prev]?.id ?? null);
      } else if (e.key === " " && expandedId) {
        e.preventDefault();
        const video = document.querySelector(`[data-candidate="${expandedId}"] video`) as HTMLVideoElement | null;
        if (video) {
          if (video.paused) video.play().catch(() => {});
          else video.pause();
        }
      } else if (e.key === "Delete" && expandedId) {
        e.preventDefault();
        if (window.confirm("この候補を削除しますか？")) deleteCandidate(expandedId);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [candidates, expandedId, sortBy, keepFilter, minConfidence, showKeyHelp]);

  const effectiveMax = customMax.trim() ? Math.max(1, parseInt(customMax, 10) || maxCandidates) : maxCandidates;

  // ── undo system ──
  function pushUndo(action: UndoAction) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoAction(action);
    undoTimerRef.current = setTimeout(() => setUndoAction(null), UNDO_TIMEOUT_MS);
  }

  function performUndo() {
    if (!undoAction) return;
    setCandidates(undoAction.snapshot);
    setUndoAction(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }

  function deleteCandidate(id: string) {
    const snapshot = [...candidates];
    setCandidates(prev => prev.filter(c => c.id !== id));
    if (expandedId === id) setExpandedId(null);
    pushUndo({ type: "delete", snapshot, message: "Candidate deleted" });
  }

  // ── export/import ──
  function handleExport() {
    const data = { version: 1, candidates, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stream-clipper-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
        } else if (Array.isArray(data)) {
          setCandidates(data);
        } else {
          setError("インポート失敗: データの形式が正しくありません");
        }
      } catch {
        setError("インポート失敗: JSONの形式が正しくありません");
      }
    };
    input.click();
  }

  // ── run pipeline with proper SSE parsing ──

  const handleRun = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) { setError("URLを入力してください"); return; }
    if (!/^https?:\/\//i.test(trimmed)) { setError("URLは http:// または https:// で始まる必要があります"); return; }
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    setError(null);
    setResult(null);
    setIsRunning(true);
    setElapsed(0);
    setProgress(0);
    setDownloadPoints([]);
    downloadStartRef.current = 0;
    setStages(STAGE_ORDER.map((id) => ({ id, label: t(STAGE_KEYS[id] ?? id), status: "pending" })));

    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);
    tickRef.current = tick;
    const abort = new AbortController();
    abortRef.current = abort;

    const stageStatus: Record<string, StageStatus> = {};
    let keepaliveCheck: ReturnType<typeof setInterval> | null = null;

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

      const SSE_TIMEOUT_MS = 60_000;
      let lastEventTime = Date.now();

      try {

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
                  const now = Date.now();
                  setStageTimestamps(prev => ({ ...prev, [evt.stage]: now }));
                  const newStatus: StageStatus =
                    evt.status === "running" ? "running"
                    : evt.status === "done" ? "done"
                    : evt.status === "error" ? "error"
                    : "pending";
                  stageStatus[evt.stage] = newStatus;

                  const doneCount = Object.values(stageStatus).filter((s) => s === "done").length;
                  setProgress(Math.round((doneCount / STAGE_ORDER.length) * 100));

                  setStages(STAGE_ORDER.map((id) => ({
                    id,
                    label: t(STAGE_KEYS[id] ?? id),
                    status: stageStatus[id] ?? "pending",
                    detail: evt.stage === id ? evt.message : undefined
                  })));

                  if (evt.stage === "download" && evt.status === "running" && evt.message) {
                    // Parse progress from message like "Downloading... 12.3% at 1.0MiB/s, ETA 00:30"
                    const m = evt.message.match(/([\d.]+)%\s+at\s+([\w./]+)/);
                    if (m) {
                      const now = Date.now();
                      if (!downloadStartRef.current) downloadStartRef.current = now;
                      setDownloadPoints(prev => [...prev, { percent: parseFloat(m[1]), speed: m[2], ts: now, elapsed: (now - downloadStartRef.current) / 1000 }]);
                    }
                  }
                }
              } else if (currentEvent === "complete") {
                const res = data as PipelineResult;
                setResult(res);
                setCandidates(res.candidates);
                setProgress(100);
                setStages(STAGE_ORDER.map((id) => ({ id, label: t(STAGE_KEYS[id] ?? id), status: "done" })));
                if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                  new Notification("Stream Clipper", { body: `${res.candidates.length} candidates found` });
                }
              } else if (currentEvent === "error") {
                setError(data?.error ?? t("archive.unknownError"));
              } else if (currentEvent === "cancelled") {
                setError(t("archive.pipelineCancelled"));
              }
            } catch {}
          }
        }
      }

      keepaliveCheck = setInterval(() => {
        if (Date.now() - lastEventTime > SSE_TIMEOUT_MS) {
          reader.cancel();
        }
      }, 10_000);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lastEventTime = Date.now();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        processLines(lines);
      }
      clearInterval(keepaliveCheck);
      if (buffer.trim()) processLines([buffer]);
      } catch (innerErr) { /* inner SSE parse error — already handled in processLines */ }
    } catch (err) {
      if (abort.signal.aborted) {
        setError(t("archive.pipelineCancelled"));
      } else {
        const msg = err instanceof Error ? err.message : "Unknown pipeline error";
        setError(humanizeError(msg, t));
      }
    } finally {
      clearInterval(tick);
      if (keepaliveCheck) clearInterval(keepaliveCheck);
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [url, effectiveMax, transcribe, withComments, t]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Batch download — parallel with concurrency limiter
  const handleBatchDownload = useCallback(async () => {
    const toBurn = candidates.filter(c => c.editorStatus === "keep" && c.generatedClip && !c.commentBurnedClip);
    if (toBurn.length === 0) return;
    setBatchBurning(true);
    setBatchProgress("");

    const CONCURRENCY = Math.max(1, Math.floor(navigator.hardwareConcurrency / 2));
    const errors: Array<{ id: string; error: string }> = [];
    let completed = 0;

    async function burnOne(c: ClipCandidate) {
      const variant = c.variants.find(v => v.id === c.selectedVariantId) ?? c.variants[0];
      if (!variant) return;
      const dur = Math.max(1, parseTime(variant?.duration ?? c.duration));
      const overlay = generateCommentOverlayItems(c, dur);
      const bundle = createCommentExportPayload({ candidate: c, comments: overlay, settings: commentSettings, duration: dur });
      try {
        const res = await fetch("/api/media/clips-with-comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clipPath: c.generatedClip!.outputPath,
            candidateId: c.id,
            variantId: variant?.id,
            assContent: generateScrollingCommentsAss(bundle),
            assFileName: bundle.files.assFileName,
            encoder: "h264_nvenc"
          })
        });
        const data = await res.json();
        if (res.ok) {
          setCandidates(prev => prev.map(x => x.id === c.id ? { ...x, commentBurnedClip: data } : x));
        } else {
          errors.push({ id: c.id, error: data?.error ?? "Unknown error" });
        }
      } catch (err) {
        errors.push({ id: c.id, error: err instanceof Error ? err.message : "Network error" });
      }
      completed++;
      setBatchProgress(`${completed}/${toBurn.length}`);
    }

    // Process in batches of CONCURRENCY
    for (let i = 0; i < toBurn.length; i += CONCURRENCY) {
      const batch = toBurn.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(burnOne));
    }

    setBatchBurning(false);
    if (errors.length > 0) {
      setBatchProgress(`${errors.length}件失敗`);
      setError(`バッチダウンロード: ${errors.length}件が失敗しました (${errors.map(e => e.id).join(", ")})`);
    } else {
      setBatchProgress("完了");
    }
  }, [candidates, commentSettings]);

  // Bulk keep / discard
  const handleBulkAction = useCallback((action: "keep" | "discard") => {
    setCandidates(prev => prev.map(c => {
      if (keepFilter === "unreviewed" && c.editorStatus) return c;
      if (keepFilter === "keep" && c.editorStatus !== "keep") return c;
      if (keepFilter === "discard" && c.editorStatus !== "discard") return c;
      return { ...c, editorStatus: action };
    }));
  }, [keepFilter]);

  const etaSeconds = (() => {
    if (progress <= 0 || progress >= 100) return null;
    if (elapsed < 3) return null;
    const estimatedTotal = (elapsed / progress) * 100;
    return Math.max(0, Math.round(estimatedTotal - elapsed));
  })();

  const filteredCandidates = useMemo(() => {
    return getFilteredCandidates(getSortedCandidates(candidates, sortBy), keepFilter, minConfidence, searchQuery);
  }, [candidates, keepFilter, minConfidence, sortBy, searchQuery]);

  const totalCandidates = candidates.length;
  const withClips = candidates.filter((c) => c.generatedClip).length;
  const withTranscriptions = candidates.filter((c) => c.transcription).length;

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-lg focus:bg-cyan-300/20 focus:px-4 focus:py-2 focus:text-cyan-100">
        {t("main.skipToContent")}
      </a>
      <div className="mx-auto max-w-5xl space-y-8">
        {/* header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-200/30 bg-cyan-300/10 text-base font-black text-cyan-100 shadow-glow">
              SC
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Stream Clipper</h1>
              <p className="text-xs text-slate-400">{t("main.subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saveWarning && (
              <span className="rounded-lg bg-amber-400/10 px-2 py-0.5 text-[0.6rem] text-amber-300" title={saveWarning}>
                ⚠ save failed
              </span>
            )}
            <LanguageSwitcher />
            <button type="button" onClick={() => setShowKeyHelp(true)} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-slate-500 transition hover:text-slate-300" title="Keyboard shortcuts">
              ?
            </button>
            <a href="/dev" className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-500 transition hover:text-slate-300">
              dev
            </a>
          </div>
        </header>

        {/* Step 1: URL input */}
        <section id="main-content" className="glass-panel rounded-3xl p-5 sm:p-6">
          <div className="flex flex-col gap-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <input
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setError(null); }}
                  placeholder={t("main.urlPlaceholder")}
                  disabled={isRunning}
                  className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 text-base text-white placeholder:text-slate-500 focus:border-cyan-200/60 focus:outline-none disabled:opacity-50"
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
                {isRunning ? t("main.stop") : t("main.start")}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition",
                transcribe ? "border-fuchsia-300/40 bg-fuchsia-400/10 text-fuchsia-100" : "border-white/10 text-slate-400")}>
                <input type="checkbox" checked={transcribe} onChange={(e) => setTranscribe(e.target.checked)} className="h-3.5 w-3.5 accent-fuchsia-300" />
                {t("main.transcribe")}
              </label>
              <label className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition",
                withComments ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100" : "border-white/10 text-slate-400")}>
                <input type="checkbox" checked={withComments} onChange={(e) => setWithComments(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-300" />
                {t("main.withComments")}
              </label>
              <button type="button" onClick={() => setShowSettings((v) => !v)} className="text-xs text-slate-500 transition hover:text-slate-300">
                {showSettings ? t("main.settingsToggleOpen") : t("main.settingsToggle")}
              </button>
            </div>
            {showSettings && (<>
              <div className="mt-3 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-3">
                <div>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" title="検出するハイライト候補の最大数。多いほど処理時間が長くなります">
                    {t("main.maxCandidates", { value: effectiveMax })}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {MAX_CANDIDATES_PRESETS.map((v) => (
                      <button key={v} type="button" onClick={() => { setMaxCandidates(v); setCustomMax(""); }}
                        className={cn("rounded-xl px-2.5 py-1.5 text-xs font-semibold transition",
                          effectiveMax === v && customMax === "" ? "border border-cyan-200/60 bg-cyan-300/15 text-cyan-50" : "border border-white/10 text-slate-400 hover:text-slate-200"
                        )}>
                        {v}
                      </button>
                    ))}
                    <input value={customMax} onChange={(e) => setCustomMax(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder={t("main.customMax")}
                      className={cn("w-12 rounded-xl border px-2 py-1.5 text-xs text-slate-100 bg-slate-950/40 outline-none placeholder:text-slate-600 focus:border-cyan-200/60", customMax ? "border-cyan-200/40" : "border-white/10")} />
                  </div>
                </div>
                <div className="flex items-end gap-3">
                  <label className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition",
                    encoder !== "libx264" ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-100" : "border-white/10 text-slate-400")}>
                    <input type="checkbox" checked={encoder !== "libx264"} onChange={(e) => setEncoder(e.target.checked ? "h264_nvenc" : "libx264")} className="h-3.5 w-3.5 accent-emerald-300" />
                    {t("main.highSpeed")}
                  </label>
                </div>
                <div className="flex items-end gap-2">
                  {result && (
                    <button type="button"
                      onClick={() => { if (!confirm(t("main.clearAllWarning"))) return; clearCandidates(); setCandidates([]); setResult(null); setExpandedId(null); }}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-slate-400 transition hover:text-rose-300">
                      {t("main.clearAll")}
                    </button>
                  )}
                  <button type="button" onClick={handleExport} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400 transition hover:text-slate-200">
                    {t("main.settingsExport")}
                  </button>
                  <button type="button" onClick={handleImport} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400 transition hover:text-slate-200">
                    {t("main.settingsImport")}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[0.55rem] text-slate-600">{t("main.vodDeleteNotice")}</p>
            </>)}
          </div>
        </section>

        {/* Step 2: pipeline progress */}
        {isRunning && (
          <section className="glass-panel rounded-3xl p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">{t("main.analyzing")}</p>
              <p className="font-mono text-xs text-slate-400">
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
              </p>
            </div>
            <div className="mb-5 h-2.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-violet-300 via-cyan-200 to-emerald-200 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <div className="space-y-2">
              {stages.map((stage) => (
                <div key={stage.id} className={cn("flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm",
                  stage.status === "running" && "border border-cyan-300/15 bg-cyan-900/10",
                  stage.id === "download" && downloadPoints.length > 0 && "flex-col items-stretch")}>
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot status={stage.status} />
                    <span className="truncate text-slate-200">{stage.label}</span>
                    {stage.detail && stage.status === "running" && (
                      <span className="truncate text-xs text-slate-500">{stage.detail}</span>
                    )}
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                    stage.status === "done" && "bg-emerald-300/15 text-emerald-100",
                    stage.status === "running" && "bg-cyan-300/15 text-cyan-100",
                    stage.status === "error" && "bg-rose-300/15 text-rose-100",
                    stage.status === "pending" && "bg-white/5 text-slate-500")}>
                    {stage.status === "done" ? t("archive.done") : stage.status === "running" ? t("archive.runningStage") : stage.status === "error" ? t("archive.errorStage") : t("archive.pendingStage")}
                  </span>
                  {stage.id === "download" && downloadPoints.length > 1 && (
                    <div className="pt-1">
                      <DownloadSpeedChart points={downloadPoints} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={handleCancel}
              className="mt-4 rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm text-rose-100 transition hover:bg-rose-400/20">
              {t("main.cancel")}
            </button>
          </section>
        )}

        {/* errors */}
        {error && (
          <section className="glass-panel rounded-3xl border border-rose-300/30 bg-rose-400/10 p-5 sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-rose-100">{t("main.error")}</p>
                <p className="mt-1 text-sm text-rose-200/80">{error}</p>
              </div>
              <button type="button" onClick={() => setError(null)}
                className="ml-3 shrink-0 rounded-lg p-1 text-rose-300/60 transition hover:text-rose-100" title="閉じる">
                ✕
              </button>
            </div>
            <button type="button" onClick={handleRun}
              className="mt-3 rounded-xl border border-cyan-200/40 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/20">
              {t("main.retry")}
            </button>
          </section>
        )}

        {/* undo toast */}
        {undoAction && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-white/20 bg-slate-900/90 px-4 py-2.5 text-sm text-white shadow-lg backdrop-blur">
            <span>{undoAction.message}</span>
            <button type="button" onClick={performUndo} className="rounded-lg bg-cyan-500/30 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/50">
              Undo
            </button>
          </div>
        )}

        {/* Step 3: results */}
        {!isRunning && (result || candidates.length > 0) && (
          <section className="space-y-4">
            {result && (
              <div className="glass-panel rounded-3xl border border-emerald-300/25 bg-emerald-400/10 p-4">
                <p className="text-sm font-semibold text-emerald-50">
                  {t("main.analysisComplete")} · {totalCandidates}{t("main.candidates")} · {withClips}{t("main.clipsGenerated")} · {withTranscriptions}{t("main.transcriptionsDone")}
                </p>
                {result.metadata.title && (
                  <p className="mt-1 truncate text-xs text-emerald-100/70">
                    {result.metadata.title} · {result.metadata.uploader ?? ""} · {result.chat.messageCount.toLocaleString()} {t("main.messages")}
                  </p>
                )}
                {result.pipelineWarnings.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-amber-100/80">
                      {result.pipelineWarnings.length} {t("main.warningsCount")}
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

            {/* filter bar + batch actions */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1 sm:hidden">
                {(["all", "keep", "discard", "unreviewed"] as const).map(f => (
                  <button key={f} type="button" onClick={() => setKeepFilter(f)} className={cn(
                    "rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold transition",
                    keepFilter === f ? "border-cyan-200/60 bg-cyan-300/15 text-cyan-50" : "border-white/10 text-slate-400 hover:text-slate-200"
                  )}>
                    {f === "all" ? t("main.filterAll") : f === "keep" ? t("main.filterKeep") : f === "discard" ? t("main.filterDiscard") : t("main.filterUnreviewed")}
                    <span className="ml-0.5 text-white/40">{f === "all" ? candidates.length : f === "keep" ? candidates.filter(c => c.editorStatus === "keep").length : f === "discard" ? candidates.filter(c => c.editorStatus === "discard").length : candidates.filter(c => !c.editorStatus).length}</span>
                  </button>
                ))}
              </div>
              <div className="hidden sm:flex sm:flex-wrap sm:gap-1">
                {(["all", "keep", "discard", "unreviewed"] as const).map(f => (
                  <button key={f} type="button" onClick={() => setKeepFilter(f)} className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition",
                    keepFilter === f ? "border-cyan-200/60 bg-cyan-300/15 text-cyan-50" : "border-white/10 text-slate-400 hover:text-slate-200"
                  )}>
                    {f === "all" ? t("main.filterAll") : f === "keep" ? t("main.filterKeep") : f === "discard" ? t("main.filterDiscard") : t("main.filterUnreviewed")}
                    <span className="ml-1 text-white/40">{f === "all" ? candidates.length : f === "keep" ? candidates.filter(c => c.editorStatus === "keep").length : f === "discard" ? candidates.filter(c => c.editorStatus === "discard").length : candidates.filter(c => !c.editorStatus).length}</span>
                  </button>
                ))}
              </div>

              <div className="flex-1" />

              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t("main.searchPlaceholder")}
                className="h-7 w-36 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-200/60 sm:w-48" />

              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortMode)}
                className="h-7 rounded-lg border border-white/10 bg-slate-950/60 px-2 text-xs text-slate-200 outline-none focus:border-cyan-200/60 cursor-pointer">
                <option value="confidence">{t("main.sortByConfidence")}</option>
                <option value="timestamp">{t("main.sortByTimestamp")}</option>
                <option value="duration">{t("main.sortByDuration")}</option>
              </select>

              <label className={`flex items-center gap-2 text-xs ${keepFilter !== "all" ? "text-slate-600" : "text-slate-400"}`} title={keepFilter !== "all" ? "フィルタを「すべて」にすると有効になります" : ""}>
                {t("main.minConfidence", { value: minConfidence })}
                <input type="range" min={0} max={100} step={5} value={minConfidence} onChange={e => setMinConfidence(Number(e.target.value))} disabled={keepFilter !== "all"} className={`w-20 accent-cyan-300 ${keepFilter !== "all" ? "opacity-40" : ""}`} />
              </label>

              <div className="flex gap-1">
                <button type="button" onClick={() => handleBulkAction("keep")} className="rounded-lg border border-emerald-200/30 bg-emerald-300/10 px-2 py-1 text-xs text-emerald-50 transition hover:bg-emerald-300/20" title={`一括保留 (${filteredCandidates.length}件)`} aria-label="表示中の候補をすべて保留にする">✓ {filteredCandidates.length}</button>
                <button type="button" onClick={() => handleBulkAction("discard")} className="rounded-lg border border-rose-200/30 bg-rose-300/10 px-2 py-1 text-xs text-rose-50 transition hover:bg-rose-300/20" title={`一括破棄 (${filteredCandidates.length}件)`} aria-label="表示中の候補をすべて破棄にする">✕ {filteredCandidates.length}</button>
              </div>

              <button type="button" onClick={handleBatchDownload} disabled={batchBurning || candidates.filter(c => c.editorStatus === "keep" && c.generatedClip && !c.commentBurnedClip).length === 0}
                className="rounded-xl border border-emerald-200/40 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-300/20 disabled:opacity-30">
                {batchBurning ? `Burn ${batchProgress}` : t("main.batchDL")}
              </button>
            </div>

            {isRunning && etaSeconds && (
              <p className="text-xs text-slate-400">{t("main.eta", { minutes: Math.ceil(etaSeconds / 60) })}</p>
            )}

            {/* comment settings global panel */}
            <CommentSettingsPanel settings={commentSettings} onUpdate={setCommentSettings} />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredCandidates.map((candidate) => (
                <SimpleCandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  isExpanded={expandedId === candidate.id}
                  onToggle={() => setExpandedId((id) => (id === candidate.id ? null : candidate.id))}
                  onUpdate={(updated) => setCandidates(prev => prev.map(c => c.id === updated.id ? updated : c))}
                  onDelete={() => deleteCandidate(candidate.id)}
                  commentSettings={commentSettings}
                />
              ))}
            </div>
          </section>
        )}

        {/* empty state */}
        {!isRunning && candidates.length === 0 && !error && (
          <div className="py-20 text-center">
            <div className="mx-auto max-w-md space-y-4">
              <p className="text-lg font-semibold text-white">{t("main.emptyTitle")}</p>
              <p className="text-sm leading-6 text-slate-400">{t("main.emptyDesc")}</p>
              <p className="text-xs text-slate-500">{t("main.emptyHint")}</p>
            </div>
          </div>
        )}

        {/* keyboard help overlay */}
        {showKeyHelp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowKeyHelp(false)}>
            <div className="glass-panel rounded-2xl border border-white/20 p-6 max-w-sm w-full space-y-3" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-white">Keyboard Shortcuts</h3>
              <div className="space-y-1.5 text-xs text-slate-300">
                <div className="flex justify-between"><span>Next candidate</span><kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono">→</kbd></div>
                <div className="flex justify-between"><span>Previous candidate</span><kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono">←</kbd></div>
                <div className="flex justify-between"><span>Play / Pause</span><kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono">Space</kbd></div>
                <div className="flex justify-between"><span>Delete candidate</span><kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono">Del</kbd></div>
                <div className="flex justify-between"><span>Toggle this help</span><kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono">?</kbd></div>
              </div>
              <button type="button" onClick={() => setShowKeyHelp(false)} className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400 transition hover:text-white">
                {t("common.close")}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// ── download speed chart ──

type DownloadPoint = { percent: number; speed: string; ts: number; elapsed: number };

function parseSpeedToMBs(s: string): number {
  const m = s.match(/([\d.]+)\s*(Ki?B|Mi?B|Gi?B|B)\/s/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  if (u === "gb/s") return n * 1024;
  if (u === "mb/s" || u === "mib/s") return n;
  if (u === "kb/s" || u === "kib/s") return n / 1024;
  return n / (1024 * 1024);
}

function DownloadSpeedChart({ points }: { points: DownloadPoint[] }) {
  const W = 480, H = 80, PAD = 4;
  const maxElapsed = Math.max(...points.map(p => p.elapsed), 0.1);
  const speeds = points.map(p => parseSpeedToMBs(p.speed));
  const maxSpeed = Math.max(...speeds, 0.1);

  const pathD = points.map((p, i) => {
    const x = PAD + (p.elapsed / maxElapsed) * (W - PAD * 2);
    const y = H - PAD - (speeds[i] / maxSpeed) * (H - PAD * 2);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const lastX = PAD + (points[points.length - 1].elapsed / maxElapsed) * (W - PAD * 2);
  const areaD = pathD + ` L${lastX.toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;

  const last = points[points.length - 1];
  const lastSpeed = speeds[speeds.length - 1];
  const lastY = H - PAD - (lastSpeed / maxSpeed) * (H - PAD * 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full">
      <defs>
        <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(34,211,238)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="rgb(34,211,238)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#speedGrad)" />
      <path d={pathD} fill="none" stroke="rgb(34,211,238)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r="3" fill="rgb(34,211,238)" />
    </svg>
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

// ── comment settings panel (global) ──

function CommentSettingsPanel({ settings, onUpdate }: { settings: CommentOverlaySettings; onUpdate: (s: CommentOverlaySettings) => void }) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="glass-panel rounded-2xl p-3">
      <button type="button" onClick={() => setIsOpen(!isOpen)} className="text-xs text-slate-500 transition hover:text-slate-300">
        {isOpen ? "▲ " : "▼ "}{t("main.comments")}
      </button>
      {isOpen && (
        <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">
              {t("main.commentDensity")}
              <select value={settings.density} onChange={e => onUpdate({ ...settings, density: e.target.value as any })} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 outline-none">
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="danmaku">Danmaku</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              {t("main.commentFontSize")}
              <select value={settings.fontSize} onChange={e => onUpdate({ ...settings, fontSize: e.target.value as any })} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 outline-none">
                <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              {t("main.commentColorMode")}
              <select value={settings.colorMode} onChange={e => onUpdate({ ...settings, colorMode: e.target.value as any })} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 outline-none">
                <option value="white">White</option><option value="reaction">Reaction</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              {t("main.commentDisplayArea")}
              <select value={settings.displayArea} onChange={e => onUpdate({ ...settings, displayArea: e.target.value as any })} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 outline-none">
                <option value="full">Full</option><option value="top">Top</option><option value="bottom">Bottom</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">
              {t("main.commentSyncOffset")}
              <input type="number" step={0.5} value={settings.syncOffsetSeconds} onChange={e => onUpdate({ ...settings, syncOffsetSeconds: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 outline-none" />
            </label>
            <label className="text-xs text-slate-400">
              {t("main.commentMaxPerSecond")}
              <input type="number" min={1} max={60} value={settings.maxPerSecond} onChange={e => onUpdate({ ...settings, maxPerSecond: Math.max(1, Number(e.target.value)) })} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 outline-none" />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <ToggleSetting label={t("main.commentFilterUrls")} checked={settings.filterUrls} onChange={v => onUpdate({ ...settings, filterUrls: v })} />
            <ToggleSetting label={t("main.commentFilterLong")} checked={settings.filterLongComments} onChange={v => onUpdate({ ...settings, filterLongComments: v })} />
            <ToggleSetting label={t("main.commentFilterRepeated")} checked={settings.filterRepeatedComments} onChange={v => onUpdate({ ...settings, filterRepeatedComments: v })} />
            <ToggleSetting label={t("main.commentHideNames")} checked={settings.hideUserNames} onChange={v => onUpdate({ ...settings, hideUserNames: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleSetting({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-3 w-3 accent-cyan-300" />
      {label}
    </label>
  );
}

// ── simplified candidate card ──

const SimpleCandidateCard = memo(function SimpleCandidateCard({ candidate, isExpanded, onToggle, onUpdate, onDelete, commentSettings }: {
  candidate: ClipCandidate; isExpanded: boolean; onToggle: () => void;
  onUpdate: (c: ClipCandidate) => void; onDelete: () => void;
  commentSettings: CommentOverlaySettings;
}) {
  const { t } = useI18n();
  const hasClip = Boolean(candidate.generatedClip);
  const hasTranscription = Boolean(candidate.transcription);
  const hasBurnedClip = Boolean(candidate.commentBurnedClip);
  const variant = candidate.variants.find((v) => v.id === candidate.selectedVariantId) ?? candidate.variants[0];
  const editorStatus = candidate.editorStatus;
  const borderClass = editorStatus === "keep" ? "ring-2 ring-emerald-400/40" : editorStatus === "discard" ? "ring-1 ring-rose-400/20 opacity-60" : "";

  return (
    <div className={cn("glass-panel rounded-2xl overflow-hidden transition", isExpanded && "ring-2 ring-cyan-400/30", borderClass)} data-candidate={candidate.id}>
      <div className="relative aspect-video w-full cursor-pointer bg-black/40" onClick={onToggle}>
        {hasClip && candidate.generatedClip ? (
          isExpanded ? (
            <VideoWithComments candidate={candidate} variant={variant} commentSettings={commentSettings} />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-2xl text-white backdrop-blur">▶</div>
            </div>
          )
        ) : (
          <div className={cn("flex h-full w-full items-center justify-center bg-gradient-to-br", candidate.visualTone)}>
            <div className="text-center">
              <div className="mx-auto h-14 w-14 rounded-xl border border-white/20 bg-white/10 flex items-center justify-center text-2xl font-bold text-white/70">{candidate.confidence}</div>
              <p className="mt-2 text-xs text-white/50">{t("main.clipNotGenerated")}</p>
            </div>
          </div>
        )}

        <div className="absolute top-2 left-2">
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white/50 text-xs backdrop-blur transition hover:bg-red-900/70 hover:text-rose-200" title={t("main.deleteCandidate")}>✕</button>
        </div>
        <div className="absolute top-2 left-1/2 -translate-x-1/2 flex gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); onUpdate({ ...candidate, editorStatus: editorStatus === "keep" ? undefined : "keep" }); }}
            className={cn("flex h-7 items-center gap-1 rounded-lg px-2 text-xs backdrop-blur transition",
              editorStatus === "keep" ? "bg-emerald-500/60 text-emerald-50" : "bg-black/40 text-white/50 hover:bg-emerald-700/50 hover:text-emerald-100")}>
            {t("main.filterKeep")}
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onUpdate({ ...candidate, editorStatus: editorStatus === "discard" ? undefined : "discard" }); }}
            className={cn("flex h-7 items-center gap-1 rounded-lg px-2 text-xs backdrop-blur transition",
              editorStatus === "discard" ? "bg-rose-500/60 text-rose-50" : "bg-black/40 text-white/50 hover:bg-rose-700/50 hover:text-rose-100")}>
            {t("main.filterDiscard")}
          </button>
        </div>
        <div className="absolute top-2 right-2">
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white/70 text-xs backdrop-blur transition hover:bg-black/70 hover:text-white">
            {isExpanded ? "▲" : "▼"}
          </button>
        </div>
      </div>

      <div className="p-3">
        {isExpanded ? (
          <input value={candidate.title} onChange={(e) => onUpdate({ ...candidate, title: e.target.value })}
            className="w-full bg-transparent text-sm font-semibold leading-snug text-white outline-none" />
        ) : (
          <p className="text-sm font-semibold leading-snug text-white truncate">{candidate.title}</p>
        )}
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <span className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-xs font-bold text-cyan-100">{candidate.confidence}%</span>
          <span className="text-xs text-slate-400">{candidate.detectedAt}</span>
          <span className="text-xs text-slate-400">{candidate.duration}</span>
          {hasBurnedClip && <span className="rounded-full bg-emerald-300/10 px-2 py-0.5 text-xs text-emerald-100">{t("main.commentedDL")}</span>}
          {hasTranscription && <span className="rounded-full bg-fuchsia-300/10 px-2 py-0.5 text-xs text-fuchsia-100">{t("main.transcriptionLabel")}</span>}
          {candidate.generatedClip?.sizeBytes ? <span className="text-[0.6rem] text-slate-500">{formatBytes(candidate.generatedClip.sizeBytes)}</span> : null}
        </div>

        {isExpanded && (
          <div className="mt-3 space-y-3">
            {candidate.variants.length > 1 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("main.variant")}</p>
                <div className="flex flex-wrap gap-1">
                  {candidate.variants.map((v) => (
                    <button key={v.id} type="button" onClick={() => onUpdate({ ...candidate, selectedVariantId: v.id })}
                      className={cn("rounded-lg border px-2.5 py-1.5 text-xs transition",
                        v.id === candidate.selectedVariantId ? "border-cyan-200/60 bg-cyan-300/15 text-cyan-50" : "border-white/10 text-slate-400 hover:text-slate-200")}>
                      <span className="font-semibold">{v.label}</span>
                      <span className="ml-1 opacity-70">{v.duration}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {hasClip && candidate.generatedClip && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("main.clipActions")}</p>
                <div className="grid grid-cols-2 gap-2">
                  <a href={`/api/media/files?path=${encodeURIComponent(candidate.generatedClip.outputPath)}`} download
                    className="rounded-xl border border-cyan-200/40 bg-cyan-300/15 px-3 py-2 text-center text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/25">
                    {t("main.mp4Download")}
                  </a>
                  <BurnButton candidate={candidate} onDone={(clip) => onUpdate({ ...candidate, commentBurnedClip: clip })} commentSettings={commentSettings} />
                </div>
                <p className="mt-1.5 truncate font-mono text-[0.6rem] text-slate-500">{candidate.generatedClip.outputPath}</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <ThumbnailButton candidate={candidate} onDone={(ref) => onUpdate({ ...candidate, thumbnailCandidates: [...(candidate.thumbnailCandidates ?? []), ref] })} />
                  <AutoEditButton candidate={candidate} onDone={(updatedClip) => onUpdate({ ...candidate, generatedClip: { ...candidate.generatedClip!, ...updatedClip } as any })} />
                  <PackageButton candidate={candidate} onDone={(pkg) => onUpdate({ ...candidate, exportPackage: pkg })} commentSettings={commentSettings} />
                </div>
              </div>
            )}

            {hasClip && candidate.generatedClip && <TrimmingSection candidate={candidate} onUpdate={(updated) => onUpdate({ ...candidate, generatedClip: updated } as any)} />}

            {hasTranscription && candidate.transcription && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-100/70">
                  {t("main.transcriptionLabel")} · {candidate.transcription.segments.length} {t("main.segments")} · {candidate.transcription.model}
                </p>
                <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2.5">
                  {candidate.transcription.segments.map((seg, idx) => (
                    <div key={idx} className="flex gap-2 text-xs leading-5">
                      <span className="shrink-0 font-mono text-slate-500">{seg.start}-{seg.end}</span>
                      <span className={cn("text-slate-200", seg.highlight && "text-fuchsia-200 font-semibold")}>{seg.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <LlmEvaluationBox candidate={candidate} onEvaluated={(evaluation) => onUpdate({ ...candidate, llmEvaluation: evaluation })} />

            {candidate.warnings.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100/70">{t("main.warningsLabel")} · {candidate.warnings.length}</p>
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

            {!hasClip && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-slate-400">{t("main.noClipHint")}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ── video with comments ──

function VideoWithComments({ candidate, variant, commentSettings }: {
  candidate: ClipCandidate; variant: ClipCandidate["variants"][0] | undefined; commentSettings: CommentOverlaySettings;
}) {
  const { t } = useI18n();
  const clip = candidate.generatedClip;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const clipDuration = Math.max(1, parseTime(variant?.duration ?? candidate.duration));

  const comments = useMemo(() => {
    if (candidate.commentOverlayItems && candidate.commentOverlayItems.length > 0) {
      return candidate.commentOverlayItems as CommentOverlayItem[];
    }
    return generateCommentOverlayItems(candidate, clipDuration);
  }, [candidate, clipDuration]);

  const overlaySettings: CommentOverlaySettings = { ...commentSettings, enabled: true };

  if (!clip?.outputPath) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black/40">
        <p className="text-xs text-slate-500">{t("main.clipMissing")}</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black">
      <video ref={videoRef} src={`/api/media/files?path=${encodeURIComponent(clip.outputPath)}`}
        className="h-full w-full object-contain" playsInline controls preload="metadata"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)}
        onError={() => setError(t("main.videoLoadError"))} />
      <CommentCanvasOverlay comments={comments} currentTime={currentTime} duration={Math.max(clipDuration, duration)} settings={overlaySettings} playing={isPlaying} />
      {error && <p className="absolute bottom-2 left-2 rounded-lg bg-black/60 px-2 py-1 text-xs text-rose-300">{error}</p>}
    </div>
  );
}

// ── trimming section (start + duration) ──

function TrimmingSection({ candidate, onUpdate }: { candidate: ClipCandidate; onUpdate: (clip: ClipCandidate["generatedClip"]) => void }) {
  const { t } = useI18n();
  const variant = candidate.variants.find(v => v.id === candidate.selectedVariantId) ?? candidate.variants[0];
  const [startSec, setStartSec] = useState(() => String(Math.round(parseTime(variant?.start ?? "0"))));
  const [durationSec, setDurationSec] = useState(() => String(Math.round(parseTime(variant?.duration ?? "30"))));
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegenerate = async () => {
    if (!candidate.generatedClip) return;
    setIsRegenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/media/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputPath: candidate.generatedClip.inputPath, candidateId: candidate.id, variantId: variant?.id ?? "custom", start: startSec, duration: durationSec, mode: "reencode", encoder: "h264_nvenc" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Regeneration failed");
      onUpdate(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("main.trimming")}</p>
      <div className="flex items-end gap-2">
        <label className="text-xs text-slate-400">
          {t("main.trimStart")}
          <input type="number" min={0} value={startSec} onChange={e => setStartSec(e.target.value)} className="mt-1 w-20 rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 outline-none" />
        </label>
        <label className="text-xs text-slate-400">
          {t("main.trimEnd")}
          <input type="number" min={0} value={durationSec} onChange={e => setDurationSec(e.target.value)} className="mt-1 w-20 rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 outline-none" />
        </label>
        <button type="button" onClick={handleRegenerate} disabled={isRegenerating}
          className="rounded-lg border border-cyan-200/40 bg-cyan-300/15 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/25 disabled:opacity-40">
          {isRegenerating ? t("main.trimRegenerating") : t("main.trimRegenerate")}
        </button>
      </div>
      {error && <p className="mt-1 text-[0.6rem] text-rose-300">{error}</p>}
    </div>
  );
}

// ── thumbnail button ──

function ThumbnailButton({ candidate, onDone }: { candidate: ClipCandidate; onDone: (ref: NonNullable<ClipCandidate["thumbnailCandidates"]>[0]) => void }) {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!candidate.generatedClip) return;
    setIsLoading(true); setError(null);
    try {
      const res = await fetch("/api/media/thumbnails", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipPath: candidate.generatedClip.outputPath, candidateId: candidate.id, timestamp: candidate.detectedAt, label: "highlight" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Thumbnail failed");
      onDone(data);
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    finally { setIsLoading(false); }
  };

  return (
    <div>
      <button type="button" onClick={handleGenerate} disabled={isLoading || !candidate.generatedClip}
        className="w-full rounded-lg border border-amber-200/40 bg-amber-300/10 px-2 py-1.5 text-[0.65rem] font-semibold text-amber-50 transition hover:bg-amber-300/20 disabled:opacity-40">
        {isLoading ? t("main.thumbnailGenerating") : t("main.thumbnailGenerate")}
      </button>
      {error && <p className="mt-0.5 text-[0.55rem] text-rose-300">{error}</p>}
    </div>
  );
}

// ── auto-edit button ──

function AutoEditButton({ candidate, onDone }: { candidate: ClipCandidate; onDone: (updatedClip: Partial<ClipCandidate["generatedClip"]>) => void }) {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAutoEdit = async () => {
    if (!candidate.generatedClip) return;
    setIsLoading(true); setError(null);
    try {
      const res = await fetch("/api/media/auto-edit", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipPath: candidate.generatedClip.outputPath, candidateId: candidate.id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Auto-edit failed");
      onDone({ outputPath: data.outputPath });
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    finally { setIsLoading(false); }
  };

  return (
    <div>
      <button type="button" onClick={handleAutoEdit} disabled={isLoading || !candidate.generatedClip}
        className="w-full rounded-lg border border-rose-200/40 bg-rose-300/10 px-2 py-1.5 text-[0.65rem] font-semibold text-rose-50 transition hover:bg-rose-300/20 disabled:opacity-40">
        {isLoading ? t("main.autoEditLoading") : t("main.autoEditSilence")}
      </button>
      {error && <p className="mt-0.5 text-[0.55rem] text-rose-300">{error}</p>}
    </div>
  );
}

// ── package button (FIXED: uses commentSettings instead of default) ──

function PackageButton({ candidate, onDone, commentSettings }: {
  candidate: ClipCandidate; onDone: (pkg: NonNullable<ClipCandidate["exportPackage"]>) => void; commentSettings: CommentOverlaySettings;
}) {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePackage = async () => {
    setIsLoading(true); setError(null);
    try {
      const variant = candidate.variants.find(v => v.id === candidate.selectedVariantId) ?? candidate.variants[0];
      const dur = Math.max(1, parseTime(variant?.duration ?? candidate.duration));
      const overlay = generateCommentOverlayItems(candidate, dur);
      const bundle = createCommentExportPayload({ candidate, comments: overlay, settings: commentSettings, duration: dur });
      const res = await fetch("/api/media/packages", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate: { id: candidate.id, title: candidate.title }, selectedVariant: variant, generatedClip: candidate.generatedClip, commentBurnedClip: candidate.commentBurnedClip, transcription: candidate.transcription,
          commentsJson: JSON.stringify(bundle.comments), commentsAss: generateScrollingCommentsAss(bundle), commentJsonFileName: bundle.files.jsonFileName, commentAssFileName: bundle.files.assFileName, thumbnailCandidates: candidate.thumbnailCandidates }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Package failed");
      onDone(data);
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    finally { setIsLoading(false); }
  };

  return (
    <div>
      <button type="button" onClick={handlePackage} disabled={isLoading}
        className="w-full rounded-lg border border-violet-200/40 bg-violet-300/10 px-2 py-1.5 text-[0.65rem] font-semibold text-violet-50 transition hover:bg-violet-300/20 disabled:opacity-40">
        {isLoading ? (
          <span className="flex items-center justify-center gap-1">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-violet-300 border-t-transparent" />
            {t("main.packageExporting")}
          </span>
        ) : t("main.packageExport")}
      </button>
      {candidate.exportPackage && (
        <a href={`/api/media/files?path=${encodeURIComponent(candidate.exportPackage.packagePath)}`} download className="mt-1 flex items-center justify-center gap-1 rounded-lg border border-violet-200/30 bg-violet-300/10 px-2 py-1 text-xs font-semibold text-violet-100 transition hover:bg-violet-300/20">
          ⬇ {t("main.packageDL")}
        </a>
      )}
      {error && <p className="mt-0.5 text-[0.55rem] text-rose-300">{error}</p>}
    </div>
  );
}

// ── burn button ──

function BurnButton({ candidate, onDone, commentSettings }: {
  candidate: ClipCandidate; onDone: (clip: NonNullable<ClipCandidate["commentBurnedClip"]>) => void; commentSettings: CommentOverlaySettings;
}) {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [normalizeAudio, setNormalizeAudio] = useState(false);

  if (done && candidate.commentBurnedClip) {
    return (
      <a href={`/api/media/files?path=${encodeURIComponent(candidate.commentBurnedClip.outputPath)}`} download
        className="rounded-xl border border-emerald-300/40 bg-emerald-400/10 px-3 py-2 text-center text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/20">
        {t("main.commentedDL")}
      </a>
    );
  }

  const handleBurn = async () => {
    if (!candidate.generatedClip) return;
    setIsLoading(true); setError(null);
    try {
      const variant = candidate.variants.find((v) => v.id === candidate.selectedVariantId) ?? candidate.variants[0];
      const duration = Math.max(1, parseTime(variant?.duration ?? candidate.duration));
      const overlay = generateCommentOverlayItems(candidate, duration);
      const bundle = createCommentExportPayload({ candidate, comments: overlay, settings: commentSettings, duration });
      const response = await fetch("/api/media/clips-with-comments", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipPath: candidate.generatedClip.outputPath, candidateId: candidate.id, variantId: variant?.id, assContent: generateScrollingCommentsAss(bundle), assFileName: bundle.files.assFileName, encoder: "h264_nvenc", normalizeAudio }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Burn-in failed");
      onDone(data); setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Burn-in failed"); }
    finally { setIsLoading(false); }
  };

  return (
    <div>
      <button type="button" onClick={handleBurn} disabled={isLoading || !candidate.generatedClip}
        className="w-full rounded-xl border border-violet-200/40 bg-violet-300/15 px-3 py-2 text-center text-xs font-semibold text-violet-50 transition hover:bg-violet-300/25 disabled:cursor-not-allowed disabled:opacity-40">
        {isLoading ? t("main.commentBurnLoading") : t("main.commentBurn")}
      </button>
      <label className="mt-1 flex cursor-pointer items-center gap-1 text-[0.6rem] text-slate-500">
        <input type="checkbox" checked={normalizeAudio} onChange={e => setNormalizeAudio(e.target.checked)} className="h-2.5 w-2.5 accent-cyan-300" />
        {t("main.normalizeAudio")}
      </label>
      {error && <p className="mt-0.5 text-[0.6rem] leading-4 text-rose-300">{error}</p>}
    </div>
  );
}

// ── LLM evaluation box ──

function LlmEvaluationBox({ candidate, onEvaluated }: { candidate: ClipCandidate; onEvaluated: (evaluation: NonNullable<ClipCandidate["llmEvaluation"]>) => void }) {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusChecked, setStatusChecked] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/transcription/summarize").then((r) => r.json()).then((d) => setStatusChecked(d.available === true)).catch(() => setStatusChecked(false));
  }, []);

  if (candidate.llmEvaluation) {
    const eval_ = candidate.llmEvaluation;
    return (
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100/70">{t("main.aiEval")} · {eval_.interestingness}/100</p>
        <div className="rounded-xl border border-amber-300/25 bg-amber-400/10 p-3 space-y-2">
          <p className="text-xs leading-5 text-amber-100/90">{eval_.summary}</p>
          {eval_.highlights.length > 0 && <div className="space-y-1">{eval_.highlights.map((h, i) => <p key={i} className="text-[0.65rem] leading-4 text-amber-100/70">▸ {h}</p>)}</div>}
          <p className="text-[0.65rem] leading-4 text-amber-100/50">{eval_.reason}</p>
        </div>
      </div>
    );
  }

  if (statusChecked === null) return <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-500">{t("main.aiCheck")}</div>;
  if (!candidate.transcription) return <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-500">{t("main.aiRequiresTranscription")}</div>;
  if (!statusChecked) return <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-500">{t("main.aiNotConfigured")}</div>;

  const handleEvaluate = async () => {
    if (!candidate.transcription) return;
    setIsLoading(true); setError(null);
    try {
      const response = await fetch("/api/transcription/summarize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segments: candidate.transcription.segments }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "LLM evaluation failed");
      onEvaluated(data);
    } catch (err) { setError(err instanceof Error ? err.message : "LLM error"); }
    finally { setIsLoading(false); }
  };

  return (
    <div>
      <button type="button" onClick={handleEvaluate} disabled={isLoading}
        className="w-full rounded-xl border border-amber-200/40 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-40">
        {isLoading ? t("main.aiEvaluating") : t("main.aiEvaluateButton")}
      </button>
      {error && <p className="mt-1 text-[0.6rem] leading-4 text-rose-300">{error}</p>}
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function getSortedCandidates(list: ClipCandidate[], sortBy: SortMode): ClipCandidate[] {
  const sorted = [...list];
  if (sortBy === "confidence") sorted.sort((a, b) => b.confidence - a.confidence);
  else if (sortBy === "timestamp") sorted.sort((a, b) => parseTime(a.detectedAt) - parseTime(b.detectedAt));
  else if (sortBy === "duration") sorted.sort((a, b) => parseTime(b.duration) - parseTime(a.duration));
  return sorted;
}

function getFilteredCandidates(list: ClipCandidate[], keepFilter: string, minConfidence: number, searchQuery: string): ClipCandidate[] {
  let filtered = list;
  if (keepFilter === "keep") filtered = filtered.filter(c => c.editorStatus === "keep");
  else if (keepFilter === "discard") filtered = filtered.filter(c => c.editorStatus === "discard");
  else if (keepFilter === "unreviewed") filtered = filtered.filter(c => !c.editorStatus);
  else filtered = filtered.filter(c => c.confidence >= minConfidence);

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(c =>
      c.title.toLowerCase().includes(q) || c.detectedAt.includes(q) || c.chat.topPhrases.some(p => p.toLowerCase().includes(q)) || c.whyDetected.some(r => r.toLowerCase().includes(q))
    );
  }
  return filtered;
}

function humanizeError(raw: string, t: (key: string) => string): string {
  const text = raw.toLowerCase();
  if (/fetch failed|econnreset|etimedout|enetunreach|network error|failed to fetch/.test(text)) return t("archive.networkError");
  if (/abort/i.test(text)) return t("archive.pipelineCancelled");
  if (/timeout/i.test(text)) return t("archive.pipelineTimeout");
  if (!raw.trim()) return t("archive.unknownError");
  return raw;
}
