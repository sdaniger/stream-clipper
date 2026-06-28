"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { ChatAnalysisSummary, ChatImportMode } from "@/lib/chat-analysis";
import type { ClipCandidate } from "@/lib/mock-candidates";
import { cn } from "@/lib/utils";

type StageStatus = "pending" | "running" | "done" | "error" | "cancelled";

type PipelineStage = {
  id: string;
  labelKey: string;
  status: StageStatus;
  detail?: string;
};

type ArchiveAutoResult = {
  sourceUrl: string;
  metadata: {
    title: string | null;
    uploader: string | null;
    duration: string | null;
    extractor: string | null;
  };
  chat: {
    messageCount: number;
    normalizedPath: string;
    fetchedAt: string;
  };
  summary: ChatAnalysisSummary;
  candidates: ClipCandidate[];
  generatedClipCount: number;
  transcribedCount: number;
  commentAssetCount: number;
  packageCount: number;
  pipelineWarnings: Array<{ stage: string; candidateId?: string; message: string }>;
};

type ArchiveAutoPanelProps = {
  onImport: (candidates: ClipCandidate[], mode: ChatImportMode, summary: ChatAnalysisSummary) => void;
};

const initialStages: PipelineStage[] = [
  { id: "metadata", labelKey: "archive.stageMetadata", status: "pending" },
  { id: "download", labelKey: "archive.stageDownload", status: "pending" },
  { id: "chat", labelKey: "archive.stageChat", status: "pending" },
  { id: "analysis", labelKey: "archive.stageAnalysis", status: "pending" },
  { id: "clip", labelKey: "archive.stageClip", status: "pending" },
  { id: "transcription", labelKey: "archive.stageTranscription", status: "pending" },
  { id: "comments", labelKey: "archive.stageComments", status: "pending" },
  { id: "package", labelKey: "archive.stagePackage", status: "pending" }
];

const MAX_MESSAGES_PRESETS = [0, 1000, 5000, 10000, 20000, 50000];

export function ArchiveAutoPanel({ onImport }: ArchiveAutoPanelProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [url, setUrl] = useState("");
  const [maxCandidates, setMaxCandidates] = useState(3);
  const [maxMessages, setMaxMessages] = useState(0);
  const [clipMode, setClipMode] = useState<"copy" | "reencode">("copy");
  const [transcribe, setTranscribe] = useState(true);
  const [generatePackages, setGeneratePackages] = useState(true);
  const [burnComments, setBurnComments] = useState(true);
  const [autoOpenModal, setAutoOpenModal] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [useTimeRange, setUseTimeRange] = useState(false);
  const [timeRangeStart, setTimeRangeStart] = useState("");
  const [timeRangeEnd, setTimeRangeEnd] = useState("");
  const [clipLength, setClipLength] = useState<"short" | "standard" | "long">("standard");
  const [stages, setStages] = useState<PipelineStage[]>(initialStages);
  const [result, setResult] = useState<ArchiveAutoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isRunning) {
      setElapsedSeconds(0);
      return;
    }
    const started = Date.now();
    startedAtRef.current = started;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

  // Throttled stage updater so high-frequency chat progress events (~33/sec
  // on a popular VOD) don't flood React with hundreds of renders per minute.
  // The throttled callback drops intermediate detail strings and only keeps
  // the latest one per 200ms window per stage.
  const stageUpdateTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingDetailsRef = useRef<Map<string, string | undefined>>(new Map());

  /**
   * Translate raw browser/Node error messages into user-friendly text.
   * SSE connections can drop silently mid-stream and surface as a bare
   * TypeError("network error") or "fetch failed"; we want to give the
   * user actionable text instead of the raw DOMException name.
   */
  function humanizeError(raw: string): string {
    const lowered = raw.toLowerCase();
    if (!raw) return t("archive.unknownError");
    if (
      lowered.includes("networkerror") ||
      lowered === "network error" ||
      lowered.includes("fetch failed") ||
      lowered.includes("failed to fetch") ||
      lowered.includes("connection reset") ||
      lowered.includes("connection aborted") ||
      lowered.includes("econnreset") ||
      lowered.includes("etimedout") ||
      lowered.includes("enetunreach")
    ) {
      return t("archive.networkError");
    }
    if (lowered.includes("aborted") || lowered.includes("aborterror")) {
      return t("archive.pipelineCancelled");
    }
    if (lowered.includes("timeout") || lowered.includes("timed out")) {
      return t("archive.pipelineTimeout");
    }
    return raw;
  }

  function updateStage(id: string, status: StageStatus, detail?: string) {
    // Always flush terminal statuses immediately so the user sees them.
    if (status === "done" || status === "error" || status === "cancelled") {
      const existingTimer = stageUpdateTimersRef.current.get(id);
      if (existingTimer) {
        clearTimeout(existingTimer);
        stageUpdateTimersRef.current.delete(id);
      }
      pendingDetailsRef.current.delete(id);
      setStages((current) => current.map((stage) => (stage.id === id ? { ...stage, status, detail } : stage)));
      return;
    }
    pendingDetailsRef.current.set(id, detail);
    if (stageUpdateTimersRef.current.has(id)) return;
    const timer = setTimeout(() => {
      const latestDetail = pendingDetailsRef.current.get(id);
      pendingDetailsRef.current.delete(id);
      stageUpdateTimersRef.current.delete(id);
      setStages((current) => current.map((stage) => (stage.id === id ? { ...stage, status, detail: latestDetail } : stage)));
    }, 200);
    stageUpdateTimersRef.current.set(id, timer);
  }

  function resetPipeline() {
    setStages(initialStages.map((stage) => ({ ...stage, status: "pending" as const })));
    setResult(null);
    setError(null);
    setWarning(null);
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  async function handleRun() {
    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      setError(t("archive.urlRequired"));
      return;
    }

    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError(t("archive.invalidUrl"));
      return;
    }

    setIsRunning(true);
    resetPipeline();
    setCopied(false);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/archive/analyze/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmedUrl,
          maxCandidates,
          maxMessages,
          clipMode,
          transcribe,
          generatePackages,
          burnComments,
          timeStartSeconds: useTimeRange ? parseTimeToSeconds(timeRangeStart) : undefined,
          timeEndSeconds: useTimeRange ? parseTimeToSeconds(timeRangeEnd) : undefined,
          clipLength,
        }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        const errorMatch = errorText.match(/data: (.+)/);
        const errorData = errorMatch ? JSON.parse(errorMatch[1]) : null;
        throw new Error(errorData?.error ?? t("archive.pipelineFailed"));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      function processLines(lines: string[]) {
        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const raw = line.slice(6);
            handleSSEEvent(currentEvent, raw);
          }
        }
      }

      function handleSSEEvent(event: string, rawData: string) {
        if (event === "progress") {
          const progress = JSON.parse(rawData) as { stage: string; status: string; message?: string };
          updateStage(progress.stage, progress.status as StageStatus, progress.message);
        } else if (event === "complete") {
          const pipelineResult = JSON.parse(rawData) as ArchiveAutoResult;
          setResult(pipelineResult);
          if (pipelineResult.candidates.length === 0) {
            setWarning(t("archive.noCandidates"));
          } else if (pipelineResult.pipelineWarnings.length > 0) {
            setWarning(t("archive.partialSuccess"));
          }
        } else if (event === "cancelled") {
          setError(t("archive.pipelineCancelled"));
        } else if (event === "error") {
          const errData = JSON.parse(rawData) as { error: string };
          throw new Error(errData.error);
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        processLines(parts.flatMap((part) => part.split("\n")));
      }

      if (buffer.trim()) {
        processLines(buffer.trim().split("\n"));
      }
    } catch (caughtError) {
      if (caughtError instanceof DOMException && caughtError.name === "AbortError") {
        setError(t("archive.pipelineCancelled"));
      } else {
        const raw = caughtError instanceof Error ? caughtError.message : "";
        setError(humanizeError(raw));
      }
    } finally {
      // Flush any pending throttled stage updates before the component may
      // unmount, so terminal statuses aren't lost on quick cancellation.
      stageUpdateTimersRef.current.forEach((timer) => clearTimeout(timer));
      stageUpdateTimersRef.current.clear();
      setIsRunning(false);
      abortControllerRef.current = null;
    }
  }

  function handleImport(mode: ChatImportMode) {
    if (!result) {
      return;
    }
    onImport(
      result.sourceUrl ? result.candidates.map((c) => ({ ...c, sourceUrl: result.sourceUrl })) : result.candidates,
      mode,
      result.summary
    );
  }

  function handleRetry() {
    setError(null);
    handleRun();
  }

  async function handleCopyError() {
    if (!error) return;
    try {
      await navigator.clipboard.writeText(error);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  const completedStages = stages.filter((s) => s.status === "done").length;
  const progressPct = Math.round((completedStages / stages.length) * 100);

  return (
    <section className="glass-panel rounded-3xl p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.26em] text-violet-200/70">{t("archive.eyebrow")}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{t("archive.title")}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{t("archive.description")}</p>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
        >
          {isExpanded ? t("archive.hide") : t("archive.open")}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="space-y-5">
            <div className="rounded-3xl border border-violet-300/25 bg-violet-400/10 p-4">
              <div className="grid gap-4 lg:grid-cols-[1.4fr_0.35fr_0.35fr_0.45fr]">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-violet-100/75">{t("archive.url")}</span>
                  <input
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setError(null);
                    }}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-200/60"
                    placeholder={t("archive.urlPlaceholder")}
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-violet-100/75">{t("archive.maxCandidates")}</span>
                  <select
                    value={maxCandidates}
                    onChange={(event) => setMaxCandidates(Number(event.target.value))}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none focus:border-violet-200/60"
                  >
                    {[1, 2, 3, 4, 5, 6, 8, 10].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-violet-100/75">{t("archive.maxMessages")}</span>
                  <select
                    value={maxMessages}
                    onChange={(event) => setMaxMessages(Number(event.target.value))}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none focus:border-violet-200/60"
                    title={t("archive.maxMessagesHint")}
                  >
                    {MAX_MESSAGES_PRESETS.map((value) => (
                      <option key={value} value={value}>
                        {value === 0 ? t("archive.unlimited") : value.toLocaleString()}
                      </option>
                    ))}
                  </select>
                  {maxMessages === 0 && (
                    <p className="mt-1 text-[0.65rem] leading-4 text-amber-100/80">
                      {t("archive.maxMessagesHint")}
                    </p>
                  )}
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-violet-100/75">{t("archive.clipMode")}</span>
                  <select
                    value={clipMode}
                    onChange={(event) => setClipMode(event.target.value as "copy" | "reencode")}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none focus:border-violet-200/60"
                  >
                    <option value="copy">{t("archive.copyMode")}</option>
                    <option value="reencode">{t("archive.reencodeMode")}</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-violet-100/75">{t("archive.clipLength")}</span>
                  <select
                    value={clipLength}
                    onChange={(event) => setClipLength(event.target.value as "short" | "standard" | "long")}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none focus:border-violet-200/60"
                  >
                    <option value="short">{t("archive.clipLengthShort")}</option>
                    <option value="standard">{t("archive.clipLengthStandard")}</option>
                    <option value="long">{t("archive.clipLengthLong")}</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={useTimeRange}
                    onChange={(event) => setUseTimeRange(event.target.checked)}
                    className="mt-1 h-4 w-4 accent-violet-300"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-slate-100">
                      {t("archive.timeRange")}
                    </span>
                    <p className="mt-0.5 text-[0.7rem] leading-4 text-slate-400">
                      {t("archive.timeRangeHint")}
                    </p>
                  </div>
                </label>
                {useTimeRange && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-400">{t("archive.timeStart")}</span>
                      <input
                        value={timeRangeStart}
                        onChange={(e) => setTimeRangeStart(e.target.value)}
                        placeholder="00:00:00"
                        className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-200/60 font-mono"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-400">{t("archive.timeEnd")}</span>
                      <input
                        value={timeRangeEnd}
                        onChange={(e) => setTimeRangeEnd(e.target.value)}
                        placeholder="02:00:00"
                        className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-200/60 font-mono"
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={transcribe}
                      onChange={(event) => setTranscribe(event.target.checked)}
                      className="mt-1 h-4 w-4 accent-fuchsia-300"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-semibold text-slate-100">
                        {t("archive.transcribe")}
                      </span>
                      <p className="mt-0.5 text-[0.7rem] leading-4 text-slate-400">
                        {transcribe
                          ? t("archive.transcribeEnabledHint")
                          : t("archive.transcribeDisabledHint")}
                      </p>
                    </div>
                  </label>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={generatePackages}
                      onChange={(event) => setGeneratePackages(event.target.checked)}
                      className="mt-1 h-4 w-4 accent-violet-300"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-semibold text-slate-100">
                        {t("archive.generatePackages")}
                      </span>
                      <p className="mt-0.5 text-[0.7rem] leading-4 text-slate-400">
                        {t("archive.generatePackagesHint")}
                      </p>
                    </div>
                  </label>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={burnComments}
                      onChange={(event) => setBurnComments(event.target.checked)}
                      className="mt-1 h-4 w-4 accent-orange-300"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-semibold text-slate-100">
                        {t("archive.burnComments")}
                      </span>
                      <p className="mt-0.5 text-[0.7rem] leading-4 text-slate-400">
                        {burnComments
                          ? t("archive.burnCommentsEnabledHint")
                          : t("archive.burnCommentsDisabledHint")}
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="mt-3">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={autoOpenModal}
                    onChange={(event) => setAutoOpenModal(event.target.checked)}
                    className="h-4 w-4 accent-violet-300"
                  />
                  {t("archive.autoOpenModal")}
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={isRunning}
                  className="rounded-2xl border border-violet-200/45 bg-violet-300/15 px-6 py-3 text-sm font-semibold text-violet-50 transition hover:bg-violet-300/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRunning ? t("archive.running") : t("archive.run")}
                </button>
                {isRunning && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="rounded-2xl border border-rose-300/40 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/20"
                  >
                    {t("archive.cancel")}
                  </button>
                )}
                {error && !isRunning && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="rounded-2xl border border-cyan-200/40 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                  >
                    {t("archive.retry")}
                  </button>
                )}
              </div>

              {error && (
                <div className="mt-4 rounded-2xl border border-rose-300/35 bg-rose-400/10 p-3 text-sm leading-6 text-rose-100">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{t("archive.pipelineFailed")}</p>
                    <button
                      type="button"
                      onClick={handleCopyError}
                      className="rounded-full border border-rose-200/40 px-2.5 py-0.5 text-xs font-semibold text-rose-50 transition hover:bg-rose-400/20"
                    >
                      {copied ? t("archive.copied") : t("archive.copyError")}
                    </button>
                  </div>
                  <p className="mt-1 break-words text-xs leading-5">{error}</p>
                </div>
              )}
            </div>

            {isRunning && (
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("archive.pipelineProgress")}</p>
                  <div className="flex items-center gap-3 text-xs text-slate-300">
                    <span className="font-mono">{progressPct}%</span>
                    <span className="text-slate-500">·</span>
                    <span className="font-mono">{Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")}</span>
                  </div>
                </div>
                <div className="mb-4 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-300 via-cyan-200 to-emerald-200 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="space-y-2">
                  {stages.map((stage) => (
                    <div key={stage.id} className={cn(
                      "flex items-center justify-between gap-3 rounded-2xl border px-3 py-2 relative overflow-hidden",
                      stage.status === "running" ? "border-cyan-300/15 bg-cyan-900/10" : "border-white/10 bg-black/15"
                    )}>
                      {stage.status === "running" && (
                        <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-cyan-300/5 to-transparent" />
                      )}
                      <div className="min-w-0 flex-1 relative">
                        <span className="text-sm text-slate-200">{t(stage.labelKey)}</span>
                        {stage.detail && <p className="mt-0.5 truncate text-xs text-slate-400">{stage.detail}</p>}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                          stage.status === "done" && "bg-emerald-300/15 text-emerald-100",
                          stage.status === "running" && "bg-cyan-300/15 text-cyan-100",
                          stage.status === "error" && "bg-rose-300/15 text-rose-100",
                          stage.status === "cancelled" && "bg-amber-300/15 text-amber-100",
                          stage.status === "pending" && "bg-white/5 text-slate-500"
                        )}
                      >
                        {stage.status === "done" && t("archive.done")}
                        {stage.status === "running" && t("archive.runningStage")}
                        {stage.status === "error" && t("archive.errorStage")}
                        {stage.status === "cancelled" && t("archive.cancelledStage")}
                        {stage.status === "pending" && t("archive.pendingStage")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result && (
              <div className="rounded-3xl border border-emerald-300/25 bg-emerald-400/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-emerald-50">{t("archive.analysisComplete")}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleImport("replace")}
                      className="rounded-2xl border border-emerald-200/45 bg-emerald-300/15 px-4 py-1.5 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-300/25"
                    >
                      {t("archive.replaceAll")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleImport("append")}
                      className="rounded-2xl border border-emerald-200/45 bg-emerald-300/15 px-4 py-1.5 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-300/25"
                    >
                      {t("archive.append")}
                    </button>
                  </div>
                </div>

                {warning && (
                  <div className="mt-3 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-2.5 text-xs leading-5 text-amber-100">
                    {warning}
                  </div>
                )}

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MiniStat label={t("archive.candidatesGenerated")} value={result.candidates.length.toString()} />
                  <MiniStat label={t("archive.clipsGenerated")} value={result.generatedClipCount.toString()} />
                  <MiniStat
                    label={t("archive.transcribed")}
                    value={
                      transcribe
                        ? result.transcribedCount.toString()
                        : `0 (${t("archive.transcribeSkipped")})`
                    }
                  />
                  <MiniStat label={t("archive.packages")} value={result.packageCount.toString()} />
                </div>

                <div className="mt-3 rounded-2xl border border-violet-300/20 bg-violet-400/10 p-3 text-xs leading-5 text-violet-100">
                  <p>
                    {t("archive.source")}: {result.metadata.title ?? url}
                  </p>
                  <p>
                    {t("archive.streamer")}: {result.metadata.uploader ?? t("common.unknown")}
                  </p>
                  <p>
                    {t("archive.chatMessages")}: {result.chat.messageCount.toLocaleString()}
                  </p>
                </div>

                {result.pipelineWarnings.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-100/70">{t("archive.warnings")}</p>
                    {result.pipelineWarnings.map((warning, index) => (
                      <div key={index} className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-2.5 text-xs leading-5 text-amber-100">
                        {warning.candidateId && <span className="font-semibold">[{warning.candidateId}] </span>}
                        {warning.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("archive.howItWorks")}</p>
              <div className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                <p>{t("archive.howMetadata")}</p>
                <p>{t("archive.howChat")}</p>
                <p>{t("archive.howClips")}</p>
                <p>{t("archive.howComments")}</p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

function parseTimeToSeconds(input: string): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return undefined;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-100">{value}</p>
    </div>
  );
}
