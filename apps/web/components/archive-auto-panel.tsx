"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { ChatAnalysisSummary, ChatImportMode } from "@/lib/chat-analysis";
import type { ClipCandidate } from "@/lib/mock-candidates";
import { cn } from "@/lib/utils";

type PipelineStage = {
  id: string;
  labelKey: string;
  status: "pending" | "running" | "done" | "error";
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

export function ArchiveAutoPanel({ onImport }: ArchiveAutoPanelProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [url, setUrl] = useState("");
  const [maxCandidates, setMaxCandidates] = useState(3);
  const [clipMode, setClipMode] = useState<"copy" | "reencode">("copy");
  const [transcribe, setTranscribe] = useState(true);
  const [generatePackages, setGeneratePackages] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [stages, setStages] = useState<PipelineStage[]>(initialStages);
  const [result, setResult] = useState<ArchiveAutoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateStage(id: string, status: PipelineStage["status"], detail?: string) {
    setStages((current) => current.map((stage) => (stage.id === id ? { ...stage, status, detail } : stage)));
  }

  function resetPipeline() {
    setStages(initialStages.map((stage) => ({ ...stage, status: "pending" as const })));
    setResult(null);
    setError(null);
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

    try {
      const response = await fetch("/api/archive/analyze/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmedUrl,
          maxCandidates,
          clipMode,
          transcribe,
          generatePackages
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorMatch = errorText.match(/data: (.+)/);
        const errorData = errorMatch ? JSON.parse(errorMatch[1]) : null;
        throw new Error(errorData?.error ?? t("archive.pipelineFailed"));
      }

      const reader = response.body!.getReader();
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
          updateStage(progress.stage, progress.status as PipelineStage["status"], progress.message);
        } else if (event === "complete") {
          const pipelineResult = JSON.parse(rawData) as ArchiveAutoResult;
          setResult(pipelineResult);
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
      const message = caughtError instanceof Error ? caughtError.message : t("archive.unknownError");
      setError(message);
    } finally {
      setIsRunning(false);
    }
  }

  function handleImport(mode: ChatImportMode) {
    if (!result) {
      return;
    }

    onImport(result.candidates, mode, result.summary);
  }

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
              <div className="grid gap-4 lg:grid-cols-[1fr_0.35fr_0.45fr]">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-violet-100/75">{t("archive.url")}</span>
                  <input
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setError(null);
                    }}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-200/60"
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-violet-100/75">{t("archive.maxCandidates")}</span>
                  <select
                    value={maxCandidates}
                    onChange={(event) => setMaxCandidates(Number(event.target.value))}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none focus:border-violet-200/60"
                  >
                    {[1, 2, 3, 4, 5, 6].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
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
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={transcribe}
                    onChange={(event) => setTranscribe(event.target.checked)}
                    className="h-4 w-4 accent-violet-300"
                  />
                  {t("archive.transcribe")}
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={generatePackages}
                    onChange={(event) => setGeneratePackages(event.target.checked)}
                    className="h-4 w-4 accent-violet-300"
                  />
                  {t("archive.generatePackages")}
                </label>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={isRunning}
                  className="rounded-2xl border border-violet-200/45 bg-violet-300/15 px-6 py-3 text-sm font-semibold text-violet-50 transition hover:bg-violet-300/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRunning ? t("archive.running") : t("archive.run")}
                </button>
              </div>

              {error && (
                <div className="mt-4 rounded-2xl border border-rose-300/35 bg-rose-400/10 p-3 text-sm leading-6 text-rose-100">
                  <p className="font-semibold">{t("archive.pipelineFailed")}</p>
                  <p className="mt-1">{error}</p>
                </div>
              )}
            </div>

            {isRunning && (
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("archive.pipelineProgress")}</p>
                <div className="space-y-2">
                  {stages.map((stage) => (
                    <div key={stage.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/15 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-slate-200">{t(stage.labelKey)}</span>
                        {stage.detail && <p className="mt-0.5 truncate text-xs text-slate-400">{stage.detail}</p>}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                          stage.status === "done" && "bg-emerald-300/15 text-emerald-100",
                          stage.status === "running" && "bg-cyan-300/15 text-cyan-100",
                          stage.status === "error" && "bg-rose-300/15 text-rose-100",
                          stage.status === "pending" && "bg-white/5 text-slate-500"
                        )}
                      >
                        {stage.status === "done" && t("archive.done")}
                        {stage.status === "running" && t("archive.runningStage")}
                        {stage.status === "error" && t("archive.errorStage")}
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

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MiniStat label={t("archive.candidatesGenerated")} value={result.candidates.length.toString()} />
                  <MiniStat label={t("archive.clipsGenerated")} value={result.generatedClipCount.toString()} />
                  <MiniStat label={t("archive.transcribed")} value={result.transcribedCount.toString()} />
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-100">{value}</p>
    </div>
  );
}


