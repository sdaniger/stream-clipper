"use client";

import { useEffect, useRef } from "react";
import {
  getActiveCommentPosition,
  getCommentY
} from "@/lib/comment-overlay";
import type { CommentOverlayItem, CommentOverlaySettings } from "@/types/comment-overlay";

type CommentCanvasOverlayProps = {
  comments: CommentOverlayItem[];
  currentTime: number;
  duration: number;
  settings: CommentOverlaySettings;
  playing: boolean;
};

export function CommentCanvasOverlay({ comments, currentTime, duration, settings, playing }: CommentCanvasOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestStateRef = useRef({ comments, currentTime, duration, settings, playing });
  const animationRef = useRef<number | null>(null);
  const renderTimeRef = useRef(currentTime);

  useEffect(() => {
    latestStateRef.current = { comments, currentTime, duration, settings, playing };
    // Sync from external currentTime whenever it changes (seek, pause, etc.)
    renderTimeRef.current = currentTime;
    drawFrame();
  }, [comments, currentTime, duration, settings, playing]);

  useEffect(() => {
    let lastFrameTime: number | null = null;

    const tick = (timestamp: number) => {
      const state = latestStateRef.current;

      if (state.playing) {
        // During playback, advance render time from delta but also
        // periodically re-sync to the parent's currentTime (passed via
        // useEffect above) to prevent long-term drift.
        if (lastFrameTime !== null) {
          const deltaSeconds = (timestamp - lastFrameTime) / 1000;
          renderTimeRef.current += deltaSeconds;
          // Wrap around at duration boundary
          if (renderTimeRef.current >= state.duration) {
            renderTimeRef.current = renderTimeRef.current % Math.max(state.duration, 1);
          }
        }
      } else {
        renderTimeRef.current = state.currentTime;
      }

      lastFrameTime = timestamp;
      drawFrame();
      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      animationRef.current = null;
      lastFrameTime = null;
    };
  }, []);

  function drawFrame() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const parent = canvas.parentElement;
    const rect = parent?.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect?.width ?? canvas.clientWidth));
    const height = Math.max(1, Math.round(rect?.height ?? canvas.clientHeight));
    const pixelRatio = window.devicePixelRatio || 1;

    if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const state = latestStateRef.current;
    if (!state.settings.enabled) {
      return;
    }

    const renderComments = state.comments;
    const renderTime = state.playing ? renderTimeRef.current : state.currentTime;

    for (const comment of renderComments) {
      const fontSize = comment.size;
      context.font = `700 ${fontSize}px "${state.settings.fontName}", system-ui, sans-serif`;
      const text = state.settings.hideUserNames || !comment.userId ? comment.text : `${comment.userId}: ${comment.text}`;
      const textWidth = context.measureText(text).width;
      const x = getActiveCommentPosition(comment, renderTime, width, textWidth, state.settings);

      if (x === null) {
        continue;
      }

      const y = getCommentY(comment.lane ?? 0, height, state.settings);

      context.save();
      if (typeof context.filter !== "undefined") {
        context.filter = "blur(3px)";
      }
      context.lineJoin = "round";
      context.strokeStyle = "rgba(0, 0, 0, 0.98)";
      context.lineWidth = Math.max(4, Math.round(fontSize / 6));
      context.strokeText(text, x, y);
      context.restore();

      context.lineJoin = "round";
      context.shadowColor = "rgba(0, 0, 0, 0.55)";
      context.shadowBlur = 2;
      context.fillStyle = comment.color;
      context.fillText(text, x, y);
      context.shadowBlur = 0;
    }
  }

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden="true" />;
}
