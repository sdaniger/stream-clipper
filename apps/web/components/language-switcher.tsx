"use client";

import { useI18n, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const locales: Locale[] = ["ja", "en"];

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1 text-xs" aria-label={t("language.label")}>
      {locales.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => setLocale(item)}
          className={cn(
            "rounded-xl px-3 py-1.5 font-semibold transition",
            locale === item ? "bg-cyan-300/20 text-cyan-50" : "text-slate-400 hover:text-slate-200"
          )}
        >
          {t(`language.${item}`)}
        </button>
      ))}
    </div>
  );
}
