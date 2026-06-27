"use client";

import { useRef, useState } from "react";
import { analyzeChatJson, type ChatAnalysisSummary, type ChatImportMode } from "@/lib/chat-analysis";
import { useI18n } from "@/lib/i18n";
import type { ClipCandidate } from "@/lib/mock-candidates";
import { cn } from "@/lib/utils";

type ChatJsonImportPanelProps = {
  onImport: (candidates: ClipCandidate[], mode: ChatImportMode, summary: ChatAnalysisSummary) => void;
};

type ChatDownloaderResponse = {
  source: "chat_downloader";
  url: string;
  normalizedPath: string;
  rawPath: string;
  messageCount: number;
  normalizedMessages: Array<{
    timestamp_seconds: number;
    author_name: string;
    message: string;
  }>;
  commandPreview: string;
  fetchedAt: string;
  candidates: ClipCandidate[];
  summary: ChatAnalysisSummary;
};

const sampleChatJson = JSON.stringify(
  [
    { timestamp_seconds: 1180, author_name: "user01", message: "normal farming time" },
    { timestamp_seconds: 1192, author_name: "user02", message: "素材集めかな" },
    { timestamp_seconds: 1201, author_name: "user03", message: "wait" },
    { timestamp_seconds: 1203, author_name: "user04", message: "え" },
    { timestamp_seconds: 1204, author_name: "user05", message: "え！？" },
    { timestamp_seconds: 1205, author_name: "user06", message: "やばい" },
    { timestamp_seconds: 1206, author_name: "user07", message: "NO WAY" },
    { timestamp_seconds: 1207, author_name: "user08", message: "まじ？？" },
    { timestamp_seconds: 1208, author_name: "user09", message: "clip this" },
    { timestamp_seconds: 1210, author_name: "user10", message: "うますぎ" },
    { timestamp_seconds: 1211, author_name: "user11", message: "神" },
    { timestamp_seconds: 1213, author_name: "user12", message: "CLUTCH" },
    { timestamp_seconds: 1214, author_name: "user13", message: "切り抜き確定" },
    { timestamp_seconds: 1215, author_name: "user14", message: "草" },
    { timestamp_seconds: 1217, author_name: "user15", message: "草草草" },
    { timestamp_seconds: 1220, author_name: "user16", message: "天才すぎる" },
    { timestamp_seconds: 1500, author_name: "user03", message: "落ち着いた" },
    { timestamp_seconds: 1510, author_name: "user04", message: "次いこう" },
    { timestamp_seconds: 1820, author_name: "user17", message: "かわいい" },
    { timestamp_seconds: 1822, author_name: "user18", message: "かわいい" },
    { timestamp_seconds: 1824, author_name: "user19", message: "beautiful" },
    { timestamp_seconds: 1825, author_name: "user20", message: "泣いた" },
    { timestamp_seconds: 1826, author_name: "user21", message: "THANK YOU" },
    { timestamp_seconds: 1828, author_name: "user22", message: "ここ好き" },
    { timestamp_seconds: 1830, author_name: "user23", message: "clip" },
    { timestamp_seconds: 1831, author_name: "user24", message: "可愛い" }
  ],
  null,
  2
);

export function ChatJsonImportPanel({ onImport }: ChatJsonImportPanelProps) {
  const { t } = useI18n();
  const [jsonText, setJsonText] = useState(sampleChatJson);
  const [mode, setMode] = useState<ChatImportMode>("append");
  const [error, setError] = useState<string | null>(null);
  const [chatDownloaderError, setChatDownloaderError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ChatAnalysisSummary | null>(null);
  const [chatDownloaderSummary, setChatDownloaderSummary] = useState<ChatAnalysisSummary | null>(null);
  const [chatDownloaderUrl, setChatDownloaderUrl] = useState("");
  const [maxMessages, setMaxMessages] = useState(5000);
  const [isFetchingChat, setIsFetchingChat] = useState(false);
  const [lastFetchedChat, setLastFetchedChat] = useState<ChatDownloaderResponse | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleAnalyze() {
    setError(null);
    setSummary(null);

    try {
      const result = analyzeChatJson(jsonText, `import-${Date.now()}`);

      if (result.candidates.length === 0) {
        setSummary(result.summary);
        setError("JSON parsed successfully, but no highlight windows were detected. Try a chat sample with a clearer activity spike.");
        return;
      }

      onImport(result.candidates, mode, result.summary);
      setSummary(result.summary);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown import error.");
    }
  }

  function handleFileChange(file: File | undefined) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setJsonText(String(reader.result ?? ""));
      setError(null);
      setSummary(null);
    };
    reader.onerror = () => setError("Could not read the selected file.");
    reader.readAsText(file);
  }

  async function handleFetchWithChatDownloader() {
    setIsFetchingChat(true);
    setChatDownloaderError(null);
    setChatDownloaderSummary(null);
    setLastFetchedChat(null);

    try {
      const response = await fetch("/api/chat/chat-downloader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: chatDownloaderUrl, maxMessages })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiError(data, "Could not fetch chat with chat-downloader."));
      }

      const result = data as ChatDownloaderResponse;
      setLastFetchedChat(result);
      setChatDownloaderSummary(result.summary);
      setJsonText(JSON.stringify(result.normalizedMessages, null, 2));

      if (result.candidates.length === 0) {
        setChatDownloaderError("Chat fetched successfully, but no highlight windows were detected. The normalized JSON was loaded for manual inspection.");
        return;
      }

      onImport(result.candidates, mode, result.summary);
    } catch (caughtError) {
      setChatDownloaderError(caughtError instanceof Error ? caughtError.message : "Could not fetch chat with chat-downloader.");
    } finally {
      setIsFetchingChat(false);
    }
  }

  return (
    <section className="glass-panel rounded-3xl p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.26em] text-fuchsia-200/70">{t("chatImport.eyebrow")}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{t("chatImport.title")}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            {t("chatImport.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
        >
          {isExpanded ? t("chatImport.hide") : t("chatImport.open")}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <div className="mb-5 rounded-3xl border border-cyan-300/25 bg-cyan-400/10 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <label className="block flex-1">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100/75">{t("chatImport.chatDownloaderUrl")}</span>
                  <input
                    value={chatDownloaderUrl}
                    onChange={(event) => {
                      setChatDownloaderUrl(event.target.value);
                      setChatDownloaderError(null);
                    }}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-200/60"
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </label>
                <label className="block lg:w-36">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100/75">{t("chatImport.maxMessages")}</span>
                  <input
                    type="number"
                    min="1"
                    max="50000"
                    value={maxMessages}
                    onChange={(event) => setMaxMessages(Number(event.target.value))}
                    className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-sm text-slate-100 outline-none focus:border-cyan-200/60"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleFetchWithChatDownloader}
                  disabled={isFetchingChat}
                  className="h-11 rounded-2xl border border-cyan-200/45 bg-cyan-300/15 px-4 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isFetchingChat ? t("chatImport.fetching") : t("chatImport.fetchAndMode", { mode: t(`common.${mode}`) })}
                </button>
              </div>
              <p className="mt-3 text-xs leading-5 text-cyan-100/75">{t("chatImport.adapterNote")}</p>

              {chatDownloaderError && (
                <div className="mt-3 rounded-2xl border border-rose-300/35 bg-rose-400/10 p-3 text-sm leading-6 text-rose-100">
                  {chatDownloaderError}
                </div>
              )}

              {lastFetchedChat && (
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 font-mono text-xs leading-5 text-cyan-100/85">
                  <p>{`source: ${lastFetchedChat.source}`}</p>
                  <p>{`messages: ${lastFetchedChat.messageCount}`}</p>
                  <p>{`normalized: ${lastFetchedChat.normalizedPath}`}</p>
                  <p>{`raw: ${lastFetchedChat.rawPath}`}</p>
                </div>
              )}

              {chatDownloaderSummary && !chatDownloaderError && (
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <SummaryStat label={t("chatImport.messages")} value={chatDownloaderSummary.analyzedMessages.toLocaleString()} />
                  <SummaryStat label={t("chatImport.candidates")} value={chatDownloaderSummary.candidateCount.toString()} />
                  <SummaryStat label={t("chatImport.baseline")} value={chatDownloaderSummary.baselinePerMinute.toString()} />
                  <SummaryStat label={t("chatImport.peak")} value={chatDownloaderSummary.peakPerMinute.toString()} />
                </div>
              )}
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setJsonText(sampleChatJson)} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">
                {t("chatImport.loadSample")}
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">
                {t("chatImport.loadFile")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => handleFileChange(event.target.files?.[0])}
              />
              <div className="flex rounded-full border border-white/10 bg-white/[0.04] p-1">
                {(["append", "replace"] as ChatImportMode[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMode(option)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold capitalize transition",
                      mode === option ? "bg-cyan-300/20 text-cyan-50" : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    {t(`common.${option}`)}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("chatImport.chatJson")}</span>
              <textarea
                value={jsonText}
                onChange={(event) => {
                  setJsonText(event.target.value);
                  setError(null);
                  setSummary(null);
                }}
                rows={18}
                spellCheck={false}
                className="w-full resize-y rounded-3xl border border-white/10 bg-black/25 p-4 font-mono text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-200/60 focus:bg-black/35"
                placeholder='[{"timestamp_seconds":1234,"author_name":"user1","message":"草"}]'
              />
            </label>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={handleAnalyze} className="rounded-2xl border border-cyan-200/45 bg-cyan-300/15 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/25">
                {t("chatImport.analyze", { mode: t(`common.${mode}`) })}
              </button>
            <p className="text-xs text-slate-500">{t("chatImport.clientNote")}</p>
            </div>

            {error && (
              <div className="mt-4 rounded-2xl border border-rose-300/35 bg-rose-400/10 p-4 text-sm leading-6 text-rose-100">
                {error}
              </div>
            )}

            {summary && !error && (
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <SummaryStat label={t("chatImport.messages")} value={summary.analyzedMessages.toLocaleString()} />
                <SummaryStat label={t("chatImport.candidates")} value={summary.candidateCount.toString()} />
                <SummaryStat label={t("chatImport.baseline")} value={summary.baselinePerMinute.toString()} />
                <SummaryStat label={t("chatImport.peak")} value={summary.peakPerMinute.toString()} />
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("chatImport.expectedFormat")}</h3>
              <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-black/25 p-3 text-xs leading-5 text-slate-300">
{`[
  {
    "timestamp_seconds": 1234,
    "author_name": "user1",
    "message": "草"
  }
]`}
              </pre>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-slate-300">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("chatImport.rulesTitle")}</h3>
              <p className="mt-3">{t("chatImport.rules1")}</p>
              <p>{t("chatImport.rules2")}</p>
              <p>{t("chatImport.rules3")}</p>
            </div>

            <div className="rounded-3xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
              {t("chatImport.chatOnlyWarning")}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function readApiError(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    return (data as { error: string }).error;
  }

  return fallback;
}
