"use client";
import React, { useState, useCallback } from "react";
import { extractVideoId, getCandidateSeekTime, secondsToTwitchTime, type HighlightCandidate } from "@/lib/twitch-time";
import type { TimelineRow } from "@/lib/studio-api";
import TwitchVodPlayer from "@/components/studio/TwitchVodPlayer";
import LocalVideoPlayer from "@/components/studio/LocalVideoPlayer";
import CandidateList from "@/components/studio/CandidateList";
import CandidateDetails from "@/components/studio/CandidateDetails";
import LogPanel from "@/components/studio/LogPanel";

type StudioMode = "twitch" | "local";

interface SseProgress {
  type: "progress";
  stage: string;
  message: string;
  progress: number;
}

interface SseResult {
  type: "result";
  video_id: string | null;
  title: string | null;
  duration_seconds: number | null;
  message_count: number;
  candidates: HighlightCandidate[];
  timeline: TimelineRow[];
  summary: Record<string, unknown> | null;
  error?: string;
  video_exists?: boolean;
}

interface SseError {
  type: "error";
  error: string;
}

type SseEvent = SseProgress | SseResult | SseError;

export default function StudioClient() {
  const [mode, setMode] = useState<StudioMode>("twitch");

  const [vodUrl, setVodUrl] = useState("");
  const [videoPath, setVideoPath] = useState("");
  const [logPath, setLogPath] = useState("");

  const [windowSec, setWindowSec] = useState(30);
  const [topN, setTopN] = useState(10);
  const [minGap, setMinGap] = useState(45);
  const [keywordsText, setKeywordsText] = useState("");

  const [videoId, setVideoId] = useState<string | null>(null);
  const [vodTitle, setVodTitle] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<HighlightCandidate[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<HighlightCandidate | null>(null);
  const [playerStartTime, setPlayerStartTime] = useState(0);
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
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
    if (mode === "twitch") {
      addLog(`候補 #${candidate.rank} に移動: ${secondsToTwitchTime(seekTime)}`);
    } else {
      addLog(`候補 #${candidate.rank} に移動: ${seekTime.toFixed(1)}s`);
    }
  }, [addLog, mode]);

  const handleLoadVod = useCallback(() => {
    const id = extractVideoId(vodUrl);
    if (!id) {
      setErrorMessage("Twitch VOD URL から video ID を抽出できませんでした");
      return;
    }
    setVideoId(id);
    setVodTitle(null);
    setCandidates([]);
    setTimeline([]);
    setSelectedCandidate(null);
    setPlayerStartTime(0);
    setPlayerReloadKey((v) => v + 1);
    setErrorMessage(null);
    addLog(`VOD loaded: v${id}`);
  }, [vodUrl, addLog]);

  const readStream = useCallback(async (res: Response) => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event: SseEvent = JSON.parse(line.slice(6));
          if (event.type === "progress") {
            setProgress(event.progress);
            setProgressLabel(event.message);
            addLog(event.message);
          } else if (event.type === "result") {
            setVodTitle(event.title);
            if (event.error) {
              addLog(`エラー: ${event.error}`);
              setCandidates([]);
              setTimeline([]);
              setErrorMessage(event.error);
            } else {
              if (event.candidates.length > 0) {
                addLog(`候補生成完了: ${event.candidates.length} 件`);
                setCandidates(event.candidates);
                setTimeline(event.timeline ?? []);
                handleSelectCandidate(event.candidates[0]);
              } else {
                addLog("チャットから候補を生成できませんでした");
                setCandidates([]);
                setTimeline([]);
              }
            }
          } else if (event.type === "error") {
            setErrorMessage(event.error);
            addLog(`エラー: ${event.error}`);
          }
        } catch {
          // skip malformed events
        }
      }
    }
  }, [addLog, handleSelectCandidate]);

  const handleAnalyze = useCallback(async () => {
    if (mode === "twitch") {
      if (!videoId) { setErrorMessage("先に Twitch VOD URL を読み込んでください"); return; }
      if (!vodUrl.trim()) { setErrorMessage("Twitch VOD URL が必要です"); return; }
    } else {
      if (!videoPath.trim()) { setErrorMessage("動画ファイルのパスを入力してください"); return; }
      if (!logPath.trim()) { setErrorMessage("チャットログファイルのパスを入力してください"); return; }
    }

    setIsAnalyzing(true);
    setProgress(0);
    setProgressLabel("");
    setErrorMessage(null);
    setCandidates([]);
    setTimeline([]);
    setSelectedCandidate(null);
    addLog("分析を開始...");

    try {
      const endpoint = mode === "twitch" ? "/api/studio/analyze-vod" : "/api/studio/analyze-local";
      const body = mode === "twitch"
        ? { vod_url: vodUrl, top_n: topN, window: windowSec, min_gap: minGap, keywords: keywordsText.trim() || undefined }
        : { video_path: videoPath, log_path: logPath, top_n: topN, window: windowSec, min_gap: minGap, keywords: keywordsText.trim() || undefined };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      await readStream(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "分析に失敗しました";
      setErrorMessage(msg);
      addLog(`エラー: ${msg}`);
    } finally {
      setIsAnalyzing(false);
      setProgress(0);
      setProgressLabel("");
    }
  }, [mode, videoId, vodUrl, videoPath, logPath, topN, windowSec, minGap, keywordsText, readStream, addLog]);

  return (
    <div className="min-h-screen flex flex-col bg-[#050816]">
      {/* Header */}
      <header className="bg-slate-900/80 border-b border-slate-700/50 px-5 py-2.5 flex items-center gap-4 flex-wrap">
        <h1 className="text-lg font-bold text-violet-300 whitespace-nowrap">Stream Clipper Studio</h1>

        <div className="flex bg-slate-800 rounded-md p-0.5 border border-slate-700">
          <button
            onClick={() => { setMode("twitch"); setVideoId(null); setCandidates([]); setVodTitle(null); }}
            className={`px-2.5 py-1 text-xs rounded-sm transition-colors ${mode === "twitch" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
          >Twitch VOD</button>
          <button
            onClick={() => { setMode("local"); setVideoId(null); setCandidates([]); setVodTitle(null); }}
            className={`px-2.5 py-1 text-xs rounded-sm transition-colors ${mode === "local" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
          >Local File</button>
        </div>

        {mode === "twitch" ? (
          <div className="flex gap-2 items-end">
            <div className="flex flex-col gap-px">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">Twitch VOD URL</label>
              <input value={vodUrl} onChange={(e) => setVodUrl(e.target.value)}
                placeholder="https://www.twitch.tv/videos/123456789"
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500 w-72" />
            </div>
            <button onClick={handleLoadVod} disabled={!vodUrl.trim()}
              className="px-2.5 py-1.5 text-xs rounded bg-slate-700/60 border border-slate-600 text-slate-300 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">Load VOD</button>
          </div>
        ) : (
          <div className="flex gap-2 items-end">
            <div className="flex flex-col gap-px">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">Video File</label>
              <input value={videoPath} onChange={(e) => setVideoPath(e.target.value)}
                placeholder="/path/to/video.mp4"
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500 w-64" />
            </div>
            <div className="flex flex-col gap-px">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">Chat Log</label>
              <input value={logPath} onChange={(e) => setLogPath(e.target.value)}
                placeholder="/path/to/chat.json"
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500 w-64" />
            </div>
          </div>
        )}

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
          <div className="flex flex-col gap-px w-32">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Keywords</label>
            <input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)}
              placeholder="comma,separated"
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
        </div>

        <div className="flex gap-1.5 ml-auto">
          <button onClick={handleAnalyze} disabled={isAnalyzing || (mode === "twitch" && !videoId)}
            className="px-3 py-1.5 text-xs rounded bg-violet-600 text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">
            {isAnalyzing ? "⏳ Analyzing..." : "🔍 Analyze"}
          </button>
        </div>
      </header>

      {/* Progress bar */}
      {isAnalyzing && (
        <div className="bg-slate-900/90 border-b border-slate-700/50 px-5 py-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${Math.max(1, progress)}%` }}
              />
            </div>
            <span className="text-xs text-slate-400 min-w-[180px] text-right whitespace-nowrap">
              {progressLabel || "準備中..."} ({progress}%)
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {errorMessage && (
        <div className="bg-red-950/80 border-b border-red-800 px-5 py-1.5 flex justify-between items-center text-red-300 text-xs">
          <span>⚠ {errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="bg-none border-none text-red-300 cursor-pointer text-sm">✕</button>
        </div>
      )}

      {/* Title bar */}
      {vodTitle && (
        <div className="bg-slate-800/50 border-b border-slate-700/30 px-5 py-1 text-xs text-slate-400">
          {vodTitle} · {candidates.length} candidates · {timeline.length} timeline buckets
        </div>
      )}

      {/* Main content */}
      <div className="flex gap-3 px-5 pt-3 flex-1 min-h-0">
        <div className="flex-[3] flex flex-col gap-2.5 min-w-0">
          {mode === "twitch" && videoId ? (
            <TwitchVodPlayer videoId={videoId} startTimeSeconds={playerStartTime} reloadKey={playerReloadKey} />
          ) : mode === "local" && videoPath.trim() ? (
            <LocalVideoPlayer videoPath={videoPath} startTimeSeconds={playerStartTime} />
          ) : (
            <div className="glass-panel rounded-lg p-3 flex items-center justify-center h-[200px]">
              <div className="text-xs text-slate-500">
                {mode === "twitch" ? 'Enter a Twitch VOD URL above and click "Load VOD"' : "Enter a local video file path above"}
              </div>
            </div>
          )}

          <CandidateDetails candidate={selectedCandidate} />

          {candidates.length > 0 && mode === "twitch" && (
            <div className="glass-panel rounded-lg p-2 text-[11px] text-slate-500">
              mp4 書き出しにはローカル動画ファイルが必要です。Twitch VOD プレイヤーはプレビュー専用です。
            </div>
          )}
        </div>

        <div className="flex-[2] flex flex-col min-w-[280px] max-w-[400px]">
          <CandidateList
            candidates={candidates}
            selectedCandidateId={selectedCandidate?.id ?? selectedCandidate?.rank ?? null}
            onSelectCandidate={handleSelectCandidate}
          />
        </div>
      </div>

      <div className="px-5 pb-3 pt-2">
        <LogPanel logs={logs} />
      </div>
    </div>
  );
}
