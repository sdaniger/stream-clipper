"use client";

import React, { useEffect, useRef, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";

const LOCALE_LABELS: Record<Locale, string> = {
  ja: "日本語",
  en: "English",
};

const LOCALE_FLAGS: Record<Locale, string> = {
  ja: "🇯🇵",
  en: "🇬🇧",
};

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const switchTo = (next: Locale) => {
    setLocale(next);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("studio.languageSwitcher")}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 text-slate-200"
      >
        <span aria-hidden>🌐</span>
        <span className="font-medium">{LOCALE_FLAGS[locale]} {LOCALE_LABELS[locale]}</span>
        <span aria-hidden className="text-slate-500">▾</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 mt-1 min-w-[160px] rounded-md bg-slate-900 border border-slate-700 shadow-lg z-50 overflow-hidden"
        >
          {(Object.keys(LOCALE_LABELS) as Locale[]).map((l) => (
            <li key={l}>
              <button
                type="button"
                role="option"
                aria-selected={l === locale}
                onClick={() => switchTo(l)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
                  l === locale
                    ? "bg-cyan-600/30 text-cyan-100"
                    : "text-slate-200 hover:bg-slate-800"
                }`}
              >
                <span aria-hidden>{LOCALE_FLAGS[l]}</span>
                <span>{LOCALE_LABELS[l]}</span>
                {l === locale && <span className="ml-auto text-cyan-300">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
