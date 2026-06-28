import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import {
  analyzeHighlights,
  createClip,
  batchCreateClips,
  type HighlightCandidate,
  type TimelineRow,
  type AnalyzeResponse,
} from "./api";

function App() {
  const [videoPath, setVideoPath] = useState("");
  const [logPath, setLogPath] = useState("");
  const [window, setWindow] = useState(30);
  const [top, setTop] = useState(5);
  const [minGap, setMinGap] = useState(30);
  const [keywords, setKeywords] = useState("");
  const [keywordWeight, setKeywordWeight] = useState(2.0);
  const [clipDuration, setClipDuration] = useState(30);
  const [clipPadding, setClipPadding] = useState(5);
  const [outputDir, setOutputDir] = useState("output");

  const [loading, setLoading] = useState(false);
  const [clipping, setClipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectedHighlight, setSelectedHighlight] = useState<HighlightCandidate | null>(null);
  const [logs, setLogs] = useState<string[]>(["Ready"]);
  const [generatedFiles, setGeneratedFiles] = useState<string[]>([]);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // ------- Analyze -------
  const handleAnalyze = useCallback(async () => {
    setError(null);
    setResult(null);
    setSelectedHighlight(null);
    setGeneratedFiles([]);

    if (!videoPath.trim()) {
      setError("Video path is required");
      return;
    }
    if (!logPath.trim()) {
      setError("Chat log path is required");
      return;
    }

    setLoading(true);
    addLog("Starting analysis...");
    try {
      const res = await analyzeHighlights(videoPath, logPath, {
        window,
        top,
        min_gap: minGap,
        keywords: keywords || undefined,
        keyword_weight: keywordWeight,
        clip_duration: clipDuration,
        clip_padding: clipPadding,
      });
      setResult(res);
      addLog(`Analysis complete: ${res.highlights.length} highlights found`);
      if (res.highlights.length > 0) {
        setSelectedHighlight(res.highlights[0]);
        setEditStart(String(res.highlights[0].clip_start));
        setEditEnd(String(res.highlights[0].clip_start + res.highlights[0].clip_duration));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      setError(msg);
      addLog(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [videoPath, logPath, window, top, minGap, keywords, keywordWeight, clipDuration, clipPadding, addLog]);

  // ------- Select highlight -------
  const handleSelectHighlight = useCallback((h: HighlightCandidate) => {
    setSelectedHighlight(h);
    setEditStart(String(h.clip_start));
    setEditEnd(String(h.clip_start + h.clip_duration));
    if (videoRef.current) {
      videoRef.current.currentTime = h.clip_start;
      videoRef.current.play().catch(() => {});
    }
  }, []);

  // ------- Seek video -------
  const handleChartClick = useCallback((data: { activeLabel?: number } | null) => {
    if (data?.activeLabel != null && videoRef.current) {
      videoRef.current.currentTime = data.activeLabel;
      videoRef.current.play().catch(() => {});
    }
  }, []);

  // ------- Generate single clip -------
  const handleGenerateClip = useCallback(async () => {
    if (!selectedHighlight) return;
    setClipping(true);
    addLog(`Generating clip #${selectedHighlight.rank}...`);
    try {
      const res = await createClip(
        videoPath,
        parseFloat(editStart) || selectedHighlight.clip_start,
        parseFloat(editEnd) - parseFloat(editStart) || selectedHighlight.clip_duration,
        outputDir,
        selectedHighlight.rank
      );
      setGeneratedFiles((prev) => [...prev, res.output_file]);
      addLog(`Clip generated: ${res.output_file}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Clip generation failed";
      setError(msg);
      addLog(`Error: ${msg}`);
    } finally {
      setClipping(false);
    }
  }, [selectedHighlight, videoPath, editStart, editEnd, outputDir, addLog]);

  // ------- Batch generate -------
  const handleBatchGenerate = useCallback(async () => {
    if (!result?.highlights.length) return;
    setClipping(true);
    addLog(`Batch generating ${result.highlights.length} clips...`);
    try {
      const res = await batchCreateClips(videoPath, result.highlights, outputDir);
      const files = res.clips.map((c) => c.output_file).filter(Boolean);
      setGeneratedFiles((prev) => [...prev, ...files]);
      addLog(`Generated ${files.length}/${result.highlights.length} clips`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Batch generation failed";
      setError(msg);
      addLog(`Error: ${msg}`);
    } finally {
      setClipping(false);
    }
  }, [result, videoPath, outputDir, addLog]);

  // ------- Save JSON -------
  const handleSaveJson = useCallback(() => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.highlights, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "highlights.json";
    a.click();
    URL.revokeObjectURL(url);
    addLog("Saved highlights.json");
  }, [result, addLog]);

  // ------- Save CSV -------
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
    a.href = url;
    a.download = "timeline.csv";
    a.click();
    URL.revokeObjectURL(url);
    addLog("Saved timeline.csv");
  }, [result, addLog]);

  // ------- Format helpers -------
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#0f0f11", color: "#e0e0e0", minHeight: "100vh" }}>
      {/* Header */}
      <header style={{ background: "#1a1a2e", padding: "12px 24px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#c084fc" }}>Stream Clipper GUI</h1>
        <span style={{ fontSize: 12, color: "#888" }}>Highlight detection &amp; clipping tool</span>
      </header>

      <div style={{ display: "flex", gap: 16, padding: 16, height: "calc(100vh - 56px)" }}>
        {/* Left column */}
        <div style={{ flex: 3, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {/* Video preview */}
          <div style={{ background: "#1c1c1f", borderRadius: 8, padding: 12, border: "1px solid #333" }}>
            <video
              ref={videoRef}
              controls
              style={{ width: "100%", maxHeight: 320, borderRadius: 4, background: "#000", display: "block" }}
            >
              {videoPath && <source src={`/api/gui/video?path=${encodeURIComponent(videoPath)}`} />}
            </video>
            {selectedHighlight && (
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <label>start:</label>
                <input value={editStart} onChange={(e) => setEditStart(e.target.value)}
                  style={{ width: 70, background: "#2a2a2e", border: "1px solid #444", color: "#eee", borderRadius: 4, padding: "2px 6px" }} />
                <label>end:</label>
                <input value={editEnd} onChange={(e) => setEditEnd(e.target.value)}
                  style={{ width: 70, background: "#2a2a2e", border: "1px solid #444", color: "#eee", borderRadius: 4, padding: "2px 6px" }} />
                <span style={{ color: "#888" }}>({fmt(parseFloat(editStart) || 0)} – {fmt(parseFloat(editEnd) || 0)})</span>
              </div>
            )}
          </div>

          {/* Graph */}
          <div style={{ background: "#1c1c1f", borderRadius: 8, padding: 12, border: "1px solid #333", flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#aaa" }}>Engagement Timeline</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={handleSaveJson} disabled={!result}
                  style={{ padding: "4px 12px", background: "#2a2a3e", border: "1px solid #555", borderRadius: 4, color: "#ccc", cursor: result ? "pointer" : "not-allowed", fontSize: 12 }}>
                  Save JSON
                </button>
                <button onClick={handleSaveCsv} disabled={!result}
                  style={{ padding: "4px 12px", background: "#2a2a3e", border: "1px solid #555", borderRadius: 4, color: "#ccc", cursor: result ? "pointer" : "not-allowed", fontSize: 12 }}>
                  Save CSV
                </button>
              </div>
            </div>
            {result?.timeline ? (
              <div onClick={() => handleChartClick(null)}>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={result.timeline} onClick={(e) => e?.activeLabel != null && handleChartClick({ activeLabel: Number(e.activeLabel) })}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis dataKey="start" tick={{ fill: "#888", fontSize: 10 }} tickFormatter={(v: number) => fmt(v)} />
                    <YAxis tick={{ fill: "#888", fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ background: "#222", border: "1px solid #444", borderRadius: 6, fontSize: 12 }}
                      labelFormatter={(v: number) => fmt(v)}
                    />
                    <Line type="monotone" dataKey="score" stroke="#c084fc" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#c084fc" }} />
                    {result.highlights.map((h) => (
                      <ReferenceArea key={h.rank} x1={h.start} x2={h.end} fill="rgba(192, 132, 252, 0.08)" />
                    ))}
                    {selectedHighlight && (
                      <>
                        <ReferenceLine x={selectedHighlight.start} stroke="#fbbf24" strokeDasharray="4 2" />
                        <ReferenceLine x={selectedHighlight.end} stroke="#fbbf24" strokeDasharray="4 2" />
                      </>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
                Run analysis to see timeline
              </div>
            )}
          </div>

          {/* Log panel */}
          <div style={{ background: "#1c1c1f", borderRadius: 8, padding: "4px 12px", border: "1px solid #333", maxHeight: 100, overflow: "auto" }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Log</div>
            {logs.map((log, i) => (
              <div key={i} style={{ fontSize: 11, color: "#777", fontFamily: "monospace", lineHeight: 1.4 }}>{log}</div>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 12, minWidth: 280, maxWidth: 420 }}>
          {/* Input panel */}
          <div style={{ background: "#1c1c1f", borderRadius: 8, padding: 12, border: "1px solid #333" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "#ccc" }}>Input</h2>
            <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 2 }}>Video file path</label>
            <input value={videoPath} onChange={(e) => setVideoPath(e.target.value)}
              placeholder="/path/to/video.mp4"
              style={{ width: "100%", background: "#2a2a2e", border: "1px solid #444", color: "#eee", borderRadius: 4, padding: "6px 8px", marginBottom: 6, fontSize: 13 }} />
            <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 2 }}>Chat log path (.json / .csv)</label>
            <input value={logPath} onChange={(e) => setLogPath(e.target.value)}
              placeholder="/path/to/chat_log.json"
              style={{ width: "100%", background: "#2a2a2e", border: "1px solid #444", color: "#eee", borderRadius: 4, padding: "6px 8px", marginBottom: 8, fontSize: 13 }} />

            <details style={{ marginBottom: 8 }}>
              <summary style={{ fontSize: 12, color: "#888", cursor: "pointer", userSelect: "none" }}>Advanced settings</summary>
              <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {[
                  { label: "Window (s)", val: window, set: setWindow, min: 10, step: 5 },
                  { label: "Top N", val: top, set: setTop, min: 1, step: 1 },
                  { label: "Min gap (s)", val: minGap, set: setMinGap, min: 0, step: 5 },
                  { label: "Clip duration (s)", val: clipDuration, set: setClipDuration, min: 5, step: 5 },
                  { label: "Clip padding (s)", val: clipPadding, set: setClipPadding, min: 0, step: 1 },
                  { label: "Keyword weight", val: keywordWeight, set: setKeywordWeight, min: 0, step: 0.5 },
                ].map((f) => (
                  <div key={f.label}>
                    <label style={{ fontSize: 11, color: "#888" }}>{f.label}</label>
                    <input type="number" value={f.val} min={f.min} step={f.step}
                      onChange={(e) => (f.set as React.Dispatch<React.SetStateAction<number>>)(parseFloat(e.target.value) || f.min)}
                      style={{ width: "100%", background: "#2a2a2e", border: "1px solid #444", color: "#eee", borderRadius: 4, padding: "3px 6px", fontSize: 12 }} />
                  </div>
                ))}
              </div>
              <label style={{ fontSize: 11, color: "#888", display: "block", marginTop: 4 }}>Custom keywords (comma-separated)</label>
              <input value={keywords} onChange={(e) => setKeywords(e.target.value)}
                placeholder="草,www,爆笑,lol"
                style={{ width: "100%", background: "#2a2a2e", border: "1px solid #444", color: "#eee", borderRadius: 4, padding: "3px 6px", fontSize: 12 }} />
              <label style={{ fontSize: 11, color: "#888", display: "block", marginTop: 4 }}>Output directory</label>
              <input value={outputDir} onChange={(e) => setOutputDir(e.target.value)}
                style={{ width: "100%", background: "#2a2a2e", border: "1px solid #444", color: "#eee", borderRadius: 4, padding: "3px 6px", fontSize: 12 }} />
            </details>

            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={handleAnalyze} disabled={loading}
                style={{ flex: 1, padding: "8px 0", background: loading ? "#444" : "#7c3aed", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontSize: 14 }}>
                {loading ? "Analyzing..." : "Analyze"}
              </button>
              <button onClick={handleBatchGenerate} disabled={!result?.highlights.length || clipping}
                style={{ flex: 1, padding: "8px 0", background: clipping ? "#444" : "#2563eb", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, cursor: !result?.highlights.length || clipping ? "not-allowed" : "pointer", fontSize: 14 }}>
                {clipping ? "Generating..." : `Top ${top} Generate`}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{ background: "#3b1a1a", borderRadius: 8, padding: "8px 12px", border: "1px solid #a33", color: "#f88", fontSize: 13 }}>
              {error}
              <button onClick={() => setError(null)} style={{ marginLeft: 8, background: "none", border: "none", color: "#f88", cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
          )}

          {/* Highlight list */}
          <div style={{ background: "#1c1c1f", borderRadius: 8, padding: 12, border: "1px solid #333", flex: 1, overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#aaa" }}>Highlights</span>
              {generatedFiles.length > 0 && <span style={{ fontSize: 11, color: "#4ade80" }}>{generatedFiles.length} generated</span>}
            </div>
            {result?.highlights.map((h) => (
              <div key={h.rank}
                onClick={() => handleSelectHighlight(h)}
                style={{
                  background: selectedHighlight?.rank === h.rank ? "#2a2a3e" : "#222",
                  border: selectedHighlight?.rank === h.rank ? "1px solid #7c3aed" : "1px solid #333",
                  borderRadius: 6, padding: "6px 10px", marginBottom: 4, cursor: "pointer", transition: "all 0.1s",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#c084fc" }}>#{h.rank}</span>
                  <span style={{ fontSize: 12, color: "#fbbf24" }}>score: {h.score}</span>
                </div>
                <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
                  {fmt(h.start)} – {fmt(h.end)} · {h.chat_count} msgs · {h.keyword_hits} kw hits
                </div>
                {h.reasons.length > 0 && (
                  <div style={{ fontSize: 11, color: "#4ade80", marginTop: 2 }}>
                    {h.reasons.slice(0, 2).join(" · ")}
                  </div>
                )}
                {h.matched_keywords.length > 0 && (
                  <div style={{ fontSize: 10, color: "#888", marginTop: 1 }}>
                    keywords: {h.matched_keywords.slice(0, 5).join(", ")}
                  </div>
                )}
                <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
                  <button onClick={(e) => { e.stopPropagation(); setSelectedHighlight(h); setEditStart(String(h.clip_start)); setEditEnd(String(h.clip_start + h.clip_duration)); }}
                    style={{ padding: "2px 8px", background: "#2a2a3e", border: "1px solid #555", borderRadius: 4, color: "#aaa", cursor: "pointer", fontSize: 11 }}>
                    Select
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleGenerateClip(); }}
                    disabled={clipping}
                    style={{ padding: "2px 8px", background: "#7c3aed", border: "none", borderRadius: 4, color: "#fff", cursor: clipping ? "not-allowed" : "pointer", fontSize: 11 }}>
                    Generate
                  </button>
                  {h.output_file && (
                    <span style={{ fontSize: 10, color: "#4ade80", alignSelf: "center" }}>✓</span>
                  )}
                </div>
              </div>
            ))}
            {!result && (
              <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
                Results appear here
              </div>
            )}
          </div>

          {/* Generated files */}
          {generatedFiles.length > 0 && (
            <div style={{ background: "#1c1c1f", borderRadius: 8, padding: "6px 12px", border: "1px solid #333", maxHeight: 80, overflow: "auto" }}>
              <div style={{ fontSize: 11, color: "#4ade80", marginBottom: 2 }}>Generated files</div>
              {generatedFiles.map((f, i) => (
                <div key={i} style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace" }}>{f}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
