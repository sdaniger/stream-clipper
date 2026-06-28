"use client";

import { useState, useCallback } from "react";
import { ChatJsonImportPanel } from "@/components/chat-json-import-panel";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LocalVideoPanel } from "@/components/local-video-panel";
import { clearCandidates, loadCandidates, saveCandidates } from "@/lib/candidate-storage";
import { useI18n } from "@/lib/i18n";
import type { ChatAnalysisSummary, ChatImportMode } from "@/lib/chat-analysis";
import type {
  ClipCandidate,
  ClipTranscription,
  GeneratedClipReference,
  ThumbnailCandidateReference
} from "@/lib/mock-candidates";

type DiagResult = {
  available?: boolean;
  version?: string;
  error?: string;
  twitchExtractors?: string[];
  formatTest?: { ok: boolean; formats?: string[]; error?: string };
  speedTest?: { ok: boolean; elapsedSec?: string; sizeMB?: string; speedMBs?: string; error?: string };
  argsValid?: { ok: boolean; error?: string };
};

export default function DevPage() {
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<ClipCandidate[]>(() => loadCandidates() ?? []);
  const [diag, setDiag] = useState<DiagResult | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const runDiagnose = useCallback(async () => {
    setDiagLoading(true);
    setDiag(null);
    try {
      const res = await fetch("/api/media/yt-dlp/diagnose");
      setDiag(await res.json() as DiagResult);
    } catch (err) {
      setDiag({ error: err instanceof Error ? err.message : "Diagnostic request failed" });
    } finally {
      setDiagLoading(false);
    }
  }, []);

  const updateClip = useCallback((id: string, clip: GeneratedClipReference) => {
    setCandidates((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, generatedClip: clip } : c));
      saveCandidates(next);
      return next;
    });
  }, []);

  const updateTranscription = useCallback((id: string, transcription: ClipTranscription) => {
    setCandidates((prev) => {
      const excerpt = transcription.segments.slice(0, 3).map((s) => s.text);
      const next = prev.map((c) =>
        c.id === id
          ? { ...c, transcription, transcript: excerpt.length > 0 ? excerpt : [transcription.text] }
          : c
      );
      saveCandidates(next);
      return next;
    });
  }, []);

  const importCandidates = useCallback((imported: ClipCandidate[], mode: ChatImportMode, _summary: ChatAnalysisSummary) => {
    setCandidates((prev) => {
      const next = mode === "replace" ? imported : [...imported, ...prev];
      saveCandidates(next);
      return next;
    });
  }, []);

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <a href="/" className="text-sm text-slate-400 transition hover:text-slate-200">← 戻る</a>
            <h1 className="mt-1 text-xl font-semibold text-white">Developer Tools</h1>
          </div>
          <LanguageSwitcher />
        </header>

        <p className="text-sm text-slate-400">
          一般ユーザーには必要ないツールです。FFmpeg の挙動確認やチャットJSONの手動取り込みに使います。
        </p>

        {/* yt-dlp diagnostic */}
        <section className="glass-panel rounded-3xl p-5 sm:p-6">
          <h2 className="mb-3 text-sm font-semibold text-white">yt-dlp 診断</h2>
          <button type="button" onClick={runDiagnose} disabled={diagLoading}
            className="rounded-xl border border-cyan-200/40 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-50">
            {diagLoading ? "診断中..." : "診断を実行"}
          </button>

          {diag && (
            <div className="mt-4 space-y-2 text-xs font-mono">
              {diag.error && <p className="text-rose-300">Error: {diag.error}</p>}
              {diag.available !== undefined && (
                <p className={diag.available ? "text-emerald-300" : "text-rose-300"}>
                  yt-dlp: {diag.available ? `v${diag.version}` : "NOT AVAILABLE"}
                </p>
              )}
              {diag.twitchExtractors && (
                <details>
                  <summary className="cursor-pointer text-slate-300">Twitch extractors ({diag.twitchExtractors.length})</summary>
                  <ul className="mt-1 space-y-0.5 pl-4 text-slate-400">
                    {diag.twitchExtractors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
              {diag.formatTest && (
                <p className={diag.formatTest.ok ? "text-slate-300" : "text-rose-300"}>
                  Format test: {diag.formatTest.ok ? "OK" : `FAIL - ${diag.formatTest.error}`}
                  {diag.formatTest.formats?.length ? ` (${diag.formatTest.formats[0]})` : ""}
                </p>
              )}
              {diag.speedTest && (
                <p className={diag.speedTest.ok ? "text-slate-300" : "text-rose-300"}>
                  Speed test: {diag.speedTest.ok
                    ? `${diag.speedTest.sizeMB}MB in ${diag.speedTest.elapsedSec}s = ${diag.speedTest.speedMBs} MB/s`
                    : `FAIL - ${diag.speedTest.error}`}
                </p>
              )}
              {diag.argsValid && (
                <p className={diag.argsValid.ok ? "text-emerald-300" : "text-rose-300"}>
                  Custom args: {diag.argsValid.ok ? "OK" : `FAIL - ${diag.argsValid.error}`}
                </p>
              )}
            </div>
          )}
        </section>

        <ChatJsonImportPanel onImport={importCandidates} />

        <LocalVideoPanel
          candidates={candidates}
          onClipGenerated={updateClip}
          onTranscriptionComplete={updateTranscription}
        />

        <button
          type="button"
          onClick={() => { if (!window.confirm("全データを削除しますか？この操作は取り消せません。")) return; clearCandidates(); setCandidates([]); }}
          className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-400 transition hover:text-rose-300"
        >
          保存データを消去
        </button>
      </div>
    </main>
  );
}
