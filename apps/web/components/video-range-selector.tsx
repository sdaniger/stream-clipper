"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

type VideoRangeSelectorProps = {
  videoSrc: string;
  duration: number;
  onChange: (start: number, end: number) => void;
};

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VideoRangeSelector({ videoSrc, duration, onChange }: VideoRangeSelectorProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(duration);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [actualDuration, setActualDuration] = useState(duration);
  const dragRef = useRef({ startX: 0, startVal: 0 });

  useEffect(() => {
    if (duration > 0) {
      setEnd(duration);
      setActualDuration(duration);
    }
  }, [duration]);

  useEffect(() => {
    onChange(start, end);
  }, [start, end, onChange]);

  const timeToPercent = useCallback((t: number) => {
    if (actualDuration <= 0) return 0;
    return Math.max(0, Math.min(100, (t / actualDuration) * 100));
  }, [actualDuration]);

  const percentToTime = useCallback((pct: number) => {
    return Math.max(0, Math.min(actualDuration, (pct / 100) * actualDuration));
  }, [actualDuration]);

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !videoRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const time = percentToTime(pct);
    videoRef.current.currentTime = time;
  }, [percentToTime]);

  const applyDrag = useCallback((clientX: number) => {
    if (!timelineRef.current || !dragging) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    const time = percentToTime(pct);

    if (dragging === "start") {
      const clamped = Math.min(time, end - 1);
      setStart(Math.max(0, clamped));
    } else {
      const clamped = Math.max(time, start + 1);
      setEnd(Math.min(actualDuration, clamped));
    }
  }, [dragging, start, end, actualDuration, percentToTime]);

  const handleMarkerMouseDown = useCallback((marker: "start" | "end") => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(marker);
    dragRef.current = { startX: e.clientX, startVal: marker === "start" ? start : end };
  }, [start, end]);

  const handleMarkerTouchStart = useCallback((marker: "start" | "end") => (e: React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(marker);
    dragRef.current = { startX: e.touches[0].clientX, startVal: marker === "start" ? start : end };
  }, [start, end]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      applyDrag(e.clientX);
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      applyDrag(e.touches[0].clientX);
    };

    const handleStop = () => setDragging(null);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleStop);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleStop);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleStop);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleStop);
    };
  }, [dragging, applyDrag]);

  const handleVideoLoaded = useCallback(() => {
    const v = videoRef.current;
    if (v && v.duration && isFinite(v.duration)) {
      setActualDuration(v.duration);
      setEnd(v.duration);
      setVideoReady(true);
    }
  }, []);

  const seekToStart = useCallback(() => {
    if (videoRef.current) videoRef.current.currentTime = start;
  }, [start]);

  const seekToEnd = useCallback(() => {
    if (videoRef.current) videoRef.current.currentTime = end;
  }, [end]);

  const clipDuration = Math.max(0, end - start);

  return (
    <div className="space-y-3">
      {/* Video player */}
      <div className="relative rounded-xl overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={videoSrc}
          controls
          onLoadedMetadata={handleVideoLoaded}
          className="w-full max-h-[50vh] object-contain"
        />
      </div>

      {/* Timeline with markers */}
      <div className="px-1">
        <div
          ref={timelineRef}
          className="relative h-8 cursor-crosshair rounded-lg bg-white/10 select-none"
          onClick={handleTimelineClick}
        >
          {/* Selected range highlight */}
          <div
            className="absolute top-0 h-full bg-cyan-400/20 border-y border-cyan-400/40"
            style={{
              left: `${timeToPercent(start)}%`,
              width: `${timeToPercent(end) - timeToPercent(start)}%`,
            }}
          />

          {/* Start marker */}
          <div
            className="absolute top-0 h-full w-1.5 bg-emerald-400 cursor-ew-resize z-10 group"
            style={{ left: `calc(${timeToPercent(start)}% - 3px)` }}
            onMouseDown={handleMarkerMouseDown("start")}
            onTouchStart={handleMarkerTouchStart("start")}
          >
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-emerald-400 px-1.5 py-0.5 text-[0.6rem] font-mono font-bold text-black whitespace-nowrap opacity-0 group-hover:opacity-100 transition">
              {formatTime(start)}
            </div>
          </div>

          {/* End marker */}
          <div
            className="absolute top-0 h-full w-1.5 bg-rose-400 cursor-ew-resize z-10 group"
            style={{ left: `calc(${timeToPercent(end)}% - 3px)` }}
            onMouseDown={handleMarkerMouseDown("end")}
            onTouchStart={handleMarkerTouchStart("end")}
          >
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-rose-400 px-1.5 py-0.5 text-[0.6rem] font-mono font-bold text-black whitespace-nowrap opacity-0 group-hover:opacity-100 transition">
              {formatTime(end)}
            </div>
          </div>
        </div>

        {/* Time display */}
        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
          <span>{t("videoRange.total")}{formatTime(actualDuration)}</span>
          <span className="font-mono">
            <span className="text-emerald-300">{formatTime(start)}</span>
            {" → "}
            <span className="text-rose-300">{formatTime(end)}</span>
            {" "}
            <span className="text-cyan-300">({formatTime(clipDuration)})</span>
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={seekToStart}
              className="rounded border border-emerald-300/30 px-1.5 py-0.5 text-[0.6rem] text-emerald-300 transition hover:bg-emerald-300/10">
              {t("videoRange.goToStart")}
            </button>
            <button type="button" onClick={seekToEnd}
              className="rounded border border-rose-300/30 px-1.5 py-0.5 text-[0.6rem] text-rose-300 transition hover:bg-rose-300/10">
              {t("videoRange.goToEnd")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
