"use client";

import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { StudioCommentOverlay } from "./CommentOverlay";
import {
  BURN_IN_MODE_DESCRIPTION_JA,
  BURN_IN_MODE_DESCRIPTION_EN,
  BURN_IN_MODE_LABEL_JA,
  BURN_IN_MODE_LABEL_EN,
  type CommentBurnInMode,
  type DanmakuRenderOptions,
} from "@/types/danmaku-render";

/**
 * Embedded video player for the Studio.
 *
 * Two video sources can be displayed:
 *   1. A finished render output (MP4 with hard-burned comments)
 *   2. A burn-in preview MP4 (same pipeline, short + low-res)
 *
 * When the burn-in mode is `preview_overlay`, a lightweight canvas
 * overlay is drawn on top of the (raw, unburned) candidate video so
 * the user can preview comments without committing to a slow render.
 */

export type VideoPlayerProps = {
  /** A raw candidate video (Twitch VOD iframe) or a finished MP4 URL. */
  sourceType: "twitch" | "local" | "preview" | "rendered";
  /** The video source URL when sourceType is "local" / "preview" / "rendered" */
  src?: string | null;
  /** Twitch VOD video id when sourceType is "twitch" */
  twitchVideoId?: string | null;
  /** Twitch VOD start offset (seconds) for parent+offset embedding */
  startSeconds?: number;
  /** Aspect ratio (9:16 or 16:9) */
  aspect: "16:9" | "9:16";
  /** Current candidate (for overlay context) */
  candidate: { clip_start: number; clip_end: number; rank: number } | null;
  /** Chat messages in absolute time, used by the lightweight overlay */
  chatMessages?: Array<{ time_sec: number; message: string; author?: string }>;
  /** Current playback time (seconds, relative to clip_start) */
  currentTime?: number;
  /** Whether the video is playing */
  playing?: boolean;
  /** Called when the user clicks play / pause */
  onTogglePlay?: () => void;
  /** Called on time update */
  onTimeUpdate?: (timeSec: number) => void;
  /** Comment display mode + render options */
  commentMode: CommentBurnInMode;
  danmakuOptions: DanmakuRenderOptions;
  /** Title shown above the video */
  title?: string;
  /** When true, shows a badge identifying the current preview state */
  showBadge?: boolean;
};

function fmtTime(v: number): string {
  const safe = Math.max(0, v);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function previewBadgeLabel(
  sourceType: VideoPlayerProps["sourceType"],
  mode: CommentBurnInMode,
  isJa: boolean,
): { text: string; tone: "light" | "preview" | "burned" } | null {
  if (mode === "off") return null;
  if (sourceType === "rendered") {
    return {
      text: isJa ? "MP4焼き込み済み" : "MP4 burned in",
      tone: "burned",
    };
  }
  if (sourceType === "preview") {
    return {
      text: isJa ? "焼き込みプレビュー中" : "Burn-in preview",
      tone: "preview",
    };
  }
  // Source is a raw video and we're showing a canvas overlay
  return {
    text: isJa ? "軽量プレビュー中" : "Lightweight preview",
    tone: "light",
  };
}

export default function VideoPlayer({
  sourceType,
  src,
  twitchVideoId,
  startSeconds = 0,
  aspect,
  candidate,
  chatMessages = [],
  currentTime = 0,
  playing = false,
  onTogglePlay,
  onTimeUpdate,
  commentMode,
  danmakuOptions,
  title,
  showBadge = true,
}: VideoPlayerProps) {
  const { locale } = useI18n();
  const isJa = locale === "ja";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [internalTime, setInternalTime] = useState(currentTime);
  const [internalPlaying, setInternalPlaying] = useState(playing);

  // Sync external state -> internal
  useEffect(() => {
    setInternalTime(currentTime);
  }, [currentTime]);
  useEffect(() => {
    setInternalPlaying(playing);
    const v = videoRef.current;
    if (v) {
      if (playing && v.paused) v.play().catch(() => {});
      if (!playing && !v.paused) v.pause();
    }
  }, [playing]);

  const showOverlay =
    commentMode === "preview_overlay" && (sourceType === "local" || sourceType === "twitch");
  const showIframe = sourceType === "twitch" && !!twitchVideoId;
  const showVideo = (sourceType === "local" || sourceType === "preview" || sourceType === "rendered") && !!src;

  const aspectClass = aspect === "9:16" ? "aspect-[9/16] max-h-[600px] mx-auto" : "aspect-video";
  const badge = showBadge ? previewBadgeLabel(sourceType, commentMode, isJa) : null;

  return (
    <div className="bg-slate-900/60 rounded-xl border border-slate-700/40 overflow-hidden">
      {title && (
        <div className="px-3 py-1.5 flex items-center justify-between border-b border-slate-800/60">
          <div className="text-[11px] font-semibold text-slate-300 truncate">{title}</div>
          {badge && (
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                badge.tone === "burned"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : badge.tone === "preview"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
              }`}
            >
              {badge.text}
            </span>
          )}
        </div>
      )}
      <div className="relative bg-black">
        <div className={`relative ${aspectClass} w-full`}>
          {showIframe ? (
            <iframe
              src={`https://player.twitch.tv/?video=${twitchVideoId}&parent=${typeof window !== "undefined" ? window.location.hostname : "localhost"}&time=${Math.max(0, Math.floor(startSeconds + (currentTime || 0)))}s`}
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          ) : showVideo ? (
            <video
              ref={videoRef}
              src={src!}
              className="absolute inset-0 w-full h-full bg-black object-contain"
              controls={false}
              playsInline
              preload="metadata"
              onPlay={() => {
                setInternalPlaying(true);
                onTogglePlay?.();
              }}
              onPause={() => {
                setInternalPlaying(false);
                onTogglePlay?.();
              }}
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setInternalTime(t);
                onTimeUpdate?.(t);
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-center text-slate-500 text-xs">
              {isJa ? "動画がありません" : "No video source"}
            </div>
          )}

          {showOverlay && showVideo && (
            <StudioCommentOverlay
              chatMessages={chatMessages}
              clipStartSec={candidate?.clip_start ?? 0}
              clipEndSec={candidate?.clip_end ?? 0}
              currentTime={internalTime}
              playing={internalPlaying}
              options={danmakuOptions}
              width={1920}
              height={1080}
            />
          )}

          {/* Mode description footer */}
          {showOverlay && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 pt-3 pb-1.5 text-[9px] leading-snug pointer-events-none z-20">
              <div className="text-cyan-200/80 font-semibold">
                {isJa ? "軽量プレビュー" : "Lightweight preview"}
              </div>
              <div className="text-slate-300/70">
                {isJa
                  ? "この表示は確認用です。本番MP4に焼き込むには『MP4に焼き込み』を選んでください。"
                  : "For preview only. Choose \u201cBurn to MP4\u201d to bake comments into the video."}
              </div>
            </div>
          )}

          {/* Custom controls for local/preview/rendered video */}
          {showVideo && !showIframe && (
            <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent flex items-center gap-2 z-20">
              <button
                type="button"
                onClick={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  if (v.paused) v.play().catch(() => {});
                  else v.pause();
                }}
                className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 text-white text-xs flex items-center justify-center"
                aria-label={internalPlaying ? "Pause" : "Play"}
              >
                {internalPlaying ? "❚❚" : "▶"}
              </button>
              <div className="flex-1 h-1 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full bg-cyan-400"
                  style={{
                    width: `${
                      videoRef.current && videoRef.current.duration > 0
                        ? Math.min(100, (videoRef.current.currentTime / videoRef.current.duration) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
              <span className="text-[9px] font-mono text-white/80 tabular-nums">
                {fmtTime(internalTime)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Mode hint footer (always shown) */}
      <div className="px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-800/60 flex items-center justify-between gap-2">
        <span className="text-slate-500">
          {isJa ? "コメント表示" : "Comment display"}:{" "}
          <span className="text-slate-300 font-semibold">
            {isJa ? BURN_IN_MODE_LABEL_JA[commentMode] : BURN_IN_MODE_LABEL_EN[commentMode]}
          </span>
        </span>
        <span className="text-slate-500 truncate text-right">
          {isJa ? BURN_IN_MODE_DESCRIPTION_JA[commentMode] : BURN_IN_MODE_DESCRIPTION_EN[commentMode]}
        </span>
      </div>
    </div>
  );
}
