// Contract spec, formatting, and small numeric utilities shared everywhere.
// Ported 1:1 from the original app's part3.js so every downstream number
// (fills, commissions, R-multiples) stays byte-identical.
import type { ContractSpec, Bar } from './types';

export const SPEC: ContractSpec = { tick: 0.25, pointValue: 50, commission: 2.25, slipTicks: 1 };

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const roundTick = (p: number, spec: ContractSpec = SPEC) => Math.round(p / spec.tick) * spec.tick;

export const px = (p: number) => p.toFixed(2);

export const fmtAxis = (p: number) =>
  p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtVol = (v: number) =>
  v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1000 ? Math.round(v / 1000) + 'K' : String(Math.round(v));

export const fmt$ = (v: number, d = 2) =>
  (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtSigned$ = (v: number) =>
  (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const sgnClass = (v: number): 'pos' | 'neg' | 'flat' => (v > 0.0001 ? 'pos' : v < -0.0001 ? 'neg' : 'flat');

export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export function trueRangeATR(bars: Bar[]): number {
  if (bars.length < 2) return 1;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)));
  }
  return Math.max(0.25, mean(trs));
}

/** Seeded PRNG — mulberry32. Same seed, same stream, forever. */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const tfLabel = (n: number) => (n >= 60 ? n / 60 + 'h' : n + 'm');

// bar index -> wall clock (index 0 = 08:30 ET)
export function minuteToClock(i: number): string {
  const mins = 8 * 60 + 30 + i;
  const h = Math.floor(mins / 60) % 24, mm = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

export const PRE_BARS = 60;
export const SUBSTEPS = 8;

/** HTML-escape for the string-built rich-text blocks ported verbatim from the
 *  original's innerHTML renderers (see components that use dangerouslySetInnerHTML). */
export const esc = (s: unknown): string =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
