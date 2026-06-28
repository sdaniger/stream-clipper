import React, { useRef, useEffect, useCallback } from "react";

interface Props {
  videoPath: string;
  currentTime: number;
  editedStart: number;
  editedEnd: number;
  isPreviewing: boolean;
  onTimeUpdate: (t: number) => void;
  onSeek: (t: number) => void;
  onPreviewPlay: () => void;
  onSetStartToCurrent: () => void;
  onSetEndToCurrent: () => void;
  onTogglePlay: () => void;
}

export default function VideoPreview({
  videoPath, currentTime, editedStart, editedEnd, isPreviewing,
  onTimeUpdate, onSeek, onPreviewPlay, onSetStartToCurrent, onSetEndToCurrent, onTogglePlay,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekBarRef = useRef<HTMLInputElement>(null);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      onTimeUpdate(videoRef.current.currentTime);
    }
  }, [onTimeUpdate]);

  useEffect(() => {
    if (isPreviewing && videoRef.current) {
      const video = videoRef.current;
      const checkEnd = () => {
        if (video.currentTime >= editedEnd) {
          video.pause();
        }
      };
      video.addEventListener("timeupdate", checkEnd);
      return () => video.removeEventListener("timeupdate", checkEnd);
    }
  }, [isPreviewing, editedEnd]);

  const handleSeekBar = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = t;
    }
    onSeek(t);
  }, [onSeek]);

  const handleSeekTo = useCallback((t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
    }
    onSeek(t);
  }, [onSeek]);

  const duration = videoRef.current?.duration || 0;

  return (
    <div className="panel">
      <div className="panel-title" style={{ marginBottom: 6 }}>Video Preview</div>
      <video
        ref={videoRef}
        controls
        onTimeUpdate={handleTimeUpdate}
        className="video-player"
      >
        {videoPath && <source src={`/api/gui/video?path=${encodeURIComponent(videoPath)}`} />}
      </video>
      <div className="seek-bar-row">
        <input
          ref={seekBarRef}
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={handleSeekBar}
          className="seek-bar"
        />
      </div>
      <div className="video-actions">
        <button className="btn btn-sm" onClick={onTogglePlay}>
          ▶ Play / Pause
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => handleSeekTo(editedStart)}>
          ⏮ Start
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => handleSeekTo(editedEnd)}>
          ⏭ End
        </button>
        <button className={`btn btn-sm ${isPreviewing ? "btn-danger" : "btn-green"}`} onClick={onPreviewPlay}>
          {isPreviewing ? "■ Stop Preview" : "▶ Preview"}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onSetStartToCurrent}>
          📍 Set Start
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onSetEndToCurrent}>
          📍 Set End
        </button>
      </div>
    </div>
  );
}
