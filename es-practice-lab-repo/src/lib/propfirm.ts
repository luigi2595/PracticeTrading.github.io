// Prop-firm evaluation rules.
//
// A funded-account evaluation is not really a trading test, it is a rule test:
// most people who fail one do it by tripping a trailing drawdown, a daily loss
// limit, or a consistency rule — not by being unable to read a chart. This
// module models those rules so they can be practised before any money is spent
// on an attempt.
//
// Everything here is pure. The reducer owns the running peak and the breach
// flag (they cannot be derived from the trade list alone); everything else is
// computed fresh from the session history on each render.
import { fmt$ } from './spec';
import type { PropRules, TrailingMode } from './types';

export type { PropRules, TrailingMode };

/* ---------------------------------------------------------------
   Presets
   ---------------------------------------------------------------
   These are deliberately GENERIC shapes, not any particular firm's
   published rules. Real programmes change their numbers regularly, and
   practising against a stale copy of someone else's rulebook is worse than
   useless — it teaches the wrong limits. Pick the shape that matches, then
   type in your own firm's actual numbers.                                */

export interface PropPreset {
  key: string;
  label: string;
  blurb: string;
  rules: Omit<PropRules, 'on' | 'presetKey'>;
}

export const PROP_PRESETS: PropPreset[] = [
  {
    key: '50k-eod',
    label: '50K · end-of-day trailing',
    blurb: 'The drawdown line moves up only when a day closes green. Forgiving intraday.',
    rules: {
      accountSize: 50000, profitTarget: 3000, maxDrawdown: 2500, trailing: 'eod',
      trailLocksAtStart: true, dailyLossLimit: 1100, consistencyPct: 30,
      minTradingDays: 5, maxContracts: 10,
    },
  },
  {
    key: '50k-intraday',
    label: '50K · intraday trailing',
    blurb: 'The line follows your highest equity tick by tick, open profit included. Unforgiving.',
    rules: {
      accountSize: 50000, profitTarget: 3000, maxDrawdown: 2500, trailing: 'intraday',
      trailLocksAtStart: true, dailyLossLimit: 1100, consistencyPct: 30,
      minTradingDays: 5, maxContracts: 10,
    },
  },
  {
    key: '100k-eod',
    label: '100K · end-of-day trailing',
    blurb: 'Bigger account, proportionally similar rules.',
    rules: {
      accountSize: 100000, profitTarget: 6000, maxDrawdown: 3000, trailing: 'eod',
      trailLocksAtStart: true, dailyLossLimit: 2200, consistencyPct: 30,
      minTradingDays: 5, maxContracts: 20,
    },
  },
  {
    key: '150k-static',
    label: '150K · static drawdown',
    blurb: 'The line never moves. Rarer, and much easier to survive.',
    rules: {
      accountSize: 150000, profitTarget: 9000, maxDrawdown: 4500, trailing: 'static',
      trailLocksAtStart: false, dailyLossLimit: 3300, consistencyPct: 0,
      minTradingDays: 5, maxContracts: 30,
    },
  },
  {
    key: 'strict',
    label: 'Strict · consistency enforced',
    blurb: 'Tight consistency rule, so one lucky day cannot carry the account.',
    rules: {
      accountSize: 50000, profitTarget: 3000, maxDrawdown: 2000, trailing: 'intraday',
      trailLocksAtStart: true, dailyLossLimit: 1000, consistencyPct: 20,
      minTradingDays: 10, maxContracts: 5,
    },
  },
];

export const TRAILING_LABEL: Record<TrailingMode, string> = {
  static: 'Static — never moves',
  intraday: 'Intraday — follows peak equity',
  eod: 'End of day — follows closing balance',
};

/* ---------------------------------------------------------------
   Status
   --------------------------------------------------------------- */

export interface PropContext {
  /** Net P&L of each completed session since the evaluation began, in order. */
  sessionNets: number[];
  /** Realized P&L in the session currently open. */
  realizedToday: number;
  /** Unrealized P&L of any open position. */
  openPnl: number;
  /** Highest equity ever touched this evaluation, open P&L included. */
  peakEquity: number;
  /** Whether the session currently open has produced at least one trade. */
  tradedToday: boolean;
}

export interface PropBreach {
  kind: 'drawdown' | 'dailyLoss';
  reason: string;
}

export interface PropStatus {
  /** Closed balance: account size plus every realized dollar. */
  balance: number;
  /** Balance plus open P&L — the number the drawdown rule actually watches. */
  equity: number;
  /** The drawdown line. Falling to or below it fails the evaluation. */
  threshold: number;
  /** Distance from equity down to the line. Negative means blown. */
  cushion: number;
  /** Profit against the starting balance. */
  profit: number;
  /** 0..1 progress toward the profit target (1 when there is no target). */
  targetProgress: number;
  daysTraded: number;
  bestDay: number;
  /** Best day as a share of total profit, or null when there is no profit. */
  consistencyShare: number | null;
  consistencyOk: boolean;
  /** Today's P&L including open positions. */
  dayPnl: number;
  /** Dollars of the daily loss limit still available; Infinity when unset. */
  dailyLossLeft: number;
  breach: PropBreach | null;
  /** True when every pass condition is met. */
  passReady: boolean;
  /** Human-readable reasons passReady is false. */
  blockers: string[];
}

/** The highest closing balance reached, used by end-of-day trailing. */
function peakClosingBalance(accountSize: number, sessionNets: number[]): number {
  let running = accountSize;
  let peak = accountSize;
  for (const net of sessionNets) {
    running += net;
    if (running > peak) peak = running;
  }
  return peak;
}

export function drawdownThreshold(rules: PropRules, ctx: PropContext): number {
  if (!rules.maxDrawdown) return -Infinity;
  let anchor: number;
  switch (rules.trailing) {
    case 'static':
      anchor = rules.accountSize;
      break;
    case 'intraday':
      anchor = Math.max(rules.accountSize, ctx.peakEquity);
      break;
    case 'eod':
      anchor = peakClosingBalance(rules.accountSize, ctx.sessionNets);
      break;
  }
  const line = anchor - rules.maxDrawdown;
  // Most programmes freeze a trailing line once it reaches the starting
  // balance: past that point you can no longer be blown, only give back gains.
  if (rules.trailLocksAtStart && rules.trailing !== 'static') {
    return Math.min(line, rules.accountSize);
  }
  return line;
}

export function evalProp(rules: PropRules, ctx: PropContext): PropStatus {
  const closed = ctx.sessionNets.reduce((a, n) => a + n, 0) + ctx.realizedToday;
  const balance = rules.accountSize + closed;
  const equity = balance + ctx.openPnl;
  const threshold = drawdownThreshold(rules, ctx);
  const cushion = threshold === -Infinity ? Infinity : equity - threshold;
  const profit = equity - rules.accountSize;

  const targetProgress = rules.profitTarget > 0
    ? Math.max(0, Math.min(1, profit / rules.profitTarget))
    : 1;

  const dayNets = ctx.sessionNets.slice();
  if (ctx.tradedToday) dayNets.push(ctx.realizedToday);
  const daysTraded = dayNets.length;
  const bestDay = dayNets.length ? Math.max.apply(null, dayNets) : 0;

  const totalClosedProfit = dayNets.reduce((a, n) => a + n, 0);
  const consistencyShare = rules.consistencyPct > 0 && totalClosedProfit > 0 && bestDay > 0
    ? bestDay / totalClosedProfit
    : null;
  const consistencyOk = consistencyShare == null || consistencyShare <= rules.consistencyPct / 100;

  const dayPnl = ctx.realizedToday + ctx.openPnl;
  const dailyLossLeft = rules.dailyLossLimit > 0
    ? rules.dailyLossLimit + dayPnl
    : Infinity;

  let breach: PropBreach | null = null;
  if (rules.maxDrawdown > 0 && equity <= threshold) {
    breach = {
      kind: 'drawdown',
      reason: 'Equity hit ' + fmt$(equity, 0) + ', at or below the ' + fmt$(threshold, 0) +
        ' drawdown line. On a real evaluation the account would be closed here — not paused, closed.',
    };
  } else if (rules.dailyLossLimit > 0 && dayPnl <= -rules.dailyLossLimit) {
    breach = {
      kind: 'dailyLoss',
      reason: 'Daily loss limit of ' + fmt$(rules.dailyLossLimit, 0) + ' hit. The day is over.',
    };
  }

  const blockers: string[] = [];
  if (rules.profitTarget > 0 && profit < rules.profitTarget) {
    blockers.push(fmt$(rules.profitTarget - profit, 0) + ' more profit needed');
  }
  if (rules.minTradingDays > 0 && daysTraded < rules.minTradingDays) {
    const left = rules.minTradingDays - daysTraded;
    blockers.push(left + ' more trading day' + (left === 1 ? '' : 's') + ' needed');
  }
  if (!consistencyOk && consistencyShare != null) {
    blockers.push('best day is ' + (consistencyShare * 100).toFixed(0) + '% of profit, over the ' +
      rules.consistencyPct + '% limit');
  }

  return {
    balance, equity, threshold, cushion, profit, targetProgress,
    daysTraded, bestDay, consistencyShare, consistencyOk,
    dayPnl, dailyLossLeft, breach,
    passReady: blockers.length === 0 && !breach,
    blockers,
  };
}

/** Profit still needed on other days for the best day to satisfy consistency. */
export function consistencyGap(rules: PropRules, bestDay: number, totalProfit: number): number {
  if (rules.consistencyPct <= 0 || bestDay <= 0 || totalProfit <= 0) return 0;
  const needed = bestDay / (rules.consistencyPct / 100);
  return Math.max(0, needed - totalProfit);
}
