"use client";
import React, { useState, useCallback } from "react";
import { extractVideoId, getCandidateSeekTime, secondsToTwitchTime, type HighlightCandidate } from "@/lib/twitch-time";
import { analyzeStudioVod, analyzeHighlights, createClip, transcribeAudio, normalizeCandidates } from "@/lib/studio-api";
import TwitchVodPlayer from "@/components/studio/TwitchVodPlayer";
import CandidateList from "@/components/studio/CandidateList";
import CandidateDetails from "@/components/studio/CandidateDetails";
import LogPanel from "@/components/studio/LogPanel";

export default function StudioClient() {
  // Inputs
  const [vodUrl, setVodUrl] = useState("");
  const [videoPath, setVideoPath] = useState("");
  const [logPath, setLogPath] = useState("");
  const [windowSec, setWindowSec] = useState(30);
  const [topN, setTopN] = useState(10);
  const [minGap, setMinGap] = useState(45);
  const [keywordsText, setKeywordsText] = useState("");

  // State
  const [videoId, setVideoId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<HighlightCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<HighlightCandidate | null>(null);
  const [playerStartTime, setPlayerStartTime] = useState(0);
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>(["Ready"]);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-99), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const handleSelectCandidate = useCallback((candidate: HighlightCandidate) => {
    const seekTime = getCandidateSeekTime(candidate);
    if (seekTime === null) {
      setErrorMessage("この候補には有効な開始時間がありません");
      addLog("候補の時刻が無効なため移動できませんでした");
      return;
    }
    setSelectedCandidate(candidate);
    setPlayerStartTime(seekTime);
    setPlayerReloadKey((v) => v + 1);
    setErrorMessage(null);
    addLog(`候補 #${candidate.rank} に移動: ${secondsToTwitchTime(seekTime)}`);
  }, [addLog]);

  const handleLoadVod = useCallback(() => {
    const id = extractVideoId(vodUrl);
    if (!id) {
      setErrorMessage("Twitch VOD URL から video ID を抽出できませんでした");
      return;
    }
    setVideoId(id);
    setPlayerStartTime(0);
    setPlayerReloadKey((v) => v + 1);
    setErrorMessage(null);
    addLog(`VOD loaded: v${id}`);
  }, [vodUrl, addLog]);

  const handleAnalyze = useCallback(async () => {
    if (!videoId) {
      setErrorMessage("先に Twitch VOD URL を読み込んでください");
      return;
    }
    setIsAnalyzing(true);
    setErrorMessage(null);
    addLog("分析を開始...");

    try {
      // Try VOD analysis via Next.js API route
      const result = await analyzeStudioVod({ vod_url: vodUrl, top_n: topN });
      if (result.candidates.length > 0) {
        const normalized = normalizeCandidates(result.candidates);
        setCandidates(normalized);
        addLog(`分析完了: ${normalized.length} 件の候補`);
        handleSelectCandidate(normalized[0]);
      } else {
        addLog(`VOD metadata fetched (${result.title ?? "unknown"}), but candidate generation requires local files.`);
        setCandidates([]);
      }
    } catch (e) {
      addLog(`備考: ${e instanceof Error ? e.message : "Now showing player"}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [videoId, vodUrl, topN, handleSelectCandidate, addLog]);

  return (
    <div className="min-h-screen flex flex-col bg-[#050816]">
      {/* Header */}
      <header className="bg-slate-900/80 border-b border-slate-700/50 px-5 py-2.5 flex items-center gap-4 flex-wrap">
        <h1 className="text-lg font-bold text-violet-300 whitespace-nowrap">Stream Clipper Studio</h1>

        <div className="flex gap-2 items-end">
          <div className="flex flex-col gap-px">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Twitch VOD URL</label>
            <input value={vodUrl} onChange={(e) => setVodUrl(e.target.value)}
              placeholder="https://www.twitch.tv/videos/123456789"
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500 w-72" />
          </div>
          <button onClick={handleLoadVod} disabled={!vodUrl.trim()}
            className="px-2.5 py-1.5 text-xs rounded bg-slate-700/60 border border-slate-600 text-slate-300 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">
            Load VOD
          </button>
        </div>

        <div className="flex gap-1.5 items-end">
          <div className="flex flex-col gap-px w-14">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Window</label>
            <input type="number" value={windowSec} min={10} step={5}
              onChange={(e) => setWindowSec(Number(e.target.value) || 30)}
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
          <div className="flex flex-col gap-px w-12">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Top N</label>
            <input type="number" value={topN} min={1} step={1}
              onChange={(e) => setTopN(Number(e.target.value) || 10)}
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
          <div className="flex flex-col gap-px w-14">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Min gap</label>
            <input type="number" value={minGap} min={0} step={5}
              onChange={(e) => setMinGap(Number(e.target.value) || 45)}
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
        </div>

        <div className="flex gap-1.5 ml-auto">
          <button onClick={handleAnalyze} disabled={isAnalyzing || !videoId}
            className="px-3 py-1.5 text-xs rounded bg-violet-600 text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">
            {isAnalyzing ? "⏳ Analyzing..." : "🔍 Analyze"}
          </button>
        </div>
      </header>

      {/* Error */}
      {errorMessage && (
        <div className="bg-red-950/80 border-b border-red-800 px-5 py-1.5 flex justify-between items-center text-red-300 text-xs">
          <span>⚠ {errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="bg-none border-none text-red-300 cursor-pointer text-sm">✕</button>
        </div>
      )}

      {/* Main content: player left, candidates right */}
      <div className="flex gap-3 px-5 pt-3 flex-1 min-h-0">
        <div className="flex-[3] flex flex-col gap-2.5 min-w-0">
          {videoId ? (
            <TwitchVodPlayer
              videoId={videoId}
              startTimeSeconds={playerStartTime}
              reloadKey={playerReloadKey}
            />
          ) : (
            <div className="glass-panel rounded-lg p-3 flex items-center justify-center h-[200px]">
              <div className="text-xs text-slate-500">
                Enter a Twitch VOD URL above and click &quot;Load VOD&quot;
              </div>
            </div>
          )}

          <CandidateDetails candidate={selectedCandidate} />
        </div>

        <div className="flex-[2] flex flex-col min-w-[280px] max-w-[400px]">
          <CandidateList
            candidates={candidates}
            selectedCandidateId={selectedCandidate?.id ?? selectedCandidate?.rank ?? null}
            onSelectCandidate={handleSelectCandidate}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 pb-3 pt-2">
        <LogPanel logs={logs} />
      </div>
    </div>
  );
}
