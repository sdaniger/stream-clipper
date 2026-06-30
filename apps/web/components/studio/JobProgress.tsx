"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  type JobState,
  type JobStage,
  type Candidate,
  ANALYZE_STAGES,
  RENDER_STAGES,
  STAGE_USER_LABELS_JA,
  STAGE_USER_LABELS_EN,
  STAGE_USER_DESCRIPTIONS_JA,
  STAGE_USER_DESCRIPTIONS_EN,
  isRetryableError,
  getUserErrorMessage,
} from "@/lib/studio-jobs-api";
import { useI18n } from "@/lib/i18n";

interface Props {
  job: JobState | null;
  candidate?: Candidate | null;
  onCancel?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
}

const TERMINAL: JobStage[] = ["completed", "failed", "cancelled"];

function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const sec = s % 60;
  const min = m % 60;
  if (h > 0) return `${h}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function kindLabel(kind: string, isJa: boolean): string {
  if (kind === "short") return "Shorts";
  if (kind === "medium") return isJa ? "通常" : "Standard";
  return isJa ? "長尺" : "Long";
}

function fmtClock(v: number): string {
  const safe = Math.max(0, v);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Build a download URL for a render-output file. The backend stores the
 * path relative to the project root, e.g. `output/clips/clip.mp4`. We
 * strip any leading project-root prefix and route through the dedicated
 * output endpoint, which validates the path stays inside the workspace.
 */
function toMediaDownloadHref(p: string): string {
  let rel = (p ?? "").replaceAll("\\", "/");
  // Strip absolute prefix if the backend ever sends one
  const idx = rel.indexOf("output/");
  if (idx >= 0) {
    rel = rel.slice(idx);
  } else if (rel.startsWith("/")) {
    rel = rel.replace(/^\/+/, "");
  }
  return `/api/studio/output?path=${encodeURIComponent(rel)}`;
}

export default function JobProgress({ job, candidate, onCancel, onRetry, onDismiss }: Props) {
  const { t, locale } = useI18n();
  const isJa = locale === "ja";
  const [logOpen, setLogOpen] = useState(false);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!job || TERMINAL.includes(job.status as JobStage)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [job?.status, job?.finished_at]);

  const elapsed = useMemo(() => {
    if (!job) return 0;
    const end = job.finished_at ?? now / 1000;
    return end - job.created_at;
  }, [job?.created_at, job?.finished_at, now]);

  const userLabel = (s: JobStage) =>
    isJa ? STAGE_USER_LABELS_JA[s] : STAGE_USER_LABELS_EN[s];

  const userDesc = (s: JobStage) =>
    isJa ? STAGE_USER_DESCRIPTIONS_JA[s] : STAGE_USER_DESCRIPTIONS_EN[s];

  if (!job) {
    return (
      <div className="bg-slate-900/60 rounded-xl p-4 sm:p-5 border border-slate-700/40 text-center">
        <div className="text-xs text-slate-500">
          {isJa ? "待機中..." : "Waiting..."}
        </div>
      </div>
    );
  }

  const isAnalyze = job.job_kind === "analyze";
  const stages = isAnalyze ? ANALYZE_STAGES : RENDER_STAGES;
  const currentStage = job.current_stage as JobStage;
  const currentStageIdx = stages.indexOf(currentStage);
  const isTerminal = TERMINAL.includes(job.status as JobStage);
  const isFailed = job.status === "failed";
  const isCancelled = job.status === "cancelled";
  const isCompleted = job.status === "completed";
  const retryable = isFailed && isRetryableError(job.error_code);

  // Candidate summary
  const candSummary = useMemo(() => {
    const c = candidate || (job.result?.candidate as Candidate | undefined);
    if (!c) return "";
    const kind = kindLabel(c.kind, isJa);
    const dur = c.clip_duration ? ` (${Math.round(c.clip_duration)}s)` : "";
    return `#${c.rank} ${kind}${dur}`;
  }, [candidate, job.result?.candidate, isJa]);

  const fileSizeStr = job.result?.size_bytes
    ? `${(job.result.size_bytes / 1024 / 1024).toFixed(1)} MB`
    : null;

  const userErrMsg = isFailed
    ? getUserErrorMessage(job.error_code, isJa) || job.error_message || ""
    : "";

  // Freeze the bar at the last known progress on cancellation so it
  // does not visually jump to 100% (which would suggest completion).
  const bw = isCancelled ? Math.max(0, Math.min(100, job.progress)) : job.progress;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className={`rounded-xl border overflow-hidden ${
      isCompleted ? "border-emerald-500/40 bg-emerald-500/[0.04]" :
      isFailed ? "border-red-500/40 bg-red-500/[0.04]" :
      isCancelled ? "border-amber-500/40 bg-amber-500/[0.04]" :
      "border-slate-700/40 bg-slate-900/60"
    }`}>
      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-2 sm:px-5 sm:pt-4 sm:pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm sm:text-base">{isAnalyze ? "🔍" : "🎬"}</span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-100 truncate leading-tight">
                {isAnalyze
                  ? (isJa ? "解析" : "Analyze")
                  : (isJa ? "レンダリング" : "Render")}
              </div>
              {candSummary && (
                <div className="text-[10px] text-cyan-300/80 truncate mt-0.5">
                  {candSummary}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Elapsed */}
            <div className="text-right">
              <div className="text-[8px] text-slate-500 uppercase tracking-wider">
                {isTerminal ? (isJa ? "所要" : "Took") : (isJa ? "経過" : "Elapsed")}
              </div>
              <div className="text-xs font-mono font-semibold text-slate-300">
                {fmtDuration(elapsed)}
              </div>
            </div>
            {/* Progress % */}
            {!isCancelled && (
              <div className="text-right">
                <div className="text-[8px] text-slate-500 uppercase tracking-wider">
                  {isJa ? "進捗" : "Progress"}
                </div>
                <div className={`text-base sm:text-lg font-mono font-bold ${
                  isCompleted ? "text-emerald-400" :
                  isFailed ? "text-red-400" :
                  "text-cyan-300"
                }`}>
                  {isCompleted ? "100" : Math.round(job.progress)}
                  <span className="text-sm">%</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div className="px-4 sm:px-5 pb-1">
        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-700 ease-out ${
              isFailed ? "bg-red-500" :
              isCompleted ? "bg-emerald-500" :
              isCancelled ? "bg-amber-500" :
              "bg-gradient-to-r from-cyan-500 to-fuchsia-500"
            }`}
            style={{ width: `${bw}%` }}
          />
        </div>
        {!isTerminal && (
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-slate-500">{Math.round(job.progress)}%</span>
            <span className="text-[9px] text-slate-500">{fmtDuration(elapsed)}</span>
          </div>
        )}
      </div>

      {/* ── Current stage (active) ── */}
      {!isTerminal && (
        <div className="px-4 sm:px-5 pt-3 pb-1">
          <div className="text-xs font-bold text-cyan-300 mb-0.5">
            {userLabel(currentStage)}
          </div>
          <div className="text-[10px] text-slate-400 leading-relaxed">
            {userDesc(currentStage)}
          </div>
          {currentStage === "ffmpeg_rendering" && (
            <div className="text-[9px] text-amber-400/70 mt-1 flex items-center gap-1">
              <span>⏳</span>
              <span>{isJa ? "長尺の動画の場合、数分かかることがあります。しばらくお待ちください" : "This may take several minutes for long clips"}</span>
            </div>
          )}
          {currentStage === "ass_generation" && (
            <div className="text-[9px] text-amber-400/70 mt-1 flex items-center gap-1">
              <span>📝</span>
              <span>{isJa ? "表示するコメントを選別し、弾幕ファイルを生成しています" : "Selecting comments and generating danmaku file"}</span>
            </div>
          )}
          {currentStage === "preview_rendering" && (
            <div className="text-[9px] text-amber-400/70 mt-1 flex items-center gap-1">
              <span>🖼️</span>
              <span>{isJa ? "720p・短尺のプレビュー動画を生成しています" : "Generating a short 720p preview video"}</span>
            </div>
          )}
          {currentStage === "comment_filtering" && (
            <div className="text-[9px] text-amber-400/70 mt-1 flex items-center gap-1">
              <span>🧹</span>
              <span>{isJa ? "URL・連投・絵文字スパムなどを除外しています" : "Removing URLs, spammers, and emoji spam"}</span>
            </div>
          )}
          {currentStage === "vod_range_fetching" && (
            <div className="text-[9px] text-amber-400/70 mt-1 flex items-center gap-1">
              <span>⏳</span>
              <span>{isJa ? "Twitchから動画をダウンロードしています。ネットワーク速度により時間がかかることがあります" : "Downloading from Twitch. May take a while depending on your connection"}</span>
            </div>
          )}
          {(currentStage === "transcription_started" || currentStage === "transcription_segmenting") && (
            <div className="text-[9px] text-amber-400/70 mt-1 flex items-center gap-1">
              <span>🎙️</span>
              <span>{isJa ? "音声をテキストに変換しています。動画の長さによって時間がかかることがあります" : "Converting audio to text. May take a while depending on length"}</span>
            </div>
          )}
          {job.message && (
            <div className="text-[9px] text-cyan-300/60 mt-1 font-mono leading-relaxed break-all">
              {job.message}
            </div>
          )}
        </div>
      )}

      {/* ── Stage list ── */}
      <div className="px-4 sm:px-5 pt-2 pb-1">
        <ol className="space-y-1 text-[11px]">
          {stages.map((stage, i) => {
            const stageS = stage as JobStage;
            const done = isTerminal || (currentStageIdx >= 0 && i < currentStageIdx);
            const active = currentStage === stage && !isTerminal;
            const failedHere = isFailed && active;
            return (
              <li key={stage} className={`flex items-center gap-2 ${
                failedHere ? "text-red-300" :
                done ? "text-emerald-400" :
                active ? "text-cyan-300" :
                "text-slate-500"
              }`}>
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] shrink-0 ${
                  failedHere ? "bg-red-500/30" :
                  done ? "bg-emerald-500/30" :
                  active ? "bg-cyan-500/30 animate-pulse" :
                  "bg-slate-700/40"
                }`}>
                  {failedHere ? "✗" : done ? "✓" : active ? "●" : i + 1}
                </span>
                <span className="flex-1">{userLabel(stageS)}</span>
                {active && (
                  <span className="text-[9px] text-cyan-300/70 shrink-0">
                    {isJa ? "実行中..." : "running..."}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── Detailed log toggle ── */}
      {job.history.length > 0 && (
        <div className="px-4 sm:px-5 pt-1 pb-1">
          <button
            type="button"
            onClick={() => setLogOpen(!logOpen)}
            className="flex items-center gap-1 text-[9px] text-slate-500 hover:text-slate-300 transition-colors py-1"
          >
            <span className="text-[8px]">{logOpen ? "▼" : "▶"}</span>
            <span>{isJa ? "詳細ログ" : "Debug log"} ({job.history.length})</span>
          </button>
          {logOpen && (
            <div className="mt-1 max-h-32 overflow-y-auto bg-slate-950/60 rounded p-2 space-y-0.5 text-[9px] font-mono text-slate-400">
              {job.history.map((h, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-600 shrink-0">{new Date(h.ts * 1000).toISOString().slice(11, 19)}</span>
                  <span className="text-cyan-300/60 shrink-0">{h.stage}</span>
                  <span className="truncate">{h.message}</span>
                  {h.progress != null && <span className="text-slate-600 shrink-0">{Math.round(h.progress)}%</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Last updated time ── */}
      {!isTerminal && (
        <div className="px-4 sm:px-5 pb-1 text-[8px] text-slate-600">
          {isJa ? "最終更新" : "Last updated"}: {new Date(job.updated_at * 1000).toLocaleTimeString()}
        </div>
      )}

      {/* ── FAILURE display ── */}
      {isFailed && (
        <div className="mx-4 sm:mx-5 mb-3 px-3 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs space-y-2">
          <div className="flex items-center gap-1.5 text-red-300 font-bold">
            <span>✗</span>
            <span>{isJa ? "エラーが発生しました" : "An error occurred"}</span>
          </div>
          {/* User-friendly message */}
          {userErrMsg && (
            <div className="text-red-200/90 leading-relaxed text-[11px]">
              {userErrMsg}
            </div>
          )}
          {/* Error code */}
          {job.error_code && !userErrMsg && (
            <div className="text-red-200/90 leading-relaxed text-[11px]">
              {job.error_code}: {job.error_message || ""}
            </div>
          )}
          {/* Technical details collapsible */}
          <details className="mt-1">
            <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">
              {isJa ? "技術的詳細" : "Technical details"}
            </summary>
            <div className="mt-1 p-2 bg-slate-950/60 rounded text-[9px] font-mono space-y-0.5">
              {job.error_code && <div><span className="text-slate-500">code:</span> {job.error_code}</div>}
              {job.error_message && <div><span className="text-slate-500">message:</span> {job.error_message}</div>}
              {job.message && <div><span className="text-slate-500">raw:</span> {job.message}</div>}
            </div>
          </details>
        </div>
      )}

      {/* ── CANCELLED display ── */}
      {isCancelled && (
        <div className="mx-4 sm:mx-5 mb-3 px-3 py-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs">
          <div className="flex items-center gap-1.5 text-amber-300 font-bold">
            <span>⛔</span>
            <span>{isJa ? "キャンセルされました" : "Cancelled"}</span>
          </div>
          {job.message && (
            <div className="text-amber-200/70 text-[10px] mt-1">{job.message}</div>
          )}
        </div>
      )}

      {/* ── COMPLETION display ── */}
      {isCompleted && (
        <div className="mx-4 sm:mx-5 mb-3">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 sm:p-4 space-y-3">
            {/* Header */}
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 text-base">✓</span>
              <span className="text-sm font-bold text-emerald-300">
                {isAnalyze
                  ? (isJa ? "解析完了" : "Analysis complete")
                  : (isJa ? "生成完了" : "Render complete")}
              </span>
              {fileSizeStr && (
                <span className="text-[9px] text-emerald-400/60">({fileSizeStr})</span>
              )}
            </div>

            {/* Analyze result: summary */}
            {isAnalyze && (
              <div className="text-[11px] text-slate-300 space-y-1">
                {job.result?.candidates && (
                  <div>
                    {isJa ? "候補" : "Candidates"}:&nbsp;
                    {(() => {
                      const c = job.result.candidates as Record<string, unknown[]>;
                      const parts: string[] = [];
                      for (const [k, v] of Object.entries(c)) {
                        const label = k === "short" ? "Shorts" : k === "medium" ? (isJa ? "通常" : "Standard") : (isJa ? "長尺" : "Long");
                        parts.push(`${label} ${v.length}`);
                      }
                      return parts.join(" / ");
                    })()}
                  </div>
                )}
                {job.result?.vod_title && (
                  <div><span className="text-slate-500">{isJa ? "タイトル" : "Title"}:</span> {job.result.vod_title}</div>
                )}
                {job.result?.streamer && (
                  <div><span className="text-slate-500">{isJa ? "配信者" : "Streamer"}:</span> {job.result.streamer}</div>
                )}
                {job.result?.normalized_chat && Array.isArray(job.result.normalized_chat) && (
                  <div><span className="text-slate-500">Chat:</span> {job.result.normalized_chat.length} {isJa ? "メッセージ" : "messages"}</div>
                )}
              </div>
            )}

            {/* Render result: output files */}
            {!isAnalyze && (
              <>
                {job.result?.output_path && (
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-300/70 shrink-0 text-[11px]">📁 MP4:</span>
                    <code className="text-[10px] text-emerald-200/80 truncate flex-1">{job.result.output_path}</code>
                    <a href={toMediaDownloadHref(job.result.output_path)} download
                      className="px-2 py-1.5 rounded bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/40 text-[10px] shrink-0 font-semibold min-h-[32px] flex items-center">
                      ⬇ {isJa ? "DL" : "DL"}
                    </a>
                  </div>
                )}
                {job.result?.ass_path && (
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-300/70 shrink-0 text-[11px]">📄 ASS:</span>
                    <code className="text-[10px] text-emerald-200/80 truncate flex-1">{job.result.ass_path}</code>
                    <a href={toMediaDownloadHref(job.result.ass_path)} download
                      className="px-2 py-1.5 rounded bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/40 text-[10px] shrink-0 font-semibold min-h-[32px] flex items-center">
                      ⬇
                    </a>
                  </div>
                )}
                {job.result?.metadata_path && (
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-300/70 shrink-0 text-[11px]">📋 JSON:</span>
                    <code className="text-[10px] text-emerald-200/80 truncate flex-1">{job.result.metadata_path}</code>
                    <a href={toMediaDownloadHref(job.result.metadata_path)} download
                      className="px-2 py-1.5 rounded bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/40 text-[10px] shrink-0 font-semibold min-h-[32px] flex items-center">
                      ⬇
                    </a>
                  </div>
                )}

                {/* YouTube metadata collapsible */}
                {job.result?.youtube && (
                  <details>
                    <summary className="text-emerald-300 font-semibold cursor-pointer text-[11px] flex items-center gap-1">
                      <span>📺</span>
                      <span>{isJa ? "YouTube投稿用メタデータ" : "YouTube metadata"}</span>
                    </summary>
                    <div className="mt-2 p-2.5 bg-slate-950/60 rounded text-[10px] space-y-2">
                      <div>
                        <div className="text-amber-300 text-[9px] font-semibold mb-0.5">
                          {isJa ? "タイトル" : "Title"}
                        </div>
                        <div className="text-slate-200">{job.result.youtube.title}</div>
                      </div>
                      <div>
                        <div className="text-amber-300 text-[9px] font-semibold mb-0.5">
                          {isJa ? "説明" : "Description"}
                        </div>
                        <pre className="text-slate-300/80 whitespace-pre-wrap font-sans text-[10px] leading-relaxed max-h-24 overflow-y-auto">
                          {job.result.youtube.description}
                        </pre>
                      </div>
                      <div>
                        <div className="text-amber-300 text-[9px] font-semibold mb-1">
                          {isJa ? "タグ" : "Tags"}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {job.result.youtube.tags?.map((tag: string, i: number) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-slate-800/70 text-slate-300 text-[9px]">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </details>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="px-4 sm:px-5 pb-4 sm:pb-5 flex gap-2 pt-1">
        {!isTerminal && onCancel && (
          <button type="button" onClick={onCancel}
            className="flex-1 px-3 py-3 text-xs font-semibold rounded-lg bg-red-700/60 hover:bg-red-600/70 text-white transition-colors min-h-[44px]">
            ⛔ {t("job.cancel")}
          </button>
        )}
        {retryable && onRetry && (
          <button type="button" onClick={onRetry}
            className="flex-1 px-3 py-3 text-xs font-semibold rounded-lg bg-amber-600/60 hover:bg-amber-500/70 text-white transition-colors min-h-[44px]">
            🔄 {isJa ? "もう一度試す" : "Retry"}
          </button>
        )}
        {isCompleted && !isAnalyze && onRetry && (
          <button type="button" onClick={onRetry}
            className="flex-1 px-3 py-3 text-xs font-semibold rounded-lg bg-cyan-600/60 hover:bg-cyan-500/70 text-white transition-colors min-h-[44px]">
            🎬 {isJa ? "次の候補を生成" : "Generate next"}
          </button>
        )}
        {isTerminal && onDismiss && (
          <button type="button" onClick={onDismiss}
            className="flex-1 px-3 py-3 text-xs font-semibold rounded-lg bg-slate-700/60 hover:bg-slate-600/70 text-white transition-colors min-h-[44px]">
            {t("job.dismiss")}
          </button>
        )}
      </div>
    </div>
  );
}
