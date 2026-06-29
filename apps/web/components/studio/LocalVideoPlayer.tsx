"use client";
import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";

export interface LocalVideoPlayerHandle {
  getCurrentTime: () => number;
  getVideoElement: () => HTMLVideoElement | null;
}

interface Props {
  videoPath: string;
  startTimeSeconds: number;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
}

const LocalVideoPlayer = forwardRef<LocalVideoPlayerHandle, Props>(function LocalVideoPlayer(
  { videoPath, startTimeSeconds, onTimeUpdate, onDurationChange },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const prevStartRef = useRef(startTimeSeconds);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onDurationChangeRef = useRef(onDurationChange);

  // Keep latest callbacks in refs to avoid re-attaching listeners
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);
  useEffect(() => {
    onDurationChangeRef.current = onDurationChange;
  }, [onDurationChange]);

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    getVideoElement: () => videoRef.current,
  }));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (startTimeSeconds !== prevStartRef.current) {
      video.currentTime = startTimeSeconds;
      video.play().catch(() => {});
      prevStartRef.current = startTimeSeconds;
    }
  }, [startTimeSeconds]);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current && onTimeUpdateRef.current) {
      onTimeUpdateRef.current(videoRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current && onDurationChangeRef.current) {
      onDurationChangeRef.current(videoRef.current.duration || 0);
    }
  }, []);

  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
        Video Player
        <span className="text-[10px] text-slate-600 ml-2 font-normal normal-case">
          {videoPath.split("/").pop()}
        </span>
      </div>
      <div className="bg-black rounded overflow-hidden">
        <video
          ref={videoRef}
          src={`/api/studio/video?path=${encodeURIComponent(videoPath)}`}
          className="w-full max-h-[70vh]"
          controls
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onError={() => {}}
        />
      </div>
    </div>
  );
});

export default LocalVideoPlayer;
