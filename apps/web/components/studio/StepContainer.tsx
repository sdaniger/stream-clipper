"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";

interface StepDef {
  index: 1 | 2 | 3;
  key: string;
}

const STEPS: StepDef[] = [
  { index: 1, key: "stepNav1" },
  { index: 2, key: "stepNav2" },
  { index: 3, key: "stepNav3" },
];

interface Props {
  currentStep: 1 | 2 | 3;
  /** Whether each step is reachable (drives the clickable state). */
  reachable: { 1: boolean; 2: boolean; 3: boolean };
  onStepClick?: (step: 1 | 2 | 3) => void;
}

export default function StepContainer({ currentStep, reachable, onStepClick }: Props) {
  const { t } = useI18n();
  return (
    <nav
      className="bg-slate-900/80 border-b border-slate-700/40 px-5 py-2 flex items-center gap-1.5 text-xs"
      aria-label={t("studio.currentStep", { current: currentStep })}
    >
      {STEPS.map((step, i) => {
        const active = step.index === currentStep;
        const done = step.index < currentStep;
        const clickable = !!onStepClick && reachable[step.index];
        return (
          <React.Fragment key={step.index}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick?.(step.index)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
                active
                  ? "bg-cyan-600 text-white font-semibold"
                  : done
                    ? "bg-slate-700/60 text-slate-200 hover:bg-slate-600/60 cursor-pointer"
                    : clickable
                      ? "bg-slate-800/40 text-slate-300 hover:bg-slate-700/40 cursor-pointer"
                      : "bg-slate-900/40 text-slate-500 cursor-default"
              }`}
              aria-current={active ? "step" : undefined}
            >
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] ${
                active
                  ? "bg-white/20 text-white"
                  : done
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-slate-700 text-slate-400"
              }`}>
                {done ? "✓" : step.index}
              </span>
              <span>{t(`studio.${step.key}`)}</span>
            </button>
            {i < STEPS.length - 1 && (
              <span className="text-slate-600 text-[10px]">›</span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
