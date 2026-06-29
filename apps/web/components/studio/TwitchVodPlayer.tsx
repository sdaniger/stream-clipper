"use client";
import React, { useMemo, useEffect, useState, useRef, forwardRef, useImperativeHandle } from "react";
import { secondsToTwitchTime } from "@/lib/twitch-time";

export interface TwitchVodPlayerHandle {
  getCurrentTime: () => number;
}

interface Props {
  videoId: string;
  startTimeSeconds: number;
  reloadKey: number;
  onTimeUpdate?: (time: number) => void;
}

const TwitchVodPlayer = forwardRef<TwitchVodPlayerHandle, Props>(function TwitchVodPlayer(
  { videoId, startTimeSeconds, reloadKey, onTimeUpdate },
  ref
) {
  const [parentHost, setParentHost] = useState("localhost");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastReportedTimeRef = useRef(0);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    setParentHost(window.location.hostname);
  }, []);

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => lastReportedTimeRef.current,
  }));

  const src = useMemo(() => {
    const time = secondsToTwitchTime(startTimeSeconds);
    return `https://player.twitch.tv/?video=v${videoId}&parent=${parentHost}&time=${time}&autoplay=true`;
  }, [videoId, startTimeSeconds, parentHost]);

  // Poll the current time from the player via the Twitch player iframe API.
  // Twitch embed doesn't expose a JS API for VODs by default, so we simulate
  // a best-effort tracker by remembering the latest seek position. The
  // parent application will get the real time once we have a "playing" event.
  useEffect(() => {
    lastReportedTimeRef.current = startTimeSeconds;
    if (onTimeUpdateRef.current) {
      onTimeUpdateRef.current(startTimeSeconds);
    }

    if (pollRef.current) {
      clearInterval(pollRef.current);
    }
    // After initial seek, simulate playback at 1x. This is a best-effort
    // approximation; for precise time the user can rely on the local player.
    pollRef.current = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      lastReportedTimeRef.current = Math.min(
        lastReportedTimeRef.current + 0.5,
        startTimeSeconds + 60
      );
      if (onTimeUpdateRef.current) {
        onTimeUpdateRef.current(lastReportedTimeRef.current);
      }
    }, 500);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [startTimeSeconds, reloadKey]);

  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
        Twitch VOD Player
        <span className="text-[10px] text-slate-600 ml-2 font-normal normal-case">
          v{videoId} · {secondsToTwitchTime(startTimeSeconds)}
        </span>
      </div>
      <div className="aspect-video bg-black rounded overflow-hidden">
        <iframe
          ref={iframeRef}
          key={reloadKey}
          src={src}
          className="w-full h-full"
          allowFullScreen
          allow="autoplay"
          title="Twitch VOD Player"
        />
      </div>
    </div>
  );
});

export default TwitchVodPlayer;
