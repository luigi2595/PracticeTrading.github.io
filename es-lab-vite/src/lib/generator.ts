// Synthetic ES session generator + the intrabar path synthesizer used for
// both generated and imported bars. Ported from part3.js — regime switching,
// GARCH-like clustering, U-shaped time-of-day volatility, deterministic
// per-bar intrabar paths.
import { mulberry32, roundTick, clamp, minuteToClock, PRE_BARS, SUBSTEPS } from './spec';
import type { Bar, GenParams, Session } from './types';

export function generateSession(opts: GenParams): Session {
  const seed = opts.seed;
  const rnd = mulberry32(seed);
  let spare: number | null = null;
  function gauss(): number {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0, v = 0, s = 0;
    do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul; return u * mul;
  }

  const rthMinutes = opts.minutes;
  const total = PRE_BARS + rthMinutes;
  const base = opts.base;
  const volMult = opts.volMult;

  const sigma0 = base * 0.00026 * volMult;

  const priorClose = roundTick(base);
  const pdRange = priorClose * (0.006 + rnd() * 0.009);
  const pdLow = roundTick(priorClose - pdRange * (0.15 + rnd() * 0.7));
  const pdHigh = roundTick(pdLow + pdRange);
  let price = roundTick(priorClose * (1 + gauss() * 0.0022));

  let regime = rnd() < 0.5 ? 0 : rnd() < 0.5 ? 1 : 2;
  let regimeLeft = 25 + Math.floor(rnd() * 70);
  let anchor = price;
  let volState = 1;
  let shockLeft = 0;

  const bars: Bar[] = [];
  for (let i = 0; i < total; i++) {
    const isPre = i < PRE_BARS;
    const m = i - PRE_BARS;

    let tod: number;
    if (isPre) tod = 0.45 + 0.35 * Math.exp(-(PRE_BARS - i) / 25);
    else tod = 0.72 + 1.45 * Math.exp(-m / 38) + 0.85 * Math.exp(-(rthMinutes - m) / 34);

    volState = Math.exp(0.9 * Math.log(volState) + 0.22 * gauss());
    volState = clamp(volState, 0.45, 3.2);
    if (shockLeft > 0) shockLeft--;
    else if (!isPre && rnd() < 0.004) { shockLeft = 3 + Math.floor(rnd() * 8); volState *= 2.6 + rnd() * 2; }

    const sigma = sigma0 * tod * volState;

    if (--regimeLeft <= 0) {
      const r = rnd();
      regime = r < 0.44 ? 0 : r < 0.72 ? 1 : 2;
      regimeLeft = 25 + Math.floor(rnd() * 70);
      anchor = price;
    }
    let drift = 0, revert = 0;
    if (regime === 0) { drift = 0; revert = 0.055; }
    else if (regime === 1) { drift = 0.30 * sigma; revert = 0.006; }
    else { drift = -0.30 * sigma; revert = 0.006; }
    anchor += drift * 0.9;

    const path = new Array(SUBSTEPS) as number[];
    let p = price;
    const stepSig = sigma / Math.sqrt(SUBSTEPS);
    for (let k = 0; k < SUBSTEPS; k++) {
      p += drift / SUBSTEPS + stepSig * gauss() + (revert * (anchor - p)) / SUBSTEPS;
      path[k] = roundTick(p);
    }
    const o = roundTick(price);
    const c = path[SUBSTEPS - 1];
    let hi = o, lo = o;
    for (let k = 0; k < SUBSTEPS; k++) { if (path[k] > hi) hi = path[k]; if (path[k] < lo) lo = path[k]; }
    hi = roundTick(hi + Math.abs(gauss()) * sigma * 0.18);
    lo = roundTick(lo - Math.abs(gauss()) * sigma * 0.18);

    const range = hi - lo;
    const vol = Math.round((900 + 2600 * tod) * (0.55 + (range / (sigma * 3 + 0.01)) * 0.35) * (0.75 + rnd() * 0.5));

    bars.push({ i, t: minuteToClock(i), o, h: hi, l: lo, c, v: Math.max(60, vol), path, pre: isPre });
    price = c;
  }

  return {
    bars, priorClose, openPrice: bars[PRE_BARS] ? bars[PRE_BARS].o : priorClose,
    pdHigh: Math.max(pdHigh, priorClose), pdLow: Math.min(pdLow, priorClose),
    seed, rthStart: PRE_BARS, rthMinutes,
  };
}

/** Real bars record only OHLC; this walks open -> one extreme -> the other -> close
 *  to give stops/targets a plausible, and always-reproducible, fill order. */
export function synthPath(o: number, h: number, l: number, c: number, idx: number): number[] {
  const key =
    (((o * 4) | 0) * 73856093) ^
    (((h * 4) | 0) * 19349663) ^
    (((l * 4) | 0) * 83492791) ^
    (((c * 4) | 0) * 49979693) ^
    ((idx || 0) * 2654435761);
  const rnd = mulberry32(key >>> 0);
  const highFirst = rnd() < (c >= o ? 0.35 : 0.65);
  const way = highFirst ? [o, h, l, c] : [o, l, h, c];
  const path: number[] = [];
  for (let k = 0; k < SUBSTEPS; k++) {
    const u = ((k + 1) / SUBSTEPS) * 3;
    const seg = Math.min(2, Math.floor(u));
    const f = u - seg;
    path.push(clamp(roundTick(way[seg] + (way[seg + 1] - way[seg]) * f), l, h));
  }
  path[SUBSTEPS - 1] = clamp(roundTick(c), l, h);
  return path;
}
