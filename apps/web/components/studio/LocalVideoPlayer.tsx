"use client";
import React, { useRef, useEffect, useCallback } from "react";

interface Props {
  videoPath: string;
  startTimeSeconds: number;
  onTimeUpdate?: (time: number) => void;
}

export default function LocalVideoPlayer({ videoPath, startTimeSeconds, onTimeUpdate }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const prevStartRef = useRef(startTimeSeconds);

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
    if (onTimeUpdate && videoRef.current) {
      onTimeUpdate(videoRef.current.currentTime);
    }
  }, [onTimeUpdate]);

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
          onError={() => {}}
        />
      </div>
    </div>
  );
}
