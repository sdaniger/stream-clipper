"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  commentFontSizes,
  defaultCommentOverlaySettings,
  generateCommentOverlayItemsFromChat,
  prepareOverlayComments,
} from "@/lib/comment-overlay";
import type { CommentOverlaySettings } from "@/types/comment-overlay";
import { DENSITY_TO_MAX_PER_SEC, type DanmakuRenderOptions } from "@/types/danmaku-render";

/**
 * Lightweight in-browser comment overlay for the studio.
 *
 * IMPORTANT: This is a CSS/Canvas overlay, NOT a burned-in MP4.
 * It exists for the "preview only" / "preview_overlay" mode so the
 * user can see what comments will look like BEFORE the (slow) render.
 * When the user switches to "MP4に焼き込み" mode, the actual render
 * pipeline (FFmpeg + ass= filter) does the real work.
 */
export type CommentOverlayProps = {
  /** Comments that may be relevant for this candidate */
  chatMessages: Array<{ time_sec: number; message: string; author?: string }>;
  /** Clip absolute time range */
  clipStartSec: number;
  clipEndSec: number;
  /** Current playback time within the clip (seconds, relative) */
  currentTime: number;
  /** Whether the underlying video is playing */
  playing: boolean;
  /** Render options driving the overlay visuals */
  options: DanmakuRenderOptions;
  /** Canvas size; the overlay covers the parent element */
  width: number;
  height: number;
};

const SIZE_PRESET_TO_KEY: Record<"small" | "medium" | "large", "small" | "medium" | "large"> = {
  small: "small",
  medium: "medium",
  large: "large",
};

function densityToOverlayDensity(d: "low" | "normal" | "high" | "insane"): "low" | "medium" | "high" | "danmaku" {
  if (d === "low") return "low";
  if (d === "normal") return "medium";
  if (d === "high") return "danmaku";
  return "danmaku";
}

export function StudioCommentOverlay({
  chatMessages,
  clipStartSec,
  clipEndSec,
  currentTime,
  playing,
  options,
  width,
  height,
}: CommentOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const renderTimeRef = useRef(currentTime);
  const [, setTick] = useState(0);

  // Build overlay items from real chat messages + settings
  const { items, settings } = React.useMemo(() => {
    const sizeKey = SIZE_PRESET_TO_KEY[options.size];
    const overlaySettings: CommentOverlaySettings = {
      ...defaultCommentOverlaySettings,
      enabled: true,
      density: densityToOverlayDensity(options.density),
      fontSize: sizeKey,
      fontName: options.fontFamily || "Noto Sans JP",
      outlineWidth: options.outline ?? 4,
      maxPerSecond: DENSITY_TO_MAX_PER_SEC[options.density] ?? 8,
      colorMode: "white",
      hideUserNames: true,
      filterUrls: true,
      filterLongComments: true,
      filterRepeatedComments: true,
    };

    // Reuse the existing chat-driven generator. The "candidate" is just
    // a stand-in id so we keep the keys stable.
    const fakeCandidate = {
      id: "studio-preview",
      representativeComments: [],
      chat: { topPhrases: [] },
    };
    const chatEntries = chatMessages
      .filter((m) => m.message && m.time_sec >= clipStartSec && m.time_sec <= clipEndSec)
      .map((m, i) => ({
        timestamp_seconds: m.time_sec,
        message: m.message,
        author_name: m.author || "",
      }));
    const base = generateCommentOverlayItemsFromChat(
      fakeCandidate as any,
      chatEntries,
      clipStartSec,
      clipEndSec,
      overlaySettings,
    );
    // Pre-compute lanes
    const prepared = prepareOverlayComments(base, overlaySettings, height, width);
    return { items: prepared, settings: overlaySettings };
  }, [chatMessages, clipStartSec, clipEndSec, options, width, height]);

  // Keep latest state in a ref so the animation loop doesn't need to
  // re-bind on every prop change.
  const stateRef = useRef({ items, settings, currentTime, playing });
  useEffect(() => {
    stateRef.current = { items, settings, currentTime, playing };
    renderTimeRef.current = currentTime;
  }, [items, settings, currentTime, playing]);

  // Animation loop
  useEffect(() => {
    let lastTs: number | null = null;
    const tick = (ts: number) => {
      const s = stateRef.current;
      if (s.playing) {
        if (lastTs != null) {
          renderTimeRef.current += (ts - lastTs) / 1000;
        }
      } else {
        renderTimeRef.current = s.currentTime;
      }
      lastTs = ts;
      draw();
      setTick((n) => (n + 1) & 0xff);
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      lastTs = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const rect = parent?.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect?.width ?? width));
    const h = Math.max(1, Math.round(rect?.height ?? height));
    const dpr = (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const s = stateRef.current;
    const time = renderTimeRef.current;
    for (const c of s.items) {
      const elapsed = time - c.time;
      if (elapsed < 0 || elapsed > c.duration) continue;
      const text = c.text;
      const size = c.size;
      ctx.font = `700 ${size}px "${s.settings.fontName}", "Noto Sans JP", system-ui, sans-serif`;
      const textWidth = ctx.measureText(text).width;
      const progress = elapsed / c.duration;
      const x = w - progress * (w + textWidth);
      // y is already stored in the lane-based comment item
      const y = c.lane != null ? computeLaneY(c.lane, h, size, s.settings) : h / 2;
      ctx.save();
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(0,0,0,0.95)";
      ctx.lineWidth = Math.max(3, Math.round(size / 7));
      ctx.strokeText(text, x, y);
      ctx.fillStyle = c.color || "#ffffff";
      ctx.fillText(text, x, y);
      ctx.restore();
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full z-10"
      aria-hidden="true"
    />
  );
}

function computeLaneY(lane: number, canvasHeight: number, fontSize: number, _settings: CommentOverlaySettings) {
  // Top area margin: 3% of canvas height, matching the narinico style
  const top = Math.max(8, Math.round(canvasHeight * 0.03));
  const lineHeight = Math.max(fontSize + 10, 36);
  return top + lane * lineHeight + lineHeight * 0.85;
}

// Re-export the helper to make the call-site cleaner
export { commentFontSizes };
