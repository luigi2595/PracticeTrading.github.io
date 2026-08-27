// Bar-cursor helpers shared by the chart, indicators, and engine: what price
// is "last" right now, what does the still-forming bar look like, and what
// bars does the chart show at the active timeframe. Ported from part3.js.
import { SUBSTEPS } from './spec';
import type { Bar, Session } from './types';

export function lastPrice(session: Session | null, cursor: number, sub: number): number {
  if (!session) return 0;
  const b = session.bars[cursor];
  if (!b) return session.bars[session.bars.length - 1].c;
  if (sub === 0) return cursor > 0 ? session.bars[cursor - 1].c : b.o;
  return b.path ? b.path[sub - 1] : b.c;
}

export function formingBar(session: Session | null, cursor: number, sub: number): Bar | null {
  if (!session) return null;
  const b = session.bars[cursor];
  if (!b || sub === 0) return null;
  const seen = (b.path || []).slice(0, sub);
  let hi = -Infinity, lo = Infinity;
  for (const p of seen) { if (p > hi) hi = p; if (p < lo) lo = p; }
  const o = cursor > 0 ? session.bars[cursor - 1].c : b.o;
  return { i: b.i, t: b.t, o, h: Math.max(hi, o), l: Math.min(lo, o), c: seen[seen.length - 1], v: 0, forming: true };
}

/** Aggregate completed 1m bars to the display timeframe. */
export function displayBars(session: Session, cursor: number, sub: number, tf: number): Bar[] {
  const out: Bar[] = [];
  const src = session.bars.slice(0, cursor);
  for (let i = 0; i < src.length; i += tf) {
    const grp = src.slice(i, i + tf);
    out.push({
      i: grp[0].i, t: grp[0].t, o: grp[0].o,
      h: Math.max.apply(null, grp.map((b) => b.h)),
      l: Math.min.apply(null, grp.map((b) => b.l)),
      c: grp[grp.length - 1].c,
      v: grp.reduce((a, b) => a + b.v, 0),
    });
  }
  const f = formingBar(session, cursor, sub);
  if (f) {
    const rem = src.length % tf;
    if (rem !== 0 && out.length) {
      const last = out[out.length - 1];
      last.h = Math.max(last.h, f.h); last.l = Math.min(last.l, f.l); last.c = f.c; last.forming = true;
    } else out.push(f);
  }
  return out;
}

export { SUBSTEPS };
