import React, { useRef, useCallback } from "react";
import type { HighlightCandidate } from "../api";
import { fmt } from "../utils";

interface Props {
  videoPath: string;
  selectedHighlight: HighlightCandidate | null;
  editStart: number;
  editEnd: number;
  sliderMin: number;
  sliderMax: number;
  onSliderChange: (value: number, type: "start" | "end") => void;
}

export default function VideoPlayer({
  videoPath, selectedHighlight, editStart, editEnd,
  sliderMin, sliderMax, onSliderChange,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const startPct = sliderMax > 0 ? (editStart / sliderMax) * 100 : 0;
  const endPct = sliderMax > 0 ? (editEnd / sliderMax) * 100 : 0;

  const seekVideo = useCallback((t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
    }
  }, []);

  return (
    <div className="panel">
      <video
        ref={videoRef}
        controls
        className="video-player"
      >
        {videoPath && <source src={`/api/gui/video?path=${encodeURIComponent(videoPath)}`} />}
      </video>
      {selectedHighlight && (
        <div style={{ marginTop: 8 }}>
          <div className="slider-labels">
            <span>Start: {fmt(editStart)}</span>
            <span>End: {fmt(editEnd)}</span>
            <span>Duration: {fmt(Math.max(0, editEnd - editStart))}</span>
          </div>
          <div className="slider-track">
            <div className="slider-selection-highlight"
              style={{
                left: `${Math.min(startPct, endPct)}%`,
                width: `${Math.abs(endPct - startPct)}%`,
              }}
            />
            <input
              type="range" min={sliderMin} max={sliderMax} value={editStart}
              onChange={(e) => { onSliderChange(Number(e.target.value), "start"); seekVideo(Number(e.target.value)); }}
              className="thumb thumb-start"
            />
            <input
              type="range" min={sliderMin} max={sliderMax} value={editEnd}
              onChange={(e) => { onSliderChange(Number(e.target.value), "end"); seekVideo(Number(e.target.value)); }}
              className="thumb thumb-end"
            />
          </div>
        </div>
      )}
    </div>
  );
}
