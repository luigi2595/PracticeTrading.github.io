// localStorage shape + quota-trim fallback. Ported from part5.js. The React
// app owns *when* to call these (debounced on state change); this module is
// just the pure serialize/deserialize contract plus the browser I/O.
import type { LevelToggles, MAConfig, Settings, SessionSummary, Trade } from './types';

export const STORE_KEY = 'es-practice-lab-v1';
export const SEEN_KEY = 'es-practice-lab-seen-v1';

export interface PatternLabSaveShape {
  stats: Record<string, { n: number; ok: number }>;
  asked: number; correct: number; best: number;
  stopN: number; stopOk: number;
  hardAsked: number; hardCorrect: number; hard: boolean;
}

export interface SavePayload {
  v: 1;
  savedAt: string;
  trades: Trade[];
  sessions: SessionSummary[];
  pl: PatternLabSaveShape;
  settings: Settings;
  levels: LevelToggles;
  mas: MAConfig[];
  userLevels: number[];
  tf: number;
}

export function storageAvailable(): boolean {
  try {
    const k = '__eslab_test';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** Returns { ok, trimmed } — trimmed is how many oldest trades were dropped
 *  to fit, 0 if the full payload saved fine. Throws only if even a
 *  100-trade payload won't fit (storage is unusable, not just full). */
export function saveWithTrim(build: (trades: Trade[]) => string, trades: Trade[]): { ok: boolean; trimmed: number } {
  try {
    window.localStorage.setItem(STORE_KEY, build(trades));
    return { ok: true, trimmed: 0 };
  } catch {
    const keep = Math.max(100, Math.floor(trades.length / 2));
    if (trades.length > 100) {
      try {
        window.localStorage.setItem(STORE_KEY, build(trades.slice(-keep)));
        return { ok: true, trimmed: trades.length - keep };
      } catch {
        return { ok: false, trimmed: 0 };
      }
    }
    return { ok: false, trimmed: 0 };
  }
}

export function loadPayload(): SavePayload | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavePayload;
  } catch {
    return null;
  }
}

export function forgetSaved(): void {
  try { window.localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

export function seenBefore(): boolean {
  try { return window.localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
export function markSeen(): void {
  try { window.localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
}
