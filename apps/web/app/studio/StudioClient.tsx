"use client";
import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { extractVideoId, getCandidateSeekTime, type HighlightCandidate } from "@/lib/twitch-time";
import type { TimelineRow } from "@/lib/studio-api";
import { createStudioClip, batchCreateStudioClips } from "@/lib/studio-api";
import TwitchVodPlayer, { type TwitchVodPlayerHandle } from "@/components/studio/TwitchVodPlayer";
import LocalVideoPlayer, { type LocalVideoPlayerHandle } from "@/components/studio/LocalVideoPlayer";
import CandidateList from "@/components/studio/CandidateList";
import CandidateDetails from "@/components/studio/CandidateDetails";
import LogPanel from "@/components/studio/LogPanel";
import AdvancedSettings from "@/components/studio/AdvancedSettings";
import ClipActionPanel from "@/components/studio/ClipActionPanel";
import TimelineGraph from "@/components/studio/TimelineGraph";

type StudioMode = "twitch" | "local";
type ExportStatus = "idle" | "exporting" | "exported" | "error";

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
  diagnostic?: {
    fetched_chat_count: number;
    normalized_chat_count: number;
    timeline_count: number;
    raw_candidate_count: number;
    candidates_after_threshold: number;
    candidates_after_min_gap: number;
    final_candidate_count: number;
    top_n: number;
    window: number;
    step: number;
    threshold: number;
    min_gap: number;
  };
}

interface SseError {
  type: "error";
  error: string;
}

type SseEvent = SseProgress | SseResult | SseError;

function getStart(c: HighlightCandidate): number {
  return c.clip_start ?? c.start ?? c.peak_time ?? 0;
}
function getEnd(c: HighlightCandidate): number {
  return c.end ?? (c.clip_start != null && c.clip_duration != null ? c.clip_start + c.clip_duration : getStart(c) + 30);
}
function getPeak(c: HighlightCandidate): number {
  return c.peak_time ?? (getStart(c) + getEnd(c)) / 2;
}
function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function StudioClient() {
  const [mode, setMode] = useState<StudioMode>("twitch");

  const [vodUrl, setVodUrl] = useState("");
  const [videoPath, setVideoPath] = useState("");
  const [logPath, setLogPath] = useState("");

  // Advanced analysis params
  const [windowSec, setWindowSec] = useState(30);
  const [topN, setTopN] = useState(10);
  const [minGap, setMinGap] = useState(45);
  const [keywordsText, setKeywordsText] = useState("");
  const [step, setStep] = useState(10);
  const [clipDuration, setClipDuration] = useState(30);
  const [clipOffset, setClipOffset] = useState(10);
  const [keywordWeight, setKeywordWeight] = useState(2.0);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [videoId, setVideoId] = useState<string | null>(null);
  const [vodTitle, setVodTitle] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<HighlightCandidate[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<HighlightCandidate | null>(null);
  const [playerStartTime, setPlayerStartTime] = useState(0);
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>(["Ready"]);
  const [diagnostic, setDiagnostic] = useState<SseResult["diagnostic"] | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Export state
  const [exportedIds, setExportedIds] = useState<Set<string | number>>(new Set());
  const [exportingId, setExportingId] = useState<string | number | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [batchExportStatus, setBatchExportStatus] = useState<ExportStatus>("idle");

  // Player refs
  const localPlayerRef = useRef<LocalVideoPlayerHandle>(null);
  const twitchPlayerRef = useRef<TwitchVodPlayerHandle>(null);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-99), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const canExport = mode === "local" && !!videoPath.trim();

  // Compute maxTime for timeline graph
  const maxTime = useMemo(() => {
    if (timeline.length > 0) {
      return Math.max(...timeline.map((t) => t.end));
    }
    if (candidates.length > 0) {
      return Math.max(...candidates.map((c) => getEnd(c)));
    }
    return videoDuration || 0;
  }, [timeline, candidates, videoDuration]);

  // Seek helper - updates player state
  const seekTo = useCallback((time: number) => {
    const clamped = Math.max(0, time);
    setPlayerStartTime(clamped);
    setPlayerReloadKey((v) => v + 1);
    setCurrentTime(clamped);
  }, []);

  const handleSelectCandidate = useCallback((candidate: HighlightCandidate) => {
    const seekTime = getCandidateSeekTime(candidate);
    if (seekTime === null) {
      setErrorMessage("この候補には有効な開始時間がありません");
      addLog("候補の時刻が無効なため移動できませんでした");
      return;
    }
    setSelectedCandidate(candidate);
    seekTo(seekTime);
    setErrorMessage(null);
    addLog(`候補 #${candidate.rank} を選択: ${formatTimecode(seekTime)}`);
  }, [addLog, seekTo]);

  const handleEditCandidate = useCallback((candidate: HighlightCandidate) => {
    handleSelectCandidate(candidate);
    addLog(`候補 #${candidate.rank} を編集中 (範囲を調整してください)`);
  }, [addLog, handleSelectCandidate]);

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
    setExportedIds(new Set());
    setExportStatus("idle");
    setBatchExportStatus("idle");
    seekTo(0);
    setErrorMessage(null);
    addLog(`VOD loaded: v${id}`);
  }, [vodUrl, addLog, seekTo]);

  const handleCancel = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsAnalyzing(false);
      setProgress(0);
      setProgressLabel("");
      addLog("分析をキャンセルしました");
    }
  }, [abortController, addLog]);

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
            setDiagnostic(event.diagnostic ?? null);
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

    const controller = new AbortController();
    setAbortController(controller);
    setIsAnalyzing(true);
    setProgress(0);
    setProgressLabel("");
    setErrorMessage(null);
    setCandidates([]);
    setTimeline([]);
    setSelectedCandidate(null);
    setExportedIds(new Set());
    setExportStatus("idle");
    setBatchExportStatus("idle");
    setDiagnostic(null);
    addLog("分析を開始...");

    try {
      const endpoint = mode === "twitch" ? "/api/studio/analyze-vod" : "/api/studio/analyze-local";
      const body = mode === "twitch"
        ? {
            vod_url: vodUrl,
            top_n: topN,
            window: windowSec,
            min_gap: minGap,
            step,
            clip_duration: clipDuration,
            clip_offset: clipOffset,
            keyword_weight: keywordWeight,
            keywords: keywordsText.trim() || undefined,
          }
        : {
            video_path: videoPath,
            log_path: logPath,
            top_n: topN,
            window: windowSec,
            min_gap: minGap,
            step,
            clip_duration: clipDuration,
            clip_offset: clipOffset,
            keyword_weight: keywordWeight,
            keywords: keywordsText.trim() || undefined,
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      await readStream(res);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        addLog("分析がキャンセルされました");
      } else {
        const msg = e instanceof Error ? e.message : "分析に失敗しました";
        setErrorMessage(msg);
        addLog(`エラー: ${msg}`);
      }
    } finally {
      setIsAnalyzing(false);
      setProgress(0);
      setProgressLabel("");
      setAbortController(null);
    }
  }, [mode, videoId, vodUrl, videoPath, logPath, topN, windowSec, minGap, keywordsText, step, clipDuration, clipOffset, keywordWeight, readStream, addLog]);

  // ─── Export functions ─────────────────────────────────────────────────────

  const exportCandidate = useCallback(async (candidate: HighlightCandidate) => {
    if (!canExport) {
      setErrorMessage("MP4 書き出しにはローカル動画ファイルが必要です");
      return;
    }
    const id = candidate.id ?? candidate.rank;
    setExportingId(id);
    setExportStatus("exporting");
    addLog(`候補 #${candidate.rank} の書き出しを開始...`);

    try {
      const start = getStart(candidate);
      const duration = (getEnd(candidate) - getStart(candidate)) || candidate.clip_duration || 30;
      const result = await createStudioClip({
        inputPath: videoPath,
        candidateId: `rank-${candidate.rank}`,
        variantId: "default",
        start: formatTimecode(start),
        duration: formatTimecode(duration),
        mode: "reencode",
      });
      addLog(`✓ 書き出し完了: ${result.outputPath}`);
      setExportedIds((prev) => new Set(prev).add(id));
      setExportStatus("exported");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "書き出しに失敗しました";
      setErrorMessage(msg);
      addLog(`✗ 書き出し失敗: ${msg}`);
      setExportStatus("error");
    } finally {
      setExportingId(null);
    }
  }, [canExport, videoPath, addLog]);

  const exportTop5 = useCallback(async () => {
    if (!canExport) {
      setErrorMessage("MP4 書き出しにはローカル動画ファイルが必要です");
      return;
    }
    if (candidates.length === 0) return;

    setBatchExportStatus("exporting");
    addLog(`Top 5 候補の一括書き出しを開始 (${Math.min(5, candidates.length)}件)...`);

    try {
      const top5 = candidates.slice(0, 5);
      const result = await batchCreateStudioClips(videoPath, top5, { mode: "reencode" });
      const newExported = new Set<string | number>(exportedIds);
      top5.forEach((c) => newExported.add(c.id ?? c.rank));
      setExportedIds(newExported);
      addLog(`✓ 一括書き出し完了: ${result.clips.length}件成功, ${result.failed.length}件失敗`);
      if (result.failed.length > 0) {
        result.failed.forEach((f) => addLog(`  ✗ ${f.candidateId}: ${f.error}`));
      }
      setBatchExportStatus(result.failed.length === 0 ? "exported" : "error");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "一括書き出しに失敗しました";
      setErrorMessage(msg);
      addLog(`✗ 一括書き出し失敗: ${msg}`);
      setBatchExportStatus("error");
    }
  }, [canExport, candidates, videoPath, exportedIds, addLog]);

  // ─── Action panel handlers ────────────────────────────────────────────────

  const handleJumpStart = useCallback(() => {
    if (!selectedCandidate) return;
    seekTo(getStart(selectedCandidate));
    addLog(`▶ Start: ${formatTimecode(getStart(selectedCandidate))}`);
  }, [selectedCandidate, seekTo, addLog]);

  const handleJumpPeak = useCallback(() => {
    if (!selectedCandidate) return;
    seekTo(getPeak(selectedCandidate));
    addLog(`⭐ Peak: ${formatTimecode(getPeak(selectedCandidate))}`);
  }, [selectedCandidate, seekTo, addLog]);

  const handleJumpEnd = useCallback(() => {
    if (!selectedCandidate) return;
    seekTo(Math.max(0, getEnd(selectedCandidate) - 1));
    addLog(`⏭ End: ${formatTimecode(getEnd(selectedCandidate))}`);
  }, [selectedCandidate, seekTo, addLog]);

  const handlePreviewRange = useCallback(() => {
    if (!selectedCandidate) return;
    seekTo(getStart(selectedCandidate));
    addLog(`▶ Preview: ${formatTimecode(getStart(selectedCandidate))} から再生`);
  }, [selectedCandidate, seekTo, addLog]);

  const handleSetStartFromCurrent = useCallback(() => {
    if (!selectedCandidate) return;
    const newStart = currentTime;
    const end = getEnd(selectedCandidate);
    const updated: HighlightCandidate = {
      ...selectedCandidate,
      clip_start: newStart,
      start: newStart,
      clip_duration: Math.max(1, end - newStart),
    };
    setSelectedCandidate(updated);
    setCandidates((prev) => prev.map((c) => (c.rank === selectedCandidate.rank ? updated : c)));
    addLog(`Start を ${formatTimecode(newStart)} に設定`);
  }, [selectedCandidate, currentTime, addLog]);

  const handleSetEndFromCurrent = useCallback(() => {
    if (!selectedCandidate) return;
    const newEnd = currentTime;
    const start = getStart(selectedCandidate);
    const updated: HighlightCandidate = {
      ...selectedCandidate,
      end: newEnd,
      clip_duration: Math.max(1, newEnd - start),
    };
    setSelectedCandidate(updated);
    setCandidates((prev) => prev.map((c) => (c.rank === selectedCandidate.rank ? updated : c)));
    addLog(`End を ${formatTimecode(newEnd)} に設定`);
  }, [selectedCandidate, currentTime, addLog]);

  const handleSelectLocalVideo = useCallback(() => {
    setMode("local");
    addLog("Local File モードに切り替えました");
  }, [addLog]);

  // ─── Time tracking ────────────────────────────────────────────────────────

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleDurationChange = useCallback((duration: number) => {
    if (Number.isFinite(duration) && duration > 0) {
      setVideoDuration(duration);
    }
  }, []);

  // Get current time from player (for "Set from current" buttons)
  const liveCurrentTime = useMemo(() => {
    if (mode === "local" && localPlayerRef.current) {
      return localPlayerRef.current.getCurrentTime();
    }
    return currentTime;
  }, [mode, currentTime]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const hasLocalVideo = canExport;

  return (
    <div className="min-h-screen flex flex-col bg-[#050816]">
      {/* Header: only essential controls */}
      <header className="bg-slate-900/80 border-b border-slate-700/50 px-5 py-2.5 flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-violet-300 whitespace-nowrap">Studio</h1>

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
              className="px-2.5 py-1.5 text-xs rounded bg-slate-700/60 border border-slate-600 text-slate-300 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">Load</button>
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

        <div className="flex gap-1.5 ml-auto">
          {isAnalyzing ? (
            <button onClick={handleCancel}
              className="px-3 py-1.5 text-xs rounded bg-red-600 text-white hover:brightness-110">
              キャンセル
            </button>
          ) : (
            <button onClick={handleAnalyze}
              disabled={mode === "twitch" && !videoId}
              className="px-3 py-1.5 text-xs rounded bg-violet-600 text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">
              🔍 分析開始
            </button>
          )}
        </div>
      </header>

      {/* Advanced Settings (collapsible) */}
      <AdvancedSettings
        isOpen={advancedOpen}
        onToggle={() => setAdvancedOpen((v) => !v)}
        windowSec={windowSec} setWindowSec={setWindowSec}
        step={step} setStep={setStep}
        topN={topN} setTopN={setTopN}
        minGap={minGap} setMinGap={setMinGap}
        clipDuration={clipDuration} setClipDuration={setClipDuration}
        clipOffset={clipOffset} setClipOffset={setClipOffset}
        keywordWeight={keywordWeight} setKeywordWeight={setKeywordWeight}
        keywordsText={keywordsText} setKeywordsText={setKeywordsText}
      />

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
        <div className="bg-slate-800/50 border-b border-slate-700/30 px-5 py-1 text-xs text-slate-400 flex justify-between items-center">
          <span>{vodTitle} · {candidates.length} candidates · {timeline.length} timeline buckets</span>
          {diagnostic && (
            <span className="text-slate-500">
              {diagnostic.fetched_chat_count} chat → {diagnostic.final_candidate_count} candidates
              (threshold={diagnostic.threshold}, min_gap={diagnostic.min_gap}s)
            </span>
          )}
        </div>
      )}

      {/* Main content */}
      <div className="flex gap-3 px-5 pt-3 flex-1 min-h-0">
        <div className="flex-[3] flex flex-col gap-2.5 min-w-0">
          {mode === "twitch" && videoId ? (
            <TwitchVodPlayer
              ref={twitchPlayerRef}
              videoId={videoId}
              startTimeSeconds={playerStartTime}
              reloadKey={playerReloadKey}
              onTimeUpdate={handleTimeUpdate}
            />
          ) : mode === "local" && videoPath.trim() ? (
            <LocalVideoPlayer
              ref={localPlayerRef}
              videoPath={videoPath}
              startTimeSeconds={playerStartTime}
              onTimeUpdate={handleTimeUpdate}
              onDurationChange={handleDurationChange}
            />
          ) : (
            <div className="glass-panel rounded-lg p-3 flex items-center justify-center h-[200px]">
              <div className="text-xs text-slate-500">
                {mode === "twitch" ? 'Twitch VOD URL を入力して "Load" をクリック' : "ローカル動画ファイルのパスを入力"}
              </div>
            </div>
          )}

          {/* Timeline Graph (interactive) */}
          {timeline.length > 0 && (
            <TimelineGraph
              timeline={timeline}
              candidates={candidates}
              selectedCandidate={selectedCandidate}
              currentTime={currentTime}
              duration={videoDuration}
              maxTime={maxTime}
              onSeek={seekTo}
            />
          )}

          {/* Clip action panel for selected candidate */}
          {selectedCandidate && (
            <ClipActionPanel
              candidate={selectedCandidate}
              hasLocalVideo={hasLocalVideo}
              localVideoPath={videoPath || null}
              currentTime={liveCurrentTime}
              isPlayerAvailable={mode === "local" || (mode === "twitch" && !!videoId)}
              singleExportStatus={exportStatus}
              batchExportStatus={batchExportStatus}
              onJumpStart={handleJumpStart}
              onJumpPeak={handleJumpPeak}
              onJumpEnd={handleJumpEnd}
              onPreviewRange={handlePreviewRange}
              onSetStartFromCurrent={handleSetStartFromCurrent}
              onSetEndFromCurrent={handleSetEndFromCurrent}
              onExportThisClip={() => exportCandidate(selectedCandidate)}
              onExportTop5={exportTop5}
              onSelectLocalVideo={handleSelectLocalVideo}
            />
          )}

          {/* Detailed reasons (collapsible / on-demand) */}
          {selectedCandidate && (
            <CandidateDetails candidate={selectedCandidate} />
          )}

          {/* Export state hint for Twitch mode */}
          {mode === "twitch" && candidates.length > 0 && (
            <div className="glass-panel rounded-lg p-2 text-[11px] text-amber-400/80 flex items-center gap-2">
              <span>ℹ</span>
              <span>MP4 書き出しにはローカル動画ファイルが必要です。上の「ローカル動画を指定 →」から切り替えるか、Local File モードで再実行してください。</span>
            </div>
          )}
        </div>

        <div className="flex-[2] flex flex-col min-w-[280px] max-w-[400px] gap-2">
          {/* Diagnostic panel */}
          {diagnostic && (
            <details className="glass-panel rounded-lg p-2.5 text-[10px] text-slate-500" open>
              <summary className="text-slate-400 cursor-pointer font-semibold text-[11px] uppercase tracking-wider mb-1">分析診断</summary>
              <div className="grid grid-cols-2 gap-1 mt-1">
                <div>取得チャット: <span className="text-slate-300">{diagnostic.fetched_chat_count.toLocaleString()}</span></div>
                <div>タイムライン: <span className="text-slate-300">{diagnostic.timeline_count}</span></div>
                <div>生候補数: <span className="text-slate-300">{diagnostic.raw_candidate_count}</span></div>
                <div>しきい値: <span className="text-slate-300">{diagnostic.threshold}</span></div>
                <div>しきい値通過: <span className="text-slate-300">{diagnostic.candidates_after_threshold}</span></div>
                <div>間引き後: <span className="text-slate-300">{diagnostic.candidates_after_min_gap}</span></div>
                <div>最終候補: <span className="text-slate-300 font-medium text-violet-300">{diagnostic.final_candidate_count}</span></div>
                <div>ウィンドウ: <span className="text-slate-300">{diagnostic.window}s</span></div>
              </div>
            </details>
          )}

          <CandidateList
            candidates={candidates}
            selectedCandidateId={selectedCandidate?.id ?? selectedCandidate?.rank ?? null}
            exportedCandidateIds={exportedIds}
            exportingCandidateId={exportingId}
            canExport={canExport}
            onSelectCandidate={handleSelectCandidate}
            onEditCandidate={handleEditCandidate}
            onExportCandidate={exportCandidate}
          />
        </div>
      </div>

      <div className="px-5 pb-3 pt-2">
        <LogPanel logs={logs} />
      </div>
    </div>
  );
}
