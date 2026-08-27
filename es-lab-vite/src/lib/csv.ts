// CSV import for real ES bars — handles the common export shapes: separate
// date/time or one datetime column, comma or semicolon delimiters, US or
// ISO dates, with or without volume. Ported from part3.js parseBarsCSV.
import { roundTick, minuteToClock, SUBSTEPS } from './spec';
import { synthPath } from './generator';
import type { Bar, ImportedSession } from './types';

export interface ParseResult { sessions: ImportedSession[]; skipped: number }

export function parseBarsCSV(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) throw new Error('that file is empty');
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = (l: string) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));

  const head = split(lines[0]).map((h) => h.toLowerCase());
  let start = 1;
  const findCol = (names: string[]) => {
    for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  let cD = findCol(['date', 'datetime', 'date/time', 'time', 'timestamp']);
  let cO = findCol(['open', 'o']), cH = findCol(['high', 'h']),
      cL = findCol(['low', 'l']), cC = findCol(['close', 'c', 'last']),
      cV = findCol(['volume', 'vol', 'v']);
  let cT = findCol(['time']);
  if (cT === cD) cT = -1;

  if (cO < 0 || cH < 0 || cL < 0 || cC < 0) {
    const f = split(lines[0]);
    if (f.length >= 6 && !isNaN(parseFloat(f[f.length - 4]))) {
      start = 0;
      const n = f.length;
      cV = isNaN(parseFloat(f[n - 1])) ? -1 : n - 1;
      const base = cV >= 0 ? n - 5 : n - 4;
      cO = base; cH = base + 1; cL = base + 2; cC = base + 3;
      cD = 0; cT = base > 1 ? 1 : -1;
    } else throw new Error('could not find open/high/low/close columns');
  }

  interface Row { o: number; h: number; l: number; c: number; v: number; t: string | null; i?: number; path?: number[] }
  const days = new Map<string, Row[]>();
  let skipped = 0;
  for (let i = start; i < lines.length; i++) {
    const f = split(lines[i]);
    const o = parseFloat(f[cO]), h = parseFloat(f[cH]), l = parseFloat(f[cL]), c = parseFloat(f[cC]);
    if (![o, h, l, c].every(isFinite)) { skipped++; continue; }
    const v = cV >= 0 ? Math.max(1, parseFloat(f[cV]) || 1) : 1000;
    const rawD = cD >= 0 ? f[cD] : '';
    const rawT = cT >= 0 ? f[cT] : '';
    const stamp = (rawD + ' ' + rawT).trim();
    const dm = stamp.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/) || stamp.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    let dayKey = 'day';
    if (dm) {
      dayKey = dm[1].length === 4
        ? dm[1] + '-' + dm[2].padStart(2, '0') + '-' + dm[3].padStart(2, '0')
        : dm[3] + '-' + dm[1].padStart(2, '0') + '-' + dm[2].padStart(2, '0');
    }
    const tm = stamp.match(/(\d{1,2}):(\d{2})/);
    const clock = tm ? tm[1].padStart(2, '0') + ':' + tm[2] : null;
    const ro = roundTick(o), rc = roundTick(c);
    const rh = roundTick(Math.max(h, o, c)), rl = roundTick(Math.min(l, o, c));
    if (!days.has(dayKey)) days.set(dayKey, []);
    days.get(dayKey)!.push({ o: ro, h: Math.max(rh, ro, rc), l: Math.min(rl, ro, rc), c: rc, v, t: clock });
  }
  if (!days.size) throw new Error('no usable rows — check the columns are open, high, low, close');

  const out: ImportedSession[] = [];
  let prev: ImportedSession | null = null;
  for (const [date, rows] of days) {
    if (rows.length < 20) { skipped += rows.length; continue; }
    rows.forEach((b, i) => {
      if (!b.t) b.t = minuteToClock(i);
      b.i = i;
      b.path = synthPath(b.o, b.h, b.l, b.c, i);
    });
    let rthStart = rows.findIndex((b) => (b.t as string) >= '09:30');
    if (rthStart < 0) rthStart = 0;
    const bars = rows as unknown as Bar[];
    const sess: ImportedSession = {
      bars,
      date,
      label: date + ' · ' + rows.length + ' bars',
      rthStart,
      rthMinutes: rows.length - rthStart,
      priorClose: prev ? prev.bars[prev.bars.length - 1].c : rows[0].o,
      pdHigh: prev ? Math.max.apply(null, prev.bars.map((b) => b.h)) : Math.max.apply(null, rows.map((b) => b.h)),
      pdLow: prev ? Math.min.apply(null, prev.bars.map((b) => b.l)) : Math.min.apply(null, rows.map((b) => b.l)),
      openPrice: rows[rthStart] ? rows[rthStart].o : rows[0].o,
      seed: 'imported:' + date,
      imported: true,
    };
    out.push(sess);
    prev = sess;
  }
  if (!out.length) throw new Error('every day had fewer than 20 bars');
  return { sessions: out, skipped };
}
