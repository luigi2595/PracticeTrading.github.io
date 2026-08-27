// The trading engine: orders, positions, exits, risk caps, and journal
// statistics. Ported from part4a.js, restructured so every function takes
// its state explicitly instead of reading the DOM or a module-global `S` —
// that's what makes it usable from a React reducer and testable in plain
// Node without a browser.
import { SPEC, roundTick, px, mean, fmt$ } from './spec';
import { lastPrice } from './session';
import type { Bar, RestingOrder as Order, Position, PositionExit, Session, Settings, Side, Trade } from './types';

export function openPnl(position: Position | null, price: number, spec: typeof SPEC = SPEC): number {
  if (!position) return 0;
  const dir = position.side === 'Long' ? 1 : -1;
  return (price - position.entry) * dir * spec.pointValue * position.qty;
}

export function totalNet(trades: Trade[]): number {
  return trades.filter((t) => t.source === 'sim').reduce((a, t) => a + t.net, 0);
}

/** How much risk the daily cap still allows. Infinity if rules aren't enforced or no cap set. */
export function remainingBudget(realized: number, settings: Settings): number {
  if (!settings.enforceRules) return Infinity;
  const cap = settings.lossLimit || 0;
  if (cap <= 0) return Infinity;
  return cap + realized; // realized is negative when down
}

export function maxContracts(stopPts: number, realized: number, settings: Settings, spec: typeof SPEC = SPEC): number {
  const rem = remainingBudget(realized, settings);
  if (rem === Infinity) return 20;
  return Math.max(0, Math.floor(rem / Math.max(0.01, stopPts * spec.pointValue)));
}

export interface ExitPlan { stop: number | null; target: number | null }

export function exitPriceFrom(
  val: number, unit: 'pts' | 'ticks' | 'price', entry: number, side: Side, isStop: boolean, spec: typeof SPEC = SPEC,
): number | null {
  if (!isFinite(val) || val <= 0) return null;
  if (unit === 'price') return roundTick(val, spec);
  const pts = unit === 'ticks' ? val * spec.tick : val;
  const dir = side === 'Long' ? 1 : -1;
  return roundTick(entry + (isStop ? -dir : dir) * pts, spec);
}

export function ticketPlan(side: Side, entry: number, settings: Settings, spec: typeof SPEC = SPEC): ExitPlan {
  return {
    stop: settings.useStop ? exitPriceFrom(settings.stopVal, settings.stopUnit, entry, side, true, spec) : null,
    target: settings.useTarget ? exitPriceFrom(settings.targetVal, settings.targetUnit, entry, side, false, spec) : null,
  };
}

export function validPlan(side: Side, entry: number, plan: ExitPlan): string | null {
  if (plan.stop != null && (side === 'Long' ? plan.stop >= entry : plan.stop <= entry))
    return 'A stop has to sit on the losing side of ' + px(entry) + '.';
  if (plan.target != null && (side === 'Long' ? plan.target <= entry : plan.target >= entry))
    return 'A target has to sit on the winning side of ' + px(entry) + '.';
  return null;
}

export function enterPosition(
  side: Side, qty: number, entry: number, stop: number | null, target: number | null, tag: string,
  cursor: number, session: Session, spec: typeof SPEC = SPEC,
): Position {
  const dir = side === 'Long' ? 1 : -1;
  const stopPts = stop != null ? Math.abs(entry - stop) : 0;
  return {
    side, qty, entry, initQty: qty, exits: [], grossAcc: 0,
    hi: entry, lo: entry, beMoved: false,
    stop: stop != null ? stop : roundTick(entry - dir * 1000, spec),
    target: target != null ? target : roundTick(entry + dir * 1000, spec),
    stopPts, tgtPts: target != null ? Math.abs(target - entry) : 0,
    hasStop: stop != null, hasTarget: target != null,
    mae: 0, mfe: 0,
    openedBar: cursor,
    openedAt: session.bars[Math.min(cursor, session.bars.length - 1)].t,
    tag,
    riskD: stopPts * spec.pointValue * qty,
  };
}

/** Resting-order fills. Mutates nothing; returns the fill if one order should
 *  trigger at this price (only one can fill since a position closes the book). */
export interface FillResult { order: Order; fillPrice: number; stop: number | null }
export function checkOrders(orders: Order[], price: number, hasPosition: boolean, spec: typeof SPEC = SPEC): FillResult | null {
  if (!orders.length || hasPosition) return null;
  for (const o of orders) {
    const hit = o.type === 'limit'
      ? (o.side === 'Long' ? price <= o.price : price >= o.price)
      : (o.side === 'Long' ? price >= o.price : price <= o.price);
    if (!hit) continue;
    const dir = o.side === 'Long' ? 1 : -1;
    const fill = o.type === 'limit' ? o.price : roundTick(price + dir * spec.slipTicks * spec.tick, spec);
    let stop = o.stop;
    if (o.type === 'stop' && stop != null && fill !== o.price) stop = roundTick(stop + (fill - o.price), spec);
    return { order: o, fillPrice: fill, stop };
  }
  return null;
}

/** One substep of price movement against an open position. Returns a close
 *  instruction if the stop or target was touched (checked before hi/lo is
 *  further extended, matching the original's order of operations). */
export interface PriceTick { mae: number; mfe: number; hi: number; lo: number; closeAt: number | null; closeReason: string | null }
export function onPriceAgainstPosition(position: Position, price: number, spec: typeof SPEC = SPEC): PriceTick {
  const dir = position.side === 'Long' ? 1 : -1;
  const excursion = (price - position.entry) * dir;
  const mae = Math.min(position.mae, excursion);
  const mfe = Math.max(position.mfe, excursion);
  const hi = Math.max(position.hi, price);
  const lo = Math.min(position.lo, price);

  if (position.side === 'Long') {
    if (position.hasStop && price <= position.stop) return { mae, mfe, hi, lo, closeAt: roundTick(Math.min(position.stop, price) - spec.slipTicks * spec.tick, spec), closeReason: 'Stop' };
    if (position.hasTarget && price >= position.target) return { mae, mfe, hi, lo, closeAt: position.target, closeReason: 'Target' };
  } else {
    if (position.hasStop && price >= position.stop) return { mae, mfe, hi, lo, closeAt: roundTick(Math.max(position.stop, price) + spec.slipTicks * spec.tick, spec), closeReason: 'Stop' };
    if (position.hasTarget && price <= position.target) return { mae, mfe, hi, lo, closeAt: position.target, closeReason: 'Target' };
  }
  return { mae, mfe, hi, lo, closeAt: null, closeReason: null };
}

/** Trailing stop: only ever ratchets in the position's favour. Returns the
 *  new stop price, or null if nothing should change. */
export function applyTrail(position: Position, recentBars: Bar[], mode: 'off' | 'atr' | 'swing', atrMult: number, trailBars: number, lastPx: number, atrFn: (bars: Bar[]) => number, spec: typeof SPEC = SPEC): number | null {
  if (mode === 'off') return null;
  if (recentBars.length < 3) return null;
  let cand: number;
  if (mode === 'atr') {
    const atr = atrFn(recentBars.slice(-14));
    cand = position.side === 'Long' ? position.hi - atrMult * atr : position.lo + atrMult * atr;
  } else {
    const n = Math.max(2, Math.round(trailBars || 5));
    const seg = recentBars.slice(-n);
    cand = position.side === 'Long'
      ? Math.min.apply(null, seg.map((b) => b.l)) - spec.tick
      : Math.max.apply(null, seg.map((b) => b.h)) + spec.tick;
  }
  cand = roundTick(cand, spec);
  if (position.side === 'Long') { if (cand > position.stop && cand < lastPx) return cand; }
  else { if (cand < position.stop && cand > lastPx) return cand; }
  return null;
}

/** Scale out of part (or all) of a position. Returns the updated position
 *  (or null if fully closed) plus the exit record appended. */
export interface ScaleResult { position: Position | null; exit: PositionExit; beMoved: boolean }
export function closePartial(position: Position, qty: number, exitPrice: number, reason: string, barTime: string, beOnScale: boolean, spec: typeof SPEC = SPEC): ScaleResult {
  const q = Math.max(1, Math.min(Math.round(qty), position.qty));
  const dir = position.side === 'Long' ? 1 : -1;
  const pts = roundTick((exitPrice - position.entry) * dir, spec);
  const exit: PositionExit = { qty: q, price: exitPrice, pts, reason, t: barTime };
  const grossAcc = position.grossAcc + pts * spec.pointValue * q;
  const remainingQty = position.qty - q;

  if (remainingQty > 0) {
    let beMoved = position.beMoved, stop = position.stop;
    if (beOnScale && !position.beMoved && pts > 0) { stop = position.entry; beMoved = true; }
    return {
      position: { ...position, qty: remainingQty, exits: [...position.exits, exit], grossAcc, stop, beMoved },
      exit, beMoved: beMoved && !position.beMoved,
    };
  }
  return { position: null, exit, beMoved: false };
}

export function finalizeTrade(
  position: Position, exits: PositionExit[], grossAcc: number, lastReason: string,
  cursorBar: Bar, spec: typeof SPEC, genParams: Trade['gen'], importedDate: string | null, seedText: string, nextId: number,
): Trade {
  const dir = position.side === 'Long' ? 1 : -1;
  const gross = grossAcc;
  const comm = spec.commission * 2 * position.initQty;
  const net = gross - comm;
  const avgExit = roundTick(exits.reduce((a, e) => a + e.price * e.qty, 0) / position.initQty, spec);
  const pts = roundTick((avgExit - position.entry) * dir, spec);
  const scaled = exits.length > 1;
  const reason = scaled ? 'Scaled (' + exits.map((e) => e.reason).join(' → ') + ')' : lastReason;
  const availableR = position.stopPts > 0 ? position.mfe / position.stopPts : null;
  const R = position.riskD ? net / position.riskD : null;

  return {
    id: nextId,
    t: cursorBar.t,
    openedAt: position.openedAt,
    side: position.side, qty: position.initQty,
    entry: position.entry, exit: avgExit,
    pts, gross, comm, net,
    riskD: position.riskD, R,
    mae: position.mae, mfe: position.mfe,
    availableR,
    capture: availableR != null && availableR > 0.05 && R != null ? R / availableR : null,
    exits: exits.slice(),
    scaled,
    barsHeld: cursorBar.i - position.openedBar,
    entryBar: position.openedBar, exitBar: cursorBar.i,
    initialStop: roundTick(position.entry - (position.side === 'Long' ? 1 : -1) * position.stopPts, spec),
    gen: genParams,
    importedDate,
    reason, tag: position.tag, note: '',
    source: 'sim', seed: seedText,
  };
}

export interface Stats {
  n: number; net: number; wins: number; losses: number; winRate: number;
  pf: number; avgWin: number; avgLoss: number; expR: number | null; expD: number;
  maxDD: number; worstStreak: number; best: number; worst: number; commissions: number;
  capture: number | null; avgAvail: number;
}
export function computeStats(list: Trade[]): Stats {
  const n = list.length;
  const wins = list.filter((t) => t.net > 0), losses = list.filter((t) => t.net < 0);
  const gw = wins.reduce((a, t) => a + t.net, 0), gl = Math.abs(losses.reduce((a, t) => a + t.net, 0));
  const net = list.reduce((a, t) => a + t.net, 0);
  const rs = list.filter((t) => t.R != null && isFinite(t.R)).map((t) => t.R as number);
  let run = 0, peak = 0, dd = 0;
  for (const t of list) { run += t.net; peak = Math.max(peak, run); dd = Math.min(dd, run - peak); }
  let curStreak = 0, worstStreak = 0;
  for (const t of list) { if (t.net < 0) { curStreak++; worstStreak = Math.max(worstStreak, curStreak); } else curStreak = 0; }
  const capt = list.filter((t) => t.capture != null).map((t) => t.capture as number);
  const avail = list.filter((t) => t.availableR != null).map((t) => t.availableR as number);
  return {
    capture: capt.length ? mean(capt) : null,
    avgAvail: avail.length ? mean(avail) : 0,
    n, net, wins: wins.length, losses: losses.length,
    winRate: n ? (wins.length / n) * 100 : 0,
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    avgWin: wins.length ? gw / wins.length : 0,
    avgLoss: losses.length ? gl / losses.length : 0,
    expR: rs.length ? mean(rs) : null,
    expD: n ? net / n : 0,
    maxDD: dd, worstStreak,
    best: n ? Math.max.apply(null, list.map((t) => t.net)) : 0,
    worst: n ? Math.min.apply(null, list.map((t) => t.net)) : 0,
    commissions: list.reduce((a, t) => a + (t.comm || 0), 0),
  };
}

export function oneThingToFix(list: Trade[], st: Stats, equity: number, locked: boolean, lockReason: string): { tag: string; body: string } {
  const caps = list.filter((t) => t.riskD && t.riskD / equity > 0.02);
  const revenge = list.filter((t) => /revenge|fomo/i.test(t.tag || '')).length;
  const capt = list.filter((t) => t.capture != null).map((t) => t.capture as number);
  const avgCapture = capt.length ? mean(capt) : null;
  const avail = list.filter((t) => t.availableR != null).map((t) => t.availableR as number);
  const avgAvail = avail.length ? mean(avail) : 0;
  const maeOnWins = list.filter((t) => t.net > 0 && t.riskD).map((t) => Math.abs(t.mae || 0) * SPEC.pointValue * t.qty / t.riskD);

  if (caps.length) return {
    tag: 'Sizing',
    body: caps.length + ' of your ' + list.length + ' trades risked more than 2% of the account on one idea. Nothing else on this list matters until that stops — position size is the only variable that can end you in a single afternoon. Set the contracts from the stop and the cap, never from how good the setup feels.',
  };
  if (locked && /loss cap/i.test(lockReason)) return {
    tag: 'The cap did its job',
    body: 'You hit the daily loss cap and the app stopped you. That is the system working. The thing to examine is not the cap but the three or four trades before it — losing days are usually one bad read followed by an attempt to win it back immediately.',
  };
  if (revenge >= 2) return {
    tag: 'Tilt',
    body: 'You tagged ' + revenge + ' trades revenge or FOMO. Those tags are the most honest data in the journal. The fix is mechanical, not emotional: after any loss, sit out a fixed number of bars before you are allowed to click again.',
  };
  if (list.length >= 6 && avgCapture != null && avgCapture < 0.35 && avgAvail > 1.2) return {
    tag: 'Exits',
    body: 'On average the market handed you ' + avgAvail.toFixed(2) + 'R and you took home ' + (avgCapture * 100).toFixed(0) + '% of it. Your reads are finding the moves; you are letting go of them early. Try scaling half off at 1R and trailing the rest behind structure instead of taking the whole thing at a fixed target.',
  };
  if (maeOnWins.length >= 4 && mean(maeOnWins) > 0.8) return {
    tag: 'Entries',
    body: 'Your winners went an average of ' + mean(maeOnWins).toFixed(2) + 'R against you before they worked. That is not a stop problem — it is an entry-timing problem. You are getting in before the trigger. Waiting for the reclaim or the close through would leave the same trades with far less heat.',
  };
  if (list.length >= 5 && st.winRate < 35 && st.expR != null && st.expR < 0) return {
    tag: 'Selection',
    body: 'A ' + st.winRate.toFixed(0) + '% win rate with a negative expectancy means you are taking trades the evidence does not support. Spend a session in the Pattern lab on hard mode before the next one — and remember that "no trade" is a scored answer there for a reason.',
  };
  if (st.expR != null && st.expR > 0.2 && list.length >= 5) return {
    tag: 'Keep going',
    body: 'Expectancy of ' + (st.expR >= 0 ? '+' : '') + st.expR.toFixed(2) + 'R across ' + list.length + ' trades is a real result. The work now is repetition, not adjustment — most traders destroy a working process by tuning it after a good day. Change nothing and log 30 more.',
  };
  return {
    tag: 'Too few trades to judge',
    body: 'A handful of trades tells you almost nothing — the noise is bigger than any edge at this sample size. Keep the process identical and let the number build; the journal only starts to mean something somewhere north of 30 trades.',
  };
}

export { fmt$ };
