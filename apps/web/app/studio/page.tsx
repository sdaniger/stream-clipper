"use client";
import React, { useState, useCallback, useEffect } from "react";
import {
  analyzeHighlights, createClip, batchCreateClips, createShort,
  transcribeAudio, listOutputFiles,
  type HighlightCandidate, type AnalyzeResponse, type OutputFileEntry,
} from "@/lib/studio-api";
import VideoPreview from "@/components/studio/VideoPreview";
import HighlightChart from "@/components/studio/HighlightChart";
import HighlightRanking from "@/components/studio/HighlightRanking";
import HighlightEditor from "@/components/studio/HighlightEditor";
import LogPanel from "@/components/studio/LogPanel";

export default function StudioPage() {
  const [videoPath, setVideoPath] = useState("");
  const [logPath, setLogPath] = useState("");
  const [windowSec, setWindowSec] = useState(30);
  const [topN, setTopN] = useState(10);
  const [minGap, setMinGap] = useState(45);
  const [keywordsText, setKeywordsText] = useState("");
  const [encoder, setEncoder] = useState("auto");
  const [clipMode, setClipMode] = useState("reencode");

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectedRank, setSelectedRank] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [editedStart, setEditedStart] = useState(0);
  const [editedEnd, setEditedEnd] = useState(30);
  const [generatedFiles, setGeneratedFiles] = useState<string[]>([]);
  const [exportProgress, setExportProgress] = useState("");

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);

  const [outputFiles, setOutputFiles] = useState<OutputFileEntry[]>([]);
  const [outputPath, setOutputPath] = useState("");

  const [logs, setLogs] = useState<string[]>(["Ready — select video and chat log to start"]);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-99), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const seekVideo = useCallback((t: number) => {
    setCurrentTime(t);
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!videoPath.trim()) { setError("Video path is required"); return; }
    if (!logPath.trim()) { setError("Chat log path is required"); return; }
    setError(null); setResult(null); setSelectedRank(null);
    setGeneratedFiles([]); setTranscriptText(null); setExportProgress("");
    setIsAnalyzing(true);
    addLog("Starting analysis...");
    try {
      const kwList = keywordsText.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await analyzeHighlights(videoPath, logPath, {
        window: windowSec, top: topN, min_gap: minGap,
        keywords_list: kwList.length > 0 ? kwList : undefined,
        keyword_weight: 2.0, clip_padding: 5,
      });
      setResult(res);
      addLog(`Analysis complete: ${res.highlights.length} candidates found`);
      if (res.highlights.length > 0) selectHighlight(res.highlights[0].rank, res.highlights);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      setError(msg);
      addLog(`Error: ${msg}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [videoPath, logPath, windowSec, topN, minGap, keywordsText, addLog]);

  const selectHighlight = useCallback((rank: number, highlights?: HighlightCandidate[]) => {
    const list = highlights || result?.highlights;
    if (!list) return;
    const h = list.find((c) => c.rank === rank);
    if (!h) return;
    setSelectedRank(rank);
    setEditedStart(h.clip_start);
    setEditedEnd(h.clip_start + h.clip_duration);
    seekVideo(h.clip_start);
  }, [result, seekVideo]);

  const handleSelectHighlight = useCallback((rank: number) => {
    selectHighlight(rank);
  }, [selectHighlight]);

  const handleChartClick = useCallback((nextState: Record<string, unknown>) => {
    const label = nextState?.activeLabel;
    const t = typeof label === "number" ? label : typeof label === "string" ? parseFloat(label) : undefined;
    if (t != null && !Number.isNaN(t)) { seekVideo(t); setCurrentTime(t); }
  }, [seekVideo]);

  const handleTimeUpdate = useCallback((t: number) => { setCurrentTime(t); }, []);
  const handleSeek = useCallback((t: number) => { setCurrentTime(t); }, []);

  const handlePreviewPlay = useCallback(() => {
    setIsPreviewing((p) => !p);
    addLog(`Preview playing: ${editedStart.toFixed(1)}s – ${editedEnd.toFixed(1)}s`);
  }, [editedStart, editedEnd, addLog]);

  useEffect(() => {
    if (!isPreviewing) return;
    addLog("Preview active");
  }, [isPreviewing, addLog]);

  const handleSetStartToCurrent = useCallback(() => {
    setEditedStart(currentTime);
    addLog(`Start set to ${currentTime.toFixed(1)}s`);
  }, [currentTime, addLog]);

  const handleSetEndToCurrent = useCallback(() => {
    setEditedEnd(currentTime);
    addLog(`End set to ${currentTime.toFixed(1)}s`);
  }, [currentTime, addLog]);

  const handleTogglePlay = useCallback(() => {
    const video = document.querySelector("video");
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  const handleExportClip = useCallback(async (h?: HighlightCandidate) => {
    const target = h ?? (selectedRank != null ? result?.highlights.find((c) => c.rank === selectedRank) : null);
    if (!target) return;
    const st = selectedRank === target.rank ? editedStart : target.clip_start;
    const en = selectedRank === target.rank ? editedEnd : target.clip_start + target.clip_duration;
    const dur = Math.max(1, en - st);
    setIsGenerating(true);
    addLog(`Exporting clip #${target.rank} (${st.toFixed(1)}s – ${en.toFixed(1)}s, ${encoder}/${clipMode})...`);
    try {
      const res = await createClip(videoPath, st, dur, "output", target.rank, { encoder, mode: clipMode });
      setGeneratedFiles((prev) => [...prev, res.output_file]);
      addLog(`Exported: ${res.output_file}`);
      refreshOutputFiles();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Export failed";
      setError(msg); addLog(`Error: ${msg}`);
    } finally { setIsGenerating(false); }
  }, [selectedRank, result, videoPath, editedStart, editedEnd, encoder, clipMode, addLog]);

  const handleBatchExport = useCallback(async () => {
    if (!result?.highlights.length) return;
    const count = Math.min(topN, result.highlights.length);
    setIsGenerating(true); setExportProgress(`0/${count}`);
    addLog(`Batch exporting top ${count} clips (${encoder}/${clipMode})...`);
    try {
      const res = await batchCreateClips(videoPath, result.highlights.slice(0, count), "output", { encoder, mode: clipMode });
      const files = res.clips.filter((c) => c.success).map((c) => c.output_file);
      setGeneratedFiles((prev) => [...prev, ...files]);
      setExportProgress(`${files.length}/${count}`);
      addLog(`Exported ${files.length}/${count} clips`);
      refreshOutputFiles();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Batch export failed";
      setError(msg); addLog(`Error: ${msg}`);
    } finally { setIsGenerating(false); setExportProgress(""); }
  }, [result, videoPath, topN, encoder, clipMode, addLog]);

  const handleCreateShort = useCallback(async (h: HighlightCandidate) => {
    const st = selectedRank === h.rank ? editedStart : h.clip_start;
    const en = selectedRank === h.rank ? editedEnd : h.clip_start + h.clip_duration;
    const dur = Math.max(1, en - st);
    setIsGenerating(true);
    addLog(`Creating short video #${h.rank}...`);
    try {
      const res = await createShort(videoPath, st, dur, "output", h.rank);
      setGeneratedFiles((prev) => [...prev, res.output_file]);
      addLog(`Short created: ${res.output_file}`);
      refreshOutputFiles();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Short creation failed";
      setError(msg); addLog(`Error: ${msg}`);
    } finally { setIsGenerating(false); }
  }, [videoPath, selectedRank, editedStart, editedEnd, addLog]);

  const handleTranscribe = useCallback(async () => {
    if (!videoPath.trim()) { setError("Video path required"); return; }
    setIsTranscribing(true); setTranscriptText(null);
    addLog("Starting transcription (GPU)...");
    try {
      const data = await transcribeAudio(videoPath);
      setTranscriptText(data.text);
      addLog(`Transcription complete: ${data.segments?.length || 0} segments, ${(data.duration_seconds || 0).toFixed(1)}s`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Transcription failed";
      setError(msg); addLog(`Error: ${msg}`);
    } finally { setIsTranscribing(false); }
  }, [videoPath, addLog]);

  const refreshOutputFiles = useCallback(async () => {
    try { const res = await listOutputFiles("output"); setOutputFiles(res.files); setOutputPath(res.path); }
    catch { /* silent */ }
  }, []);

  const handleOpenOutputFolder = useCallback(async () => {
    await refreshOutputFiles();
    addLog(`Output folder: ${outputPath || "output/"}`);
  }, [refreshOutputFiles, outputPath, addLog]);

  const handleSaveJson = useCallback(() => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.highlights, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "highlights.json"; a.click();
    URL.revokeObjectURL(url);
    addLog("Saved highlights.json");
  }, [result, addLog]);

  const handleSaveCsv = useCallback(() => {
    if (!result) return;
    const headers = ["start", "end", "score", "chat_count", "keyword_hits", "matched_keywords"];
    const rows = result.timeline.map((t) =>
      [t.start, t.end, t.score, t.chat_count, t.keyword_hits, t.matched_keywords.join(";")].join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "timeline.csv"; a.click();
    URL.revokeObjectURL(url);
    addLog("Saved timeline.csv");
  }, [result, addLog]);

  const selectedHighlight = selectedRank != null
    ? result?.highlights.find((h) => h.rank === selectedRank) ?? null
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-[#050816]">
      {/* Header */}
      <header className="bg-slate-900/80 border-b border-slate-700/50 px-5 py-2.5 flex items-center gap-4 flex-wrap">
        <h1 className="text-lg font-bold text-violet-300 whitespace-nowrap">Stream Clipper Studio</h1>
        <div className="flex gap-2 items-end">
          <div className="flex flex-col gap-px">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Video</label>
            <input value={videoPath} onChange={(e) => setVideoPath(e.target.value)}
              placeholder="/path/to/video.mp4"
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500 w-60" />
          </div>
          <div className="flex flex-col gap-px">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Chat Log</label>
            <input value={logPath} onChange={(e) => setLogPath(e.target.value)}
              placeholder="/path/to/chat.json"
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500 w-60" />
          </div>
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
          <div className="flex flex-col gap-px w-32">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">Keywords</label>
            <input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)}
              placeholder="comma,separated"
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-violet-500" />
          </div>
        </div>
        <div className="flex gap-1.5 ml-auto">
          <button onClick={handleAnalyze} disabled={isAnalyzing}
            className="px-3 py-1.5 text-xs rounded bg-violet-600 text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">
            {isAnalyzing ? "⏳ Analyzing..." : "🔍 Analyze"}
          </button>
          <button onClick={handleBatchExport} disabled={!result?.highlights.length || isGenerating}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">
            {isGenerating ? `⏳ ${exportProgress || "..."}` : `📦 Top ${topN} Export`}
          </button>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="bg-red-950/80 border-b border-red-800 px-5 py-1.5 flex justify-between items-center text-red-300 text-xs">
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)} className="bg-none border-none text-red-300 cursor-pointer text-sm">✕</button>
        </div>
      )}

      {/* Main content */}
      <div className="flex gap-3 px-5 pt-3 flex-1 min-h-0">
        <div className="flex-[3] flex flex-col gap-2.5 min-w-0">
          <VideoPreview
            videoPath={videoPath} currentTime={currentTime}
            editedStart={editedStart} editedEnd={editedEnd}
            isPreviewing={isPreviewing}
            onTimeUpdate={handleTimeUpdate} onSeek={handleSeek}
            onPreviewPlay={handlePreviewPlay}
            onSetStartToCurrent={handleSetStartToCurrent}
            onSetEndToCurrent={handleSetEndToCurrent}
            onTogglePlay={handleTogglePlay} />
          <HighlightEditor
            highlight={selectedHighlight}
            editedStart={editedStart} editedEnd={editedEnd}
            isGenerating={isGenerating}
            encoder={encoder} clipMode={clipMode}
            onStartChange={setEditedStart} onEndChange={setEditedEnd}
            onEncoderChange={setEncoder} onClipModeChange={setClipMode}
            onSetStartToCurrent={handleSetStartToCurrent}
            onSetEndToCurrent={handleSetEndToCurrent}
            onPreviewPlay={handlePreviewPlay}
            onExport={() => handleExportClip()}
            onTranscribe={handleTranscribe}
            isTranscribing={isTranscribing}
            transcriptText={transcriptText} />
        </div>
        <div className="flex-[2] flex flex-col min-w-[280px] max-w-[400px]">
          <HighlightRanking
            highlights={result?.highlights ?? []}
            selectedRank={selectedRank}
            generatedFiles={generatedFiles}
            onSelect={handleSelectHighlight}
            onExport={handleExportClip}
            onCreateShort={handleCreateShort} />
        </div>
      </div>

      {/* Chart */}
      <div className="px-5 pt-2.5">
        <HighlightChart
          timeline={result?.timeline ?? []}
          highlights={result?.highlights ?? []}
          selectedRank={selectedRank}
          currentTime={currentTime}
          onChartClick={handleChartClick as any} />
      </div>

      {/* Footer */}
      <div className="flex gap-3 px-5 pb-3 pt-2">
        <div className="flex-[3]">
          <LogPanel logs={logs} />
        </div>
        <div className="flex-[2] flex items-start">
          <div className="flex gap-1.5 items-center flex-wrap">
            <button onClick={handleSaveJson} disabled={!result}
              className="px-2 py-0.5 text-[10px] rounded bg-slate-700/60 border border-slate-600 text-slate-300 hover:brightness-110 disabled:opacity-40">
              💾 JSON
            </button>
            <button onClick={handleSaveCsv} disabled={!result}
              className="px-2 py-0.5 text-[10px] rounded bg-slate-700/60 border border-slate-600 text-slate-300 hover:brightness-110 disabled:opacity-40">
              📊 CSV
            </button>
            <button onClick={handleOpenOutputFolder}
              className="px-2 py-0.5 text-[10px] rounded bg-slate-700/60 border border-slate-600 text-slate-300 hover:brightness-110">
              📁 Output
            </button>
            {generatedFiles.length > 0 && (
              <span className="text-[11px] text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-sm">
                🎬 {generatedFiles.length} files
              </span>
            )}
          </div>
          {outputFiles.length > 0 && (
            <div className="flex gap-1 ml-2 flex-wrap">
              {outputFiles.slice(-5).map((f) => (
                <span key={f.name} className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-sm">{f.name}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
