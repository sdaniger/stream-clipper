import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  analyzeHighlights, createClip, batchCreateClips, createShort,
  transcribeAudio, listOutputFiles, fetchTwitchChat,
  type HighlightCandidate, type AnalyzeResponse, type OutputFileEntry,
} from "./api";
import VideoPreview from "./components/VideoPreview";
import HighlightChart from "./components/HighlightChart";
import HighlightRanking from "./components/HighlightRanking";
import HighlightEditor from "./components/HighlightEditor";
import LogPanel from "./components/LogPanel";

export default function App() {
  // ---- Input state ----
  const [videoPath, setVideoPath] = useState("");
  const [logPath, setLogPath] = useState("");
  const [vodUrl, setVodUrl] = useState("");
  const [windowSec, setWindowSec] = useState(30);
  const [topN, setTopN] = useState(10);
  const [minGap, setMinGap] = useState(45);
  const [keywordsText, setKeywordsText] = useState("");
  const [encoder, setEncoder] = useState("auto");
  const [clipMode, setClipMode] = useState("reencode");

  // ---- UI state ----
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

  // ---- Transcription state ----
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);

  // ---- Output files state ----
  const [outputFiles, setOutputFiles] = useState<OutputFileEntry[]>([]);
  const [outputPath, setOutputPath] = useState("");

  const [logs, setLogs] = useState<string[]>(["Ready — provide video path + chat log (or VOD URL) to start"]);

  const videoRef = useRef<HTMLVideoElement>(null);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-99), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const seekVideo = useCallback((t: number) => {
    setCurrentTime(t);
  }, []);

  // ---- Analysis ----
  const handleAnalyze = useCallback(async () => {
    if (!videoPath.trim()) { setError("Video path is required"); return; }

    const useVodMode = vodUrl.trim().length > 0;
    if (!useVodMode && !logPath.trim()) { setError("Chat log path or VOD URL is required"); return; }

    setError(null);
    setResult(null);
    setSelectedRank(null);
    setGeneratedFiles([]);
    setTranscriptText(null);
    setExportProgress("");
    setIsAnalyzing(true);

    const kwList = keywordsText.split(",").map((s) => s.trim()).filter(Boolean);

    if (useVodMode) {
      addLog("Fetching chat via shared server API...");
    } else {
      addLog("Starting analysis...");
    }

    try {
      const res = await analyzeHighlights(
        videoPath,
        useVodMode ? null : logPath,
        useVodMode ? vodUrl : null,
        {
          window: windowSec, top: topN, min_gap: minGap,
          keywords_list: kwList.length > 0 ? kwList : undefined,
          keyword_weight: 2.0, clip_padding: 5,
        }
      );
      setResult(res);
      addLog(`Analysis complete: ${res.highlights.length} candidates found`);

      if (res.highlights.length > 0) {
        selectHighlight(res.highlights[0].rank, res.highlights);
      } else {
        addLog("No highlight candidates detected (chat may be too quiet or sparse)");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      setError(msg);
      addLog(`Error: ${msg}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [videoPath, logPath, vodUrl, windowSec, topN, minGap, keywordsText, addLog]);

  // ---- Select highlight ----
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

  // ---- Chart click seek ----
  const handleChartClick = useCallback((nextState: Record<string, unknown>) => {
    const label = nextState?.activeLabel;
    const t = typeof label === "number" ? label : typeof label === "string" ? parseFloat(label) : undefined;
    if (t != null && !Number.isNaN(t)) {
      seekVideo(t);
      setCurrentTime(t);
    }
  }, [seekVideo]);

  // ---- Video time sync ----
  const handleTimeUpdate = useCallback((t: number) => {
    setCurrentTime(t);
  }, []);

  const handleSeek = useCallback((t: number) => {
    setCurrentTime(t);
  }, []);

  // ---- Preview play ----
  const handlePreviewPlay = useCallback(() => {
    if (isPreviewing) {
      setIsPreviewing(false);
      return;
    }
    setIsPreviewing(true);
    addLog(`Preview playing: ${editedStart.toFixed(1)}s – ${editedEnd.toFixed(1)}s`);
  }, [isPreviewing, editedStart, editedEnd, addLog]);

  // ---- Preview auto-stop ----
  useEffect(() => {
    if (!isPreviewing) return;
    const video = videoRef.current;
    if (!video) return;
    const check = () => {
      if (video.currentTime >= editedEnd || video.paused) {
        setIsPreviewing(false);
      }
    };
    video.addEventListener("timeupdate", check);
    video.currentTime = editedStart;
    video.play().catch(() => setIsPreviewing(false));
    return () => {
      video.removeEventListener("timeupdate", check);
      video.pause();
    };
  }, [isPreviewing, editedStart, editedEnd]);

  // ---- Set start/end from current time ----
  const handleSetStartToCurrent = useCallback(() => {
    setEditedStart(currentTime);
    addLog(`Start set to ${currentTime.toFixed(1)}s`);
  }, [currentTime, addLog]);

  const handleSetEndToCurrent = useCallback(() => {
    setEditedEnd(currentTime);
    addLog(`End set to ${currentTime.toFixed(1)}s`);
  }, [currentTime, addLog]);

  // ---- Toggle play/pause ----
  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  // ---- Export single clip ----
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
      setError(msg);
      addLog(`Error: ${msg}`);
    } finally {
      setIsGenerating(false);
    }
  }, [selectedRank, result, videoPath, editedStart, editedEnd, encoder, clipMode, addLog]);

  // ---- Batch export top N ----
  const handleBatchExport = useCallback(async () => {
    if (!result?.highlights.length) return;
    const count = Math.min(topN, result.highlights.length);
    setIsGenerating(true);
    setExportProgress(`0/${count}`);
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
      setError(msg);
      addLog(`Error: ${msg}`);
    } finally {
      setIsGenerating(false);
      setExportProgress("");
    }
  }, [result, videoPath, topN, encoder, clipMode, addLog]);

  // ---- Create Short ----
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
      setError(msg);
      addLog(`Error: ${msg}`);
    } finally {
      setIsGenerating(false);
    }
  }, [videoPath, selectedRank, editedStart, editedEnd, addLog]);

  // ---- Transcribe ----
  const handleTranscribe = useCallback(async () => {
    if (!videoPath.trim()) { setError("Video path required"); return; }
    setIsTranscribing(true);
    setTranscriptText(null);
    addLog("Starting transcription (GPU)...");
    try {
      const data = await transcribeAudio(videoPath);
      setTranscriptText(data.text);
      addLog(`Transcription complete: ${data.segments?.length || 0} segments, ${(data.duration_seconds || 0).toFixed(1)}s`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Transcription failed";
      setError(msg);
      addLog(`Error: ${msg}`);
    } finally {
      setIsTranscribing(false);
    }
  }, [videoPath, addLog]);

  // ---- Output files ----
  const refreshOutputFiles = useCallback(async () => {
    try {
      const res = await listOutputFiles("output");
      setOutputFiles(res.files);
      setOutputPath(res.path);
    } catch {
      // silently ignore
    }
  }, []);

  const handleOpenOutputFolder = useCallback(async () => {
    await refreshOutputFiles();
    addLog(`Output folder: ${outputPath || "output/"}`);
  }, [refreshOutputFiles, outputPath, addLog]);

  // ---- Drag & drop / paste ----
  const handlePaste = useCallback((type: "video" | "log") => async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (type === "video") setVideoPath(text.trim());
      else setLogPath(text.trim());
    } catch {
      addLog("Cannot read clipboard (permission denied)");
    }
  }, [addLog]);

  // ---- Save JSON ----
  const handleSaveJson = useCallback(() => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.highlights, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "highlights.json"; a.click();
    URL.revokeObjectURL(url);
    addLog("Saved highlights.json");
  }, [result, addLog]);

  // ---- Save CSV ----
  const handleSaveCsv = useCallback(() => {
    if (!result) return;
    const headers = ["start", "end", "score", "chat_count", "keyword_hits", "matched_keywords"];
    const rows = result.timeline.map((t) =>
      [t.start, t.end, t.score, t.chat_count, t.keyword_hits, t.matched_keywords.join(";")].join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "timeline.csv"; a.click();
    URL.revokeObjectURL(url);
    addLog("Saved timeline.csv");
  }, [result, addLog]);

  // ---- Selected highlight ----
  const selectedHighlight = selectedRank != null
    ? result?.highlights.find((h) => h.rank === selectedRank) ?? null
    : null;

  // ---- Render ----
  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1 className="app-title">Stream Clipper Studio</h1>

        <div className="header-inputs">
          <div className="header-field">
            <label className="field-label">Video</label>
            <input value={videoPath} onChange={(e) => setVideoPath(e.target.value)}
              placeholder="/path/to/video.mp4" className="input input-sm" style={{ width: 240 }} />
          </div>
          <div className="header-field">
            <label className="field-label">Chat Log</label>
            <input value={logPath} onChange={(e) => setLogPath(e.target.value)}
              placeholder="/path/to/chat.json" className="input input-sm" style={{ width: 240 }} />
          </div>
          <span className="field-label" style={{ alignSelf: "center", opacity: 0.6 }}>or</span>
          <div className="header-field">
            <label className="field-label">VOD URL</label>
            <input value={vodUrl} onChange={(e) => setVodUrl(e.target.value)}
              placeholder="https://twitch.tv/videos/123456789" className="input input-sm" style={{ width: 280 }} />
          </div>
        </div>

        <div className="header-actions">
          <div className="header-field" style={{ width: 60 }}>
            <label className="field-label">Window</label>
            <input type="number" value={windowSec} min={10} step={5}
              onChange={(e) => setWindowSec(Number(e.target.value) || 30)} className="input input-sm" />
          </div>
          <div className="header-field" style={{ width: 50 }}>
            <label className="field-label">Top N</label>
            <input type="number" value={topN} min={1} step={1}
              onChange={(e) => setTopN(Number(e.target.value) || 10)} className="input input-sm" />
          </div>
          <div className="header-field" style={{ width: 60 }}>
            <label className="field-label">Min gap</label>
            <input type="number" value={minGap} min={0} step={5}
              onChange={(e) => setMinGap(Number(e.target.value) || 45)} className="input input-sm" />
          </div>
        </div>

        <div className="header-buttons">
          <button className="btn btn-primary" onClick={handleAnalyze} disabled={isAnalyzing}>
            {isAnalyzing ? "⏳ Analyzing..." : "🔍 Analyze"}
          </button>
          <button className="btn btn-accent" onClick={handleBatchExport}
            disabled={!result?.highlights.length || isGenerating}>
            {isGenerating ? `⏳ ${exportProgress || "..."}` : `📦 Top ${topN} Export`}
          </button>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="error-bar">
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Main content */}
      <div className="main-layout">
        {/* Left column: video + editor */}
        <div className="main-left">
          <VideoPreview
            videoPath={videoPath}
            currentTime={currentTime}
            editedStart={editedStart}
            editedEnd={editedEnd}
            isPreviewing={isPreviewing}
            onTimeUpdate={handleTimeUpdate}
            onSeek={handleSeek}
            onPreviewPlay={handlePreviewPlay}
            onSetStartToCurrent={handleSetStartToCurrent}
            onSetEndToCurrent={handleSetEndToCurrent}
            onTogglePlay={handleTogglePlay}
          />
          <HighlightEditor
            highlight={selectedHighlight}
            editedStart={editedStart}
            editedEnd={editedEnd}
            isGenerating={isGenerating}
            encoder={encoder}
            clipMode={clipMode}
            onStartChange={setEditedStart}
            onEndChange={setEditedEnd}
            onEncoderChange={setEncoder}
            onClipModeChange={setClipMode}
            onSetStartToCurrent={handleSetStartToCurrent}
            onSetEndToCurrent={handleSetEndToCurrent}
            onPreviewPlay={handlePreviewPlay}
            onExport={() => handleExportClip()}
            onTranscribe={handleTranscribe}
            isTranscribing={isTranscribing}
            transcriptText={transcriptText}
          />
        </div>

        {/* Right column: ranking */}
        <div className="main-right">
          <HighlightRanking
            highlights={result?.highlights ?? []}
            selectedRank={selectedRank}
            generatedFiles={generatedFiles}
            onSelect={handleSelectHighlight}
            onExport={handleExportClip}
            onCreateShort={handleCreateShort}
          />
        </div>
      </div>

      {/* Chart */}
      <div className="chart-area">
        <HighlightChart
          timeline={result?.timeline ?? []}
          highlights={result?.highlights ?? []}
          selectedRank={selectedRank}
          currentTime={currentTime}
          onChartClick={handleChartClick as any}
        />
      </div>

      {/* Footer: Log + Export + Output files */}
      <div className="footer-area">
        <div className="footer-left">
          <LogPanel logs={logs} />
        </div>
        <div className="footer-right">
          <div className="export-actions">
            <button className="btn btn-xs btn-ghost" onClick={handleSaveJson} disabled={!result}>
              💾 JSON
            </button>
            <button className="btn btn-xs btn-ghost" onClick={handleSaveCsv} disabled={!result}>
              📊 CSV
            </button>
            <button className="btn btn-xs btn-ghost" onClick={handleOpenOutputFolder}>
              📁 Output
            </button>
            {generatedFiles.length > 0 && (
              <div className="generated-badge">
                🎬 {generatedFiles.length} files
              </div>
            )}
          </div>
          {outputFiles.length > 0 && (
            <div className="output-files-bar">
              {outputFiles.slice(-5).map((f) => (
                <span key={f.name} className="output-file-chip">{f.name}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
