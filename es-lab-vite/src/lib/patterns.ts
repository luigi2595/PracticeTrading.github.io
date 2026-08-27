// The live pattern detector: finds levels people would actually draw
// (clustered fractal pivots), watches for a break, and classifies what
// happened using the same four tells as the Pattern Lab drills. Only ever
// looks at bars already printed — never a lookahead. Ported from part3.js
// scanPatterns/pivots/candidateLevels.
import { mean, px, trueRangeATR } from './spec';
import { classifyLevel } from './patternLab';
import type { Bar, CandidateLevel, PatternEvent } from './types';

export const PAT_COLOR: Record<string, string> = { failed: '#3987e5', real: '#d03b3b', sweep: '#fab219', retest: '#9085e9' };

export function pivots(bars: Bar[], k: number): { hi: number[]; lo: number[] } {
  const hi: number[] = [], lo: number[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let isHi = true, isLo = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].h >= bars[i].h) isHi = false;
      if (bars[j].l <= bars[i].l) isLo = false;
    }
    if (isHi) hi.push(i);
    if (isLo) lo.push(i);
  }
  return { hi, lo };
}

export function candidateLevels(bars: Bar[], atr: number): CandidateLevel[] {
  const look = bars.slice(-90);
  const off = bars.length - look.length;
  const pv = pivots(look, 3);
  const raw: CandidateLevel[] = (pv.hi
    .map((i) => ({ price: look[i].h, dir: -1 as const, touches: 1, firstIdx: i + off, lastIdx: i + off })) as CandidateLevel[])
    .concat(pv.lo.map((i) => ({ price: look[i].l, dir: 1 as const, touches: 1, firstIdx: i + off, lastIdx: i + off })) as CandidateLevel[]);
  const out: CandidateLevel[] = [];
  for (const r of raw) {
    const near = out.find((o) => o.dir === r.dir && Math.abs(o.price - r.price) < atr * 0.45);
    if (near) { near.touches++; near.lastIdx = Math.max(near.lastIdx, r.lastIdx); }
    else out.push({ ...r });
  }
  return out.filter((o) => o.touches >= 2).sort((a, b) => b.touches - a.touches).slice(0, 4);
}

export interface ScanResult { events: PatternEvent[]; fresh: PatternEvent[] }

/**
 * bars: printed bars only (S.session.bars.slice(0, cursor)).
 * prevEvents: the events array from the previous scan (immutable in, new array out).
 * Returns the full updated events list (capped at 24) plus the events that are
 * newly created or changed kind this scan, for the caller to toast/announce.
 */
export function scanPatterns(bars: Bar[], prevEvents: PatternEvent[]): ScanResult {
  const events = prevEvents.map((e) => ({ ...e }));
  const fresh: PatternEvent[] = [];
  if (bars.length < 45) return { events, fresh };

  const atr = trueRangeATR(bars.slice(-20));
  const levels = candidateLevels(bars, atr);

  for (const L of levels) {
    const k = L.dir;
    const uC = (b: Bar) => k * (b.c - L.price);
    const uLo = (b: Bar) => Math.min(k * (b.l - L.price), k * (b.h - L.price));

    let breakIdx = -1;
    for (let i = L.lastIdx + 1; i < bars.length; i++) {
      if (uC(bars[i]) < 0) { breakIdx = i; break; }
    }
    if (breakIdx < 0) continue;

    const seg = bars.slice(breakIdx);
    if (seg.length < 2) continue;
    const ext = -Math.min.apply(null, seg.map(uLo));
    const closesBeyond = seg.filter((b) => uC(b) < 0).length;
    const barsBeyond = seg.filter((b) => uLo(b) < 0).length;
    const pre = bars.slice(Math.max(0, breakIdx - 20), breakIdx);
    const volPre = mean(pre.map((b) => b.v)) || 1;
    const volRatio = mean(seg.map((b) => b.v)) / volPre;
    const f = { ext, extATR: ext / atr, closesBeyond, barsBeyond, volRatio, tests: L.touches };
    const verdict = classifyLevel(f as any);

    const key = Math.round(L.price * 4) + ':' + breakIdx;
    const seenIdx = events.findIndex((e) => e.key === key);
    const back = uC(bars[bars.length - 1]) >= 0;
    const word = k > 0 ? 'breakdown' : 'breakout';
    const side = k > 0 ? 'low' : 'high';

    let kind: PatternEvent['kind'] | null = null, text = '', detail = '';
    if (back && seg.length >= 2 && verdict === 'trap') {
      kind = 'failed';
      text = 'Failed ' + word;
      detail = 'The ' + side + ' at ' + px(L.price) + ' was swept by ' + f.extATR.toFixed(2) + '× ATR on ' +
        f.volRatio.toFixed(2) + '× volume and price closed back inside. That is stops being run, not supply arriving. ' +
        'The trade is this reclaim, with risk at the sweep ' + side + '.';
    } else if (verdict === 'real' && !back) {
      kind = 'real';
      text = 'Real ' + word;
      detail = 'Extended ' + f.extATR.toFixed(2) + '× ATR with ' + f.closesBeyond + ' closes beyond ' + px(L.price) +
        ' on ' + f.volRatio.toFixed(2) + '× volume. The market has accepted the new price — fading this is the expensive habit.';
    } else if (!back && seg.length <= 6) {
      kind = 'sweep';
      text = word.charAt(0).toUpperCase() + word.slice(1) + ' in progress';
      detail = 'Through ' + px(L.price) + ' by ' + f.extATR.toFixed(2) + '× ATR, ' + f.closesBeyond + ' close' +
        (f.closesBeyond === 1 ? '' : 's') + ' beyond, ' + f.volRatio.toFixed(2) + '× volume. Undecided — this is the moment to wait, not act.';
    }

    if (verdict === 'real') {
      for (let i = breakIdx + 3; i < bars.length; i++) {
        const touched = Math.abs(k * (bars[i].h - L.price)) < atr * 0.35 || Math.abs(k * (bars[i].l - L.price)) < atr * 0.35;
        if (touched && uC(bars[i]) < 0 && i >= bars.length - 4) {
          kind = 'retest'; text = 'Retest of ' + px(L.price);
          detail = 'Price came back to the broken level from the other side and was rejected. A held retest is the ' +
            'lower-risk entry the initial break never offers — your risk sits just the other side of ' + px(L.price) + '.';
          break;
        }
      }
    }

    if (!kind) continue;
    if (seenIdx >= 0) {
      if (events[seenIdx].kind !== kind) {
        events[seenIdx] = { ...events[seenIdx], kind, text, detail, bar: bars.length - 1 };
        fresh.push(events[seenIdx]);
      }
      continue;
    }
    const ev: PatternEvent = {
      key, kind, text, detail, price: L.price,
      bar: bars.length - 1, breakBar: breakIdx, t: bars[bars.length - 1].t, dir: k,
    };
    events.push(ev);
    fresh.push(ev);
  }

  while (events.length > 24) events.shift();
  return { events, fresh };
}
