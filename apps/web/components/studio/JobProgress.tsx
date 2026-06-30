"use client";

import React from "react";
import {
  JobState,
  JobStage,
  JobKind,
  ANALYZE_STAGES,
  RENDER_STAGES,
  STAGE_LABELS,
  STAGE_LABELS_EN,
} from "@/lib/studio-jobs-api";
import { useI18n } from "@/lib/i18n";

interface Props {
  job: JobState | null;
  onCancel?: () => void;
  onDismiss?: () => void;
}

const TERMINAL_STAGES: JobStage[] = ["completed", "failed", "cancelled"];

export default function JobProgress({ job, onCancel, onDismiss }: Props) {
  const { locale } = useI18n();
  const isJa = locale === "ja";
  const labelFor = (s: JobStage) => (isJa ? STAGE_LABELS[s] : STAGE_LABELS_EN[s]);

  if (!job) {
    return (
      <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-700/40 text-xs text-slate-500">
        待機中...
      </div>
    );
  }

  const stages = job.job_kind === "analyze" ? ANALYZE_STAGES : RENDER_STAGES;
  const currentStage = job.current_stage;
  const currentStageIdx = stages.indexOf(currentStage);
  const isTerminal = TERMINAL_STAGES.includes(job.status as JobStage);

  return (
    <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-700/40">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            {job.status === "completed" ? (
              <span className="text-emerald-400">✓</span>
            ) : job.status === "failed" ? (
              <span className="text-red-400">✗</span>
            ) : job.status === "cancelled" ? (
              <span className="text-amber-400">⊘</span>
            ) : (
              <span className="animate-spin w-3.5 h-3.5 border-2 border-cyan-500 border-t-transparent rounded-full" />
            )}
            {job.job_kind === "analyze" ? "解析ジョブ" : "レンダリングジョブ"}
            <span className="text-[10px] text-slate-500 ml-2">#{job.job_id.slice(0, 8)}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {job.message || labelFor(currentStage)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-mono font-bold text-cyan-300">
            {Math.round(job.progress)}%
          </div>
          <div className="text-[10px] text-slate-500">
            {isJa ? "進捗" : "progress"}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full transition-all duration-500 ${
            job.status === "failed"
              ? "bg-red-500"
              : job.status === "completed"
                ? "bg-emerald-500"
                : job.status === "cancelled"
                  ? "bg-amber-500"
                  : "bg-gradient-to-r from-cyan-500 to-fuchsia-500"
          }`}
          style={{ width: `${job.progress}%` }}
        />
      </div>

      {/* Stage list */}
      <ol className="space-y-1.5 text-[11px]">
        {stages.map((stage, i) => {
          const done =
            isTerminal ||
            (currentStageIdx >= 0 && i < currentStageIdx) ||
            job.history.some(
              (h) => h.stage === stage && h.ts < (job.updated_at ?? 0),
            );
          const active = currentStage === stage;
          const failed_here = job.status === "failed" && active;
          return (
            <li
              key={stage}
              className={`flex items-center gap-2 ${
                failed_here
                  ? "text-red-300"
                  : done
                    ? "text-emerald-400"
                    : active
                      ? "text-cyan-300"
                      : "text-slate-500"
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                  failed_here
                    ? "bg-red-500/30"
                    : done
                      ? "bg-emerald-500/30"
                      : active
                        ? "bg-cyan-500/30"
                        : "bg-slate-700/40"
                }`}
              >
                {failed_here ? "✗" : done ? "✓" : active ? "●" : i + 1}
              </span>
              <span className="flex-1">{labelFor(stage)}</span>
              {active && !isTerminal && (
                <span className="text-[9px] text-cyan-300 animate-pulse">実行中</span>
              )}
            </li>
          );
        })}
      </ol>

      {/* Error */}
      {job.status === "failed" && job.error_code && (
        <div className="mt-3 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-[11px] text-red-300">
          <div className="font-semibold">{job.error_code}</div>
          <div className="text-red-200/80 mt-0.5">{job.error_message}</div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        {!isTerminal && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-3 py-1.5 text-xs font-semibold rounded bg-red-700/60 hover:bg-red-600/70 text-white transition-colors"
          >
            ⛔ {isJa ? "キャンセル" : "Cancel"}
          </button>
        )}
        {isTerminal && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 px-3 py-1.5 text-xs font-semibold rounded bg-slate-700/60 hover:bg-slate-600/70 text-white transition-colors"
          >
            {isJa ? "閉じる" : "Dismiss"}
          </button>
        )}
      </div>
    </div>
  );
}
