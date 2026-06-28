"use client";
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
    if (videoRef.current) onTimeUpdate(videoRef.current.currentTime);
  }, [onTimeUpdate]);

  useEffect(() => {
    if (isPreviewing && videoRef.current) {
      const video = videoRef.current;
      const checkEnd = () => { if (video.currentTime >= editedEnd) video.pause(); };
      video.addEventListener("timeupdate", checkEnd);
      return () => video.removeEventListener("timeupdate", checkEnd);
    }
  }, [isPreviewing, editedEnd]);

  const handleSeekBar = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    if (videoRef.current) videoRef.current.currentTime = t;
    onSeek(t);
  }, [onSeek]);

  const handleSeekTo = useCallback((t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
    onSeek(t);
  }, [onSeek]);

  const duration = videoRef.current?.duration || 0;

  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Video Preview</div>
      <video ref={videoRef} controls onTimeUpdate={handleTimeUpdate}
        className="w-full max-h-[260px] rounded bg-black block">
        {videoPath && <source src={`/api/gui/video?path=${encodeURIComponent(videoPath)}`} />}
      </video>
      <div className="mt-1.5">
        <input ref={seekBarRef} type="range" min={0} max={duration || 0} step={0.1}
          value={currentTime} onChange={handleSeekBar}
          className="w-full h-1 appearance-none bg-slate-700 rounded-full outline-none
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:cursor-pointer" />
      </div>
      <div className="flex gap-1 mt-1.5 flex-wrap">
        <button onClick={onTogglePlay}
          className="px-2.5 py-1 text-xs rounded bg-slate-700/60 border border-slate-600 text-slate-300 hover:brightness-110">
          ▶ Play / Pause
        </button>
        <button onClick={() => handleSeekTo(editedStart)}
          className="px-2.5 py-1 text-xs rounded bg-violet-600 text-white hover:brightness-110">
          ⏮ Start
        </button>
        <button onClick={() => handleSeekTo(editedEnd)}
          className="px-2.5 py-1 text-xs rounded bg-violet-600 text-white hover:brightness-110">
          ⏭ End
        </button>
        <button onClick={onPreviewPlay}
          className={`px-2.5 py-1 text-xs rounded text-white hover:brightness-110 ${isPreviewing ? "bg-red-600" : "bg-emerald-600"}`}>
          {isPreviewing ? "■ Stop Preview" : "▶ Preview"}
        </button>
        <button onClick={onSetStartToCurrent}
          className="px-2.5 py-1 text-xs rounded bg-slate-700/60 border border-slate-600 text-slate-300 hover:brightness-110">
          📍 Set Start
        </button>
        <button onClick={onSetEndToCurrent}
          className="px-2.5 py-1 text-xs rounded bg-slate-700/60 border border-slate-600 text-slate-300 hover:brightness-110">
          📍 Set End
        </button>
      </div>
    </div>
  );
}
