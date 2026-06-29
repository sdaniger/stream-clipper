"use client";
import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { extractVideoId, getCandidateSeekTime, type HighlightCandidate } from "@/lib/twitch-time";
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
import TwitchVodPlayer, { type TwitchVodPlayerHandle } from "@/components/studio/TwitchVodPlayer";
import LocalVideoPlayer, { type LocalVideoPlayerHandle } from "@/components/studio/LocalVideoPlayer";
import CandidateList from "@/components/studio/CandidateList";
import CandidateDetails from "@/components/studio/CandidateDetails";
import LogPanel from "@/components/studio/LogPanel";
import AdvancedSettings from "@/components/studio/AdvancedSettings";
import ClipActionPanel from "@/components/studio/ClipActionPanel";
import TimelineGraph from "@/components/studio/TimelineGraph";
import ExportStatusPanel from "@/components/studio/ExportStatusPanel";
import DanmakuPanel from "@/components/studio/DanmakuPanel";

type StudioMode = "twitch" | "local";
type ExportStatus = "idle" | "exporting" | "exported" | "error";
type DanmakuExportKind = "with" | "without" | "ass" | null;
type LogLevel = "user" | "info" | "warn" | "error";
type LogEntry = { level: LogLevel; message: string };

interface SseProgress {
  type: "progress";
  stage: string;
  message: string;
  progress: number;
}

interface SseResult {
  type: "result";
  video_id: string | null;
  title: string | null;
  duration_seconds: number | null;
  message_count: number;
  candidates: HighlightCandidate[];
  timeline: TimelineRow[];
  summary: Record<string, unknown> | null;
  error?: string;
  video_exists?: boolean;
  normalized_chat?: DanmakuChatMessage[];
  diagnostic?: {
    fetched_chat_count: number;
    normalized_chat_count: number;
    timeline_count: number;
    raw_candidate_count: number;
    candidates_after_threshold: number;
    candidates_after_min_gap: number;
    final_candidate_count: number;
    top_n: number;
    window: number;
    step: number;
    threshold: number;
    min_gap: number;
  };
}

interface SseError {
  type: "error";
  error: string;
}

type SseEvent = SseProgress | SseResult | SseError;

function getStart(c: HighlightCandidate): number {
  return c.clip_start ?? c.start ?? c.peak_time ?? 0;
}
function getEnd(c: HighlightCandidate): number {
  return c.end ?? (c.clip_start != null && c.clip_duration != null ? c.clip_start + c.clip_duration : getStart(c) + 30);
}
function getPeak(c: HighlightCandidate): number {
  return c.peak_time ?? (getStart(c) + getEnd(c)) / 2;
}
function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// Map SSE stage to user-friendly Japanese messages
function userFriendlyProgressMessage(stage: string, raw: string): string | null {
  if (stage === "metadata") return null; // too technical
  if (stage === "metadata_done") return "VOD情報を取得しました";
  if (stage === "chat_fetch") return "チャットを取得しています...";
  if (stage === "chat_done") return "チャットの取得が完了しました";
  if (stage === "normalize") return null;
  if (stage === "analyze") return "盛り上がりポイントを分析しています...";
  if (stage === "analyze_done") return null;
  if (stage === "timeline") return null;
  if (stage === "done") return "分析が完了しました";
  if (stage === "error") return null;
  return null;
}

export default function StudioClient() {
  const [mode, setMode] = useState<StudioMode>("twitch");

  const [vodUrl, setVodUrl] = useState("");
  const [videoPath, setVideoPath] = useState("");
  const [logPath, setLogPath] = useState("");

  // Advanced analysis params
  const [windowSec, setWindowSec] = useState(30);
  const [topN, setTopN] = useState(10);
  const [minGap, setMinGap] = useState(45);
  const [keywordsText, setKeywordsText] = useState("");
  const [step, setStep] = useState(10);
  const [clipDuration, setClipDuration] = useState(30);
  const [clipOffset, setClipOffset] = useState(10);
  const [keywordWeight, setKeywordWeight] = useState(2.0);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [videoId, setVideoId] = useState<string | null>(null);
  const [vodTitle, setVodTitle] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<HighlightCandidate[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<HighlightCandidate | null>(null);
  const [playerStartTime, setPlayerStartTime] = useState(0);
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [diagnostic, setDiagnostic] = useState<SseResult["diagnostic"] | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Export state
  const [exportedIds, setExportedIds] = useState<Set<string | number>>(new Set());
  const [exportingId, setExportingId] = useState<string | number | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [batchExportStatus, setBatchExportStatus] = useState<ExportStatus>("idle");

  // Danmaku export state
  const [normalizedChat, setNormalizedChat] = useState<DanmakuChatMessage[]>([]);
  const [danmakuExporting, setDanmakuExporting] = useState<DanmakuExportKind>(null);
  const [danmakuLastResult, setDanmakuLastResult] = useState<DanmakuExportResponse | null>(null);
  // Danmaku form state
  const [danmakuDensity, setDanmakuDensity] = useState<DanmakuDensity>("medium");
  const [danmakuMaxComments, setDanmakuMaxComments] = useState(120);
  const [danmakuFontSize, setDanmakuFontSize] = useState(32);
  const [danmakuCommentDuration, setDanmakuCommentDuration] = useState(4.0);
  const [danmakuOpacity, setDanmakuOpacity] = useState(0.9);
  const [danmakuNgWords, setDanmakuNgWords] = useState("");
  const [danmakuMinMessageLength, setDanmakuMinMessageLength] = useState(1);
  const [danmakuDeduplicate, setDanmakuDeduplicate] = useState(true);
  // Danmaku export track (which candidates have been danmaku-exported)
  const [danmakuExportedIds, setDanmakuExportedIds] = useState<Set<string | number>>(new Set());
  // Danmaku export source selection
  const [exportSource, setExportSource] = useState<DanmakuExportSource>(
    typeof window === "undefined" ? "twitch_vod" : (localStorage.getItem("danmaku-source") as DanmakuExportSource) || "twitch_vod",
  );

  useEffect(() => {
    try {
      localStorage.setItem("danmaku-source", exportSource);
    } catch {}
  }, [exportSource]);

  // Default to twitch_vod when we have a VOD URL and no local file.
  // Default to local_file when we have a local file but no VOD URL.
  // Default to ass_only when neither is available.
  useEffect(() => {
    if (mode === "twitch" && videoId && exportSource === "local_file") {
      setExportSource("twitch_vod");
    }
    if (mode === "local" && videoPath.trim() && exportSource === "twitch_vod" && !videoId) {
      setExportSource("local_file");
    }
  }, [mode, videoId, videoPath, exportSource]);

  // Player refs
  const localPlayerRef = useRef<LocalVideoPlayerHandle>(null);
  const twitchPlayerRef = useRef<TwitchVodPlayerHandle>(null);

  const addLog = useCallback((level: LogLevel, message: string) => {
    setLogs((prev) => [...prev.slice(-149), { level, message }]);
  }, []);

  const canExport = mode === "local" && !!videoPath.trim();

  // Compute maxTime for timeline graph
  const maxTime = useMemo(() => {
    if (timeline.length > 0) {
      return Math.max(...timeline.map((t) => t.end));
    }
    if (candidates.length > 0) {
      return Math.max(...candidates.map((c) => getEnd(c)));
    }
    return videoDuration || 0;
  }, [timeline, candidates, videoDuration]);

  // Seek helper - updates player state
  const seekTo = useCallback((time: number) => {
    const clamped = Math.max(0, time);
    setPlayerStartTime(clamped);
    setPlayerReloadKey((v) => v + 1);
    setCurrentTime(clamped);
  }, []);

  const handleSelectCandidate = useCallback((candidate: HighlightCandidate) => {
    const seekTime = getCandidateSeekTime(candidate);
    if (seekTime === null) {
      setErrorMessage("この候補には有効な開始時間がありません");
      addLog("error", "候補の時刻が無効なため選択できませんでした");
      return;
    }
    setSelectedCandidate(candidate);
    seekTo(seekTime);
    setErrorMessage(null);
    addLog("user", `候補 #${candidate.rank} を選択しました（${formatTimecode(seekTime)}から）`);
  }, [addLog, seekTo]);

  const handleEditCandidate = useCallback((candidate: HighlightCandidate) => {
    handleSelectCandidate(candidate);
    addLog("user", `候補 #${candidate.rank} の範囲を調整します`);
  }, [addLog, handleSelectCandidate]);

  const handleLoadVod = useCallback(() => {
    const id = extractVideoId(vodUrl);
    if (!id) {
      setErrorMessage("Twitch VOD URL から video ID を抽出できませんでした");
      return;
    }
    setVideoId(id);
    setVodTitle(null);
    setCandidates([]);
    setTimeline([]);
    setSelectedCandidate(null);
    setExportedIds(new Set());
    setExportStatus("idle");
    setBatchExportStatus("idle");
    seekTo(0);
    setErrorMessage(null);
    addLog("user", `Twitch VODを読み込みました（ID: ${id}）`);
  }, [vodUrl, addLog, seekTo]);

  const handleCancel = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsAnalyzing(false);
      setProgress(0);
      setProgressLabel("");
      addLog("user", "分析をキャンセルしました");
    }
  }, [abortController, addLog]);

  const readStream = useCallback(async (res: Response) => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event: SseEvent = JSON.parse(line.slice(6));
          if (event.type === "progress") {
            setProgress(event.progress);
            setProgressLabel(event.message);
            // Only log user-friendly progress
            const friendly = userFriendlyProgressMessage(event.stage, event.message);
            if (friendly) addLog("info", friendly);
          } else if (event.type === "result") {
            setVodTitle(event.title);
            setDiagnostic(event.diagnostic ?? null);
            // Capture normalized chat for later danmaku export. The server
            // sends the full chat array (already normalized) using the
            // {timestamp_seconds, author_name, message} format.
            const rawChat = (event as any).normalized_chat;
            if (Array.isArray(rawChat)) {
              const chatForDanmaku: DanmakuChatMessage[] = rawChat.map((m: any) => ({
                timestamp: Number(m.timestamp_seconds ?? m.timestamp ?? 0),
                time_sec: Number(m.timestamp_seconds ?? m.time_sec ?? 0),
                message: typeof m.message === "string" ? m.message : "",
                author: typeof m.author_name === "string" ? m.author_name : undefined,
              }));
              setNormalizedChat(chatForDanmaku);
            } else {
              setNormalizedChat([]);
            }
            if (event.error) {
              addLog("error", `分析エラー: ${event.error}`);
              setCandidates([]);
              setTimeline([]);
              setErrorMessage(event.error);
            } else {
              if (event.candidates.length > 0) {
                addLog("user", `${event.candidates.length}件の候補を検出しました`);
                setCandidates(event.candidates);
                setTimeline(event.timeline ?? []);
                handleSelectCandidate(event.candidates[0]);
              } else {
                addLog("warn", "候補が見つかりませんでした。チャットが静かな可能性があります");
                setCandidates([]);
                setTimeline([]);
              }
            }
          } else if (event.type === "error") {
            setErrorMessage(event.error);
            addLog("error", event.error);
          }
        } catch {
          // skip malformed events
        }
      }
    }
  }, [addLog, handleSelectCandidate]);

  const handleAnalyze = useCallback(async () => {
    if (mode === "twitch") {
      if (!videoId) { setErrorMessage("先に Twitch VOD URL を読み込んでください"); return; }
      if (!vodUrl.trim()) { setErrorMessage("Twitch VOD URL が必要です"); return; }
    } else {
      if (!videoPath.trim()) { setErrorMessage("動画ファイルのパスを入力してください"); return; }
      if (!logPath.trim()) { setErrorMessage("チャットログファイルのパスを入力してください"); return; }
    }

    const controller = new AbortController();
    setAbortController(controller);
    setIsAnalyzing(true);
    setProgress(0);
    setProgressLabel("");
    setErrorMessage(null);
    setCandidates([]);
    setTimeline([]);
    setSelectedCandidate(null);
    setExportedIds(new Set());
    setExportStatus("idle");
    setBatchExportStatus("idle");
    setDiagnostic(null);
    addLog("user", "分析を開始します...");

    try {
      const endpoint = mode === "twitch" ? "/api/studio/analyze-vod" : "/api/studio/analyze-local";
      const body = mode === "twitch"
        ? {
            vod_url: vodUrl,
            top_n: topN,
            window: windowSec,
            min_gap: minGap,
            step,
            clip_duration: clipDuration,
            clip_offset: clipOffset,
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
            clip_duration: clipDuration,
            clip_offset: clipOffset,
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

      await readStream(res);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        addLog("user", "分析をキャンセルしました");
      } else {
        const msg = e instanceof Error ? e.message : "分析に失敗しました";
        setErrorMessage(msg);
        addLog("error", msg);
      }
    } finally {
      setIsAnalyzing(false);
      setProgress(0);
      setProgressLabel("");
      setAbortController(null);
    }
  }, [mode, videoId, vodUrl, videoPath, logPath, topN, windowSec, minGap, keywordsText, step, clipDuration, clipOffset, keywordWeight, readStream, addLog]);

  // ─── Export functions ─────────────────────────────────────────────────────

  const exportCandidate = useCallback(async (candidate: HighlightCandidate) => {
    if (!canExport) {
      setErrorMessage("MP4 書き出しにはローカル動画ファイルが必要です");
      return;
    }
    const id = candidate.id ?? candidate.rank;
    setExportingId(id);
    setExportStatus("exporting");
    addLog("user", `候補 #${candidate.rank} をMP4で書き出し中...`);

    try {
      const start = getStart(candidate);
      const duration = (getEnd(candidate) - getStart(candidate)) || candidate.clip_duration || 30;
      const result = await createStudioClip({
        inputPath: videoPath,
        candidateId: `rank-${candidate.rank}`,
        variantId: "default",
        start: formatTimecode(start),
        duration: formatTimecode(duration),
        mode: "reencode",
      });
      const fileName = result.outputPath.split("/").pop();
      addLog("user", `候補 #${candidate.rank} の書き出しが完了しました（${fileName}）`);
      setExportedIds((prev) => new Set(prev).add(id));
      setExportStatus("exported");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "書き出しに失敗しました";
      setErrorMessage(msg);
      addLog("error", `書き出し失敗: ${msg}`);
      setExportStatus("error");
    } finally {
      setExportingId(null);
    }
  }, [canExport, videoPath, addLog]);

  const exportTop5 = useCallback(async () => {
    if (!canExport) {
      setErrorMessage("MP4 書き出しにはローカル動画ファイルが必要です");
      return;
    }
    if (candidates.length === 0) return;

    setBatchExportStatus("exporting");
    const top5Count = Math.min(5, candidates.length);
    addLog("user", `上位${top5Count}件を一括書き出し中...`);

    try {
      const top5 = candidates.slice(0, 5);
      const result = await batchCreateStudioClips(videoPath, top5, { mode: "reencode" });
      const newExported = new Set<string | number>(exportedIds);
      top5.forEach((c) => newExported.add(c.id ?? c.rank));
      setExportedIds(newExported);
      if (result.failed.length === 0) {
        addLog("user", `${result.clips.length}件の書き出しが完了しました`);
      } else {
        addLog("warn", `書き出し完了: ${result.clips.length}件成功、${result.failed.length}件失敗`);
        result.failed.forEach((f) => addLog("error", `  ${f.candidateId}: ${f.error}`));
      }
      setBatchExportStatus(result.failed.length === 0 ? "exported" : "error");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "一括書き出しに失敗しました";
      setErrorMessage(msg);
      addLog("error", msg);
      setBatchExportStatus("error");
    }
  }, [canExport, candidates, videoPath, exportedIds, addLog]);

  // ─── Danmaku export functions ───────────────────────────────────────────

  // Filter chat to the candidate's range
  const getChatInRange = useCallback((c: HighlightCandidate): DanmakuChatMessage[] => {
    if (normalizedChat.length === 0) return [];
    const start = getStart(c);
    const end = getEnd(c);
    return normalizedChat.filter((m) => m.time_sec >= start && m.time_sec <= end);
  }, [normalizedChat]);

  // Compute chat in range for the currently selected candidate
  const chatInRange = useMemo(() => {
    if (!selectedCandidate) return [];
    return getChatInRange(selectedCandidate);
  }, [selectedCandidate, getChatInRange]);

  const handleDanmakuExport = useCallback(async (
    kind: "with" | "without" | "ass",
    options: DanmakuExportOptions,
  ) => {
    if (!selectedCandidate) {
      addLog("error", "候補が選択されていません");
      return;
    }
    // Validate per-source requirements
    const hasVod = mode === "twitch" && !!videoId;
    const hasLocal = mode === "local" && videoPath.trim().length > 0;
    if (kind !== "ass") {
      // MP4 export requires either VOD or local file
      if (exportSource === "twitch_vod" && !hasVod) {
        addLog("error", "Twitch VOD sourceの選択にはVOD URLが必要です");
        setErrorMessage("Twitch VOD sourceの選択にはVOD URLが必要です");
        return;
      }
      if (exportSource === "local_file" && !hasLocal) {
        addLog("error", "Local file sourceの選択にはローカル動画ファイルが必要です");
        setErrorMessage("ローカル動画ファイルパスを入力してください");
        return;
      }
      if (exportSource !== "twitch_vod" && exportSource !== "local_file") {
        addLog("error", "MP4出力にはTwitch VODまたはlocal_file sourceが必要です");
        return;
      }
    } else {
      // ASS only: needs a candidate only
    }
    setDanmakuExporting(kind);
    setDanmakuLastResult(null);
    setErrorMessage(null);
    const start = getStart(selectedCandidate);
    const end = getEnd(selectedCandidate);
    addLog("user", `Export source: ${exportSource}`);
    addLog("user", `選択範囲: ${formatTimecode(start)} - ${formatTimecode(end)}`);
    addLog("user", `範囲内コメントを抽出: ${chatInRange.length}件`);

    try {
      if (kind === "with") {
        if (exportSource === "twitch_vod") {
          addLog("info", "Twitch VODから選択範囲を取得中...");
        }
        addLog("info", "弾幕ASSを生成中...");
        const result = await exportDanmakuClip({
          source: exportSource as "twitch_vod" | "local_file",
          video_path: exportSource === "local_file" ? videoPath : null,
          vod_url: exportSource === "twitch_vod" ? vodUrl : null,
          video_id: exportSource === "twitch_vod" ? videoId : null,
          candidate: selectedCandidate,
          chat: chatInRange,
          options: { ...options, with_danmaku: true },
        });
        if (!result.ok) {
          addLog("error", `弾幕出力失敗: ${result.message ?? "Unknown error"}`);
          setErrorMessage(result.message ?? "弾幕出力に失敗しました");
          setDanmakuLastResult(result);
          // If fallback is suggested, log it
          if (result.fallback) {
            const f = result.fallback;
            const opts = [];
            if (f.local_file) opts.push("ローカル動画");
            if (f.twitch_vod) opts.push("Twitch VOD (再試行)");
            if (f.ass_only) opts.push("ASSのみ");
            if (opts.length > 0) addLog("warn", `フォールバック可能: ${opts.join(" / ")}`);
          }
        } else {
          if (result.temporary_video_file) {
            addLog("user", `一時動画取得: ${result.temporary_video_file}`);
          }
          addLog("user", `弾幕として使用: ${result.comment_count}件`);
          addLog("user", `ASS生成完了: ${result.ass_file}`);
          addLog("info", "FFmpegで弾幕付き動画を書き出し中...");
          addLog("user", `弾幕付きクリップ出力完了: ${result.output_file}`);
          setDanmakuLastResult(result);
          setDanmakuExportedIds((prev) => new Set(prev).add(selectedCandidate.id ?? selectedCandidate.rank));
        }
      } else if (kind === "without") {
        if (exportSource === "twitch_vod") {
          addLog("info", "Twitch VODから選択範囲を取得中...");
        }
        addLog("info", "弾幕なしで範囲のみを切り出し中...");
        const result = await exportDanmakuClip({
          source: exportSource as "twitch_vod" | "local_file",
          video_path: exportSource === "local_file" ? videoPath : null,
          vod_url: exportSource === "twitch_vod" ? vodUrl : null,
          video_id: exportSource === "twitch_vod" ? videoId : null,
          candidate: selectedCandidate,
          chat: [],
          options: { ...options, with_danmaku: false },
        });
        if (!result.ok) {
          addLog("error", `書き出し失敗: ${result.message ?? "Unknown error"}`);
          setErrorMessage(result.message ?? "書き出しに失敗しました");
          setDanmakuLastResult(result);
          if (result.fallback) {
            const f = result.fallback;
            const opts = [];
            if (f.local_file) opts.push("ローカル動画");
            if (f.twitch_vod) opts.push("Twitch VOD (再試行)");
            if (f.ass_only) opts.push("ASSのみ");
            if (opts.length > 0) addLog("warn", `フォールバック可能: ${opts.join(" / ")}`);
          }
        } else {
          addLog("user", `弾幕なし書き出し完了: ${result.output_file}`);
          setDanmakuLastResult(result);
        }
      } else {
        // ASS only
        addLog("info", "ASSファイルを生成中...");
        const result = await generateAssOnly({
          chat: chatInRange,
          clip_start: start,
          clip_end: end,
          output_path: `output/clip_${Date.now()}_${selectedCandidate.rank}.ass`,
          options,
        });
        if (!result.ok) {
          addLog("error", `ASS生成失敗: ${result.message ?? "Unknown error"}`);
          setErrorMessage(result.message ?? "ASS生成に失敗しました");
        } else {
          addLog("user", `ASS生成完了: ${result.ass_path} (${result.comment_count}件使用)`);
          setDanmakuLastResult({
            ok: true,
            source: "ass_only",
            ass_file: result.ass_path,
            comment_count: result.comment_count,
            in_range_count: result.in_range_count,
            skipped_ng: result.skipped_ng,
            skipped_too_short: result.skipped_too_short,
            skipped_duplicate: result.skipped_duplicate,
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      addLog("error", msg);
      setErrorMessage(msg);
    } finally {
      setDanmakuExporting(null);
    }
  }, [selectedCandidate, canExport, videoPath, chatInRange, addLog]);

  // ─── Action panel handlers ────────────────────────────────────────────────

  const handleJumpStart = useCallback(() => {
    if (!selectedCandidate) return;
    seekTo(getStart(selectedCandidate));
    addLog("info", `開始位置 (${formatTimecode(getStart(selectedCandidate))}) にジャンプ`);
  }, [selectedCandidate, seekTo, addLog]);

  const handleJumpPeak = useCallback(() => {
    if (!selectedCandidate) return;
    seekTo(getPeak(selectedCandidate));
    addLog("info", `盛り上がりピーク (${formatTimecode(getPeak(selectedCandidate))}) にジャンプ`);
  }, [selectedCandidate, seekTo, addLog]);

  const handleJumpEnd = useCallback(() => {
    if (!selectedCandidate) return;
    seekTo(Math.max(0, getEnd(selectedCandidate) - 1));
    addLog("info", `終了位置 (${formatTimecode(getEnd(selectedCandidate))}) にジャンプ`);
  }, [selectedCandidate, seekTo, addLog]);

  const handlePreviewRange = useCallback(() => {
    if (!selectedCandidate) return;
    seekTo(getStart(selectedCandidate));
    addLog("user", `プレビュー範囲を再生します（${formatTimecode(getStart(selectedCandidate))}から）`);
  }, [selectedCandidate, seekTo, addLog]);

  const handleSetStartFromCurrent = useCallback(() => {
    if (!selectedCandidate) return;
    const newStart = currentTime;
    const end = getEnd(selectedCandidate);
    const updated: HighlightCandidate = {
      ...selectedCandidate,
      clip_start: newStart,
      start: newStart,
      clip_duration: Math.max(1, end - newStart),
    };
    setSelectedCandidate(updated);
    setCandidates((prev) => prev.map((c) => (c.rank === selectedCandidate.rank ? updated : c)));
    addLog("user", `開始位置を ${formatTimecode(newStart)} に設定しました`);
  }, [selectedCandidate, currentTime, addLog]);

  const handleSetEndFromCurrent = useCallback(() => {
    if (!selectedCandidate) return;
    const newEnd = currentTime;
    const start = getStart(selectedCandidate);
    const updated: HighlightCandidate = {
      ...selectedCandidate,
      end: newEnd,
      clip_duration: Math.max(1, newEnd - start),
    };
    setSelectedCandidate(updated);
    setCandidates((prev) => prev.map((c) => (c.rank === selectedCandidate.rank ? updated : c)));
    addLog("user", `終了位置を ${formatTimecode(newEnd)} に設定しました`);
  }, [selectedCandidate, currentTime, addLog]);

  const handleSelectLocalVideo = useCallback(() => {
    setMode("local");
    addLog("user", "Local Fileモードに切り替えました。動画ファイルのパスを入力してください。");
  }, [addLog]);

  // ─── Time tracking ────────────────────────────────────────────────────────

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleDurationChange = useCallback((duration: number) => {
    if (Number.isFinite(duration) && duration > 0) {
      setVideoDuration(duration);
    }
  }, []);

  // Get current time from player (for "Set from current" buttons)
  const liveCurrentTime = useMemo(() => {
    if (mode === "local" && localPlayerRef.current) {
      return localPlayerRef.current.getCurrentTime();
    }
    return currentTime;
  }, [mode, currentTime]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const hasLocalVideo = canExport;

  return (
    <div className="min-h-screen flex flex-col bg-[#050816]">
      {/* Header: only essential controls */}
      <header className="bg-slate-900/80 border-b border-slate-700/50 px-5 py-2.5 flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-cyan-300 whitespace-nowrap">切り抜きStudio</h1>

        <div className="flex bg-slate-800 rounded-md p-0.5 border border-slate-700">
          <button
            onClick={() => { setMode("twitch"); setVideoId(null); setCandidates([]); setVodTitle(null); }}
            className={`px-2.5 py-1 text-xs rounded-sm transition-colors ${mode === "twitch" ? "bg-cyan-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
          >Twitch VOD</button>
          <button
            onClick={() => { setMode("local"); setVideoId(null); setCandidates([]); setVodTitle(null); }}
            className={`px-2.5 py-1 text-xs rounded-sm transition-colors ${mode === "local" ? "bg-cyan-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
          >Local File</button>
        </div>

        {mode === "twitch" ? (
          <div className="flex gap-2 items-end">
            <div className="flex flex-col gap-px">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">Twitch VOD URL</label>
              <input value={vodUrl} onChange={(e) => setVodUrl(e.target.value)}
                placeholder="https://www.twitch.tv/videos/123456789"
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-cyan-500 w-72" />
            </div>
            <button onClick={handleLoadVod} disabled={!vodUrl.trim()}
              className="px-2.5 py-1.5 text-xs rounded bg-slate-700/60 border border-slate-600 text-slate-300 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">読み込み</button>
          </div>
        ) : (
          <div className="flex gap-2 items-end">
            <div className="flex flex-col gap-px">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">動画ファイル</label>
              <input value={videoPath} onChange={(e) => setVideoPath(e.target.value)}
                placeholder="/path/to/video.mp4"
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-cyan-500 w-64" />
            </div>
            <div className="flex flex-col gap-px">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide">チャットログ</label>
              <input value={logPath} onChange={(e) => setLogPath(e.target.value)}
                placeholder="/path/to/chat.json"
                className="bg-slate-950 border border-slate-700 text-slate-200 rounded-sm px-1.5 py-0.5 text-xs outline-none focus:border-cyan-500 w-64" />
            </div>
          </div>
        )}

        <div className="flex gap-1.5 ml-auto">
          {isAnalyzing ? (
            <button onClick={handleCancel}
              className="px-3 py-1.5 text-xs rounded bg-red-600 text-white hover:brightness-110 font-semibold"
            >
              キャンセル
            </button>
          ) : (
            <button onClick={handleAnalyze}
              disabled={mode === "twitch" && !videoId}
              className="px-3 py-1.5 text-xs rounded bg-cyan-600 text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
            >
              候補を検出する
            </button>
          )}
        </div>
      </header>

      {/* Advanced Settings (collapsible) */}
      <AdvancedSettings
        isOpen={advancedOpen}
        onToggle={() => setAdvancedOpen((v) => !v)}
        windowSec={windowSec} setWindowSec={setWindowSec}
        step={step} setStep={setStep}
        topN={topN} setTopN={setTopN}
        minGap={minGap} setMinGap={setMinGap}
        clipDuration={clipDuration} setClipDuration={setClipDuration}
        clipOffset={clipOffset} setClipOffset={setClipOffset}
        keywordWeight={keywordWeight} setKeywordWeight={setKeywordWeight}
        keywordsText={keywordsText} setKeywordsText={setKeywordsText}
      />

      {/* Progress bar */}
      {isAnalyzing && (
        <div className="bg-slate-900/90 border-b border-slate-700/50 px-5 py-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-400 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${Math.max(1, progress)}%` }}
              />
            </div>
            <span className="text-xs text-slate-400 min-w-[180px] text-right whitespace-nowrap">
              {progressLabel || "準備中..."} ({progress}%)
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {errorMessage && (
        <div className="bg-red-950/80 border-b border-red-800 px-5 py-1.5 flex justify-between items-center text-red-300 text-xs">
          <span>⚠ {errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="bg-none border-none text-red-300 cursor-pointer text-sm">✕</button>
        </div>
      )}

      {/* Title bar */}
      {vodTitle && (
        <div className="bg-slate-800/50 border-b border-slate-700/30 px-5 py-1.5 text-sm text-slate-200 flex justify-between items-center">
          <span className="font-semibold">{vodTitle}</span>
          <span className="text-xs text-slate-400">
            候補 {candidates.length}件
          </span>
        </div>
      )}

      {/* Main content */}
      <div className="flex gap-3 px-5 pt-3 flex-1 min-h-0">
        <div className="flex-[3] flex flex-col gap-2.5 min-w-0">
          {mode === "twitch" && videoId ? (
            <TwitchVodPlayer
              ref={twitchPlayerRef}
              videoId={videoId}
              startTimeSeconds={playerStartTime}
              reloadKey={playerReloadKey}
              onTimeUpdate={handleTimeUpdate}
            />
          ) : mode === "local" && videoPath.trim() ? (
            <LocalVideoPlayer
              ref={localPlayerRef}
              videoPath={videoPath}
              startTimeSeconds={playerStartTime}
              onTimeUpdate={handleTimeUpdate}
              onDurationChange={handleDurationChange}
            />
          ) : (
            <div className="glass-panel rounded-lg p-3 flex items-center justify-center h-[200px]">
              <div className="text-sm text-slate-400">
                {mode === "twitch" ? (
                  <div className="text-center">
                    <div className="text-2xl mb-2">📺</div>
                    <div>Twitch VOD URL を入力して「読み込み」をクリック</div>
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="text-2xl mb-2">🎬</div>
                    <div>ローカル動画ファイルのパスを入力</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Timeline Graph (interactive) */}
          {timeline.length > 0 && (
            <TimelineGraph
              timeline={timeline}
              candidates={candidates}
              selectedCandidate={selectedCandidate}
              currentTime={currentTime}
              duration={videoDuration}
              maxTime={maxTime}
              onSeek={seekTo}
              onSelectCandidate={handleSelectCandidate}
            />
          )}

          {/* Clip action panel for selected candidate */}
          {selectedCandidate && (
            <ClipActionPanel
              candidate={selectedCandidate}
              hasLocalVideo={hasLocalVideo}
              localVideoPath={videoPath || null}
              currentTime={liveCurrentTime}
              isPlayerAvailable={mode === "local" || (mode === "twitch" && !!videoId)}
              singleExportStatus={exportStatus}
              batchExportStatus={batchExportStatus}
              onJumpStart={handleJumpStart}
              onJumpPeak={handleJumpPeak}
              onJumpEnd={handleJumpEnd}
              onPreviewRange={handlePreviewRange}
              onSetStartFromCurrent={handleSetStartFromCurrent}
              onSetEndFromCurrent={handleSetEndFromCurrent}
              onExportThisClip={() => exportCandidate(selectedCandidate)}
              onExportTop5={exportTop5}
              onSelectLocalVideo={handleSelectLocalVideo}
            />
          )}

          {/* Danmaku export panel - works for Twitch VOD / Local file / ASS only */}
          {selectedCandidate && (
            <DanmakuPanel
              candidate={selectedCandidate}
              chatInRange={chatInRange}
              hasLocalVideo={canExport}
              hasVodUrl={mode === "twitch" && !!videoId}
              localVideoPath={videoPath}
              isExporting={danmakuExporting}
              lastResult={danmakuLastResult}
              exportSource={exportSource}
              setExportSource={setExportSource}
              onExportWithDanmaku={(opts) => handleDanmakuExport("with", opts)}
              onExportWithoutDanmaku={() => handleDanmakuExport("without", { with_danmaku: false })}
              onExportAssOnly={(opts) => handleDanmakuExport("ass", opts)}
              density={danmakuDensity}
              setDensity={setDanmakuDensity}
              maxComments={danmakuMaxComments}
              setMaxComments={setDanmakuMaxComments}
              fontSize={danmakuFontSize}
              setFontSize={setDanmakuFontSize}
              commentDuration={danmakuCommentDuration}
              setCommentDuration={setDanmakuCommentDuration}
              opacity={danmakuOpacity}
              setOpacity={setDanmakuOpacity}
              ngWords={danmakuNgWords}
              setNgWords={setDanmakuNgWords}
              minMessageLength={danmakuMinMessageLength}
              setMinMessageLength={setDanmakuMinMessageLength}
              deduplicateConsecutive={danmakuDeduplicate}
              setDeduplicateConsecutive={setDanmakuDeduplicate}
            />
          )}

          {/* Detailed reasons (collapsible / on-demand) */}
          {selectedCandidate && (
            <CandidateDetails candidate={selectedCandidate} />
          )}
        </div>

        <div className="flex-[2] flex flex-col min-w-[280px] max-w-[400px] gap-2">
          {/* Export status panel */}
          <ExportStatusPanel
            mode={mode}
            videoPath={videoPath}
            twitchVodId={videoId}
            exportedCount={exportedIds.size}
            totalCandidates={candidates.length}
            onSelectLocalFile={handleSelectLocalVideo}
          />

          <CandidateList
            candidates={candidates}
            selectedCandidateId={selectedCandidate?.id ?? selectedCandidate?.rank ?? null}
            exportedCandidateIds={exportedIds}
            danmakuExportedIds={danmakuExportedIds}
            exportingCandidateId={exportingId}
            canExport={canExport}
            onSelectCandidate={handleSelectCandidate}
            onEditCandidate={handleEditCandidate}
            onExportCandidate={exportCandidate}
          />
        </div>
      </div>

      <div className="px-5 pb-3 pt-2">
        <LogPanel
          logs={logs}
          diagnostic={diagnostic as Record<string, unknown> | null}
        />
      </div>
    </div>
  );
}
