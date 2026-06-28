"use client";
import React, { useMemo, useEffect, useState } from "react";
import { secondsToTwitchTime } from "@/lib/twitch-time";

interface Props {
  videoId: string;
  startTimeSeconds: number;
  reloadKey: number;
}

export default function TwitchVodPlayer({ videoId, startTimeSeconds, reloadKey }: Props) {
  const [parentHost, setParentHost] = useState("localhost");

  useEffect(() => {
    setParentHost(window.location.hostname);
  }, []);

  const src = useMemo(() => {
    const time = secondsToTwitchTime(startTimeSeconds);
    return `https://player.twitch.tv/?video=v${videoId}&parent=${parentHost}&time=${time}`;
  }, [videoId, startTimeSeconds, parentHost]);

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
          key={reloadKey}
          src={src}
          className="w-full h-full"
          allowFullScreen
          title="Twitch VOD Player"
        />
      </div>
    </div>
  );
}
