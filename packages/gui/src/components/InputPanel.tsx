import React from "react";

interface Props {
  videoPath: string;
  logPath: string;
  window: number;
  top: number;
  minGap: number;
  keywords: string;
  keywordWeight: number;
  clipDuration: number;
  clipPadding: number;
  outputDir: string;
  encoder: string;
  clipMode: string;
  loading: boolean;
  clipping: boolean;
  hasHighlights: boolean;
  onVideoPathChange: (v: string) => void;
  onLogPathChange: (v: string) => void;
  onWindowChange: (v: number) => void;
  onTopChange: (v: number) => void;
  onMinGapChange: (v: number) => void;
  onKeywordsChange: (v: string) => void;
  onKeywordWeightChange: (v: number) => void;
  onClipDurationChange: (v: number) => void;
  onClipPaddingChange: (v: number) => void;
  onOutputDirChange: (v: string) => void;
  onEncoderChange: (v: string) => void;
  onClipModeChange: (v: string) => void;
  onAnalyze: () => void;
  onBatchGenerate: () => void;
}

const inp = (label: string, val: number | string, min: number | string | undefined, step: number | string | undefined, onChange: (v: number) => void) => (
  <div key={label}>
    <label className="field-label">{label}</label>
    <input type="number" value={val} min={min as any} step={step as any}
      onChange={(e) => onChange(parseFloat(e.target.value) || (typeof min === "number" ? min : 0))}
      className="input input-sm" />
  </div>
);

export default function InputPanel({
  videoPath, logPath, window, top, minGap, keywords, keywordWeight,
  clipDuration, clipPadding, outputDir, encoder, clipMode,
  loading, clipping, hasHighlights,
  onVideoPathChange, onLogPathChange, onWindowChange, onTopChange,
  onMinGapChange, onKeywordsChange, onKeywordWeightChange,
  onClipDurationChange, onClipPaddingChange, onOutputDirChange,
  onEncoderChange, onClipModeChange,
  onAnalyze, onBatchGenerate,
}: Props) {
  return (
    <div className="panel">
      <h2 className="panel-title" style={{ margin: "0 0 8px" }}>Input</h2>
      <label className="field-label">Video file path</label>
      <input value={videoPath} onChange={(e) => onVideoPathChange(e.target.value)}
        placeholder="/path/to/video.mp4" className="input" />
      <label className="field-label" style={{ marginTop: 6 }}>Chat log path (.json / .csv)</label>
      <input value={logPath} onChange={(e) => onLogPathChange(e.target.value)}
        placeholder="/path/to/chat_log.json" className="input" />

      <details style={{ marginTop: 8 }}>
        <summary className="field-label" style={{ cursor: "pointer", userSelect: "none" }}>Advanced settings</summary>
        <div className="grid-2col" style={{ marginTop: 6 }}>
          {inp("Window (s)", window, 10, 5, onWindowChange)}
          {inp("Top N", top, 1, 1, onTopChange)}
          {inp("Min gap (s)", minGap, 0, 5, onMinGapChange)}
          {inp("Clip duration (s)", clipDuration, 5, 5, onClipDurationChange)}
          {inp("Clip padding (s)", clipPadding, 0, 1, onClipPaddingChange)}
          {inp("Keyword weight", keywordWeight, 0, 0.5, onKeywordWeightChange)}
        </div>
        <label className="field-label" style={{ marginTop: 4 }}>Custom keywords (comma-separated)</label>
        <input value={keywords} onChange={(e) => onKeywordsChange(e.target.value)}
          placeholder="草,www,爆笑,lol" className="input input-sm" />
        <label className="field-label" style={{ marginTop: 4 }}>Output directory</label>
        <input value={outputDir} onChange={(e) => onOutputDirChange(e.target.value)}
          className="input input-sm" />
        <div className="field-label" style={{ marginTop: 4 }}>Encoder</div>
        <select value={encoder} onChange={(e) => onEncoderChange(e.target.value)}
          className="input input-sm">
          <option value="auto">Auto (NVENC if available)</option>
          <option value="h264_nvenc">NVENC (GPU)</option>
          <option value="libx264">libx264 (CPU)</option>
        </select>
        <div className="field-label" style={{ marginTop: 4 }}>Clip mode</div>
        <select value={clipMode} onChange={(e) => onClipModeChange(e.target.value)}
          className="input input-sm">
          <option value="reencode">Re-encode (precise)</option>
          <option value="copy">Stream copy (instant)</option>
        </select>
      </details>

      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn btn-primary" onClick={onAnalyze} disabled={loading}>
          {loading ? "Analyzing..." : "Analyze"}
        </button>
        <button className="btn btn-accent" onClick={onBatchGenerate} disabled={!hasHighlights || clipping}>
          {clipping ? "Generating..." : `Top ${top} Generate`}
        </button>
      </div>
    </div>
  );
}
