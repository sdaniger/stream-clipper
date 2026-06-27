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

export default function DevPage() {
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<ClipCandidate[]>(() => loadCandidates() ?? []);

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

        <ChatJsonImportPanel onImport={importCandidates} />

        <LocalVideoPanel
          candidates={candidates}
          onClipGenerated={updateClip}
          onTranscriptionComplete={updateTranscription}
        />

        <button
          type="button"
          onClick={() => { clearCandidates(); setCandidates([]); }}
          className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-400 transition hover:text-rose-300"
        >
          保存データを消去
        </button>
      </div>
    </main>
  );
}
