// VWAP/opening-range/prior-day levels and moving averages — computed only
// from bars already revealed (S.cursor), never lookahead. Ported from
// part3.js computeLevels/computeMA.
import { formingBar } from './session';
import { SUBSTEPS } from './spec';
import type { LevelSnapshot, MAConfig, MAType, Session } from './types';

export function computeLevels(session: Session | null, cursor: number, sub: number, orMinutes: number): LevelSnapshot | null {
  if (!session) return null;
  const b = session.bars;
  let rth = session.rthStart, dayIdx = -1;
  if (session.dayStarts) {
    for (let k = 0; k < session.dayStarts.length; k++) {
      if (session.dayStarts[k] <= cursor) { rth = session.dayStarts[k]; dayIdx = k; }
    }
  }
  const done = Math.min(cursor, b.length);
  const orMin = orMinutes || 15;

  let pv = 0, vol = 0, pv2 = 0;
  const vwap: (number | null)[] = new Array(b.length).fill(null);
  const sdLine: (number | null)[] = new Array(b.length).fill(null);
  let orHi = -Infinity, orLo = Infinity, sHi = -Infinity, sLo = Infinity, sd = 0, lastVwap: number | null = null;

  const add = (bar: { h: number; l: number; c: number; v: number }, weight: number) => {
    const tp = (bar.h + bar.l + bar.c) / 3, v = Math.max(1, bar.v * weight);
    pv += tp * v; vol += v; pv2 += tp * tp * v;
    return pv / vol;
  };

  for (let i = rth; i < done; i++) {
    const bar = b[i];
    const vw = add(bar, 1);
    vwap[i] = vw; lastVwap = vw;
    sd = Math.sqrt(Math.max(0, pv2 / vol - vw * vw));
    sdLine[i] = sd;
    if (i - rth < orMin) { orHi = Math.max(orHi, bar.h); orLo = Math.min(orLo, bar.l); }
    sHi = Math.max(sHi, bar.h); sLo = Math.min(sLo, bar.l);
  }
  const f = formingBar(session, cursor, sub);
  if (f && cursor >= rth) {
    const raw = b[cursor];
    const vw = add({ h: f.h, l: f.l, c: f.c as number, v: raw ? raw.v : 1 }, sub / SUBSTEPS);
    vwap[cursor] = vw; lastVwap = vw;
    sd = Math.sqrt(Math.max(0, pv2 / vol - vw * vw));
    sdLine[cursor] = sd;
    if (cursor - rth < orMin) { orHi = Math.max(orHi, f.h); orLo = Math.min(orLo, f.l); }
    sHi = Math.max(sHi, f.h); sLo = Math.min(sLo, f.l);
  }

  let onHi = -Infinity, onLo = Infinity;
  for (let i = 0; i < Math.min(rth, done + 1); i++) { onHi = Math.max(onHi, b[i].h); onLo = Math.min(onLo, b[i].l); }

  const barsIntoRth = Math.max(0, Math.min(cursor, b.length) - rth);
  return {
    vwap, sdLine, sd, last: lastVwap,
    orHi: isFinite(orHi) ? orHi : null, orLo: isFinite(orLo) ? orLo : null,
    orLocked: barsIntoRth >= orMin, orMin,
    sHi: isFinite(sHi) ? sHi : null, sLo: isFinite(sLo) ? sLo : null,
    onHi: isFinite(onHi) ? onHi : null, onLo: isFinite(onLo) ? onLo : null,
    pdHigh: (session.dayHiLo && dayIdx > 0) ? session.dayHiLo[dayIdx - 1].hi : session.pdHigh,
    pdLow: (session.dayHiLo && dayIdx > 0) ? session.dayHiLo[dayIdx - 1].lo : session.pdLow,
    started: barsIntoRth > 0,
  };
}

export const DEFAULT_MAS: MAConfig[] = [
  { on: true, type: 'ema', period: 9, color: '#d55181' },
  { on: true, type: 'ema', period: 20, color: '#9085e9' },
  { on: false, type: 'sma', period: 50, color: '#c98500' },
];

export function computeMA(closes: number[], type: MAType, period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (!closes.length) return out;
  if (type === 'cma') {
    let sum = 0;
    for (let i = 0; i < closes.length; i++) { sum += closes[i]; out[i] = sum / (i + 1); }
    return out;
  }
  if (type === 'sma') {
    let sum = 0;
    for (let i = 0; i < closes.length; i++) {
      sum += closes[i];
      if (i >= period) sum -= closes[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }
  const k = 2 / (period + 1);
  let ema: number | null = null, sum = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { sum += closes[i]; continue; }
    if (ema === null) { sum += closes[i]; ema = sum / period; }
    else ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

export const maLabel = (m: MAConfig) => m.type.toUpperCase() + ' ' + (m.type === 'cma' ? '' : m.period);
