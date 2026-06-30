"use client";
import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { extractVideoId } from "@/lib/twitch-time";
import { useI18n } from "@/lib/i18n";
import StepContainer from "@/components/studio/StepContainer";
import Step1VodInput from "@/components/studio/Step1VodInput";
import CandidateTabs from "@/components/studio/CandidateTabs";
import Step3ExportPanel from "@/components/studio/Step3ExportPanel";
import AdvancedSettings, {
  type ExportSource,
  type FfmpegQuality,
  type ScoringWeights,
} from "@/components/studio/AdvancedSettings";
import LanguageSwitcher from "@/components/studio/LanguageSwitcher";
import VideoArea from "@/components/studio/VideoArea";
import {
  startAnalyzeJob,
  startRenderJob,
  pollJobUntilDone,
  cancelJob,
  type JobState,
  type Candidate,
  type RenderRequest,
} from "@/lib/studio-jobs-api";

const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  chat: 1.0,
  unique_author: 0.5,
  keyword: 2.0,
  laugh: 1.2,
  surprise: 1.5,
  clip_worthy: 1.8,
  reaction: 1.3,
  burst: 1.5,
};

export default function StudioClient() {
  const { t, locale } = useI18n();
  // Step 1
  const [vodUrl, setVodUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoPath, setVideoPath] = useState("");
  const [logPath, setLogPath] = useState("");
  const [vodTitle, setVodTitle] = useState<string | null>(null);
  const [streamer, setStreamer] = useState<string | null>(null);
  const [vodDuration, setVodDuration] = useState<number | null>(null);

  // Step 1 analyze state
  const [analyzeJob, setAnalyzeJob] = useState<JobState | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);

  // Step 2 candidates
  const [candidates, setCandidates] = useState<{
    short: Candidate[];
    medium: Candidate[];
    long: Candidate[];
  }>({ short: [], medium: [], long: [] });
  const [timeline, setTimeline] = useState<any[]>([]);
  const [normalizedChat, setNormalizedChat] = useState<
    Array<{ timestamp: number; time_sec: number; message: string; author?: string }>
  >([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [exportedIds, setExportedIds] = useState<Set<string>>(new Set());
  const [exportingIds, setExportingIds] = useState<Set<string>>(new Set());

  // Step 3 job
  const [currentRenderJob, setCurrentRenderJob] = useState<JobState | null>(null);
  const [lastRenderResult, setLastRenderResult] = useState<any>(null);
  const renderAbortRef = useRef<AbortController | null>(null);

  // Advanced settings
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [windowSec, setWindowSec] = useState(30);
  const [step, setStep] = useState(10);
  const [topShort, setTopShort] = useState(5);
  const [topMedium, setTopMedium] = useState(5);
  const [topLong, setTopLong] = useState(3);
  const [minGap, setMinGap] = useState(45);
  const [keywordWeight, setKeywordWeight] = useState(2.0);
  const [keywordsText, setKeywordsText] = useState("");
  const [scoringWeights, setScoringWeights] = useState<ScoringWeights>(DEFAULT_SCORING_WEIGHTS);

  // Step 3 source
  const [exportSource, setExportSource] = useState<ExportSource>("twitch_vod");
  const [withDanmaku, setWithDanmaku] = useState(true);
  const [ffmpegQuality, setFfmpegQuality] = useState<FfmpegQuality>("standard");
  const [safetyCommentLimit, setSafetyCommentLimit] = useState<number | null>(null);

  // Danmaku
  const [danmakuDensity, setDanmakuDensity] = useState<"low" | "medium" | "high">("medium");
  const [danmakuFontSize, setDanmakuFontSize] = useState(32);
  const [danmakuCommentDuration, setDanmakuCommentDuration] = useState(4.0);
  const [danmakuOpacity, setDanmakuOpacity] = useState(0.9);
  const [danmakuNgWords, setDanmakuNgWords] = useState("");
  const [danmakuMinMessageLength, setMinMessageLength] = useState(1);
  const [danmakuDeduplicate, setDeduplicateConsecutive] = useState(true);

  // Output dir
  const [outputDir, setOutputDir] = useState<string>(() => {
    if (typeof window === "undefined") return "output/clips";
    try {
      const stored = window.localStorage.getItem("studio-output-dir");
      if (stored) return stored;
    } catch {}
    return "output/clips";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("studio-output-dir", outputDir);
    } catch {}
  }, [outputDir]);

  // Player refs (reused from VideoArea)
  const localPlayerRef = useRef<any>(null);
  const twitchPlayerRef = useRef<any>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerStartTime, setPlayerStartTime] = useState(0);
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  // Quality → ffmpeg params
  const QUALITY_TO_FFMPEG = {
    high_speed: { preset: "ultrafast", crf: 26 },
    standard: { preset: "veryfast", crf: 23 },
    high_quality: { preset: "medium", crf: 20 },
  } as const;
  const ffmpegPreset = QUALITY_TO_FFMPEG[ffmpegQuality].preset as "ultrafast" | "veryfast" | "fast" | "medium" | "slow";
  const ffmpegCrf = QUALITY_TO_FFMPEG[ffmpegQuality].crf;

  // Step state
  const currentStep: 1 | 2 | 3 = useMemo(() => {
    if (candidates.short.length + candidates.medium.length + candidates.long.length === 0) return 1;
    if (!selectedCandidate && !currentRenderJob) return 2;
    return 3;
  }, [candidates, selectedCandidate, currentRenderJob]);
  const reachable = useMemo(
    () => ({ 1: true, 2: true, 3: true }),
    [],
  );

  // ─── Step 1: Load + Auto-analyze ──────────────────────────────────────────
  const handleLoadVod = useCallback(() => {
    const id = extractVideoId(vodUrl);
    if (!id) return;
    setVideoId(id);
    setVodTitle(id);
    setChatLoadedFromUrl(vodUrl);
  }, [vodUrl]);

  // Just resolves the VOD URL into a video id, no chat fetch yet
  const setChatLoadedFromUrl = (url: string) => {
    // No-op placeholder; we just need videoId for the analyze step.
  };

  // ─── Step 1: Run analyze job ──────────────────────────────────────────────
  const runAnalyze = useCallback(async () => {
    if (!vodUrl.trim()) {
      setAnalyzeError("VOD URL を入力してください");
      return;
    }
    // Extract & set the video id early so the video player has it
    const id = extractVideoId(vodUrl);
    if (id) {
      setVideoId(id);
      if (!vodTitle) setVodTitle(id);
    }
    setAnalyzeError(null);
    setAnalyzeJob(null);
    setCandidates({ short: [], medium: [], long: [] });
    setTimeline([]);
    setSelectedCandidate(null);
    setNormalizedChat([]);
    setLastRenderResult(null);

    const abortController = new AbortController();
    analyzeAbortRef.current = abortController;

    try {
      const custom_keywords = keywordsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const startResp = await startAnalyzeJob({
        vod_url: vodUrl,
        window: windowSec,
        step,
        top_short: topShort,
        top_medium: topMedium,
        top_long: topLong,
        min_score: 0.0,
        custom_keywords,
        scoring_weights: scoringWeights,
      });
      const jobId = startResp.job_id;
      // poll
      const state = await pollJobUntilDone(
        jobId,
        (s) => setAnalyzeJob(s),
        { intervalMs: 1000, signal: abortController.signal },
      );
      if (state.status === "completed") {
        const r = state.result;
        setVodTitle(r.vod_title || r.video_id || vodUrl);
        setStreamer(r.streamer || null);
        setVodDuration(r.vod_duration || null);
        setCandidates({
          short: r.candidates?.short || [],
          medium: r.candidates?.medium || [],
          long: r.candidates?.long || [],
        });
        setTimeline(r.timeline || []);
        if (r.normalized_chat) {
          setNormalizedChat(r.normalized_chat);
        }
      } else if (state.status === "failed") {
        setAnalyzeError(state.error_message || state.error_code || "分析に失敗しました");
      }
    } catch (e) {
      if (e instanceof Error && e.message === "aborted") {
        // user cancelled
      } else {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setAnalyzeError(msg);
      }
    } finally {
      analyzeAbortRef.current = null;
    }
  }, [
    vodUrl,
    windowSec,
    step,
    topShort,
    topMedium,
    topLong,
    keywordsText,
    scoringWeights,
  ]);

  // ─── Step 2: Select candidate ─────────────────────────────────────────────
  const handleSelectCandidate = useCallback((c: Candidate) => {
    setSelectedCandidate(c);
  }, []);

  // Compute chat in range for the selected candidate
  const chatInRange = useMemo(() => {
    if (!selectedCandidate) return [] as typeof normalizedChat;
    const start = selectedCandidate.clip_start ?? 0;
    const end = selectedCandidate.clip_end ?? start;
    return normalizedChat.filter((m) => m.time_sec >= start && m.time_sec <= end);
  }, [selectedCandidate, normalizedChat]);

  // For batch: top 5 = top short + top 1 medium + top 1 long
  const top5Candidates = useMemo(() => {
    const out: Candidate[] = [];
    // Take top 3 shorts
    for (const c of candidates.short.slice(0, 3)) out.push(c);
    // Then 1 medium
    if (candidates.medium[0]) out.push(candidates.medium[0]);
    // Then 1 long
    if (candidates.long[0]) out.push(candidates.long[0]);
    return out.slice(0, 5);
  }, [candidates]);

  // ─── Step 3: Render pipeline ──────────────────────────────────────────────
  const startRenderForCandidate = useCallback(
    async (c: Candidate) => {
      if (!c) return;
      if (exportSource === "twitch_vod" && !vodUrl.trim()) {
        setAnalyzeError("Twitch VOD source には URL が必要です");
        return;
      }
      if (exportSource === "local_file" && !videoPath.trim()) {
        setAnalyzeError("Local file ソースには video path が必要です");
        return;
      }
      const cid = c.candidate_id;
      setExportingIds((prev) => new Set(prev).add(cid));
      setLastRenderResult(null);

      const abortController = new AbortController();
      renderAbortRef.current = abortController;

      const custom_keywords = keywordsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const opts: RenderRequest["options"] = {
        density: danmakuDensity,
        font_size: danmakuFontSize,
        comment_duration: danmakuCommentDuration,
        opacity: danmakuOpacity,
        ng_words: danmakuNgWords.split(",").map((s) => s.trim()).filter(Boolean),
        min_message_length: danmakuMinMessageLength,
        deduplicate_consecutive: danmakuDeduplicate,
        safety_comment_limit: safetyCommentLimit,
      };
      const target_aspect: "16:9" | "9:16" = c.kind === "short" ? "9:16" : "16:9";

      try {
        const chatInRangeForCand = normalizedChat.filter(
          (m) => m.time_sec >= (c.clip_start ?? 0) && m.time_sec <= (c.clip_end ?? 0),
        );
        const startResp = await startRenderJob({
          candidate: c,
          source: exportSource,
          vod_url: exportSource === "twitch_vod" ? vodUrl : null,
          video_id: exportSource === "twitch_vod" ? videoId : null,
          video_path: exportSource === "local_file" ? videoPath : null,
          chat_messages: chatInRangeForCand,
          options: opts,
          output_dir: outputDir,
          with_danmaku: withDanmaku,
          ffmpeg_preset: ffmpegPreset,
          ffmpeg_crf: ffmpegCrf,
          target_aspect,
          streamer_name: streamer,
          vod_title: vodTitle,
        });
        const jobId = startResp.job_id;
        const state = await pollJobUntilDone(
          jobId,
          (s) => setCurrentRenderJob(s),
          { intervalMs: 1000, signal: abortController.signal },
        );
        if (state.status === "completed") {
          setExportedIds((prev) => new Set(prev).add(cid));
          setLastRenderResult({
            output_file: state.result.output_path,
            ass_file: state.result.ass_path,
            metadata_path: state.result.metadata_path,
            youtube: state.result.youtube,
          });
        } else if (state.status === "failed") {
          setAnalyzeError(state.error_message || state.error_code || "生成に失敗しました");
        }
      } catch (e) {
        if (e instanceof Error && e.message === "aborted") {
          // user cancelled
        } else {
          const msg = e instanceof Error ? e.message : "Unknown error";
          setAnalyzeError(msg);
        }
      } finally {
        setExportingIds((prev) => {
          const next = new Set(prev);
          next.delete(cid);
          return next;
        });
        setCurrentRenderJob(null);
        renderAbortRef.current = null;
      }
    },
    [
      exportSource,
      vodUrl,
      videoId,
      videoPath,
      keywordsText,
      danmakuDensity,
      danmakuFontSize,
      danmakuCommentDuration,
      danmakuOpacity,
      danmakuNgWords,
      danmakuMinMessageLength,
      danmakuDeduplicate,
      safetyCommentLimit,
      outputDir,
      withDanmaku,
      ffmpegPreset,
      ffmpegCrf,
      normalizedChat,
      streamer,
      vodTitle,
    ],
  );

  // Single export
  const handleExportSelected = useCallback(() => {
    if (!selectedCandidate) return;
    startRenderForCandidate(selectedCandidate);
  }, [selectedCandidate, startRenderForCandidate]);

  // Top-5 batch
  const handleExportTop5 = useCallback(async () => {
    for (const c of top5Candidates) {
      if (renderAbortRef.current?.signal.aborted) break;
      await startRenderForCandidate(c);
    }
  }, [top5Candidates, startRenderForCandidate]);

  // All-of-kind batch
  const handleExportAllShort = useCallback(async () => {
    for (const c of candidates.short) {
      if (renderAbortRef.current?.signal.aborted) break;
      await startRenderForCandidate(c);
    }
  }, [candidates.short, startRenderForCandidate]);
  const handleExportAllMedium = useCallback(async () => {
    for (const c of candidates.medium) {
      if (renderAbortRef.current?.signal.aborted) break;
      await startRenderForCandidate(c);
    }
  }, [candidates.medium, startRenderForCandidate]);
  const handleExportAllLong = useCallback(async () => {
    for (const c of candidates.long) {
      if (renderAbortRef.current?.signal.aborted) break;
      await startRenderForCandidate(c);
    }
  }, [candidates.long, startRenderForCandidate]);

  const handleCancelRender = useCallback(() => {
    if (renderAbortRef.current) {
      renderAbortRef.current.abort();
    }
    if (currentRenderJob) {
      cancelJob(currentRenderJob.job_id);
    }
  }, [currentRenderJob]);

  const handleDismissJob = useCallback(() => {
    setCurrentRenderJob(null);
    setLastRenderResult(null);
    setAnalyzeError(null);
  }, []);

  const handleCancelAnalyze = useCallback(() => {
    if (analyzeAbortRef.current) {
      analyzeAbortRef.current.abort();
    }
    if (analyzeJob) {
      cancelJob(analyzeJob.job_id);
    }
  }, [analyzeJob]);

  // For Step 1, "isAnalyzing" is true when there's an active analyze job
  const isAnalyzing = !!analyzeJob && analyzeJob.status !== "completed" && analyzeJob.status !== "failed" && analyzeJob.status !== "cancelled";
  const analyzeProgress = analyzeJob?.progress ?? 0;
  const analyzeProgressLabel = analyzeJob?.message ?? "";

  // Chat count estimate from candidates (since we don't always have it from job)
  const chatInRangeCount = chatInRange.length || (selectedCandidate?.chat_count ?? 0);

  // Player actions
  const seekToPlayer = useCallback((timeSeconds: number) => {
    const clamped = Math.max(0, timeSeconds);
    setPlayerStartTime(clamped);
    setCurrentTime(clamped);
    if (twitchPlayerRef.current?.seekTo) {
      const ok = twitchPlayerRef.current.seekTo(clamped);
      if (ok) return;
    }
    setPlayerReloadKey((v) => v + 1);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#050816]">
      <header className="bg-slate-900/80 border-b border-slate-700/50 px-5 py-2 flex items-center gap-3">
        <h1 className="text-lg font-bold text-cyan-300 whitespace-nowrap">
          🎬 Stream Clipper Studio
        </h1>
        <span className="text-[10px] text-slate-500 ml-2">
          自動切り抜きパイプライン · Twitch VOD → Shorts / 通常 / 長尺
        </span>
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
        </div>
      </header>

      <StepContainer
        currentStep={currentStep}
        reachable={reachable}
        onStepClick={() => {}}
      />

      <main className="flex-1 max-w-4xl mx-auto w-full px-5 py-4 space-y-4">
        {/* Step 1 */}
        <Step1VodInput
          vodUrl={vodUrl}
          setVodUrl={setVodUrl}
          videoId={videoId}
          isAnalyzing={isAnalyzing}
          progressLabel={analyzeProgressLabel}
          progress={analyzeProgress}
          errorMessage={analyzeError}
          vodTitle={vodTitle}
          onLoad={handleLoadVod}
          onAutoAnalyze={runAnalyze}
        />

        {/* Step 2: Candidates */}
        {(candidates.short.length > 0 || candidates.medium.length > 0 || candidates.long.length > 0) && (
          <CandidateTabs
            short={candidates.short}
            medium={candidates.medium}
            long={candidates.long}
            selectedCandidateId={selectedCandidate?.candidate_id ?? null}
            exportingCandidateIds={exportingIds}
            exportedCandidateIds={exportedIds}
            onSelect={handleSelectCandidate}
            onExport={(c) => startRenderForCandidate(c)}
          />
        )}

        {/* Step 3: Export */}
        <Step3ExportPanel
          candidate={selectedCandidate}
          selectedCandidates={top5Candidates}
          chatInRangeCount={chatInRangeCount}
          outputDir={outputDir}
          withDanmaku={withDanmaku}
          setWithDanmaku={setWithDanmaku}
          ffmpegPreset={ffmpegPreset}
          setFfmpegPreset={(v) => {
            // Map preset directly back to quality if it matches
            if (v === "ultrafast") setFfmpegQuality("high_speed");
            else if (v === "veryfast") setFfmpegQuality("standard");
            else if (v === "medium") setFfmpegQuality("high_quality");
          }}
          ffmpegCrf={ffmpegCrf}
          setFfmpegCrf={() => {}}
          sourceMode={exportSource}
          setSourceMode={setExportSource}
          localFilePath={videoPath}
          setLocalFilePath={setVideoPath}
          currentJob={currentRenderJob}
          lastResult={lastRenderResult}
          onExportSelected={handleExportSelected}
          onExportTop5={handleExportTop5}
          onExportAllShort={handleExportAllShort}
          onExportAllMedium={handleExportAllMedium}
          onExportAllLong={handleExportAllLong}
          onCancel={handleCancelRender}
          onDismissJob={handleDismissJob}
          vodUrlAvailable={!!vodUrl.trim()}
          counts={{
            short: candidates.short.length,
            medium: candidates.medium.length,
            long: candidates.long.length,
          }}
        />

        {/* Video area (only when there's a VOD) */}
        {videoId && (
          <VideoArea
            mode="twitch"
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
            onTimeUpdate={setCurrentTime}
            onDurationChange={(d) => setVideoDuration(d)}
            onSeek={seekToPlayer}
            onJumpStart={() => selectedCandidate && seekToPlayer(selectedCandidate.clip_start ?? 0)}
            onJumpPeak={() =>
              selectedCandidate && seekToPlayer(selectedCandidate.peak_time ?? 0)
            }
            onJumpEnd={() =>
              selectedCandidate && seekToPlayer(Math.max(0, (selectedCandidate.clip_end ?? 0) - 1))
            }
            onPreview={() => selectedCandidate && seekToPlayer(selectedCandidate.clip_start ?? 0)}
            onSetStartFromCurrent={() => {}}
            onSetEndFromCurrent={() => {}}
            onSelectCandidate={handleSelectCandidate}
          />
        )}

        {/* Advanced */}
        <AdvancedSettings
          isOpen={advancedOpen}
          onToggle={() => setAdvancedOpen((v) => !v)}
          windowSec={windowSec} setWindowSec={setWindowSec}
          step={step} setStep={setStep}
          topShort={topShort} setTopShort={setTopShort}
          topMedium={topMedium} setTopMedium={setTopMedium}
          topLong={topLong} setTopLong={setTopLong}
          minGap={minGap} setMinGap={setMinGap}
          keywordWeight={keywordWeight} setKeywordWeight={setKeywordWeight}
          keywordsText={keywordsText} setKeywordsText={setKeywordsText}
          scoringWeights={scoringWeights}
          setScoringWeights={setScoringWeights}
          exportSource={exportSource}
          setExportSource={setExportSource}
          vodUrl={vodUrl}
          videoPath={videoPath}
          setVideoPath={setVideoPath}
          logPath={logPath}
          setLogPath={setLogPath}
          mode="twitch"
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
          quality={ffmpegQuality}
          setQuality={setFfmpegQuality}
          outputDir={outputDir}
          setOutputDir={setOutputDir}
        />

        <div className="text-[9px] text-slate-600 leading-relaxed text-center pt-2">
          ⚠ {t("studio.rightNotice")}
        </div>
      </main>
    </div>
  );
}
