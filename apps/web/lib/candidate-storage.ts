import type { ClipCandidate } from "@/lib/mock-candidates";

/**
 * Persists the clip candidate list to localStorage so that user-imported
 * candidates and any status/notes edits survive page reloads.
 *
 * Design notes:
 *  - SSR-safe: every entry point checks for `window` to avoid Next.js errors
 *  - Versioned: bumping STORAGE_VERSION invalidates old payloads cleanly
 *  - Bounded: MAX_CANDIDATES caps memory use at ~5MB even for huge lists
 *  - Tolerant: corrupted JSON or quota errors fall back gracefully (no crash)
 */

const STORAGE_KEY = "stream-clipper:candidates:v1";
const STORAGE_VERSION = 1;
const MAX_CANDIDATES = 500;

type PersistedPayload = {
  version: number;
  candidates: ClipCandidate[];
  savedAt: string;
};

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadCandidates(): ClipCandidate[] | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedPayload>;
    if (parsed.version !== STORAGE_VERSION) return null;
    if (!Array.isArray(parsed.candidates)) return null;
    return parsed.candidates.slice(0, MAX_CANDIDATES);
  } catch {
    // Corrupted JSON or storage access denied — silently fall back to defaults
    return null;
  }
}

export function saveCandidates(candidates: ClipCandidate[]): { ok: true; savedAt: string } | { ok: false; reason: string } {
  if (!hasStorage()) return { ok: false, reason: "localStorage unavailable" };
  try {
    const payload: PersistedPayload = {
      version: STORAGE_VERSION,
      candidates: candidates.slice(0, MAX_CANDIDATES),
      savedAt: new Date().toISOString()
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { ok: true, savedAt: payload.savedAt };
  } catch (error) {
    // QuotaExceededError, SecurityError, etc. — don't crash the UI
    const reason = error instanceof Error ? error.message : "unknown error";
    if (typeof console !== "undefined") {
      console.warn("Failed to persist candidates:", reason);
    }
    return { ok: false, reason };
  }
}

export function clearCandidates(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — localStorage may be in a read-only state
  }
}

export function getStorageMeta(): { version: number; key: string; maxCandidates: number } {
  return {
    version: STORAGE_VERSION,
    key: STORAGE_KEY,
    maxCandidates: MAX_CANDIDATES
  };
}
