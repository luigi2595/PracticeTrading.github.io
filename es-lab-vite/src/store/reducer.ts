// The store's reducer: a thin, mostly-pure orchestrator over the already
// verified lib/ functions. It is intentionally NOT a byte-for-byte
// transcription of part4a.js/part5.js's imperative style — those functions
// read and wrote a shared global `S` object and the DOM directly. Here every
// case takes the previous SimState and returns a new one.
//
// Purity note: the SIM engine (session generation, orders, fills, P&L) is
// kept pure — any randomness (a fresh session seed) or wall-clock timestamp
// (a session-summary's `when`) is resolved by the caller (StoreContext) and
// passed in on the action, never read inside the reducer. The Pattern Lab
// drills are a deliberate exception: the original app generated every drill
// scenario with unseeded `Math.random()` (see lib/patternLab.ts's header
// comment) — replaying a drill was never a feature — so NEW_SCENARIO calls
// those builders directly here rather than threading pre-rolled randomness
// through the action, matching the original's own architecture.
import { SPEC, SUBSTEPS, roundTick, px, fmt$, fmtSigned$, mean, trueRangeATR, hashSeed, clamp } from '../lib/spec';
import { generateSession } from '../lib/generator';
import { lastPrice } from '../lib/session';
import {
  remainingBudget, maxContracts, ticketPlan, validPlan, enterPosition, checkOrders,
  onPriceAgainstPosition, applyTrail, closePartial, finalizeTrade, computeStats, oneThingToFix, totalNet, openPnl,
} from '../lib/engine';
import { scanPatterns } from '../lib/patterns';
import { buildLevelScenario, buildTrendScenario, patternName, ri } from '../lib/patternLab';
import type {
  Bar, ContractSpec, ImportedSession, MAType, Position, RestingOrder, Session, SessionSummary, Settings, Side, Trade,
} from '../lib/types';
import type { PatternLabSaveShape, SavePayload } from '../lib/persistence';
import { initialPatternLab, initialTicket, DEFAULT_LEVELS } from './state';
import type { SimState } from './state';

/* ============================================================
   Small pure helpers
   ============================================================ */
export function specFromSettings(settings: Settings): ContractSpec {
  return { tick: SPEC.tick, pointValue: settings.pointValue, commission: settings.commission, slipTicks: settings.slipTicks };
}

function currentBar(session: Session, cursor: number): Bar {
  return session.bars[Math.min(cursor, session.bars.length - 1)];
}

function bumpToast(prev: SimState['toast'], text: string): SimState['toast'] {
  return { id: (prev?.id ?? 0) + 1, text };
}
function bumpAnnounce(prev: SimState['announcement'], text: string): SimState['announcement'] {
  return { id: (prev?.id ?? 0) + 1, text };
}
function withToast(state: SimState, text: string): SimState {
  return { ...state, toast: bumpToast(state.toast, text) };
}
function withAnnounce(state: SimState, text: string): SimState {
  return { ...state, announcement: bumpAnnounce(state.announcement, text) };
}

function evalRules(settings: Settings, realized: number, sessionTrades: number): { locked: boolean; lockReason: string } {
  if (!settings.enforceRules) return { locked: false, lockReason: '' };
  const cap = settings.lossLimit || 0;
  const maxT = settings.maxTrades || 0;
  if (cap > 0 && realized <= -cap) {
    return { locked: true, lockReason: 'Daily loss cap of ' + fmt$(cap, 0) + ' hit. Done for the day — that is the rule working, not the rule failing.' };
  }
  if (maxT > 0 && sessionTrades >= maxT) {
    return { locked: true, lockReason: 'Trade limit reached (' + maxT + '). Overtrading is the most common way a good morning becomes a bad day.' };
  }
  return { locked: false, lockReason: '' };
}

function finalizeFullClose(
  position: Position, exitPrice: number, reason: string, barTime: string, spec: ContractSpec, beOnScale: boolean,
  genParams: SimState['genParams'], importedDate: string | null, seedText: string, nextId: number, cursorBar: Bar,
): Trade {
  const result = closePartial(position, position.qty, exitPrice, reason, barTime, beOnScale, spec);
  const exits = [...position.exits, result.exit];
  const grossAcc = position.grossAcc + result.exit.pts * spec.pointValue * result.exit.qty;
  return finalizeTrade(position, exits, grossAcc, reason, cursorBar, spec, genParams, importedDate, seedText, nextId);
}

/** Mirrors finalizeTrade()'s side effects in the original: realize the P&L,
 *  bump the trade counters, re-evaluate the discipline rules (announcing if
 *  newly locked), auto-pause if that setting is on, and toast/announce the
 *  result. Does NOT push a session-summary row — that only happens via
 *  END_DAY or a natural session-complete, matching the original. */
function closePositionCase(state: SimState, exitPrice: number, reason: string, spec: ContractSpec): SimState {
  const position = state.position;
  if (!position || !state.session) return withToast(state, 'No position to close.');
  const bar = currentBar(state.session, state.cursor);
  const nextId = state.trades.length + 1;
  const trade = finalizeFullClose(
    position, exitPrice, reason, bar.t, spec, state.settings.beOnScale, state.genParams,
    state.session.imported ? (state.session.date ?? null) : null, state.seedText, nextId, bar,
  );
  const realized = state.realized + trade.net;
  const sessionTrades = state.sessionTrades + 1;
  const wasLocked = state.locked;
  const rules = evalRules(state.settings, realized, sessionTrades);
  let next: SimState = {
    ...state, position: null, realized, sessionTrades, trades: [...state.trades, trade],
    locked: rules.locked, lockReason: rules.lockReason,
    playing: state.settings.autoPause ? false : state.playing,
  };
  if (rules.locked && !wasLocked) next = withAnnounce(next, 'Trading locked. ' + rules.lockReason);
  const toastMsg = (trade.net >= 0 ? 'Closed +' : 'Closed −') + '$' + Math.abs(trade.net).toFixed(2) + ' · ' +
    (trade.scaled ? 'scaled out' : reason) + (trade.riskD ? ' · ' + (trade.net / trade.riskD).toFixed(2) + 'R' : '');
  next = withToast(next, toastMsg);
  next = withAnnounce(next, 'Trade closed ' + (trade.net >= 0 ? 'up ' : 'down ') + fmt$(Math.abs(trade.net), 2) +
    (trade.R != null ? ', ' + trade.R.toFixed(2) + ' R' : '') + ', ' + (trade.scaled ? 'scaled out' : reason) + '.');
  return next;
}

function doFlatten(state: SimState, spec: ContractSpec): SimState {
  if (!state.position || !state.session) return withToast(state, 'No position to close.');
  const dir = state.position.side === 'Long' ? 1 : -1;
  const exitPrice = roundTick(lastPrice(state.session, state.cursor, state.sub) - dir * spec.slipTicks * spec.tick, spec);
  return closePositionCase(state, exitPrice, 'Manual', spec);
}

function applyPatternScan(state: SimState, printed: Bar[], cursor: number): SimState {
  const scan = scanPatterns(printed, state.patEvents);
  let next: SimState = { ...state, patEvents: scan.events, patLastScan: cursor };
  for (const ev of scan.fresh) {
    next = withAnnounce(next, ev.text + ' at ' + px(ev.price));
    if (ev.kind === 'failed' || ev.kind === 'retest') next = withToast(next, ev.text + ' at ' + px(ev.price) + ' — see Live read.');
  }
  return next;
}

export function sessionTradesOf(state: SimState): Trade[] {
  return state.trades.slice(state.sessionStartIdx || 0).filter((t) => t.source === 'sim');
}

function pushSessionSummaryIfAny(state: SimState, now: string): SimState {
  const list = sessionTradesOf(state);
  if (!list.length) return state;
  const st = computeStats(list);
  const capt = list.filter((t) => t.capture != null).map((t) => t.capture as number);
  const avgCapture = capt.length ? mean(capt) : null;
  const eq = state.startEquity + totalNet(state.trades);
  const fix = oneThingToFix(list, st, eq, state.locked, state.lockReason);
  const summary: SessionSummary = {
    seed: state.seedText, when: now, n: st.n, net: st.net, winRate: st.winRate,
    expR: st.expR, capture: avgCapture, fix: fix.tag,
  };
  return { ...state, sessions: [...state.sessions, summary] };
}

function openPositionCase(state: SimState, side: Side, spec: ContractSpec): SimState {
  if (!state.session) return state;
  if (state.locked) return withToast(state, 'Locked out: ' + state.lockReason.split('.')[0]);
  if (state.cursor >= state.session.bars.length) return withToast(state, 'Session is over — start a new one.');
  if (state.position) return withToast(state, 'Already ' + state.position.side.toLowerCase() + '. Use Flatten or Reverse.');
  const qty = clamp(Math.round(state.ticket.qty || 1), 1, 20);
  const dir = side === 'Long' ? 1 : -1;
  const last = lastPrice(state.session, state.cursor, state.sub);
  const entry = roundTick(last + dir * spec.slipTicks * spec.tick, spec);
  const plan = ticketPlan(side, entry, state.settings, spec);
  const planErr = validPlan(side, entry, plan);
  if (planErr) return withToast(state, planErr);
  const stopPts = plan.stop != null ? Math.abs(entry - plan.stop) : 0;
  const allowed = plan.stop != null ? maxContracts(stopPts, state.realized, state.settings, spec) : 20;
  if (qty > allowed) {
    const rem = remainingBudget(state.realized, state.settings);
    let msg: string;
    if (allowed === 0) {
      const fits = Math.floor(rem / spec.pointValue / spec.tick) * spec.tick;
      msg = fits >= spec.tick
        ? 'Your cap leaves ' + fmt$(rem, 0) + '. One contract on a ' + stopPts.toFixed(2) + '-point stop risks ' + fmt$(stopPts * spec.pointValue, 0) + '. Tighten the stop to ' + fits.toFixed(2) + ' points or fewer — or call it a day.'
        : 'Your cap leaves ' + fmt$(rem, 0) + ' — not enough for a single contract. The day is done.';
    } else {
      msg = 'Your cap allows ' + allowed + ' contract' + (allowed > 1 ? 's' : '') + ' at a ' + stopPts.toFixed(2) + '-point stop, not ' + qty + '. Size is set by the cap, not by how you feel about the setup.';
    }
    return withToast(state, msg);
  }
  const position = enterPosition(side, qty, entry, plan.stop, plan.target, state.ticket.setupTag, state.cursor, state.session, spec);
  const msg2 = side + ' ' + qty + ' at ' + px(entry) +
    (plan.stop != null ? ', stop ' + px(plan.stop) : ', no stop set') + (plan.target != null ? ', target ' + px(plan.target) : '');
  return withAnnounce({ ...state, position }, msg2);
}

/* one substep of price movement — the heart of the replay loop */
function advanceSubstep(state0: SimState, now: string): SimState {
  if (!state0.session) return state0;
  const bars = state0.session.bars;
  if (state0.cursor >= bars.length) return { ...state0, playing: false };
  const spec = specFromSettings(state0.settings);
  let work: SimState = { ...state0, sub: state0.sub + 1 };
  const bar = bars[work.cursor];
  const p = bar.path ? bar.path[work.sub - 1] : bar.c;

  // 1. a resting order may fill at this price
  if (!work.position) {
    const fill = checkOrders(work.orders, p, false, spec);
    if (fill) {
      const orders = work.orders.filter((o) => o.id !== fill.order.id);
      const position = enterPosition(
        fill.order.side, fill.order.qty, fill.fillPrice, fill.stop, fill.order.target, fill.order.tag,
        work.cursor, work.session!, spec,
      );
      work = withToast({ ...work, orders, position },
        fill.order.side + ' ' + fill.order.qty + ' filled at ' + px(fill.fillPrice) + ' · ' + fill.order.type + ' order');
    }
  }

  // 2. price moves against (or in favour of) any open position
  if (work.position) {
    const tick = onPriceAgainstPosition(work.position, p, spec);
    work = { ...work, position: { ...work.position, mae: tick.mae, mfe: tick.mfe, hi: tick.hi, lo: tick.lo } };
    if (tick.closeAt != null) {
      work = closePositionCase(work, tick.closeAt, tick.closeReason as string, spec);
    }
  }

  // 3. a full bar has now printed
  if (work.sub >= SUBSTEPS) {
    const cursor = work.cursor + 1;
    work = { ...work, cursor, sub: 0 };
    if (work.position) {
      const recentBars = work.session!.bars.slice(Math.max(0, cursor - 20), cursor);
      const newStop = applyTrail(work.position, recentBars, work.settings.trailMode, work.settings.trailAtrMult, work.settings.trailBars, p, trueRangeATR, spec);
      if (newStop != null) work = { ...work, position: { ...work.position, stop: newStop, trailed: true } };
    }
    if (work.settings.patOn) {
      const printed = work.session!.bars.slice(0, cursor);
      work = applyPatternScan(work, printed, cursor);
    }
  }

  // 4. the session itself may be over
  if (work.cursor >= bars.length) {
    work = { ...work, playing: false };
    if (work.position) {
      work = closePositionCase(work, p, 'Session end', spec);
      work = withToast(work, 'Session over — position closed at the bell.');
    } else {
      work = withToast(work, 'Session complete.');
    }
    if (work.settings.debriefOnEnd) {
      work = pushSessionSummaryIfAny(work, now);
      work = { ...work, debriefRequestId: work.debriefRequestId + 1 };
    }
  }

  return work;
}

/* ============================================================
   Actions
   ============================================================ */
export type Action =
  | { type: 'NEW_SESSION'; keepSeed: boolean; quiet?: boolean; randomSeed: number }
  | { type: 'PLAY' } | { type: 'PAUSE' } | { type: 'TOGGLE_PLAY' }
  | { type: 'ADVANCE'; now: string }
  | { type: 'STEP_BAR'; now: string }
  | { type: 'SET_SPEED'; speed: number }
  | { type: 'SET_TF'; tf: number }
  | { type: 'TOGGLE_MA'; index: number }
  | { type: 'CONFIGURE_MA'; index: number; patch: { on?: boolean; type?: MAType; period?: number } }
  | { type: 'TOGGLE_LEVEL'; key: keyof SimState['levels'] }
  | { type: 'TOGGLE_DRAWING' }
  | { type: 'ADD_USER_LEVEL'; price: number }
  | { type: 'REMOVE_USER_LEVEL'; price: number }
  | { type: 'CLEAR_LEVELS' }
  | { type: 'SET_HOVER'; x: number; y: number } | { type: 'CLEAR_HOVER' }
  | { type: 'SET_TICKET_ORDER_TYPE'; orderType: SimState['ticket']['orderType'] }
  | { type: 'SET_TICKET_QTY'; qty: number }
  | { type: 'STEP_TICKET_QTY'; delta: number }
  | { type: 'SET_TICKET_PRICE'; price: string }
  | { type: 'STEP_TICKET_PRICE'; delta: number }
  | { type: 'SET_SETUP_TAG'; tag: string }
  | { type: 'PLACE_ORDER'; side: Side }
  | { type: 'CANCEL_ORDER'; id: number }
  | { type: 'ADJUST_STOP_TARGET'; field: 'stop' | 'target'; delta: number }
  | { type: 'FLATTEN' } | { type: 'REVERSE' } | { type: 'STOP_TO_BE' } | { type: 'TAKE_HALF' } | { type: 'TAKE_PROFIT' }
  | { type: 'END_DAY'; now: string }
  | { type: 'TOGGLE_PAT' }
  | { type: 'SET_IMPORTED'; sessions: ImportedSession[] }
  | { type: 'SET_IMPORT_IDX'; idx: number }
  | { type: 'CLEAR_IMPORTED' }
  | { type: 'DELETE_TRADE'; id: number }
  | { type: 'SET_TRADE_NOTE'; id: number; note: string }
  | { type: 'ADD_MANUAL_TRADE'; side: Side; qty: number; entry: number; exitP: number; stop: number | null; timeIn: string; timeOut: string; tag: string; note: string }
  | { type: 'IMPORT_TRADES_JSON'; trades: Trade[]; patternLab?: PatternLabSaveShape }
  | { type: 'NEW_SCENARIO' }
  | { type: 'ANSWER_CALL'; key: string }
  | { type: 'ANSWER_STOP'; key: string }
  | { type: 'SET_DRILL_STEP'; step: 'call' | 'stop' | 'reveal' }
  | { type: 'REVEAL_TICK'; amount?: number }
  | { type: 'SET_HARD'; hard: boolean }
  | { type: 'SET_DRILL_MODE'; mode: SimState['patternLab']['mode'] }
  | { type: 'SET_SETTINGS'; patch: Partial<Settings> }
  | { type: 'LOAD_PERSISTED'; payload: SavePayload }
  | { type: 'RESET_ALL' }
  | { type: 'TOAST'; text: string }
  | { type: 'ANNOUNCE'; text: string }
  | { type: 'MARK_SAVE_STATUS'; available: boolean; savedAt: string | null; size: number; trimmed: number };

/* ============================================================
   Reducer
   ============================================================ */
export function reducer(state: SimState, action: Action): SimState {
  switch (action.type) {
    case 'NEW_SESSION': {
      const spec = specFromSettings(state.settings);
      let next = state;
      next = { ...next, playing: false };
      if (next.position && next.session) {
        const exitPrice = lastPrice(next.session, next.cursor, next.sub);
        next = closePositionCase(next, exitPrice, 'Session end', spec);
      }

      const seedField = next.settings.seedText.trim();
      let seed: number | string;
      if (action.keepSeed && next.session) seed = next.session.seed;
      else if (seedField) seed = hashSeed(seedField);
      else seed = action.randomSeed;

      const useReal = !!(next.settings.useReal && next.imported && next.imported.length);
      const combine = useReal && next.settings.combineDays && next.imported!.length > 1;
      let session: Session;
      let genParams: SimState['genParams'] = null;
      let importIdx = next.importIdx;

      if (combine) {
        const bars: Bar[] = [];
        const dayStarts: number[] = [];
        const dayHiLo: { hi: number; lo: number }[] = [];
        next.imported!.forEach((d) => {
          dayStarts.push(bars.length);
          const hi = Math.max.apply(null, d.bars.map((b) => b.h));
          const lo = Math.min.apply(null, d.bars.map((b) => b.l));
          dayHiLo.push({ hi, lo });
          d.bars.forEach((b) => bars.push({ ...b, i: bars.length }));
        });
        session = {
          bars, dayStarts, dayHiLo,
          priorClose: next.imported![0].priorClose, openPrice: next.imported![0].openPrice,
          pdHigh: next.imported![0].pdHigh, pdLow: next.imported![0].pdLow,
          seed: 'imported:combined', rthStart: 0, rthMinutes: bars.length,
          imported: true, date: next.imported!.length + ' days combined',
        };
      } else if (useReal) {
        importIdx = action.keepSeed ? next.importIdx : (next.importIdx + 1) % next.imported!.length;
        const src = next.imported![importIdx];
        session = {
          bars: src.bars, priorClose: src.priorClose, openPrice: src.openPrice,
          pdHigh: src.pdHigh, pdLow: src.pdLow, seed: src.seed,
          rthStart: src.rthStart, rthMinutes: src.rthMinutes, imported: true, date: src.date,
        };
      } else {
        genParams = { seed: seed as number, base: next.settings.base, volMult: next.settings.volMult, minutes: next.settings.sessionMinutes };
        session = generateSession(genParams);
      }

      const cursor = session.rthStart > 0 ? session.rthStart : Math.min(30, Math.max(1, session.bars.length - 1));
      next = {
        ...next, session, genParams, importIdx,
        cursor, sub: 0, realized: 0, sessionTrades: 0, orders: [],
        patEvents: [], patLastScan: -1,
        sessionStartIdx: next.trades.length,
        locked: false, lockReason: '',
        seedText: String(session.seed),
        position: null,
      };
      if (!action.quiet) {
        next = withToast(next, session.imported ? 'Replaying real bars · ' + session.date : 'New session · seed ' + seed);
      }
      return next;
    }

    case 'PLAY': return state.session && state.cursor < state.session.bars.length ? { ...state, playing: true } : state;
    case 'PAUSE': return { ...state, playing: false };
    case 'TOGGLE_PLAY': return state.playing ? { ...state, playing: false } : reducer(state, { type: 'PLAY' });

    case 'ADVANCE': return advanceSubstep(state, action.now);

    case 'STEP_BAR': {
      if (!state.session) return state;
      let next: SimState = { ...state, playing: false };
      const target = state.sub === 0 ? SUBSTEPS : SUBSTEPS - state.sub;
      for (let k = 0; k < target; k++) {
        if (next.cursor >= next.session!.bars.length) break;
        next = advanceSubstep(next, action.now);
      }
      return next;
    }

    case 'SET_SPEED': return { ...state, speed: action.speed };
    case 'SET_TF': return { ...state, tf: action.tf };

    case 'TOGGLE_MA': {
      const mas = state.mas.map((m, i) => (i === action.index ? { ...m, on: !m.on } : m));
      return { ...state, mas };
    }
    case 'CONFIGURE_MA': {
      const mas = state.mas.map((m, i) => {
        if (i !== action.index) return m;
        const patch = { ...action.patch };
        if (patch.period != null) patch.period = clamp(Math.round(patch.period), 2, 400);
        return { ...m, ...patch };
      });
      return { ...state, mas };
    }

    case 'TOGGLE_LEVEL': return { ...state, levels: { ...state.levels, [action.key]: !state.levels[action.key] } };
    case 'TOGGLE_DRAWING': return { ...state, drawing: !state.drawing };
    case 'ADD_USER_LEVEL': return withAnnounce(withToast(
      { ...state, userLevels: [...state.userLevels, action.price] },
      'Level at ' + px(action.price) + '. Tap it again to remove it.'), 'Level added at ' + px(action.price));
    case 'REMOVE_USER_LEVEL': return withToast(
      { ...state, userLevels: state.userLevels.filter((v) => v !== action.price) },
      'Level at ' + px(action.price) + ' removed.');
    case 'CLEAR_LEVELS': return withToast({ ...state, userLevels: [] }, 'Levels cleared.');

    case 'SET_HOVER': return { ...state, hover: { x: action.x, y: action.y } };
    case 'CLEAR_HOVER': return { ...state, hover: null };

    case 'SET_TICKET_ORDER_TYPE': return { ...state, ticket: { ...state.ticket, orderType: action.orderType } };
    case 'SET_TICKET_QTY': return { ...state, ticket: { ...state.ticket, qty: clamp(Math.round(action.qty || 1), 1, 20) } };
    case 'STEP_TICKET_QTY': return { ...state, ticket: { ...state.ticket, qty: clamp(state.ticket.qty + action.delta, 1, 20) } };
    case 'SET_TICKET_PRICE': return { ...state, ticket: { ...state.ticket, price: action.price } };
    case 'STEP_TICKET_PRICE': {
      const spec = specFromSettings(state.settings);
      const base = parseFloat(state.ticket.price) || (state.session ? lastPrice(state.session, state.cursor, state.sub) : 0);
      const price = roundTick(base + action.delta * spec.tick, spec).toFixed(2);
      return { ...state, ticket: { ...state.ticket, price } };
    }
    case 'SET_SETUP_TAG': return { ...state, ticket: { ...state.ticket, setupTag: action.tag } };

    case 'PLACE_ORDER': {
      const { side } = action;
      if (!state.session) return state;
      if (state.locked) return withToast(state, 'Locked out: ' + state.lockReason.split('.')[0]);
      const spec = specFromSettings(state.settings);
      const type = state.ticket.orderType;
      if (type === 'market') return openPositionCase(state, side, spec);
      if (state.position) return withToast(state, 'Already in a trade — flatten before resting another order.');
      const qty = clamp(Math.round(state.ticket.qty || 1), 1, 20);
      const last = lastPrice(state.session, state.cursor, state.sub);
      const priceRaw = parseFloat(state.ticket.price);
      const price = roundTick(isFinite(priceRaw) ? priceRaw : last, spec);
      if (type === 'limit' && (side === 'Long' ? price > last : price < last)) {
        return withToast(state, 'A ' + side.toLowerCase() + ' limit at ' + px(price) + ' would fill instantly — that is just a market order. Put it ' +
          (side === 'Long' ? 'below ' : 'above ') + px(last) + '.');
      }
      if (type === 'stop' && (side === 'Long' ? price < last : price > last)) {
        return withToast(state, 'A ' + side.toLowerCase() + ' stop at ' + px(price) + ' is already triggered. Put it ' +
          (side === 'Long' ? 'above ' : 'below ') + px(last) + '.');
      }
      const plan = ticketPlan(side, price, state.settings, spec);
      const bad = validPlan(side, price, plan);
      if (bad) return withToast(state, bad);
      if (plan.stop != null) {
        const allowed = maxContracts(Math.abs(price - plan.stop), state.realized, state.settings, spec);
        if (qty > allowed) return withToast(state, 'Your cap allows ' + allowed + ' contract' + (allowed === 1 ? '' : 's') + ' with that stop.');
      }
      const orderSeq = state.orderSeq + 1;
      const bar = currentBar(state.session, state.cursor);
      const order: RestingOrder = { id: orderSeq, side, type, qty, price, stop: plan.stop, target: plan.target, tag: state.ticket.setupTag, placedAt: bar.t };
      let next = { ...state, orders: [...state.orders, order], orderSeq };
      next = withToast(next, side + ' ' + qty + ' ' + type + ' resting at ' + px(price) + '.');
      next = withAnnounce(next, 'Order placed: ' + side + ' ' + qty + ' ' + type + ' at ' + px(price));
      return next;
    }
    case 'CANCEL_ORDER': return withToast({ ...state, orders: state.orders.filter((o) => o.id !== action.id) }, 'Order cancelled.');

    case 'ADJUST_STOP_TARGET': {
      if (!state.position) return state;
      const spec = specFromSettings(state.settings);
      const key = action.field;
      const value = roundTick(state.position[key] + action.delta * spec.tick, spec);
      return { ...state, position: { ...state.position, [key]: value } };
    }

    case 'FLATTEN': return doFlatten(state, specFromSettings(state.settings));
    case 'REVERSE': {
      if (!state.position) return state;
      const spec = specFromSettings(state.settings);
      const nextSide: Side = state.position.side === 'Long' ? 'Short' : 'Long';
      let next = doFlatten(state, spec);
      next = openPositionCase(next, nextSide, spec);
      return next;
    }
    case 'STOP_TO_BE': {
      if (!state.position || !state.session) return withToast(state, 'No position.');
      const dir = state.position.side === 'Long' ? 1 : -1;
      const last = lastPrice(state.session, state.cursor, state.sub);
      if ((last - state.position.entry) * dir <= 0) {
        return withToast(state, 'Not in profit yet — moving the stop now just tightens your risk for nothing.');
      }
      return withToast({ ...state, position: { ...state.position, stop: state.position.entry } },
        'Stop moved to break-even. R is still measured against your original risk.');
    }
    case 'TAKE_HALF': {
      if (!state.position || !state.session) return withToast(state, 'No position to scale out of.');
      if (state.position.qty < 2) return withToast(state, 'One contract left — scaling out needs at least two. Size up, or practise this on micros.');
      const spec = specFromSettings(state.settings);
      const dir = state.position.side === 'Long' ? 1 : -1;
      const price = roundTick(lastPrice(state.session, state.cursor, state.sub) - dir * spec.slipTicks * spec.tick, spec);
      const qty = Math.floor(state.position.qty / 2);
      const bar = currentBar(state.session, state.cursor);
      const result = closePartial(state.position, qty, price, 'Scale', bar.t, state.settings.beOnScale, spec);
      if (!result.position) return closePositionCase(state, price, 'Scale', spec);
      const msg = result.beMoved
        ? 'Took ' + qty + ' off at ' + px(price) + ' · stop moved to break-even on the rest.'
        : 'Took ' + qty + ' off at ' + px(price) + ' · ' + result.position.qty + ' left on.';
      const ann = result.beMoved
        ? 'Scaled out ' + qty + ' at ' + px(price) + '. ' + result.position.qty + ' left, stop now at break-even.'
        : 'Scaled out ' + qty + ' at ' + px(price) + '. ' + result.position.qty + ' still open.';
      return withAnnounce(withToast({ ...state, position: result.position }, msg), ann);
    }
    case 'TAKE_PROFIT': {
      if (!state.position || !state.session) return withToast(state, 'No position to close.');
      const spec = specFromSettings(state.settings);
      const dir = state.position.side === 'Long' ? 1 : -1;
      const last = lastPrice(state.session, state.cursor, state.sub);
      if ((last - state.position.entry) * dir <= 0) {
        const pnl = openPnl(state.position, last, spec);
        return withToast(state, 'Not a profit yet — ' + fmtSigned$(pnl) + ' open. Flatten if you want out anyway.');
      }
      return doFlatten(state, spec);
    }
    case 'END_DAY': {
      let next = state;
      if (next.position) next = doFlatten(next, specFromSettings(next.settings));
      next = { ...next, playing: false };
      next = pushSessionSummaryIfAny(next, action.now);
      next = { ...next, debriefRequestId: next.debriefRequestId + 1 };
      return next;
    }

    case 'TOGGLE_PAT': {
      const patOn = !state.settings.patOn;
      let next: SimState = { ...state, settings: { ...state.settings, patOn } };
      if (patOn && state.session) {
        const printed = state.session.bars.slice(0, state.cursor);
        next = applyPatternScan(next, printed, state.cursor);
      }
      return withToast(next, patOn
        ? 'Live read on — it will name what it sees as it happens.'
        : 'Live read off. Call the patterns yourself; check the debrief after.');
    }

    case 'SET_IMPORTED': return { ...state, imported: action.sessions, importIdx: 0 };
    case 'SET_IMPORT_IDX': return { ...state, importIdx: action.idx };
    case 'CLEAR_IMPORTED': return { ...state, imported: null, importIdx: 0 };

    case 'DELETE_TRADE': return { ...state, trades: state.trades.filter((t) => t.id !== action.id) };
    case 'SET_TRADE_NOTE': return { ...state, trades: state.trades.map((t) => (t.id === action.id ? { ...t, note: action.note } : t)) };
    case 'ADD_MANUAL_TRADE': {
      const { side, qty, entry, exitP, stop, timeIn, timeOut, tag, note } = action;
      if (!entry || !exitP) return withToast(state, 'Entry and exit are required.');
      const spec = specFromSettings(state.settings);
      const dir = side === 'Long' ? 1 : -1;
      const pts = (exitP - entry) * dir;
      const gross = pts * spec.pointValue * qty;
      const comm = spec.commission * 2 * qty;
      const riskD = stop ? Math.abs(entry - stop) * spec.pointValue * qty : 0;
      const trade: Trade = {
        id: state.trades.length + 1, t: timeOut || '—', openedAt: timeIn || '—',
        side, qty, entry, exit: exitP, pts, gross, comm, net: gross - comm,
        riskD, R: riskD ? (gross - comm) / riskD : null, mae: null, mfe: null,
        availableR: null, capture: null, exits: [], scaled: false, barsHeld: 0,
        entryBar: 0, exitBar: 0, initialStop: stop, gen: null, importedDate: null,
        reason: 'Manual', tag: tag || 'Untagged', note: note || '', source: 'manual', seed: '',
      };
      return withToast({ ...state, trades: [...state.trades, trade] }, 'Trade logged.');
    }
    case 'IMPORT_TRADES_JSON': {
      const trades = action.trades.map((t, i) => ({ ...t, id: i + 1 }));
      const pl = action.patternLab;
      const patternLab = pl
        ? { ...state.patternLab, stats: pl.stats || {}, asked: pl.asked || 0, correct: pl.correct || 0, stopN: pl.stopN || 0, stopOk: pl.stopOk || 0 }
        : state.patternLab;
      return withToast({ ...state, trades, patternLab }, 'Restored ' + trades.length + ' trades.');
    }

    case 'NEW_SCENARIO': {
      const pl = state.patternLab;
      const due = pl.misses.filter((m) => pl.mode === 'mixed' || m.family === pl.mode);
      if (due.length && pl.sinceReview >= 3) {
        return { ...state, patternLab: { ...pl, sinceReview: 0, isReview: true, scenario: due[0], step: 'call', call: null, stopPick: null, reveal: 0 } };
      }
      const fam = pl.mode === 'mixed' ? (['support', 'resistance', 'trend'] as const)[ri(0, 2)] : pl.mode;
      const intents = fam === 'trend' ? (['fade', 'follow', 'none'] as const) : (['trap', 'real', 'none'] as const);
      const r = Math.random();
      const want = intents[r < 0.42 ? 0 : r < 0.66 ? 1 : 2];
      let sc = null as ReturnType<typeof buildLevelScenario> | null;
      for (let attempt = 0; attempt < 25; attempt++) {
        sc = fam === 'trend'
          ? buildTrendScenario(want as 'fade' | 'follow' | 'none', state.settings.base, state.settings.volMult)
          : buildLevelScenario(fam as 'support' | 'resistance', want as 'trap' | 'real' | 'none', state.settings.base, state.settings.volMult);
        if (sc.truth === want || (want === 'none' && sc.truth === 'none')) break;
      }
      return { ...state, patternLab: { ...pl, isReview: false, sinceReview: pl.sinceReview + 1, scenario: sc, step: 'call', call: null, stopPick: null, reveal: 0 } };
    }
    case 'ANSWER_CALL': {
      const pl = state.patternLab;
      const sc = pl.scenario;
      if (!sc || pl.step !== 'call') return state;
      const key = action.key;
      const ok = key === sc.truth;
      const asked = pl.asked + 1;
      const correct = pl.correct + (ok ? 1 : 0);
      const streak = ok ? pl.streak + 1 : 0;
      const best = Math.max(pl.best, streak);
      const kind = patternName(sc);
      const prevStat = pl.stats[kind] || { n: 0, ok: 0 };
      const stats = { ...pl.stats, [kind]: { n: prevStat.n + 1, ok: prevStat.ok + (ok ? 1 : 0) } };
      const hardAsked = pl.hard ? pl.hardAsked + 1 : pl.hardAsked;
      const hardCorrect = pl.hard && ok ? pl.hardCorrect + 1 : pl.hardCorrect;
      let misses = pl.misses.slice();
      const idx = misses.indexOf(sc);
      if (ok) { if (idx >= 0) misses.splice(idx, 1); }
      else if (idx < 0) { misses.push(sc); if (misses.length > 12) misses.shift(); }
      else { const [m] = misses.splice(idx, 1); misses.push(m); }
      const goesToReveal = sc.truth === 'none';
      return {
        ...state,
        patternLab: {
          ...pl, call: key, asked, correct, streak, best, stats, hardAsked, hardCorrect, misses,
          step: goesToReveal ? 'reveal' : 'call', reveal: 0,
        },
      };
    }
    case 'SET_DRILL_STEP': {
      const pl = state.patternLab;
      if (!pl.scenario) return state;
      return { ...state, patternLab: { ...pl, step: action.step, reveal: action.step === 'reveal' ? 0 : pl.reveal } };
    }
    case 'ANSWER_STOP': {
      const pl = state.patternLab;
      if (!pl.scenario || pl.step !== 'stop') return state;
      const key = action.key;
      const stopN = pl.stopN + 1;
      const stopOk = pl.stopOk + (key === 'struct' ? 1 : 0);
      return { ...state, patternLab: { ...pl, stopPick: key, stopN, stopOk, step: 'reveal', reveal: 0 } };
    }
    case 'REVEAL_TICK': {
      const pl = state.patternLab;
      if (!pl.scenario || pl.step !== 'reveal') return state;
      const max = pl.scenario.bars.length - pl.scenario.decision;
      return { ...state, patternLab: { ...pl, reveal: Math.min(pl.reveal + (action.amount ?? 1), max) } };
    }
    case 'SET_HARD': return { ...state, patternLab: { ...state.patternLab, hard: action.hard } };
    case 'SET_DRILL_MODE': return { ...state, patternLab: { ...state.patternLab, mode: action.mode } };

    case 'SET_SETTINGS': {
      const settings = { ...state.settings, ...action.patch };
      let locked = state.locked, lockReason = state.lockReason;
      if ('lossLimit' in action.patch || 'maxTrades' in action.patch || 'enforceRules' in action.patch) {
        const rc = evalRules(settings, state.realized, state.sessionTrades);
        locked = rc.locked; lockReason = rc.lockReason;
      }
      return { ...state, settings, locked, lockReason };
    }

    case 'LOAD_PERSISTED': {
      const d = action.payload;
      const trades = Array.isArray(d.trades) ? d.trades.map((t, i) => ({ ...t, id: i + 1 })) : state.trades;
      const sessions = Array.isArray(d.sessions) ? d.sessions : state.sessions;
      const settings = d.settings ? { ...state.settings, ...(d.settings as unknown as Partial<Settings>) } : state.settings;
      const levels = d.levels ? { ...state.levels, ...d.levels } : state.levels;
      const mas = Array.isArray(d.mas)
        ? state.mas.map((m, i) => (d.mas[i] ? { ...m, on: !!d.mas[i].on, type: d.mas[i].type || m.type, period: d.mas[i].period || m.period } : m))
        : state.mas;
      const userLevels = Array.isArray(d.userLevels) ? d.userLevels.map(Number) : state.userLevels;
      const tf = d.tf ? Number(d.tf) : state.tf;
      const pl = d.pl;
      const patternLab = pl
        ? { ...state.patternLab, stats: pl.stats || {}, asked: pl.asked || 0, correct: pl.correct || 0, best: pl.best || 0, stopN: pl.stopN || 0, stopOk: pl.stopOk || 0, hardAsked: pl.hardAsked || 0, hardCorrect: pl.hardCorrect || 0, hard: !!pl.hard }
        : state.patternLab;
      return { ...state, trades, sessions, settings, levels, mas, userLevels, tf, patternLab };
    }
    case 'RESET_ALL': {
      return { ...state, trades: [], sessions: [], userLevels: [], patternLab: { ...initialPatternLab } };
    }

    case 'TOAST': return withToast(state, action.text);
    case 'ANNOUNCE': return withAnnounce(state, action.text);
    case 'MARK_SAVE_STATUS': return { ...state, saveStatus: { available: action.available, savedAt: action.savedAt, size: action.size, trimmed: action.trimmed } };

    default: return state;
  }
}

// re-exported for components that need a fresh ticket without importing store/state directly
export { initialTicket, DEFAULT_LEVELS };
