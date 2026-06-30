"use client";

import React, { useEffect, useRef, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";

export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
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
        className="flex items-center gap-1 px-1 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs rounded bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 text-slate-200 min-h-[32px]"
      >
        <span aria-hidden className="text-xs sm:text-sm">🌐</span>
        <span className="hidden sm:inline text-[10px] font-medium">{locale === "ja" ? "日本語" : "English"}</span>
        <span className="sm:hidden uppercase text-[10px] font-bold">{locale}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 mt-1 min-w-[100px] sm:min-w-[140px] rounded-md bg-slate-900 border border-slate-700 shadow-lg z-50 overflow-hidden"
        >
          {(Object.keys({ ja: "日本語", en: "English" }) as Locale[]).map((l) => (
            <li key={l}>
              <button
                type="button"
                role="option"
                aria-selected={l === locale}
                onClick={() => switchTo(l)}
                className={`w-full text-left px-2 sm:px-3 py-1.5 text-[10px] sm:text-xs flex items-center gap-1.5 ${
                  l === locale
                    ? "bg-cyan-600/30 text-cyan-100"
                    : "text-slate-200 hover:bg-slate-800"
                }`}
              >
                <span>{l === "ja" ? "🇯🇵" : "🇬🇧"}</span>
                <span>{l === "ja" ? "日本語" : "English"}</span>
                {l === locale && <span className="ml-auto text-cyan-300">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
