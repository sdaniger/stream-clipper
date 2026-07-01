"use client";
import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { extractVideoId, toHighlightCandidate, type HighlightCandidate } from "@/lib/twitch-time";
import { useI18n } from "@/lib/i18n";
import StepContainer from "@/components/studio/StepContainer";
import Step1VodInput from "@/components/studio/Step1VodInput";
import CandidateTabs from "@/components/studio/CandidateTabs";
import Step3ExportPanel from "@/components/studio/Step3ExportPanel";
import LanguageSwitcher from "@/components/studio/LanguageSwitcher";
import TimelineGraph from "@/components/studio/TimelineGraph";
import VideoPlayer from "@/components/studio/VideoPlayer";
import {
  startAnalyzeJob,
  startRenderJob,
  startPreviewJob,
  pollJobUntilDone,
  cancelJob,
  type JobState,
  type Candidate,
  type RenderRequest,
  type PreviewRenderRequest,
  type BatchItem,
} from "@/lib/studio-jobs-api";
import JobProgress from "@/components/studio/JobProgress";
import {
  DEFAULT_DANMAKU_RENDER_OPTIONS,
  type CommentBurnInMode,
  type DanmakuStylePreset,
  type DanmakuRenderOptions,
} from "@/types/danmaku-render";

export default function StudioClient() {
  const { t, locale } = useI18n();
  const isJa = locale === "ja";

  // ─── Step 1: VOD ────────────────────────────────────────────────────────
  const [vodUrl, setVodUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [vodTitle, setVodTitle] = useState<string | null>(null);
  const [streamer, setStreamer] = useState<string | null>(null);
  const [vodDuration, setVodDuration] = useState<number | null>(null);
  const [analyzeJob, setAnalyzeJob] = useState<JobState | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  // Separate render error state so render failures don't bleed into
  // the analyze-side error UI.
  const [renderError, setRenderError] = useState<string | null>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);

  // ─── Analysis params (hidden from normal users) ─────────────────────────
  const [advancedAnalysisOpen, setAdvancedAnalysisOpen] = useState(false);
  const [windowSec, setWindowSec] = useState(30);
  const [step, setStep] = useState(10);
  const [topShort, setTopShort] = useState(5);
  const [topMedium, setTopMedium] = useState(5);
  const [topLong, setTopLong] = useState(3);
  const [keywordsText, setKeywordsText] = useState("");
  const [scoringWeights, setScoringWeights] = useState({
    chat: 1.0, unique_author: 0.5, keyword: 2.0, laugh: 1.2,
    surprise: 1.5, clip_worthy: 1.8, reaction: 1.3, burst: 1.5,
  });

  // ─── Step 2: Candidates ─────────────────────────────────────────────────
  const [candidates, setCandidates] = useState<{
    short: Candidate[]; medium: Candidate[]; long: Candidate[];
  }>({ short: [], medium: [], long: [] });
  const [timeline, setTimeline] = useState<any[]>([]);
  const [normalizedChat, setNormalizedChat] = useState<
    Array<{ timestamp: number; time_sec: number; message: string; author?: string }>
  >([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [exportedIds, setExportedIds] = useState<Set<string>>(new Set());
  const [exportingIds, setExportingIds] = useState<Set<string>>(new Set());
  const [candidateFeedback, setCandidateFeedback] = useState<Record<string, "good" | "bad" | "maybe">>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(window.localStorage.getItem("studio-candidate-feedback") || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("studio-candidate-feedback", JSON.stringify(candidateFeedback)); } catch {}
  }, [candidateFeedback]);

  // ─── Step 3: Render ─────────────────────────────────────────────────────
  const [currentRenderJob, setCurrentRenderJob] = useState<JobState | null>(null);
  const [currentPreviewJob, setCurrentPreviewJob] = useState<JobState | null>(null);
  const renderAbortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  // ─── Batch render ───────────────────────────────────────────────────────
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const batchQueueRef = useRef<Candidate[]>([]);

  // Export settings
  const [exportSource, setExportSource] = useState<"twitch_vod" | "local_file" | "ass_only">("twitch_vod");
  const [withDanmaku, setWithDanmaku] = useState(true);
  const [ffmpegPreset, setFfmpegPreset] = useState<"ultrafast" | "veryfast" | "fast" | "medium" | "slow">("fast");
  const [ffmpegCrf, setFfmpegCrf] = useState(23);
  const [videoPath, setVideoPath] = useState("");
  const [outputDir, setOutputDir] = useState<string>(() => {
    if (typeof window === "undefined") return "output/clips";
    try { return window.localStorage.getItem("studio-output-dir") || "output/clips"; } catch { return "output/clips"; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("studio-output-dir", outputDir); } catch {}
  }, [outputDir]);

  // Comment burn-in mode + style preset
  const [commentBurnInMode, setCommentBurnInMode] = useState<CommentBurnInMode>("hard_burn");
  const [danmakuStylePreset, setDanmakuStylePreset] = useState<DanmakuStylePreset>("niconico_classic");
  const [danmakuRenderOptions, setDanmakuRenderOptions] = useState<DanmakuRenderOptions>(() => ({
    ...DEFAULT_DANMAKU_RENDER_OPTIONS,
    burnInMode: "hard_burn",
    stylePreset: "niconico_classic",
  }));
  // Sync render options preset fields when the user changes the preset
  useEffect(() => {
    setDanmakuRenderOptions((prev) => ({
      ...prev,
      burnInMode: commentBurnInMode,
      stylePreset: danmakuStylePreset,
    }));
  }, [commentBurnInMode, danmakuStylePreset]);

  // Danmaku NG words (kept separate for back-compat with existing UI)
  const [danmakuNgWords, setDanmakuNgWords] = useState("");

  // Transcription
  const [transcriptionProvider, setTranscriptionProvider] = useState<"auto" | "existing" | "whisper_cpp" | "disabled">("auto");

  // Player
  const [currentTime, setCurrentTime] = useState(0);
  const [playerStartTime, setPlayerStartTime] = useState(0);
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  // Step detection
  const currentStep: 1 | 2 | 3 = useMemo(() => {
    if (candidates.short.length + candidates.medium.length + candidates.long.length === 0) return 1;
    if (!selectedCandidate && !currentRenderJob && batchItems.length === 0) return 2;
    return 3;
  }, [candidates, selectedCandidate, currentRenderJob, batchItems]);
  const reachable = useMemo(() => ({ 1: true, 2: true, 3: true }), []);

  // ─── Step 1: Analyze ────────────────────────────────────────────────────
  const runAnalyze = useCallback(async () => {
    if (!vodUrl.trim()) { setAnalyzeError(isJa ? "VOD URL を入力してください" : "Enter a VOD URL"); return; }
    const id = extractVideoId(vodUrl);
    if (id) { setVideoId(id); if (!vodTitle) setVodTitle(id); }
    setAnalyzeError(null); setAnalyzeJob(null);
    setCandidates({ short: [], medium: [], long: [] });
    setTimeline([]); setSelectedCandidate(null); setNormalizedChat([]);
    setBatchItems([]);

    const abortController = new AbortController();
    analyzeAbortRef.current = abortController;
    try {
      const custom_keywords = keywordsText.split(",").map(s => s.trim()).filter(Boolean);
      const feedbackValues = Object.values(candidateFeedback);
      const good = feedbackValues.filter(v => v === "good").length;
      const bad = feedbackValues.filter(v => v === "bad").length;
      const feedbackBias = Math.max(-0.2, Math.min(0.25, (good - bad) * 0.015));
      const adaptiveWeights = {
        ...scoringWeights,
        keyword: scoringWeights.keyword + feedbackBias,
        clip_worthy: scoringWeights.clip_worthy + feedbackBias,
        unique_author: scoringWeights.unique_author + Math.max(0, feedbackBias * 0.5),
      };
      const startResp = await startAnalyzeJob({
        vod_url: vodUrl, window: windowSec, step,
        top_short: topShort, top_medium: topMedium, top_long: topLong,
        min_score: 0.0, custom_keywords, scoring_weights: adaptiveWeights,
      });
      const state = await pollJobUntilDone(startResp.job_id, s => setAnalyzeJob(s), {
        intervalMs: 1000, signal: abortController.signal,
      });
      if (state.status === "completed") {
        const r = state.result;
        setVodTitle(r.vod_title || r.video_id || vodUrl);
        setStreamer(r.streamer || null);
        setVodDuration(r.vod_duration || null);
        setCandidates({ short: r.candidates?.short || [], medium: r.candidates?.medium || [], long: r.candidates?.long || [] });
        setTimeline(r.timeline || []);
        if (r.normalized_chat) setNormalizedChat(r.normalized_chat);
      } else if (state.status === "failed") {
        setAnalyzeError(state.error_message || state.error_code || (isJa ? "分析に失敗しました" : "Analysis failed"));
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setAnalyzeError(e instanceof Error ? e.message : "Unknown error");
      }
    } finally { analyzeAbortRef.current = null; }
  }, [vodUrl, windowSec, step, topShort, topMedium, topLong, keywordsText, scoringWeights, candidateFeedback, isJa, vodTitle]);

  // Player actions
  const seekToPlayer = useCallback((timeSeconds: number) => {
    setPlayerStartTime(Math.max(0, timeSeconds));
    setCurrentTime(Math.max(0, timeSeconds));
    setPlayerReloadKey(v => v + 1);
  }, []);

  // ─── Step 2: Select candidate ──────────────────────────────────────────
  const handleSelectCandidate = useCallback((c: Candidate) => {
    setSelectedCandidate(c);
    const targetTime = c.peak_time ?? c.clip_start ?? 0;
    seekToPlayer(targetTime);
  }, [seekToPlayer]);

  const handleCandidateFeedback = useCallback((candidateId: string, value: "good" | "bad" | "maybe") => {
    setCandidateFeedback(prev => ({ ...prev, [candidateId]: value }));
  }, []);

  // Convert job-API candidates to the legacy HighlightCandidate shape
  // for the TimelineGraph component. We memoize per render so the
  // graph does not re-render unnecessarily.
  const candidatesForGraph: HighlightCandidate[] = useMemo(() => {
    return [
      ...candidates.short,
      ...candidates.medium,
      ...candidates.long,
    ].map(toHighlightCandidate);
  }, [candidates]);

  const selectedForGraph: HighlightCandidate | null = useMemo(
    () => (selectedCandidate ? toHighlightCandidate(selectedCandidate) : null),
    [selectedCandidate],
  );

  const chatInRange = useMemo(() => {
    if (!selectedCandidate) return [] as typeof normalizedChat;
    const start = selectedCandidate.clip_start ?? 0;
    const end = selectedCandidate.clip_end ?? start;
    return normalizedChat.filter(m => m.time_sec >= start && m.time_sec <= end);
  }, [selectedCandidate, normalizedChat]);

  const chatInRangeCount = chatInRange.length || (selectedCandidate?.chat_count ?? 0);

  const top5Candidates = useMemo(() => {
    const out: Candidate[] = [];
    for (const c of candidates.short.slice(0, 3)) out.push(c);
    if (candidates.medium[0]) out.push(candidates.medium[0]);
    if (candidates.long[0]) out.push(candidates.long[0]);
    return out.slice(0, 5);
  }, [candidates]);

  // ─── Step 3: Render a single candidate ─────────────────────────────────
  const startRenderForCandidate = useCallback(async (c: Candidate) => {
    if (!c) return;
    setRenderError(null);
    if (exportSource === "twitch_vod" && !vodUrl.trim()) {
      setRenderError(isJa ? "Twitch VOD source には URL が必要です" : "Twitch VOD source needs a URL");
      return;
    }
    if (exportSource === "local_file" && !videoPath.trim()) {
      setRenderError(isJa ? "Local file sourceには動画パスが必要です" : "Local file source needs a video path");
      return;
    }
    const cid = c.candidate_id;
    setExportingIds(prev => new Set(prev).add(cid));

    const abortController = new AbortController();
    renderAbortRef.current = abortController;

    const custom_keywords = keywordsText.split(",").map(s => s.trim()).filter(Boolean);
    const opts: RenderRequest["options"] = {
      density: danmakuRenderOptions.density === "insane" ? "high" : danmakuRenderOptions.density === "normal" ? "medium" : danmakuRenderOptions.density,
      font_size: danmakuRenderOptions.fontSize,
      comment_duration: danmakuRenderOptions.durationSec,
      opacity: danmakuRenderOptions.opacity,
      outline: danmakuRenderOptions.outline,
      shadow: danmakuRenderOptions.shadow,
      style_preset: danmakuRenderOptions.stylePreset,
      max_lanes: danmakuRenderOptions.maxLanes,
      max_comments_per_second: danmakuRenderOptions.maxCommentsPerSecond,
      ng_words: danmakuNgWords.split(",").map(s => s.trim()).filter(Boolean),
    };
    const target_aspect: "16:9" | "9:16" = c.kind === "short" ? "9:16" : "16:9";

    try {
      const chatInRangeForCand = normalizedChat.filter(
        m => m.time_sec >= (c.clip_start ?? 0) && m.time_sec <= (c.clip_end ?? 0),
      );
      const startResp = await startRenderJob({
        candidate: c, source: exportSource,
        vod_url: exportSource === "twitch_vod" ? vodUrl : null,
        video_id: exportSource === "twitch_vod" ? videoId : null,
        video_path: exportSource === "local_file" ? videoPath : null,
        chat_messages: chatInRangeForCand, options: opts,
        output_dir: outputDir, with_danmaku: withDanmaku,
        comment_burn_in_mode: commentBurnInMode,
        danmaku_style_preset: danmakuStylePreset,
        ffmpeg_preset: ffmpegPreset, ffmpeg_crf: ffmpegCrf,
        target_aspect, streamer_name: streamer, vod_title: vodTitle,
        transcription_provider: transcriptionProvider,
      });
      const state = await pollJobUntilDone(startResp.job_id, s => setCurrentRenderJob(s), {
        intervalMs: 1000, signal: abortController.signal,
      });
      if (state.status === "completed") {
        setExportedIds(prev => new Set(prev).add(cid));
        return "completed";
      } else if (state.status === "failed") {
        const msg = state.error_message || state.error_code || "Render failed";
        setRenderError(msg);
        return { failed: true, error_message: msg };
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return "cancelled";
      }
      const msg = e instanceof Error ? e.message : "Unknown error";
      setRenderError(msg);
      return { failed: true, error_message: msg };
    } finally {
      setExportingIds(prev => { const n = new Set(prev); n.delete(cid); return n; });
      renderAbortRef.current = null;
    }
    return "completed";
  }, [exportSource, vodUrl, videoId, videoPath, keywordsText, danmakuRenderOptions, danmakuNgWords,
      outputDir, withDanmaku, commentBurnInMode, danmakuStylePreset,
      ffmpegPreset, ffmpegCrf, normalizedChat, streamer, vodTitle, transcriptionProvider, isJa]);

  // ─── Batch render runner ───────────────────────────────────────────────
  const runBatchRender = useCallback(async (list: Candidate[]) => {
    if (list.length === 0) return;
    setRenderError(null);
    const items: BatchItem[] = list.map(c => ({
      candidate_id: c.candidate_id,
      rank: c.rank,
      kind: c.kind,
      status: "pending",
    }));
    setBatchItems(items);
    batchQueueRef.current = list;

    // We track the batch's active candidate separately from the user's
    // selectedCandidate so the user's click selection is not overwritten
    // when a batch render is running.
    for (let i = 0; i < list.length; i++) {
      if (renderAbortRef.current?.signal.aborted) break;
      setBatchItems(prev => prev.map((item, idx) =>
        idx === i ? { ...item, status: "active" } :
        idx < i ? item :
        { ...item, status: "pending" }
      ));
      const result = await startRenderForCandidate(list[i]);
      if (result === "cancelled") break;
      if (result === "completed") {
        setBatchItems(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: "completed" } : item
        ));
      } else if (result && typeof result === "object" && "failed" in result) {
        setBatchItems(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: "failed", error_message: result.error_message } : item
        ));
      }
    }
    setBatchItems(prev => prev.map(item =>
      item.status === "active" ? { ...item, status: "failed" } : item
    ));
  }, [startRenderForCandidate]);

  const handleExportSelected = useCallback(() => {
    if (selectedCandidate) {
      setBatchItems([]);
      startRenderForCandidate(selectedCandidate).catch(console.error);
    }
  }, [selectedCandidate, startRenderForCandidate]);

  const handleExportTop5 = useCallback(() => {
    if (top5Candidates.length === 0) return;
    runBatchRender(top5Candidates);
  }, [top5Candidates, runBatchRender]);

  const handleExportAllShort = useCallback(() => {
    if (candidates.short.length === 0) return;
    runBatchRender(candidates.short);
  }, [candidates.short, runBatchRender]);

  const handleExportAllMedium = useCallback(() => {
    if (candidates.medium.length === 0) return;
    runBatchRender(candidates.medium);
  }, [candidates.medium, runBatchRender]);

  const handleExportAllLong = useCallback(() => {
    if (candidates.long.length === 0) return;
    runBatchRender(candidates.long);
  }, [candidates.long, runBatchRender]);

  const handleCancelRender = useCallback(() => {
    if (renderAbortRef.current) renderAbortRef.current.abort();
    if (currentRenderJob) cancelJob(currentRenderJob.job_id).catch(console.error);
    setBatchItems([]);
  }, [currentRenderJob]);

  // ─── Preview (short, low-res burn-in) ─────────────────────────────────
  const handleGeneratePreview = useCallback(async () => {
    const c = selectedCandidate;
    if (!c) return;
    setCurrentPreviewJob(null);
    const abortController = new AbortController();
    previewAbortRef.current = abortController;
    try {
      const chatInRangeForCand = normalizedChat.filter(
        m => m.time_sec >= (c.clip_start ?? 0) && m.time_sec <= (c.clip_end ?? 0),
      );
      const previewReq: PreviewRenderRequest = {
        candidate: c,
        source: exportSource,
        vod_url: exportSource === "twitch_vod" ? vodUrl : null,
        video_id: exportSource === "twitch_vod" ? videoId : null,
        video_path: exportSource === "local_file" ? videoPath : null,
        chat_messages: chatInRangeForCand,
        options: {
          density: danmakuRenderOptions.density === "insane" ? "high" : danmakuRenderOptions.density === "normal" ? "medium" : danmakuRenderOptions.density,
          font_size: danmakuRenderOptions.fontSize,
          comment_duration: danmakuRenderOptions.durationSec,
          opacity: danmakuRenderOptions.opacity,
          outline: danmakuRenderOptions.outline,
          shadow: danmakuRenderOptions.shadow,
          style_preset: danmakuRenderOptions.stylePreset,
          max_lanes: danmakuRenderOptions.maxLanes,
          max_comments_per_second: danmakuRenderOptions.maxCommentsPerSecond,
        },
        danmaku_style_preset: danmakuStylePreset,
        max_duration_sec: 30,
        preview_width: 1280,
        preview_height: 720,
      };
      const startResp = await startPreviewJob(previewReq);
      const state = await pollJobUntilDone(startResp.job_id, s => setCurrentPreviewJob(s), {
        intervalMs: 1000, signal: abortController.signal,
      });
      return state;
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        console.error("Preview failed:", e);
      }
    } finally {
      previewAbortRef.current = null;
    }
  }, [
    selectedCandidate, exportSource, vodUrl, videoId, videoPath, normalizedChat,
    danmakuRenderOptions, danmakuStylePreset,
  ]);

  const handleCancelPreview = useCallback(() => {
    if (previewAbortRef.current) previewAbortRef.current.abort();
    if (currentPreviewJob) cancelJob(currentPreviewJob.job_id).catch(console.error);
  }, [currentPreviewJob]);

  const handleCancelAnalyze = useCallback(() => {
    if (analyzeAbortRef.current) analyzeAbortRef.current.abort();
    if (analyzeJob) cancelJob(analyzeJob.job_id).catch(console.error);
  }, [analyzeJob]);

  const handleDismissJob = useCallback(() => {
    setCurrentRenderJob(null); setAnalyzeJob(null); setAnalyzeError(null); setRenderError(null);
    setBatchItems([]);
  }, []);

  const handleRetry = useCallback(() => {
    if (selectedCandidate) {
      setBatchItems([]);
      startRenderForCandidate(selectedCandidate).catch(console.error);
    }
  }, [selectedCandidate, startRenderForCandidate]);

  const isAnalyzing = !!analyzeJob && analyzeJob.status !== "completed" && analyzeJob.status !== "failed" && analyzeJob.status !== "cancelled";

  const counts = { short: candidates.short.length, medium: candidates.medium.length, long: candidates.long.length };
  const hasCandidates = counts.short + counts.medium + counts.long > 0;
  const hasActiveJob = !!currentRenderJob || batchItems.some(i => i.status === "active") || batchItems.some(i => i.status === "pending");

  return (
    <div className="min-h-screen flex flex-col bg-[#050816]">
      {/* ── Header ── */}
      <header className="bg-slate-900/80 border-b border-slate-700/50 px-3 sm:px-5 py-1.5 sm:py-2 flex items-center gap-2">
        <h1 className="text-sm sm:text-base font-bold text-cyan-300 whitespace-nowrap">🎬 Stream Clipper</h1>
        <span className="hidden sm:inline text-[9px] text-slate-500">
          {isJa ? "配信アーカイブ自動切り抜き" : "Auto-clip from livestream archives"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
        </div>
      </header>

      {/* ── Step Nav ── */}
      <StepContainer currentStep={currentStep} reachable={reachable} />

      {/* ── Main Content ── */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-3 sm:px-5 py-3 sm:py-4 space-y-3 sm:space-y-4">
        {/* ====== STEP 1: VOD Input ====== */}
        <Step1VodInput
          vodUrl={vodUrl}
          setVodUrl={setVodUrl}
          videoId={videoId}
          isAnalyzing={isAnalyzing}
          progressLabel={analyzeJob?.message ?? ""}
          progress={analyzeJob?.progress ?? 0}
          errorMessage={analyzeError}
          vodTitle={vodTitle}
          onAutoAnalyze={runAnalyze}
        />

        {/* Analyze job progress (covers active + completed + failed + cancelled) */}
        {analyzeJob && (
          <JobProgress
            job={analyzeJob}
            candidate={null}
            onCancel={handleCancelAnalyze}
            onDismiss={handleDismissJob}
          />
        )}

        {/* Skeleton loading while analyzing */}
        {isAnalyzing && !hasCandidates && (
          <div className="space-y-3 animate-pulse">
            <div className="flex gap-1 mb-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex-1 h-8 bg-slate-800/60 rounded-lg" />
              ))}
            </div>
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-xl p-4 border border-slate-700/50 bg-slate-800/30 space-y-3">
                <div className="flex justify-between">
                  <div className="h-4 w-20 bg-slate-700/50 rounded" />
                  <div className="h-4 w-8 bg-slate-700/50 rounded" />
                </div>
                <div className="h-3 w-32 bg-slate-700/40 rounded" />
                <div className="h-10 w-full bg-slate-700/30 rounded-lg" />
                <div className="h-3 w-24 bg-slate-700/40 rounded" />
              </div>
            ))}
          </div>
        )}

        {/* VOD info bar (compact, after analysis) */}
        {videoId && hasCandidates && !isAnalyzing && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 border border-slate-700/40 rounded-lg text-[10px] text-slate-400">
            <span className="text-cyan-300 font-semibold truncate">📺 {vodTitle || videoId}</span>
            {vodDuration && (
              <span className="shrink-0">· {Math.round(vodDuration / 60)}{isJa ? "分" : "min"}</span>
            )}
            {streamer && (
              <span className="shrink-0">· {streamer}</span>
            )}
            <span className="shrink-0 text-slate-500">
              · {isJa ? "候補" : "Candidates"}: {counts.short + counts.medium + counts.long}
            </span>
          </div>
        )}

        {/* Advanced analysis settings (hidden tiny toggle) */}
        <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg">
          <button type="button" onClick={() => setAdvancedAnalysisOpen(!advancedAnalysisOpen)}
            className="w-full px-3 py-1 text-left hover:bg-slate-800/40 flex items-center gap-2 transition-colors">
            <span className="text-[9px] text-slate-600">{advancedAnalysisOpen ? "▼" : "▶"}</span>
            <span className="text-[9px] text-slate-500 uppercase tracking-wider font-medium">
              {isJa ? "解析設定（上級者向け）" : "Analysis Settings (Advanced)"}
            </span>
          </button>
          {advancedAnalysisOpen && (
            <div className="px-3 pb-3 pt-1 border-t border-slate-800/50 space-y-2 text-[11px]">
              <div className="grid grid-cols-3 gap-2">
                <label><span className="text-slate-400">{isJa ? "窓幅" : "Window"}(s)</span>
                  <input type="number" value={windowSec} onChange={e => setWindowSec(Number(e.target.value))}
                    className="w-full px-1.5 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100 mt-0.5" /></label>
                <label><span className="text-slate-400">{isJa ? "ステップ" : "Step"}(s)</span>
                  <input type="number" value={step} onChange={e => setStep(Number(e.target.value))}
                    className="w-full px-1.5 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100 mt-0.5" /></label>
                <label><span className="text-slate-400">Shorts</span>
                  <input type="number" value={topShort} onChange={e => setTopShort(Number(e.target.value))}
                    className="w-full px-1.5 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100 mt-0.5" /></label>
                <label><span className="text-slate-400">{isJa ? "通常" : "Std"}</span>
                  <input type="number" value={topMedium} onChange={e => setTopMedium(Number(e.target.value))}
                    className="w-full px-1.5 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100 mt-0.5" /></label>
                <label><span className="text-slate-400">{isJa ? "長尺" : "Long"}</span>
                  <input type="number" value={topLong} onChange={e => setTopLong(Number(e.target.value))}
                    className="w-full px-1.5 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100 mt-0.5" /></label>
                <label><span className="text-slate-400">{isJa ? "キーワード重み" : "Kw weight"}</span>
                  <input type="number" step="0.1" value={scoringWeights.keyword}
                    onChange={e => setScoringWeights(w => ({ ...w, keyword: Number(e.target.value) }))}
                    className="w-full px-1.5 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100 mt-0.5" /></label>
              </div>
              <label><span className="text-slate-400">{isJa ? "追加キーワード（カンマ区切り）" : "Extra keywords (comma-separated)"}</span>
                <input type="text" value={keywordsText} onChange={e => setKeywordsText(e.target.value)}
                  placeholder="草, 笑, lol, 神"
                  className="w-full mt-0.5 px-1.5 py-1 bg-slate-800/60 border border-slate-700/40 rounded text-slate-100" /></label>
            </div>
          )}
        </div>

        {/* ====== Video Player + Comments Preview ====== */}
        {hasCandidates && selectedCandidate && (
          <div className="space-y-2">
            <VideoPlayer
              sourceType={exportSource === "twitch_vod" ? "twitch" : (currentRenderJob?.status === "completed" && currentRenderJob.result?.output_path ? "rendered" : (currentPreviewJob?.status === "completed" && currentPreviewJob.result?.preview_path ? "preview" : "local"))}
              src={
                currentRenderJob?.status === "completed" && currentRenderJob.result?.output_path
                  ? `/api/media/files?path=${encodeURIComponent(currentRenderJob.result.output_path)}`
                  : currentPreviewJob?.status === "completed" && currentPreviewJob.result?.preview_path
                  ? `/api/media/files?path=${encodeURIComponent(currentPreviewJob.result.preview_path)}`
                  : null
              }
              twitchVideoId={videoId}
              startSeconds={selectedCandidate.clip_start ?? 0}
              aspect={selectedCandidate.kind === "short" ? "9:16" : "16:9"}
              candidate={{
                clip_start: selectedCandidate.clip_start ?? 0,
                clip_end: selectedCandidate.clip_end ?? 0,
                rank: selectedCandidate.rank,
              }}
              chatMessages={normalizedChat}
              currentTime={currentTime - (selectedCandidate.clip_start ?? 0)}
              playing={false}
              onTimeUpdate={(t) => setCurrentTime(t + (selectedCandidate.clip_start ?? 0))}
              commentMode={commentBurnInMode}
              danmakuOptions={danmakuRenderOptions}
              title={`#${selectedCandidate.rank} ${selectedCandidate.kind === "short" ? "Shorts" : selectedCandidate.kind === "medium" ? (isJa ? "通常" : "Standard") : (isJa ? "長尺" : "Long")}`}
            />
          </div>
        )}

        {/* ====== STEP 2: Candidates + Timeline ====== */}
        {hasCandidates && (
          <div className="flex flex-col lg:flex-row gap-3 sm:gap-4">
            {/* Left: candidates */}
            <div className="flex-1 min-w-0">
              <CandidateTabs
                short={candidates.short}
                medium={candidates.medium}
                long={candidates.long}
                selectedCandidateId={selectedCandidate?.candidate_id ?? null}
                exportingCandidateIds={exportingIds}
                exportedCandidateIds={exportedIds}
                onSelect={handleSelectCandidate}
                onExport={c => startRenderForCandidate(c)}
                onFeedback={handleCandidateFeedback}
                feedbackById={candidateFeedback}
              />
            </div>

            {/* Right: timeline + info */}
            {timeline.length > 0 && (
              <div className="w-full lg:w-80 xl:w-96 shrink-0 space-y-3">
                <TimelineGraph
                  timeline={timeline}
                  candidates={candidatesForGraph}
                  selectedCandidate={selectedForGraph}
                  currentTime={currentTime}
                  duration={videoDuration}
                  maxTime={vodDuration ?? 0}
                  onSeek={seekToPlayer}
                  onSelectCandidate={(c) => {
                    const full = [
                      ...candidates.short,
                      ...candidates.medium,
                      ...candidates.long,
                    ].find(
                      (x) => (x.candidate_id === c.id) || (x.rank === c.rank),
                    );
                    if (full) handleSelectCandidate(full);
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* ====== STEP 3: Export / Generate ====== */}
        {hasCandidates && (
          <Step3ExportPanel
            candidate={selectedCandidate}
            selectedCandidates={top5Candidates}
            chatInRangeCount={chatInRangeCount}
            outputDir={outputDir}
            commentBurnInMode={commentBurnInMode}
            setCommentBurnInMode={setCommentBurnInMode}
            danmakuStylePreset={danmakuStylePreset}
            setDanmakuStylePreset={setDanmakuStylePreset}
            danmakuRenderOptions={danmakuRenderOptions}
            setDanmakuRenderOptions={setDanmakuRenderOptions}
            withDanmaku={withDanmaku}
            setWithDanmaku={setWithDanmaku}
            ffmpegPreset={ffmpegPreset}
            setFfmpegPreset={setFfmpegPreset}
            ffmpegCrf={ffmpegCrf}
            setFfmpegCrf={setFfmpegCrf}
            sourceMode={exportSource}
            setSourceMode={setExportSource}
            localFilePath={videoPath}
            setLocalFilePath={setVideoPath}
            currentJob={currentRenderJob}
            previewJob={currentPreviewJob}
            batchItems={batchItems}
            onExportSelected={handleExportSelected}
            onExportTop5={handleExportTop5}
            onExportAllShort={handleExportAllShort}
            onExportAllMedium={handleExportAllMedium}
            onExportAllLong={handleExportAllLong}
            onGeneratePreview={handleGeneratePreview}
            onCancel={handleCancelRender}
            onCancelPreview={handleCancelPreview}
            onRetry={handleRetry}
            onDismissJob={handleDismissJob}
            vodUrlAvailable={!!vodUrl.trim()}
            counts={counts}
            danmakuNgWords={danmakuNgWords}
            setDanmakuNgWords={setDanmakuNgWords}
            transcriptionProvider={transcriptionProvider}
            setTranscriptionProvider={setTranscriptionProvider}
          />
        )}

        {/* Footer notice */}
        <div className="text-[8px] sm:text-[9px] text-slate-600 leading-relaxed text-center pt-1">
          ⚠ {t("studio.rightNotice")}
        </div>
      </main>
    </div>
  );
}
