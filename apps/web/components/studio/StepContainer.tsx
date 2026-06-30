"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";

interface StepDef {
  index: 1 | 2 | 3;
  key: string;
  shortKey: string;
}

const STEPS: StepDef[] = [
  { index: 1, key: "stepNav1", shortKey: "step1Short" },
  { index: 2, key: "stepNav2", shortKey: "step2Short" },
  { index: 3, key: "stepNav3", shortKey: "step3Short" },
];

interface Props {
  currentStep: 1 | 2 | 3;
  reachable: { 1: boolean; 2: boolean; 3: boolean };
  onStepClick?: (step: 1 | 2 | 3) => void;
}

export default function StepContainer({ currentStep, reachable, onStepClick }: Props) {
  const { t, locale } = useI18n();
  return (
    <nav
      className="bg-slate-900/80 border-b border-slate-700/40 px-3 sm:px-5 py-1 flex items-center gap-1 text-[10px] sm:text-xs"
      aria-label={t("studio.currentStep", { current: currentStep })}
    >
      {STEPS.map((stepObj, i) => {
        const step = stepObj.index;
        const active = step === currentStep;
        const done = step < currentStep;
        const clickable = !!onStepClick && reachable[step];
        const label = t(`studio.${stepObj.key}`);
        const shortLabel = t(`studio.${stepObj.shortKey}`);
        // When no `onStepClick` is provided we render a static, non-
        // interactive badge. Buttons that look interactive but do
        // nothing are an accessibility hazard.
        if (!clickable) {
          return (
            <React.Fragment key={step}>
              <span
                className={`flex items-center gap-1 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded ${
                  active
                    ? "bg-cyan-600/70 text-white font-semibold"
                    : done
                      ? "bg-slate-700/40 text-slate-200"
                      : "bg-slate-900/30 text-slate-500"
                }`}
                aria-current={active ? "step" : undefined}
              >
                <span className={`inline-flex items-center justify-center w-4 h-4 sm:w-5 sm:h-5 rounded-full text-[8px] sm:text-[10px] ${
                  active
                    ? "bg-white/20 text-white"
                    : done
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-slate-700 text-slate-400"
                }`}>
                  {done ? "✓" : step}
                </span>
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{shortLabel}</span>
              </span>
              {i < STEPS.length - 1 && (
                <span className="text-slate-600 text-[8px] sm:text-[10px]">›</span>
              )}
            </React.Fragment>
          );
        }
        return (
          <React.Fragment key={step}>
            <button
              type="button"
              onClick={() => onStepClick?.(step)}
              className={`flex items-center gap-1 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded transition-colors ${
                active
                  ? "bg-cyan-600/70 text-white font-semibold"
                  : done
                    ? "bg-slate-700/40 text-slate-200"
                    : "bg-slate-800/30 text-slate-300 hover:bg-slate-700/30"
              }`}
              aria-current={active ? "step" : undefined}
            >
              <span className={`inline-flex items-center justify-center w-4 h-4 sm:w-5 sm:h-5 rounded-full text-[8px] sm:text-[10px] ${
                active
                  ? "bg-white/20 text-white"
                  : done
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-slate-700 text-slate-400"
              }`}>
                {done ? "✓" : step}
              </span>
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{shortLabel}</span>
            </button>
            {i < STEPS.length - 1 && (
              <span className="text-slate-600 text-[8px] sm:text-[10px]">›</span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
