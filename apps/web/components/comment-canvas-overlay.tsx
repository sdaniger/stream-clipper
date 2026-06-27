"use client";

import { useEffect, useRef } from "react";
import {
  getActiveCommentPosition,
  getCommentY,
  prepareOverlayComments
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
  const lastFrameRef = useRef<number | null>(null);
  const internalTimeRef = useRef(currentTime);

  useEffect(() => {
    latestStateRef.current = { comments, currentTime, duration, settings, playing };
    internalTimeRef.current = currentTime;
    drawFrame();
  }, [comments, currentTime, duration, settings, playing]);

  useEffect(() => {
    const tick = (timestamp: number) => {
      const state = latestStateRef.current;
      const lastFrame = lastFrameRef.current ?? timestamp;
      const deltaSeconds = (timestamp - lastFrame) / 1000;
      lastFrameRef.current = timestamp;

      if (state.playing) {
        internalTimeRef.current = (internalTimeRef.current + deltaSeconds) % Math.max(state.duration, 1);
      } else {
        internalTimeRef.current = state.currentTime;
      }

      drawFrame();
      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      animationRef.current = null;
      lastFrameRef.current = null;
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

    const preparedComments = prepareOverlayComments(state.comments, state.settings, height);
    const renderTime = state.playing ? internalTimeRef.current : state.currentTime;

    for (const comment of preparedComments) {
      const fontSize = comment.size;
      context.font = `700 ${fontSize}px "Noto Sans JP", system-ui, sans-serif`;
      const text = state.settings.hideUserNames || !comment.userId ? comment.text : `${comment.userId}: ${comment.text}`;
      const textWidth = context.measureText(text).width;
      const x = getActiveCommentPosition(comment, renderTime, width, textWidth, state.settings);

      if (x === null) {
        continue;
      }

      const y = getCommentY(comment.lane ?? 0, height, state.settings);
      context.lineJoin = "round";
      context.shadowColor = "rgba(0, 0, 0, 0.45)";
      context.shadowBlur = 8;
      context.strokeStyle = "rgba(0, 0, 0, 0.92)";
      context.lineWidth = Math.max(4, Math.round(fontSize / 7));
      context.strokeText(text, x, y);
      context.shadowBlur = 0;
      context.fillStyle = comment.color;
      context.fillText(text, x, y);
    }
  }

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden="true" />;
}
