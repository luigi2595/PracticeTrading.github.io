import { evalProp, drawdownThreshold, PROP_PRESETS } from './propfirm';
import type { PropRules } from './types';

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n    got:  ' + JSON.stringify(got) + '\n    want: ' + JSON.stringify(want)); }
}

const base: PropRules = {
  on: true, presetKey: 'test', accountSize: 50000, profitTarget: 3000, maxDrawdown: 2500,
  trailing: 'static', trailLocksAtStart: true, dailyLossLimit: 1100,
  consistencyPct: 30, minTradingDays: 5, maxContracts: 10,
};
const ctx = (o: Partial<Parameters<typeof evalProp>[1]> = {}) => ({
  sessionNets: [], realizedToday: 0, openPnl: 0, peakEquity: 50000, tradedToday: false, ...o,
});

console.log('\nstatic drawdown');
check('line is fixed at size - dd', drawdownThreshold(base, ctx()), 47500);
check('profit does not move it', drawdownThreshold(base, ctx({ sessionNets: [4000], peakEquity: 54000 })), 47500);

console.log('\nintraday trailing');
const intra: PropRules = { ...base, trailing: 'intraday', trailLocksAtStart: false };
check('starts at size - dd', drawdownThreshold(intra, ctx()), 47500);
check('follows peak equity', drawdownThreshold(intra, ctx({ peakEquity: 51000 })), 48500);
check('open profit alone moves it', drawdownThreshold(intra, ctx({ openPnl: 800, peakEquity: 50800 })), 48300);
check('never falls back down', drawdownThreshold(intra, ctx({ peakEquity: 51000, realizedToday: -500 })), 48500);

console.log('\ntrailing lock at starting balance');
const locked: PropRules = { ...base, trailing: 'intraday', trailLocksAtStart: true };
check('below start it still trails', drawdownThreshold(locked, ctx({ peakEquity: 51000 })), 48500);
check('freezes at the starting balance', drawdownThreshold(locked, ctx({ peakEquity: 60000 })), 50000);

console.log('\nend-of-day trailing');
const eod: PropRules = { ...base, trailing: 'eod', trailLocksAtStart: false };
check('todays open profit does NOT raise it', drawdownThreshold(eod, ctx({ openPnl: 2000, peakEquity: 52000 })), 47500);
check('todays realized profit does NOT raise it', drawdownThreshold(eod, ctx({ realizedToday: 2000 })), 47500);
check('a closed green day does raise it', drawdownThreshold(eod, ctx({ sessionNets: [2000] })), 49500);
check('uses the PEAK closing balance, not the latest', drawdownThreshold(eod, ctx({ sessionNets: [3000, -1000] })), 50500);

console.log('\nbreach detection');
const dd = evalProp(intra, ctx({ peakEquity: 51000, sessionNets: [1000], realizedToday: -3600 }));
check('drawdown breach fires at/below the line', dd.breach?.kind, 'drawdown');
const safe = evalProp(intra, ctx({ peakEquity: 51000, sessionNets: [1000], realizedToday: -100 }));
check('no breach with cushion left', safe.breach, null);
const daily = evalProp(base, ctx({ realizedToday: -700, openPnl: -450 }));
check('daily loss counts open P&L too', daily.breach?.kind, 'dailyLoss');
check('cushion is equity minus the line', evalProp(base, ctx({ realizedToday: -500 })).cushion, 2000);

console.log('\nconsistency rule');
const consistent = evalProp(base, ctx({ sessionNets: [1000, 900, 1100, 1000], realizedToday: 1000, tradedToday: true }));
check('even days pass 30%', consistent.consistencyOk, true);
const lumpy = evalProp(base, ctx({ sessionNets: [200, 100, 2800, 150], realizedToday: 100, tradedToday: true }));
check('one big day fails 30%', lumpy.consistencyOk, false);
check('share is best day over total', Math.round((lumpy.consistencyShare ?? 0) * 100), 84);
check('rule off when pct is 0', evalProp({ ...base, consistencyPct: 0 }, ctx({ sessionNets: [3000, 10], tradedToday: true })).consistencyOk, true);

console.log('\npass conditions');
const short = evalProp(base, ctx({ sessionNets: [1000, 1000, 1000], tradedToday: false }));
check('not passed on days alone', short.passReady, false);
check('blockers name what is missing', short.blockers.length, 2);
const won = evalProp({ ...base, consistencyPct: 0 }, ctx({ sessionNets: [700, 700, 700, 700, 700], tradedToday: false }));
check('passes when target and days are met', won.passReady, true);
check('no blockers when passed', won.blockers, []);

console.log('\npresets');
check('every preset has a unique key', new Set(PROP_PRESETS.map((p) => p.key)).size, PROP_PRESETS.length);
check('every preset drawdown is below its target-free size', PROP_PRESETS.every((p) => p.rules.maxDrawdown < p.rules.accountSize), true);
check('every preset has a daily limit under the drawdown', PROP_PRESETS.every((p) => p.rules.dailyLossLimit < p.rules.maxDrawdown), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
