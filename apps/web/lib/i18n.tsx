"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import jaMessages from "@/messages/ja.json";
import enMessages from "@/messages/en.json";

export type Locale = "ja" | "en";

type Messages = typeof jaMessages;
type TranslationParams = Record<string, string | number>;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
};

const messages: Record<Locale, Messages> = {
  ja: jaMessages,
  en: enMessages
};

const I18nContext = createContext<I18nContextValue | null>(null);
const storageKey = "stream-clipper-locale";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "ja" || stored === "en") return stored;
    }
    return "en";
  });

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    function setLocale(nextLocale: Locale) {
      setLocaleState(nextLocale);
      window.localStorage.setItem(storageKey, nextLocale);
    }

    function t(key: string, params?: TranslationParams) {
      const template = readMessage(messages[locale], key) ?? readMessage(messages.ja, key) ?? key;
      return interpolate(template, params);
    }

    return { locale, setLocale, t };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider.");
  }

  return context;
}

function readMessage(source: unknown, key: string): string | null {
  const value = key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[part];
  }, source);

  return typeof value === "string" ? value : null;
}

function interpolate(template: string, params: TranslationParams | undefined) {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, key: string) => (params[key] === undefined ? match : String(params[key])));
}
