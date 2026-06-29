"use client";
import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { extractVideoId, type HighlightCandidate } from "@/lib/twitch-time";
import { getMediaRoot, getMediaPaths } from "@/lib/server/media-service";
import type { TimelineRow } from "@/lib/studio-api";
import {
  createStudioClip,
  batchCreateStudioClips,
  exportDanmakuClip,
  generateAssOnly,
  type DanmakuChatMessage,
  type DanmakuDensity,
  type DanmakuExportOptions,
  type DanmakuExportResponse,
  type DanmakuExportSource,
} from "@/lib/studio-api";
import { useI18n } from "@/lib/i18n";
import StepContainer from "@/components/studio/StepContainer";
import Step1VodInput from "@/components/studio/Step1VodInput";
import Step2CandidateList from "@/components/studio/Step2CandidateList";
import Step3ExportPanel, { type ExportStage } from "@/components/studio/Step3ExportPanel";
import AdvancedSettings, { type ExportSource, type FfmpegQuality } from "@/components/studio/AdvancedSettings";
import LanguageSwitcher from "@/components/studio/LanguageSwitcher";
import VideoArea from "@/components/studio/VideoArea";

const QUALITY_TO_FFMPEG: Record<FfmpegQuality, { preset: string; crf: number }> = {
  high_speed: { preset: "ultrafast", crf: 26 },
  standard: { preset: "veryfast", crf: 23 },
  high_quality: { preset: "medium", crf: 20 },
};

export default function StudioClient() {
  const { t, locale } = useI18n();
  // Workflow step (1/2/3) — auto-derive from state
  const [mode, setMode] = useState<"twitch" | "local">("twitch");

  // Step 1: VOD input
  const [vodUrl, setVodUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoPath, setVideoPath] = useState("");
  const [logPath, setLogPath] = useState("");
  const [vodTitle, setVodTitle] = useState<string | null>(null);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [messageCount, setMessageCount] = useState(0);

  // Step 2: Candidates
  const [candidates, setCandidates] = useState<HighlightCandidate[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<HighlightCandidate | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | number | null>(null);

  // Detection params
  const [windowSec, setWindowSec] = useState(30);
  const [step, setStep] = useState(10);
  const [topN, setTopN] = useState(10);
  const [minGap, setMinGap] = useState(45);
  const [keywordWeight, setKeywordWeight] = useState(2.0);
  const [keywordsText, setKeywordsText] = useState("");

  // Analyze state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analyzeAbortController, setAnalyzeAbortController] = useState<AbortController | null>(null);

  // Step 3: Export
  const [exportSource, setExportSource] = useState<ExportSource>("twitch_vod");
  const [exportedIds, setExportedIds] = useState<Set<string | number>>(new Set());
  const [danmakuExportedIds, setDanmakuExportedIds] = useState<Set<string | number>>(new Set());
  const [exportingId, setExportingId] = useState<string | number | null>(null);
  const [isExportingTop5, setIsExportingTop5] = useState(false);
  const [exportStage, setExportStage] = useState<ExportStage | null>(null);
  const [danmakuAbortController, setDanmakuAbortController] = useState<AbortController | null>(null);
  const [danmakuLastResult, setDanmakuLastResult] = useState<DanmakuExportResponse | null>(null);

  // Danmaku options (defaults: standard quality, all comments, no cap)
  const [danmakuDensity, setDanmakuDensity] = useState<DanmakuDensity>("medium");
  const [danmakuFontSize, setDanmakuFontSize] = useState(32);
  const [danmakuCommentDuration, setDanmakuCommentDuration] = useState(4.0);
  const [danmakuOpacity, setDanmakuOpacity] = useState(0.9);
  const [danmakuNgWords, setDanmakuNgWords] = useState("");
  const [danmakuMinMessageLength, setMinMessageLength] = useState(1);
  const [danmakuDeduplicate, setDeduplicateConsecutive] = useState(true);
  const [danmakuQuality, setDanmakuQuality] = useState<FfmpegQuality>("standard");
  const [safetyCommentLimit, setSafetyCommentLimit] = useState<number | null>(null);

  // Clip length parameters — derived from clipLengthMode but
  // overridable from Advanced. Defaults: 45s split as 15s pre / 30s post.
  const [clipLengthMode, setClipLengthMode] = useState<"short" | "standard" | "long">("standard");
  const [peakPreContext, setPeakPreContext] = useState<number>(15);
  const [peakPostContext, setPeakPostContext] = useState<number>(30);
  const [maxClipDuration, setMaxClipDuration] = useState<number>(90);
  const [minClipDuration, setMinClipDuration] = useState<number>(35);
  // When clipLengthMode changes, suggest matching defaults.
  useEffect(() => {
    if (clipLengthMode === "short") {
      setPeakPreContext(10);
      setPeakPostContext(25);
      setMaxClipDuration(35);
      setMinClipDuration(30);
    } else if (clipLengthMode === "long") {
      setPeakPreContext(20);
      setPeakPostContext(60);
      setMaxClipDuration(90);
      setMinClipDuration(45);
    } else {
      // standard
      setPeakPreContext(15);
      setPeakPostContext(30);
      setMaxClipDuration(60);
      setMinClipDuration(35);
    }
  }, [clipLengthMode]);
  const [outputDir, setOutputDir] = useState<string>(() => {
    if (typeof window === "undefined") return "output/danmaku-clips";
    try {
      const stored = window.localStorage.getItem("danmaku-output-dir");
      if (stored) return stored;
    } catch {}
    return "output/danmaku-clips";
  });

  // Save outputDir to localStorage when it changes
  useEffect(() => {
    try {
      window.localStorage.setItem("danmaku-output-dir", outputDir);
    } catch {}
  }, [outputDir]);

  // Player refs
  const localPlayerRef = useRef<import("@/components/studio/LocalVideoPlayer").LocalVideoPlayerHandle | null>(null);
  const twitchPlayerRef = useRef<import("@/components/studio/TwitchVodPlayer").TwitchVodPlayerHandle | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerStartTime, setPlayerStartTime] = useState(0);
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  // Player time tracking
  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);
  const handleDurationChange = useCallback((duration: number) => {
    if (Number.isFinite(duration) && duration > 0) setVideoDuration(duration);
  }, []);

  // Log
  type LogLevel = "user" | "info" | "warn" | "error";
  const [logs, setLogs] = useState<{ level: LogLevel; message: string }[]>([]);
  const addLog = useCallback((level: LogLevel, message: string) => {
    setLogs((prev) => [...prev.slice(-199), { level, message }]);
  }, []);

  // Chat in range for selected candidate
  const [normalizedChat, setNormalizedChat] = useState<DanmakuChatMessage[]>([]);
  const chatInRange = useMemo(() => {
    if (!selectedCandidate) return [] as DanmakuChatMessage[];
    const start = selectedCandidate.clip_start ?? selectedCandidate.start ?? 0;
    const end = selectedCandidate.end ?? (selectedCandidate.clip_start != null && selectedCandidate.clip_duration != null
      ? selectedCandidate.clip_start + selectedCandidate.clip_duration
      : start + 30);
    return normalizedChat.filter((m) => m.time_sec >= start && m.time_sec <= end);
  }, [selectedCandidate, normalizedChat]);

  // Auto-derive workflow step
  const currentStep: 1 | 2 | 3 = useMemo(() => {
    if (candidates.length === 0) return 1;
    if (!selectedCandidate) return 1;
    return 3; // Once selected, jump to export
  }, [candidates.length, selectedCandidate]);

  const reachable: { 1: boolean; 2: boolean; 3: boolean } = useMemo(() => ({
    1: true,
    2: candidates.length > 0,
    3: !!selectedCandidate,
  }), [candidates.length, selectedCandidate]);

  // Max score for CandidateCard scaling
  const maxScore = useMemo(
    () => candidates.reduce((m, c) => (typeof c.score === "number" && c.score > m ? c.score : m), 0),
    [candidates],
  );

  // Default export source follows mode
  useEffect(() => {
    if (mode === "twitch" && videoId) {
      setExportSource("twitch_vod");
    } else if (mode === "local" && videoPath.trim()) {
      setExportSource("local_file");
    }
  }, [mode, videoId, videoPath]);

  // ===== Step 1: VOD load =====
  const handleLoadVod = useCallback(async () => {
    if (!vodUrl.trim()) return;
    setErrorMessage(null);
    const id = extractVideoId(vodUrl);
    if (!id) {
      setErrorMessage(t("studio.unsupportedVodUrl"));
      return;
    }
    setVideoId(id);
    setVodTitle(id);
    setChatLoaded(false);
    setCandidates([]);
    setTimeline([]);
    setSelectedCandidate(null);
    setSelectedCandidateId(null);
    setExportedIds(new Set());
    setDanmakuExportedIds(new Set());
    setMessageCount(0);
    addLog("user", t("studio.logVodRequired"));
  }, [vodUrl, addLog, t]);

  // ===== Step 1: Auto-analyze =====
  const handleAnalyze = useCallback(async () => {
    if (mode === "twitch") {
      if (!videoId) { setErrorMessage(t("studio.loadVodFirst")); return; }
      if (!vodUrl.trim()) { setErrorMessage(t("studio.noUrlProvided")); return; }
    } else {
      if (!videoPath.trim()) { setErrorMessage(t("studio.errorNoLocalFile")); return; }
      if (!logPath.trim()) { setErrorMessage(t("studio.errorNoLocalFile")); return; }
    }

    const controller = new AbortController();
    setAnalyzeAbortController(controller);
    setIsAnalyzing(true);
    setProgress(0);
    setProgressLabel("");
    setErrorMessage(null);
    setCandidates([]);
    setTimeline([]);
    setSelectedCandidate(null);
    setSelectedCandidateId(null);
    setExportedIds(new Set());
    setDanmakuExportedIds(new Set());
    setMessageCount(0);
    addLog("user", t("studio.logAnalyzeStart"));

    try {
      const endpoint = mode === "twitch" ? "/api/studio/analyze-vod" : "/api/studio/analyze-local";
      const body = mode === "twitch"
        ? {
            vod_url: vodUrl,
            top_n: topN,
            window: windowSec,
            min_gap: minGap,
            step,
            keyword_weight: keywordWeight,
            keywords: keywordsText.trim() || undefined,
          }
        : {
            video_path: videoPath,
            log_path: logPath,
            top_n: topN,
            window: windowSec,
            min_gap: minGap,
            step,
            keyword_weight: keywordWeight,
            keywords: keywordsText.trim() || undefined,
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      // Read SSE
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "progress") {
              setProgress(event.progress);
              setProgressLabel(event.message);
            } else if (event.type === "result") {
              setVodTitle(event.title ?? event.video_id);
              if (event.normalized_chat) {
                setNormalizedChat(
                  event.normalized_chat.map((m: any) => ({
                    timestamp: Number(m.timestamp_seconds ?? m.timestamp ?? 0),
                    time_sec: Number(m.timestamp_seconds ?? m.time_sec ?? 0),
                    message: String(m.message ?? ""),
                    author: m.author_name,
                  })),
                );
                setMessageCount(event.normalized_chat.length);
                setChatLoaded(true);
              } else {
                setChatLoaded(true);
              }
              if (event.candidates?.length > 0) {
                setCandidates(event.candidates);
                setTimeline(event.timeline ?? []);
                setMessageCount(event.message_count ?? event.normalized_chat?.length ?? 0);
                addLog("user", t("studio.logCandidatesDetected", { count: event.candidates.length }));
                // Auto-select top candidate
                const top = event.candidates[0];
                setSelectedCandidate(top);
                setSelectedCandidateId(top.id ?? top.rank);
              } else {
                addLog("warn", t("studio.logNoCandidates"));
              }
            }
          } catch {
            // skip malformed
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        addLog("user", t("studio.btnCancel"));
      } else {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setErrorMessage(msg);
        addLog("error", msg);
      }
    } finally {
      setIsAnalyzing(false);
      setAnalyzeAbortController(null);
    }
  }, [mode, videoId, vodUrl, videoPath, logPath, topN, windowSec, minGap, step, keywordWeight, keywordsText, addLog, t]);

  // ===== Step 2: Candidate selection =====
  const handleSelectCandidate = useCallback((candidate: HighlightCandidate) => {
    setSelectedCandidate(candidate);
    setSelectedCandidateId(candidate.id ?? candidate.rank);
    addLog("user", t("studio.logSelectCandidate", { rank: candidate.rank, time: "" }));
  }, [addLog, t]);

  // ===== Player actions (jump / preview / set from current) =====
  const seekToPlayer = useCallback((timeSeconds: number) => {
    const clamped = Math.max(0, timeSeconds);
    setPlayerStartTime(clamped);
    setCurrentTime(clamped);
    if (mode === "twitch" && twitchPlayerRef.current?.seekTo) {
      const ok = twitchPlayerRef.current.seekTo(clamped);
      if (ok) return;
    }
    setPlayerReloadKey((v) => v + 1);
  }, [mode]);

  const handleJumpStart = useCallback(() => {
    if (!selectedCandidate) return;
    seekToPlayer(selectedCandidate.clip_start ?? selectedCandidate.start ?? 0);
  }, [selectedCandidate, seekToPlayer]);

  const handleJumpPeak = useCallback(() => {
    if (!selectedCandidate) return;
    seekToPlayer(selectedCandidate.peak_time ?? ((selectedCandidate.clip_start ?? 0) + (selectedCandidate.clip_duration ?? 30) / 2));
  }, [selectedCandidate, seekToPlayer]);

  const handleJumpEnd = useCallback(() => {
    if (!selectedCandidate) return;
    const start = selectedCandidate.clip_start ?? selectedCandidate.start ?? 0;
    const dur = selectedCandidate.clip_duration ?? 30;
    seekToPlayer(Math.max(0, start + dur - 1));
  }, [selectedCandidate, seekToPlayer]);

  const handlePreviewRange = useCallback(() => {
    if (!selectedCandidate) return;
    seekToPlayer(selectedCandidate.clip_start ?? selectedCandidate.start ?? 0);
    addLog("user", t("studio.logPreview", { time: "" }));
  }, [selectedCandidate, seekToPlayer, addLog, t]);

  const handleSetStartFromCurrent = useCallback(() => {
    if (!selectedCandidate) return;
    const newStart = currentTime;
    const end = selectedCandidate.end ?? (selectedCandidate.clip_start != null && selectedCandidate.clip_duration != null ? selectedCandidate.clip_start + selectedCandidate.clip_duration : newStart + 30);
    const updated: HighlightCandidate = {
      ...selectedCandidate,
      clip_start: newStart,
      start: newStart,
      clip_duration: Math.max(1, end - newStart),
    };
    setSelectedCandidate(updated);
    setCandidates((prev) => prev.map((c) => c.rank === selectedCandidate.rank ? updated : c));
  }, [selectedCandidate, currentTime]);

  const handleSetEndFromCurrent = useCallback(() => {
    if (!selectedCandidate) return;
    const newEnd = currentTime;
    const start = selectedCandidate.clip_start ?? selectedCandidate.start ?? 0;
    const updated: HighlightCandidate = {
      ...selectedCandidate,
      end: newEnd,
      clip_duration: Math.max(1, newEnd - start),
    };
    setSelectedCandidate(updated);
    setCandidates((prev) => prev.map((c) => c.rank === selectedCandidate.rank ? updated : c));
  }, [selectedCandidate, currentTime]);

  // ===== Step 3: Export =====
  const qualityToFfmpeg = (q: FfmpegQuality) => QUALITY_TO_FFMPEG[q];

  const buildDanmakuOptions = (): DanmakuExportOptions => {
    const q = qualityToFfmpeg(danmakuQuality);
    return {
      density: danmakuDensity,
      font_size: danmakuFontSize,
      comment_duration: danmakuCommentDuration,
      opacity: danmakuOpacity,
      ng_words: danmakuNgWords.split(",").map((s) => s.trim()).filter(Boolean),
      min_message_length: danmakuMinMessageLength,
      deduplicate_consecutive: danmakuDeduplicate,
      all_comments: true,
      safety_comment_limit: safetyCommentLimit,
      preset: q.preset as any,
      crf: q.crf,
      reuse_temp_clip: true,
      reuse_ass: false,
      output_dir: outputDir,
    };
  };

  const handleExportSingle = useCallback(async () => {
    if (!selectedCandidate) {
      addLog("error", t("studio.logCandidateRequired"));
      return;
    }
    setExportStage("vod_fetch");
    setIsExportingTop5(false);
    setExportingId(selectedCandidate.id ?? selectedCandidate.rank);
    setDanmakuLastResult(null);
    setErrorMessage(null);

    const controller = new AbortController();
    setDanmakuAbortController(controller);

    addLog("user", t("studio.logExportUser", { rank: selectedCandidate.rank, start: "", end: "" }));
    const opts = buildDanmakuOptions();
    opts.output_dir = outputDir;

    try {
      setExportStage("vod_fetch");
      if (exportSource === "twitch_vod") {
        addLog("info", t("studio.logVodRangeFetch"));
      }
      setExportStage("comment_extract");
      const result = await exportDanmakuClip({
        source: exportSource as DanmakuExportSource,
        video_path: exportSource === "local_file" ? videoPath : null,
        vod_url: exportSource === "twitch_vod" ? vodUrl : null,
        video_id: exportSource === "twitch_vod" ? videoId : null,
        candidate: selectedCandidate,
        chat: chatInRange,
        edited_start: selectedCandidate.clip_start ?? selectedCandidate.start,
        edited_end: selectedCandidate.end,
        options: { ...opts, with_danmaku: true, all_comments: true, safety_comment_limit: safetyCommentLimit },
      }, controller.signal);

      if (!result.ok) {
        addLog("error", result.message ?? "Export failed");
        setErrorMessage(result.message ?? t("studio.errorExportFailed", { message: "" }));
        setDanmakuLastResult(result);
        return;
      }

      setExportStage("ass_generate");
      setExportStage("mp4_burn");
      setDanmakuLastResult(result);
      setDanmakuExportedIds((prev) => new Set(prev).add(selectedCandidate.id ?? selectedCandidate.rank));
      addLog("user", t("studio.logExportComplete", { path: result.output_file ?? "" }));
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        addLog("user", t("studio.btnCancel"));
      } else {
        const msg = e instanceof Error ? e.message : "Unknown error";
        addLog("error", msg);
        setErrorMessage(msg);
      }
    } finally {
      setExportingId(null);
      setDanmakuAbortController(null);
      setExportStage("complete");
      setTimeout(() => setExportStage(null), 1500);
    }
  }, [selectedCandidate, exportSource, vodUrl, videoId, videoPath, chatInRange, outputDir, danmakuQuality, danmakuDensity, danmakuFontSize, danmakuCommentDuration, danmakuOpacity, danmakuNgWords, danmakuMinMessageLength, danmakuDeduplicate, safetyCommentLimit, addLog, t]);

  const handleExportTop5 = useCallback(async () => {
    if (candidates.length === 0) return;
    setExportStage("vod_fetch");
    setIsExportingTop5(true);
    setExportingId(null);
    setDanmakuLastResult(null);
    setErrorMessage(null);

    const controller = new AbortController();
    setDanmakuAbortController(controller);

    addLog("user", `${t("studio.btnExportTop5")} (${Math.min(5, candidates.length)})`);
    const top5 = candidates.slice(0, 5);
    const opts = buildDanmakuOptions();
    opts.output_dir = outputDir;

    try {
      // Use Twitch VOD source by default for top 5
      const effectiveSource: ExportSource = exportSource === "ass_only" ? "twitch_vod" : exportSource;
      setExportStage("vod_fetch");
      setExportStage("comment_extract");
      setExportStage("ass_generate");
      setExportStage("mp4_burn");
      // For top 5, we call batchCreateStudioClips for non-danmaku, but
      // for danmaku we need a loop with per-candidate export
      let successCount = 0;
      for (let i = 0; i < top5.length; i++) {
        const c = top5[i];
        const r = await exportDanmakuClip({
          source: effectiveSource,
          video_path: effectiveSource === "local_file" ? videoPath : null,
          vod_url: effectiveSource === "twitch_vod" ? vodUrl : null,
          video_id: effectiveSource === "twitch_vod" ? videoId : null,
          candidate: c,
          chat: normalizedChat.filter((m) => {
            const start = c.clip_start ?? c.start ?? 0;
            const end = c.end ?? (c.clip_start != null && c.clip_duration != null ? c.clip_start + c.clip_duration : start + 30);
            return m.time_sec >= start && m.time_sec <= end;
          }),
          options: { ...opts, with_danmaku: true, all_comments: true, safety_comment_limit: safetyCommentLimit },
        }, controller.signal);
        if (r.ok) {
          successCount++;
          setDanmakuExportedIds((prev) => new Set(prev).add(c.id ?? c.rank));
        } else {
          addLog("error", r.message ?? "Export failed");
        }
      }
      addLog("user", `Top 5 出力: ${successCount}/${top5.length} 完了`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        addLog("user", t("studio.btnCancel"));
      } else {
        const msg = e instanceof Error ? e.message : "Unknown error";
        addLog("error", msg);
      }
    } finally {
      setIsExportingTop5(false);
      setDanmakuAbortController(null);
      setExportStage("complete");
      setTimeout(() => setExportStage(null), 1500);
    }
  }, [candidates, exportSource, vodUrl, videoId, videoPath, normalizedChat, outputDir, danmakuQuality, danmakuDensity, danmakuFontSize, danmakuCommentDuration, danmakuOpacity, danmakuNgWords, danmakuMinMessageLength, danmakuDeduplicate, safetyCommentLimit, addLog, t]);

  const handleCancelExport = useCallback(() => {
    if (danmakuAbortController) {
      danmakuAbortController.abort();
      addLog("user", t("studio.btnCancel"));
    }
  }, [danmakuAbortController, addLog, t]);

  // Step navigation
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      // Ctrl+E
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (selectedCandidate) handleExportSingle();
        return;
      }
      // j/k
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        if (candidates.length === 0) return;
        const currentIdx = selectedCandidate
          ? candidates.findIndex((c) => c.rank === selectedCandidate.rank)
          : -1;
        handleSelectCandidate(candidates[Math.min(candidates.length - 1, currentIdx + 1)]);
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        if (candidates.length === 0) return;
        const currentIdx = selectedCandidate
          ? candidates.findIndex((c) => c.rank === selectedCandidate.rank)
          : candidates.length;
        handleSelectCandidate(candidates[Math.max(0, currentIdx - 1)]);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (candidates[idx]) {
          e.preventDefault();
          handleSelectCandidate(candidates[idx]);
        }
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [candidates, selectedCandidate, handleSelectCandidate, handleExportSingle]);

  return (
    <div className="min-h-screen flex flex-col bg-[#050816]">
      {/* Compact header */}
      <header className="bg-slate-900/80 border-b border-slate-700/50 px-5 py-2 flex items-center gap-3">
        <h1 className="text-lg font-bold text-cyan-300 whitespace-nowrap">
          🎬 {t("studio.title")}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
        </div>
      </header>

      {/* Step navigation */}
      <StepContainer
        currentStep={currentStep}
        reachable={reachable}
        onStepClick={() => {
          // Navigation is informational only in this build;
          // the user advances automatically by completing each step.
        }}
      />

      {/* Main 3-step flow */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-5 py-4 space-y-4">
        {/* Step 1: VOD input */}
        <Step1VodInput
          vodUrl={vodUrl}
          setVodUrl={setVodUrl}
          videoId={videoId}
          chatLoaded={chatLoaded}
          messageCount={messageCount}
          candidatesCount={candidates.length}
          vodTitle={vodTitle}
          isAnalyzing={isAnalyzing}
          progressLabel={progressLabel}
          progress={progress}
          errorMessage={errorMessage}
          onLoad={handleLoadVod}
          onAutoAnalyze={handleAnalyze}
        />

        {/* Video preview area: VOD loaded → show player + timeline */}
        {videoId && (
          <VideoArea
            mode={mode}
            videoId={videoId}
            videoPath={videoPath}
            vodTitle={vodTitle}
            playerStartTime={playerStartTime}
            playerReloadKey={playerReloadKey}
            currentTime={currentTime}
            videoDuration={videoDuration}
            twitchPlayerRef={twitchPlayerRef}
            localPlayerRef={localPlayerRef}
            timeline={timeline}
            selectedCandidate={selectedCandidate}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={handleDurationChange}
            onSeek={seekToPlayer}
            onJumpStart={handleJumpStart}
            onJumpPeak={handleJumpPeak}
            onJumpEnd={handleJumpEnd}
            onPreview={handlePreviewRange}
            onSetStartFromCurrent={handleSetStartFromCurrent}
            onSetEndFromCurrent={handleSetEndFromCurrent}
            onSelectCandidate={handleSelectCandidate}
          />
        )}

        {/* Step 2: Candidates (only shown when candidates exist) */}
        {candidates.length > 0 && (
          <Step2CandidateList
            candidates={candidates}
            selectedCandidateId={selectedCandidateId}
            exportedCandidateIds={exportedIds}
            danmakuExportedIds={danmakuExportedIds}
            exportingCandidateId={exportingId}
            canExport={!!selectedCandidate}
            maxScore={maxScore}
            onSelect={handleSelectCandidate}
            onExport={handleExportSingle}
            onExportTop5={handleExportTop5}
            isExportingTop5={isExportingTop5}
          />
        )}

        {/* Step 3: Export panel (only when a candidate is selected) */}
        {selectedCandidate && (
          <Step3ExportPanel
            candidate={selectedCandidate}
            chatInRangeCount={chatInRange.length}
            burnedCount={chatInRange.length}
            outputDir={outputDir}
            isExporting={!!exportingId && exportingId === (selectedCandidate.id ?? selectedCandidate.rank)}
            isExportingTop5={isExportingTop5}
            currentStage={exportStage}
            fallbackAvailable={!!danmakuLastResult?.fallback}
            lastResult={danmakuLastResult}
            onExportSingle={handleExportSingle}
            onExportTop5={handleExportTop5}
            onCancel={handleCancelExport}
            onShowAdvanced={() => setAdvancedOpen(true)}
          />
        )}

        {/* Advanced settings (collapsed by default) */}
        <AdvancedSettings
          isOpen={advancedOpen}
          onToggle={() => setAdvancedOpen((v) => !v)}
          windowSec={windowSec} setWindowSec={setWindowSec}
          step={step} setStep={setStep}
          topN={topN} setTopN={setTopN}
          minGap={minGap} setMinGap={setMinGap}
          keywordWeight={keywordWeight} setKeywordWeight={setKeywordWeight}
          keywordsText={keywordsText} setKeywordsText={setKeywordsText}
          exportSource={exportSource}
          setExportSource={setExportSource}
          vodUrl={vodUrl}
          videoPath={videoPath}
          setVideoPath={setVideoPath}
          logPath={logPath}
          setLogPath={setLogPath}
          mode={mode}
          density={danmakuDensity} setDensity={setDanmakuDensity}
          fontSize={danmakuFontSize} setFontSize={setDanmakuFontSize}
          commentDuration={danmakuCommentDuration} setCommentDuration={setDanmakuCommentDuration}
          opacity={danmakuOpacity} setOpacity={setDanmakuOpacity}
          ngWords={danmakuNgWords} setNgWords={setDanmakuNgWords}
          minMessageLength={danmakuMinMessageLength} setMinMessageLength={setMinMessageLength}
          deduplicateConsecutive={danmakuDeduplicate}
          setDeduplicateConsecutive={setDeduplicateConsecutive}
          safetyCommentLimit={safetyCommentLimit}
          setSafetyCommentLimit={setSafetyCommentLimit}
          quality={danmakuQuality}
          setQuality={setDanmakuQuality}
          outputDir={outputDir}
          setOutputDir={setOutputDir}
        />

        {/* Bottom: log + right notice */}
        <details className="bg-slate-900/40 rounded p-2 text-[10px] text-slate-500">
          <summary className="cursor-pointer">Activity Log ({logs.length})</summary>
          <div className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
            {logs.slice(-50).map((l, i) => (
              <div
                key={i}
                className={
                  l.level === "error"
                    ? "text-red-300"
                    : l.level === "warn"
                      ? "text-amber-300"
                      : l.level === "info"
                        ? "text-slate-500"
                        : "text-slate-300"
                }
              >
                {l.message}
              </div>
            ))}
          </div>
        </details>

        <div className="text-[9px] text-slate-600 leading-relaxed text-center">
          ⚠ {t("studio.rightNotice")}
        </div>
      </main>
    </div>
  );
}
