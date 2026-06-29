"use client";
import React, { useMemo, useEffect, useState, useRef, forwardRef, useImperativeHandle } from "react";
import { secondsToTwitchTime } from "@/lib/twitch-time";

export interface TwitchVodPlayerHandle {
  getCurrentTime: () => number;
  /**
   * Seek the player. Returns true if the seek was performed without
   * reloading the iframe (postMessage path), false if the caller should
   * fall back to a reload-based seek via `reloadKey`.
   */
  seekTo: (timeSeconds: number) => boolean;
}

interface Props {
  videoId: string;
  startTimeSeconds: number;
  reloadKey: number;
  onTimeUpdate?: (time: number) => void;
}

// Toggle: set to true to attempt postMessage-based current time tracking.
// Falls back to simulated time if Twitch doesn't emit events.
// Enabled by default — Twitch's player does emit timeupdate events
// consistently; if it doesn't, the simulated 0.5s/500ms counter kicks in.
const USE_POSTMESSAGE = true;

const TwitchVodPlayer = forwardRef<TwitchVodPlayerHandle, Props>(function TwitchVodPlayer(
  { videoId, startTimeSeconds, reloadKey, onTimeUpdate },
  ref
) {
  const [parentHost, setParentHost] = useState("localhost");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastReportedTimeRef = useRef(0);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const postMessageActiveRef = useRef(false);

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    setParentHost(window.location.hostname);
  }, []);

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => lastReportedTimeRef.current,
    seekTo: (timeSeconds: number) => {
      // Try postMessage seek first (no reload). Returns true on success
      // so the parent knows it can skip the reloadKey-based fallback.
      if (USE_POSTMESSAGE && iframeRef.current?.contentWindow) {
        try {
          iframeRef.current.contentWindow.postMessage(
            JSON.stringify({
              event: "video.seek",
              data: { time: timeSeconds },
            }),
            "*",
          );
          lastReportedTimeRef.current = timeSeconds;
          if (onTimeUpdateRef.current) onTimeUpdateRef.current(timeSeconds);
          return true;
        } catch {
          // fall through to simulated update
        }
      }
      lastReportedTimeRef.current = timeSeconds;
      if (onTimeUpdateRef.current) onTimeUpdateRef.current(timeSeconds);
      return false;
    },
  }));

  const src = useMemo(() => {
    const time = secondsToTwitchTime(startTimeSeconds);
    return `https://player.twitch.tv/?video=v${videoId}&parent=${parentHost}&time=${time}&autoplay=true`;
  }, [videoId, startTimeSeconds, parentHost]);

  // Listen for Twitch player postMessage events (when enabled).
  // Twitch's embed sends events like:
  //   { event: "video.timeupdate", data: { currentTime, duration } }
  //   { event: "video.pause", data: {} }
  //   { event: "video.play", data: {} }
  useEffect(() => {
    if (!USE_POSTMESSAGE) return;

    function handleMessage(event: MessageEvent) {
      // Only accept messages from the Twitch iframe
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      let payload: { event?: string; data?: { currentTime?: number; duration?: number } };
      try {
        payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (!payload || !payload.event) return;

      if (payload.event === "video.timeupdate" && typeof payload.data?.currentTime === "number") {
        postMessageActiveRef.current = true;
        lastReportedTimeRef.current = payload.data.currentTime;
        if (onTimeUpdateRef.current) onTimeUpdateRef.current(payload.data.currentTime);
      } else if (payload.event === "video.pause" || payload.event === "video.play") {
        if (typeof payload.data?.currentTime === "number") {
          lastReportedTimeRef.current = payload.data.currentTime;
          if (onTimeUpdateRef.current) onTimeUpdateRef.current(payload.data.currentTime);
        }
      }
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  // Initialise current time, then either listen to postMessage events
  // (when active) or fall back to a simulated 1x playback counter.
  useEffect(() => {
    lastReportedTimeRef.current = startTimeSeconds;
    if (onTimeUpdateRef.current) {
      onTimeUpdateRef.current(startTimeSeconds);
    }
    postMessageActiveRef.current = false;

    if (pollRef.current) {
      clearInterval(pollRef.current);
    }

    // The postMessage handler above will mark postMessageActiveRef=true
    // as soon as Twitch emits a timeupdate event. Until then we simulate.
    pollRef.current = setInterval(() => {
      // If postMessage is delivering real values, don't simulate.
      if (postMessageActiveRef.current) return;
      if (document.visibilityState !== "visible") return;
      lastReportedTimeRef.current = Math.min(
        lastReportedTimeRef.current + 0.5,
        startTimeSeconds + 60,
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
        {USE_POSTMESSAGE && (
          <span className="text-[9px] text-cyan-400 ml-2 font-normal normal-case">
            (postMessage)
          </span>
        )}
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
