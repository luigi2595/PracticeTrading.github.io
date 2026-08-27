// Pattern Lab drill scenarios — the four-tells classifier and the synthetic
// "spine" builder that generates a level-break or trend scenario whose truth
// is derived from the same evidence a trader would read off the chart.
// Ported from part5.js. Uses Math.random (unseeded) exactly as the original
// drills did — only the replay sim's synthetic sessions are seeded.
import { SPEC, roundTick, mean, px, fmt$, esc, trueRangeATR } from './spec';
import { minuteToClock } from './spec';
import type { Bar, ContractSpec } from './types';

export function nrand(): number {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export const rr = (a: number, b: number) => a + Math.random() * (b - a);
export const ri = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));

export interface LevelFacts {
  ext: number; extATR: number; closesBeyond: number; barsBeyond: number;
  volRatio: number; tests: number; atr: number; backInside?: boolean;
  votes?: [string, 'trap' | 'real' | 'none'][];
}
export interface TrendFacts {
  stretch: number; climax: number; volRatio: number; contraction: number; atr: number; legs: number;
  votes?: [string, 'trap' | 'real' | 'none'][];
}

export function levelFacts(bars: Bar[], breakStart: number, k: 1 | -1, level: number, atr: number): LevelFacts {
  const uC = (b: Bar) => k * (b.c - level);
  const uLo = (b: Bar) => Math.min(k * (b.l - level), k * (b.h - level));
  const pre = bars.slice(0, breakStart), brk = bars.slice(breakStart);
  const ext = -Math.min.apply(null, brk.map(uLo));
  const volPre = mean(pre.slice(-20).map((b) => b.v)) || 1;
  const volBrk = mean(brk.map((b) => b.v));
  let tests = 0;
  for (let i = 3; i < pre.length - 3; i++) {
    const v = uLo(pre[i]);
    if (v > atr * 0.7) continue;
    let isPivot = true;
    for (let j = i - 3; j <= i + 3; j++) { if (j !== i && uLo(pre[j]) < v) { isPivot = false; break; } }
    if (isPivot) { tests++; i += 3; }
  }
  return {
    ext, extATR: ext / atr,
    closesBeyond: brk.filter((b) => uC(b) < 0).length,
    barsBeyond: brk.filter((b) => uLo(b) < 0).length,
    volRatio: volBrk / volPre,
    tests: Math.max(1, tests), atr,
    backInside: uC(bars[bars.length - 1]) >= 0,
  };
}

export function classifyLevel(f: LevelFacts): 'trap' | 'real' | 'none' {
  let a = 0, b = 0;
  const votes: [string, 'trap' | 'real' | 'none'][] = [];
  if (f.extATR < 1.05) { a++; votes.push(['ext', 'trap']); } else if (f.extATR > 1.55) { b++; votes.push(['ext', 'real']); } else votes.push(['ext', 'none']);
  if (f.closesBeyond <= 2) { a++; votes.push(['closes', 'trap']); } else if (f.closesBeyond >= 4) { b++; votes.push(['closes', 'real']); } else votes.push(['closes', 'none']);
  if (f.volRatio < 1.35) { a++; votes.push(['vol', 'trap']); } else if (f.volRatio > 1.6) { b++; votes.push(['vol', 'real']); } else votes.push(['vol', 'none']);
  if (f.barsBeyond <= 4) { a++; votes.push(['time', 'trap']); } else if (f.barsBeyond >= 7) { b++; votes.push(['time', 'real']); } else votes.push(['time', 'none']);
  f.votes = votes;
  if (a >= 3 && b === 0) return 'trap';
  if (b >= 3 && a === 0) return 'real';
  return 'none';
}

export function classifyTrend(f: TrendFacts): 'fade' | 'follow' | 'none' {
  let a = 0, b = 0;
  const votes: [string, 'trap' | 'real' | 'none'][] = [];
  if (f.stretch > 2.2) { a++; votes.push(['stretch', 'trap']); } else if (f.stretch < 1.2) { b++; votes.push(['stretch', 'real']); } else votes.push(['stretch', 'none']);
  if (f.climax > 1.9) { a++; votes.push(['climax', 'trap']); } else if (f.climax < 1.15) { b++; votes.push(['climax', 'real']); } else votes.push(['climax', 'none']);
  if (f.volRatio > 1.9) { a++; votes.push(['vol', 'trap']); } else if (f.volRatio < 1.25) { b++; votes.push(['vol', 'real']); } else votes.push(['vol', 'none']);
  if (f.contraction > 1.5) { a++; votes.push(['range', 'trap']); } else if (f.contraction < 0.9) { b++; votes.push(['range', 'real']); } else votes.push(['range', 'none']);
  f.votes = votes;
  if (a >= 3 && b === 0) return 'fade';
  if (b >= 3 && a === 0) return 'follow';
  return 'none';
}

function spineToBars(spine: number[], vols: number[], k: number, anchor: number, noise: number, prevClose: number | null, t0: number): Bar[] {
  const out: Bar[] = [];
  let o = prevClose == null ? anchor + k * spine[0] : prevClose;
  for (let i = 0; i < spine.length; i++) {
    const c = roundTick(anchor + k * spine[i] + nrand() * noise * 0.35);
    const hi = roundTick(Math.max(o, c) + Math.abs(nrand()) * noise * 0.45);
    const lo = roundTick(Math.min(o, c) - Math.abs(nrand()) * noise * 0.45);
    out.push({ i, o: roundTick(o), h: hi, l: lo, c, v: Math.round(vols[i]), t: minuteToClock(t0 + i) });
    o = c;
  }
  return out;
}

export interface StopOption { key: 'struct' | 'tight' | 'flat'; label: string; price: number; note: string }
export interface Scenario {
  family: 'support' | 'resistance' | 'trend';
  k: 1 | -1;
  level: number | null;
  atr: number;
  bars: Bar[];
  decision: number;
  breakStart?: number;
  trendUp?: boolean;
  truth: string;
  facts: LevelFacts | TrendFacts;
  side: 'Long' | 'Short' | null;
  entry: number;
  entryIdx: number;
  entryNote: string;
  sweep: number;
  sweepIdx?: number;
  stops: StopOption[];
  title: string;
  question: string;
  options: { key: string; label: string; desc: string }[];
}

export function buildLevelScenario(family: 'support' | 'resistance', intent: 'trap' | 'real' | 'none', base: number, volMult: number): Scenario {
  const anchor = roundTick(base + rr(-40, 40));
  const vm = volMult || 1;
  const atr = 2.8 * vm;
  const k: 1 | -1 = family === 'support' ? 1 : -1;
  const level = anchor;

  let u = rr(6, 10);
  const spine: number[] = [], vols: number[] = [];
  const ramp = (to: number, n: number, wob: number, vb: number) => {
    const from = u;
    for (let i = 1; i <= n; i++) { spine.push(from + (to - from) * (i / n) + nrand() * wob); vols.push(Math.max(150, vb * (0.75 + Math.random() * 0.5))); }
    u = to;
  };

  const tests = ri(2, 3);
  for (let t = 0; t < tests; t++) { ramp(rr(0.1, 1.1), ri(5, 8), atr * 0.22, 1700); ramp(rr(4.5, 9), ri(5, 8), atr * 0.26, 1550); }
  ramp(rr(1.0, 2.5), ri(4, 6), atr * 0.2, 1400);
  const breakStart = spine.length;

  let d: number, belowBars: number, volMulLocal: number;
  if (intent === 'trap') { d = atr * rr(0.35, 0.85); belowBars = ri(2, 4); volMulLocal = rr(0.7, 1.1); }
  else if (intent === 'real') { d = atr * rr(1.8, 3.0); belowBars = ri(6, 10); volMulLocal = rr(1.9, 3.0); }
  else { d = atr * rr(0.9, 1.5); belowBars = ri(4, 7); volMulLocal = rr(1.35, 1.7); }

  ramp(-d * 0.85, ri(2, 3), atr * 0.22, 1750 * volMulLocal);
  for (let i = 0; i < belowBars; i++) {
    const drift = intent === 'real' ? -d * 0.10 * i : 0;
    spine.push(-d * rr(0.45, 1.0) + drift + nrand() * atr * 0.15);
    vols.push(1750 * volMulLocal * (0.7 + Math.random() * 0.6));
  }
  if (intent === 'trap') spine.push(rr(-0.4, -0.05) * atr);
  else if (intent === 'real') spine.push(spine[spine.length - 1] - rr(0.1, 0.5) * atr);
  else spine.push(-d * rr(0.35, 0.8));
  vols.push(1750 * volMulLocal * (0.8 + Math.random() * 0.4));
  u = spine[spine.length - 1];

  const bars = spineToBars(spine, vols, k, level, atr, null, 60);
  const atrCalc = trueRangeATR(bars.slice(Math.max(0, breakStart - 14), breakStart));
  const f = levelFacts(bars, breakStart, k, level, atrCalc);
  const truth = classifyLevel(f);

  const post: number[] = [], pv: number[] = [];
  const ramp2 = (to: number, n: number, wob: number, vb: number) => {
    const from = u;
    for (let i = 1; i <= n; i++) { post.push(from + (to - from) * (i / n) + nrand() * wob); pv.push(Math.max(150, vb * (0.75 + Math.random() * 0.5))); }
    u = to;
  };
  const minU = -f.ext;
  if (truth === 'trap') { ramp2(rr(1.5, 3), 2, atr * 0.2, 2400); ramp2(rr(9, 24), ri(14, 18), atr * 0.3, 1900); }
  else if (truth === 'real') { ramp2(minU - rr(5, 18), ri(15, 19), atr * 0.3, 2100); }
  else { const c = u; for (let i = 0; i < 18; i++) { post.push(c + nrand() * atr * 0.9); pv.push(1500 * (0.7 + Math.random() * 0.6)); } u = post[post.length - 1]; }
  const outBars = spineToBars(post, pv, k, level, atr, bars[bars.length - 1].c, 60 + bars.length);

  const decision = bars.length;
  const all = bars.concat(outBars);
  let entryIdx = decision - 1;
  if (truth === 'trap') {
    for (let i = decision; i < all.length; i++) { if (k * (all[i].c - level) >= 0) { entryIdx = i; break; } }
  }
  const entry = all[entryIdx].c;
  const entryNote = truth === 'trap'
    ? 'Entry is the reclaim — the first close back inside the level, at ' + all[entryIdx].t + '. Not the bar you are looking at.'
    : truth === 'real' ? 'Entry is at market on the decision bar close — you are joining a break that is already moving.' : '';
  const sweep = k > 0 ? Math.min.apply(null, bars.slice(breakStart).map((b) => b.l)) : Math.max.apply(null, bars.slice(breakStart).map((b) => b.h));
  let sweepIdx = breakStart;
  for (let i = breakStart; i < bars.length; i++) { if ((k > 0 ? bars[i].l : bars[i].h) === sweep) { sweepIdx = i; break; } }
  const side: 'Long' | 'Short' | null = truth === 'none' ? null : (truth === 'trap' ? (k > 0 ? 'Long' : 'Short') : (k > 0 ? 'Short' : 'Long'));
  const lastBar = bars[decision - 1];

  let stops: StopOption[] = [];
  if (truth === 'trap') {
    stops = [
      { key: 'struct', label: '3 ticks beyond the sweep ' + (k > 0 ? 'low' : 'high'), price: roundTick(sweep - k * 3 * SPEC.tick), note: 'Structural — the level only failed if that extreme gives way again.' },
      { key: 'tight', label: 'A tick beyond the level itself', price: roundTick(level - k * SPEC.tick), note: 'Feels tight and cheap. It sits inside the exact noise the sweep just created.' },
      { key: 'flat', label: 'A flat 10 points from entry', price: roundTick(entry - (side === 'Long' ? 10 : -10)), note: 'Ignores the structure entirely — the number came from you, not the chart.' },
    ];
  } else if (truth === 'real') {
    stops = [
      { key: 'struct', label: '3 ticks back inside the level', price: roundTick(level + k * 3 * SPEC.tick), note: 'Structural — a reclaim of the level means the breakdown failed and you are wrong.' },
      { key: 'tight', label: 'Just past the last bar’s extreme', price: roundTick((k > 0 ? lastBar.h : lastBar.l) + k * SPEC.tick), note: 'A one-bar stop. Any normal retest takes it out.' },
      { key: 'flat', label: 'A flat 10 points from entry', price: roundTick(entry - (side === 'Long' ? 10 : -10)), note: 'Ignores the structure entirely.' },
    ];
  }

  return {
    family, k, level, atr: atrCalc, bars: all, decision, breakStart,
    truth, facts: f, side, entry, entryIdx, entryNote,
    sweep, sweepIdx, stops,
    title: family === 'support'
      ? 'Price just broke a support level that had held ' + f.tests + ' time' + (f.tests > 1 ? 's' : '')
      : 'Price just broke out over a high that had capped it ' + f.tests + ' time' + (f.tests > 1 ? 's' : ''),
    question: 'What just happened?',
    options: family === 'support'
      ? [{ key: 'trap', label: 'Failed breakdown', desc: 'the low got swept — buy the reclaim' },
         { key: 'real', label: 'Real breakdown', desc: 'sellers took control — this keeps going' },
         { key: 'none', label: 'No trade', desc: 'the evidence disagrees with itself' }]
      : [{ key: 'trap', label: 'Failed breakout', desc: 'the high got swept — sell the rejection' },
         { key: 'real', label: 'Real breakout', desc: 'buyers took control — this keeps going' },
         { key: 'none', label: 'No trade', desc: 'the evidence disagrees with itself' }],
  };
}

export function buildTrendScenario(intent: 'fade' | 'follow' | 'none', base: number, volMult: number): Scenario {
  const anchor = roundTick(base + rr(-40, 40));
  const vm = volMult || 1;
  const atr = 2.8 * vm;
  const k: 1 | -1 = Math.random() < 0.5 ? 1 : -1;

  let u = 0;
  const spine: number[] = [], vols: number[] = [];
  const ramp = (to: number, n: number, wob: number, vb: number) => {
    const from = u;
    for (let i = 1; i <= n; i++) { spine.push(from + (to - from) * (i / n) + nrand() * wob); vols.push(Math.max(150, vb * (0.75 + Math.random() * 0.5))); }
    u = to;
  };

  ramp(rr(-2, 2), ri(8, 12), atr * 0.3, 1500);
  const legs = ri(3, 4);
  for (let i = 0; i < legs; i++) { ramp(u + rr(6, 11), ri(6, 9), atr * 0.28, 1650); ramp(u - rr(1.5, 4), ri(3, 5), atr * 0.22, 1250); }

  if (intent === 'fade') { ramp(u + rr(10, 17), 2, atr * 0.25, 1650 * rr(2.3, 3.2)); spine.push(u - rr(0.3, 1.5)); vols.push(1650 * rr(2.0, 2.8)); u = spine[spine.length - 1]; }
  else if (intent === 'follow') { ramp(u - rr(2, 4.5), ri(5, 8), atr * 0.10, 1000); spine.push(u + rr(0.2, 1.2)); vols.push(1100); u = spine[spine.length - 1]; }
  else { ramp(u + rr(5, 9), ri(2, 4), atr * 0.22, 1650 * rr(1.4, 1.9)); spine.push(u - rr(0.5, 2)); vols.push(1650 * rr(1.3, 1.8)); u = spine[spine.length - 1]; }

  const bars = spineToBars(spine, vols, k, anchor, atr, null, 60);
  const atrCalc = trueRangeATR(bars.slice(-30, -3));
  const uC = (b: Bar) => k * (b.c - anchor);
  const m20 = mean(bars.slice(-20).map(uC));
  const last3 = bars.slice(-3), prior20 = bars.slice(-23, -3);
  const f: TrendFacts = {
    stretch: (uC(bars[bars.length - 1]) - m20) / atrCalc,
    climax: Math.max.apply(null, last3.map((b) => b.h - b.l)) / atrCalc,
    volRatio: mean(last3.map((b) => b.v)) / (mean(prior20.map((b) => b.v)) || 1),
    contraction: mean(bars.slice(-5).map((b) => b.h - b.l)) / atrCalc,
    atr: atrCalc, legs: legs + 1,
  };
  const truth = classifyTrend(f);

  const post: number[] = [], pv: number[] = [];
  const ramp2 = (to: number, n: number, wob: number, vb: number) => {
    const from = u;
    for (let i = 1; i <= n; i++) { post.push(from + (to - from) * (i / n) + nrand() * wob); pv.push(Math.max(150, vb * (0.75 + Math.random() * 0.5))); }
    u = to;
  };
  if (truth === 'fade') ramp2(u - rr(12, 26), ri(15, 19), atr * 0.3, 2000);
  else if (truth === 'follow') ramp2(u + rr(9, 20), ri(15, 19), atr * 0.3, 1800);
  else { const c = u; for (let i = 0; i < 18; i++) { post.push(c + nrand() * atr * 0.9); pv.push(1400 * (0.7 + Math.random() * 0.6)); } u = post[post.length - 1]; }
  const outBars = spineToBars(post, pv, k, anchor, atr, bars[bars.length - 1].c, 60 + bars.length);

  const decision = bars.length, all = bars.concat(outBars);
  const lastBar = bars[decision - 1];
  let entryIdx = decision - 1;
  let entryNote = 'Entry is at market on the decision bar close, with the trend.';
  if (truth === 'fade') {
    const c3 = bars.slice(-3).slice().sort((a, b) => (b.h - b.l) - (a.h - a.l))[0];
    const mid = (c3.h + c3.l) / 2;
    for (let i = decision; i < Math.min(all.length, decision + 8); i++) {
      if (k > 0 ? all[i].c < mid : all[i].c > mid) { entryIdx = i; break; }
    }
    entryNote = 'Entry is the trigger — the first close back through the middle of the climax bar, at ' + all[entryIdx].t + '. Shorting the spike itself is not this trade.';
  }
  const entry = all[entryIdx].c;
  const climaxExt = k > 0 ? Math.max.apply(null, bars.slice(-4).map((b) => b.h)) : Math.min.apply(null, bars.slice(-4).map((b) => b.l));
  const pullExt = k > 0 ? Math.min.apply(null, bars.slice(-9).map((b) => b.l)) : Math.max.apply(null, bars.slice(-9).map((b) => b.h));
  const trendUp = k > 0;
  const side: 'Long' | 'Short' | null = truth === 'none' ? null : (truth === 'fade' ? (trendUp ? 'Short' : 'Long') : (trendUp ? 'Long' : 'Short'));

  let stops: StopOption[] = [];
  if (truth === 'fade') {
    stops = [
      { key: 'struct', label: '3 ticks beyond the climax ' + (trendUp ? 'high' : 'low'), price: roundTick(climaxExt + k * 3 * SPEC.tick), note: 'Structural — if the climax extreme trades through, the trend never finished.' },
      { key: 'tight', label: 'Just past the last bar’s extreme', price: roundTick((trendUp ? lastBar.h : lastBar.l) + k * SPEC.tick), note: 'Inside a climax bar’s noise. This is the classic way to be right and still lose.' },
      { key: 'flat', label: 'A flat 10 points from entry', price: roundTick(entry + (side === 'Long' ? -10 : 10)), note: 'Arbitrary. In a climax, volatility is at its highest — a fixed number means the least here.' },
    ];
  } else if (truth === 'follow') {
    stops = [
      { key: 'struct', label: '3 ticks beyond the pullback ' + (trendUp ? 'low' : 'high'), price: roundTick(pullExt - k * 3 * SPEC.tick), note: 'Structural — the pullback failing is what would say the trend is over.' },
      { key: 'tight', label: 'Just past the last bar’s extreme', price: roundTick((trendUp ? lastBar.l : lastBar.h) - k * SPEC.tick), note: 'A one-bar stop in a trend that breathes. It gets taken by noise.' },
      { key: 'flat', label: 'A flat 10 points from entry', price: roundTick(entry + (side === 'Long' ? -10 : 10)), note: 'Ignores the structure entirely.' },
    ];
  }

  return {
    family: 'trend', k, level: null, atr: atrCalc, bars: all, decision, trendUp,
    truth, facts: f, side, entry, entryIdx, entryNote,
    sweep: climaxExt, stops,
    title: (trendUp ? 'An uptrend' : 'A downtrend') + ' has run ' + f.legs + ' legs. This is the current bar.',
    question: 'Is this the end of the move, or a pause in it?',
    options: [
      { key: 'fade', label: 'Exhaustion', desc: 'the trend is finishing — fade it' },
      { key: 'follow', label: 'Continuation', desc: 'this is a pause — go with the trend' },
      { key: 'none', label: 'No trade', desc: 'the evidence disagrees with itself' },
    ],
  };
}

export function patternName(sc: Scenario): string {
  if (sc.family === 'trend') return sc.truth === 'fade' ? 'Exhaustion reversal' : sc.truth === 'follow' ? 'Trend continuation' : 'Trend — no trade';
  const b = sc.family === 'support' ? 'breakdown' : 'breakout';
  return sc.truth === 'trap' ? 'Failed ' + b : sc.truth === 'real' ? 'Real ' + b : 'Level — no trade';
}

export interface StopSimResult { risk: number; stoppedAt: string | null; mfe: number; R: number }
export function simStop(sc: Scenario, stop: StopOption): StopSimResult {
  const dir = sc.side === 'Long' ? 1 : -1;
  const risk = Math.max(SPEC.tick, Math.abs(sc.entry - stop.price));
  let mfe = 0, stoppedAt: string | null = null;
  for (let i = (sc.entryIdx != null ? sc.entryIdx + 1 : sc.decision); i < sc.bars.length; i++) {
    const b = sc.bars[i];
    const hit = sc.side === 'Long' ? b.l <= stop.price : b.h >= stop.price;
    if (hit) { stoppedAt = b.t; break; }
    const fav = ((sc.side === 'Long' ? b.h : b.l) - sc.entry) * dir;
    if (fav > mfe) mfe = fav;
  }
  return { risk, stoppedAt, mfe, R: stoppedAt ? -1 : mfe / risk };
}

/** Ported from part5.js callFeedback — the "why" explanation shown right
 *  after a call is made. Returns an HTML string (rendered via
 *  dangerouslySetInnerHTML in the PatternLab component), exactly as the
 *  original built it with template strings. */
export function buildCallFeedback(sc: Scenario, pick: string, ok: boolean): string {
  const f = sc.facts as any;
  const aWord = sc.family === 'trend' ? 'exhaustion' : 'a failed break';
  const bWord = sc.family === 'trend' ? 'continuation' : 'a real break';
  const votes: [string, 'trap' | 'real' | 'none'][] = f.votes || [];
  const forA = votes.filter((v) => v[1] === 'trap').length, forB = votes.filter((v) => v[1] === 'real').length;
  const truthName = patternName(sc);

  let why: string;
  if (sc.family !== 'trend') {
    const isSup = sc.family === 'support';
    const dirWord = isSup ? 'below' : 'above';
    const extremeWord = isSup ? 'low' : 'high';
    const aggressor = isSup ? 'sellers' : 'buyers';
    const underOver = isSup ? 'under' : 'over';
    const actWord = isSup ? 'Buying' : 'Selling';
    if (sc.truth === 'trap') {
      why = 'The break travelled <b>' + f.ext.toFixed(2) + ' pts (' + f.extATR.toFixed(2) + '× ATR)</b> ' + dirWord + ' a level that had already held <b>' + f.tests + '×</b>, closed ' + dirWord + ' it only <b>' + f.closesBeyond + '</b> time' + (f.closesBeyond === 1 ? '' : 's') + ', spent <b>' + f.barsBeyond + ' bars</b> there, and did it on <b>' + f.volRatio.toFixed(2) + '×</b> normal volume. ' +
        'That is the signature of resting stops being triggered, not of new ' + aggressor + ' arriving. The obvious ' + extremeWord + ' is obvious to everyone — the orders ' + underOver + ' it are the whole reason price went there. ' +
        'The trade is the <b>reclaim</b>: you wait for a close back inside the level, and the ' + extremeWord + ' of the sweep is your risk. ' + actWord + ' while it is still ' + dirWord + ' the level is how this pattern bankrupts people who read it correctly.';
    } else if (sc.truth === 'real') {
      why = 'The break travelled <b>' + f.ext.toFixed(2) + ' pts (' + f.extATR.toFixed(2) + '× ATR)</b>, closed ' + dirWord + ' the level <b>' + f.closesBeyond + '</b> times, held there for <b>' + f.barsBeyond + ' bars</b>, and ran on <b>' + f.volRatio.toFixed(2) + '×</b> volume. ' +
        'Past roughly 1.5× ATR with repeated closes beyond, you are not watching stops being run — you are watching the market agree on a new price. ' +
        'Fading this is the single most expensive habit in intraday trading, because it feels exactly like the trade that worked last time. If you want in, the entry is the retest of the level from the other side, not a guess at the ' + extremeWord + '.';
    } else {
      why = 'The four tells disagree: <b>' + forA + '</b> point to ' + aWord + ', <b>' + forB + '</b> point to ' + bWord + '. ' +
        'Extension ' + f.extATR.toFixed(2) + '× ATR, ' + f.closesBeyond + ' closes beyond, ' + f.barsBeyond + ' bars beyond, ' + f.volRatio.toFixed(2) + '× volume. ' +
        'When the evidence is split, the trade is a coin flip with commission attached. "No trade" is a real answer and it is scored like one here.';
    }
  } else {
    if (sc.truth === 'fade') {
      why = 'Price is <b>' + f.stretch.toFixed(2) + '× ATR</b> above its own 20-bar mean after ' + f.legs + ' legs, the last push printed a bar <b>' + f.climax.toFixed(2) + '× ATR</b> tall on <b>' + f.volRatio.toFixed(2) + '×</b> volume, and the last five bars are averaging <b>' + f.contraction.toFixed(2) + '× ATR</b>. ' +
        'Stretch plus range expansion plus a volume spike is a move ending, not beginning — that is late buyers being filled by the people who were early. ' +
        'But note what it still is not: a reason to short a spike. The trigger is a close back through the climax bar, and the climax extreme is your risk. Without the trigger you are catching the knife.';
    } else if (sc.truth === 'follow') {
      why = 'Only <b>' + f.stretch.toFixed(2) + '× ATR</b> from the 20-bar mean, the biggest recent bar is <b>' + f.climax.toFixed(2) + '× ATR</b>, volume is <b>' + f.volRatio.toFixed(2) + '×</b> and the last five bars average <b>' + f.contraction.toFixed(2) + '× ATR</b>. ' +
        'That is a pullback, not a reversal: ranges are contracting and volume is drying up, which means the other side is not actually showing up — they are just absent for a moment. ' +
        'Contraction into a trend resolves with the trend far more often than against it. Trade it in the direction of the legs, with risk under the pullback.';
    } else {
      why = 'Split evidence — <b>' + forA + '</b> tells point to exhaustion, <b>' + forB + '</b> to continuation. Stretch ' + f.stretch.toFixed(2) + '× ATR, biggest bar ' + f.climax.toFixed(2) + '× ATR, volume ' + f.volRatio.toFixed(2) + '×. ' +
        'A trend that is merely extended is not a reversal, and a pause that is not contracting is not a continuation. This is a wait.';
    }
  }

  const head = ok
    ? '<div class="banner ok"><b>Correct — ' + truthName.toLowerCase() + '.</b></div>'
    : (pick === 'none'
      ? '<div class="banner warn"><b>You passed. It was ' + truthName.toLowerCase() + '.</b> Passing costs nothing but the opportunity — still worth knowing what you left.</div>'
      : '<div class="banner stop"><b>Not this one — it was ' + truthName.toLowerCase() + '.</b></div>');

  return head + '<div class="card"><h3>Why</h3><p style="margin:0;font-size:13.5px;line-height:1.75">' + why + '</p></div>';
}

/** Ported from part5.js finishReveal's "no trade" and stop-comparison
 *  branches. `spec` should reflect the user's current settings (point value
 *  moves with Settings → Account & costs, exactly like the original's
 *  shared, mutable SPEC object). */
export function buildOutcomeReveal(sc: Scenario, stopPick: string | null, callCorrect: boolean, spec: ContractSpec = SPEC): string {
  if (sc.truth === 'none') {
    return '<div class="card" style="margin-top:10px"><h3>What happened next</h3>' +
      '<p class="hint" style="margin:0;font-size:13px;line-height:1.7">Nothing worth paying for. Price went sideways — which is exactly what a set of tells that disagree with each other is warning you about. ' +
      'Every trader has a "no trade" number, and the ones who last have a high one. Passing on this is not caution, it is selection.</p></div>';
  }
  const rows = sc.stops.map((s) => {
    const r = simStop(sc, s);
    const mine = s.key === stopPick;
    const res = r.stoppedAt
      ? '<b class="neg">Stopped out at ' + r.stoppedAt + ' · −1R</b>'
      : '<b class="pos">Survived · reached +' + r.R.toFixed(2) + 'R</b>';
    return '<div class="stopcard' + (mine ? ' mine' : '') + '">' +
      '<div class="row wrap" style="justify-content:space-between;gap:6px">' +
        '<b style="font-size:13px">' + (mine ? '▸ ' : '') + esc(s.label) + '</b>' +
        '<span class="num" style="font-size:12.5px">' + px(s.price) + '</span></div>' +
      '<div class="hint" style="margin:3px 0 5px">risking ' + r.risk.toFixed(2) + ' pts · ' + fmt$(r.risk * spec.pointValue, 0) + ' per contract' + (mine ? ' · your choice' : '') + '</div>' +
      '<div style="font-size:12.5px;margin-bottom:4px">' + res + '</div>' +
      '<div class="hint">' + esc(s.note) + '</div></div>';
  }).join('');
  const structR = simStop(sc, sc.stops[0]);
  const tightR = simStop(sc, sc.stops[1]);
  const mine = sc.stops.find((x) => x.key === stopPick);
  const mineR = mine ? simStop(sc, mine) : structR;
  let lesson: string;
  if (stopPick === 'struct') {
    lesson = 'You put the risk where the idea actually lives. That is the whole game: a stop is not a number you can afford, it is the price that proves you wrong.';
    if (!tightR.stoppedAt && tightR.R > structR.R) {
      lesson += ' Worth sitting with, though: the tight stop survived this one and paid ' + tightR.R.toFixed(2) + 'R against your ' + structR.R.toFixed(2) + 'R, because it risked less. That is the seduction — when a tight stop works it looks brilliant. The case for yours is the other sixty trades, where the sweep’s own noise takes the tight one out for a full loss and you never see the move at all.';
    }
  } else if (stopPick === 'tight') {
    lesson = mineR.stoppedAt
      ? 'There it is: your stop was hit at ' + mineR.stoppedAt + ' for a full loss — on a read that was ' + (callCorrect ? 'correct' : 'wrong anyway') + ', and that ' + (structR.stoppedAt ? 'still would not have worked with more room' : 'paid ' + structR.R.toFixed(2) + 'R with the stop just ' + (structR.risk - mineR.risk).toFixed(2) + ' points further away') + '. Being right and getting stopped is not bad luck, it is a stop placed inside the noise the pattern is made of.'
      : 'It survived, and because it risked ' + (structR.risk - mineR.risk).toFixed(2) + ' points less it paid ' + mineR.R.toFixed(2) + 'R against the structural stop’s ' + structR.R.toFixed(2) + 'R. Note how good that feels — that is exactly why traders keep using it. Repeat it enough times and the losses come from the trades where price wicks back through the sweep before going your way, which on this pattern is most of them.';
  } else {
    lesson = 'The flat stop risked ' + (mineR.risk - structR.risk).toFixed(2) + ' points more than the structural one for the same idea, so the same move paid ' + (structR.R > 0 && mineR.R > 0 ? 'you ' + mineR.R.toFixed(2) + 'R instead of ' + structR.R.toFixed(2) + 'R' : 'less R') + '. A fixed number cannot know where this particular level is. Where the stop goes is set by the chart; how many contracts you take is the thing that adjusts.';
  }
  if (structR.stoppedAt) {
    lesson += ' And note the structural stop lost here too — the read was right and the trade still did not work. That is normal, and it is exactly why size is calculated from the stop rather than the stop being squeezed to fit the size you wanted.';
  }
  return '<div class="card" style="margin-top:10px"><h3>What each stop would have done</h3>' +
    '<div class="stopgrid">' + rows + '</div>' +
    '<p class="hint" style="margin:10px 0 0;font-size:13px;line-height:1.7">' + lesson + '</p></div>';
}

export const TELL_LABEL: Record<string, [string, (f: any) => string]> = {
  ext: ['Extension past the level', (f) => f.ext.toFixed(2) + ' pts · ' + f.extATR.toFixed(2) + '× ATR'],
  closes: ['Closes beyond the level', (f) => String(f.closesBeyond)],
  vol: ['Volume vs the 20 bars before', (f) => f.volRatio.toFixed(2) + '×'],
  time: ['Bars spent beyond it', (f) => String(f.barsBeyond)],
  stretch: ['Stretch from the 20-bar mean', (f) => f.stretch.toFixed(2) + '× ATR'],
  climax: ['Biggest of the last 3 bars', (f) => f.climax.toFixed(2) + '× ATR'],
  range: ['Average range, last 5 bars', (f) => f.contraction.toFixed(2) + '× ATR'],
};
