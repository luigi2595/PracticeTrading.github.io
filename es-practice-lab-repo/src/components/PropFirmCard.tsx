// Live evaluation status: where the drawdown line currently sits, how much
// cushion is left, and what still stands between you and a pass. This is the
// card that makes a trailing drawdown legible — most people only discover how
// an intraday trail behaves by being blown out by one.
import React from 'react';
import { useStore } from '../store/StoreContext';
import { specFromSettings, propStatusOf } from '../store/reducer';
import { fmt$, fmtSigned$, sgnClass } from '../lib/spec';
import { can } from '../lib/entitlements';

export default function PropFirmCard() {
  const { state, dispatch } = useStore();
  const rules = state.settings.prop;
  if (!can('propFirmRules') || !rules.on) return null;

  const spec = specFromSettings(state.settings);
  const st = propStatusOf(state, spec);
  const ev = state.propEval;

  // How close the account is to the line, as a share of the full allowance.
  const cushionPct = rules.maxDrawdown > 0 && isFinite(st.cushion)
    ? Math.max(0, Math.min(1, st.cushion / rules.maxDrawdown))
    : 1;
  const cushionColor = cushionPct > 0.5 ? 'var(--up)' : cushionPct > 0.25 ? 'var(--warn)' : 'var(--down)';

  const dayLeft = st.dailyLossLeft;
  const dayPct = rules.dailyLossLimit > 0 && isFinite(dayLeft)
    ? Math.max(0, Math.min(1, dayLeft / rules.dailyLossLimit))
    : 1;

  return (
    <div className="card" id="propCard">
      <h3 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>Evaluation</span>
        <span className="hint" style={{ fontWeight: 400 }}>{fmt$(rules.accountSize, 0)}</span>
      </h3>

      {ev.breached && (
        <div className="banner stop">
          <b>Account blown.</b> {ev.breachReason}
        </div>
      )}
      {!ev.breached && ev.passed && (
        <div className="banner ok">
          <b>Passed.</b> Target, minimum days and consistency are all met for the rules you set. This is a simulation —
          it isn't submitted anywhere and doesn't guarantee a pass on any real firm's evaluation, which may score things
          differently.
        </div>
      )}

      <div className="kv"><span>Equity</span><b>{fmt$(st.equity, 0)}</b></div>
      <div className="kv">
        <span>Profit</span>
        <b className={sgnClass(st.profit)}>{fmtSigned$(st.profit)}</b>
      </div>

      {rules.maxDrawdown > 0 && (
        <div style={{ margin: '10px 0 4px' }}>
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
            <span className="hint">
              Drawdown line{' '}
              <b style={{ fontFamily: 'var(--mono)', color: 'var(--ink-2)' }}>{fmt$(st.threshold, 0)}</b>
            </span>
            <b className="num" style={{ color: cushionColor }}>
              {isFinite(st.cushion) ? fmt$(st.cushion, 0) + ' left' : '—'}
            </b>
          </div>
          <div className="bar-track" style={{ marginTop: 5 }}>
            <div className="bar-fill" style={{ width: cushionPct * 100 + '%', background: cushionColor }} />
          </div>
          <p className="hint" style={{ margin: '6px 0 0', fontSize: 11.5, lineHeight: 1.5 }}>
            {rules.trailing === 'intraday'
              ? 'Intraday trail: this line follows your highest equity, open profit included. Giving back an unrealized gain moves you toward it even without closing a trade.'
              : rules.trailing === 'eod'
                ? 'End-of-day trail: the line only moves up when a session closes green. Today’s profit does not raise it yet.'
                : 'Static drawdown: this line never moves.'}
          </p>
        </div>
      )}

      {rules.profitTarget > 0 && (
        <div style={{ margin: '10px 0 4px' }}>
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
            <span className="hint">Target {fmt$(rules.profitTarget, 0)}</span>
            <b className="num">{(st.targetProgress * 100).toFixed(0)}%</b>
          </div>
          <div className="bar-track" style={{ marginTop: 5 }}>
            <div className="bar-fill" style={{ width: st.targetProgress * 100 + '%' }} />
          </div>
        </div>
      )}

      {rules.dailyLossLimit > 0 && (
        <div style={{ margin: '10px 0 4px' }}>
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
            <span className="hint">Today {fmtSigned$(st.dayPnl)}</span>
            <b className="num" style={{ color: dayPct > 0.4 ? 'var(--ink)' : 'var(--warn)' }}>
              {isFinite(dayLeft) ? fmt$(Math.max(0, dayLeft), 0) + ' to the daily cap' : '—'}
            </b>
          </div>
          <div className="bar-track" style={{ marginTop: 5 }}>
            <div className="bar-fill" style={{ width: dayPct * 100 + '%', background: dayPct > 0.4 ? 'var(--accent)' : 'var(--warn)' }} />
          </div>
        </div>
      )}

      {rules.minTradingDays > 0 && (
        <div className="kv">
          <span>Trading days</span>
          <b className={st.daysTraded >= rules.minTradingDays ? 'pos' : undefined}>
            {st.daysTraded} / {rules.minTradingDays}
          </b>
        </div>
      )}

      {rules.consistencyPct > 0 && (
        <div className="kv">
          <span>Best day share</span>
          <b className={st.consistencyOk ? undefined : 'neg'}>
            {st.consistencyShare == null ? '—' : (st.consistencyShare * 100).toFixed(0) + '%'}
            <span className="hint"> · max {rules.consistencyPct}%</span>
          </b>
        </div>
      )}

      {!ev.breached && !ev.passed && st.blockers.length > 0 && (
        <p className="hint" style={{ margin: '10px 0 0', lineHeight: 1.6 }}>
          To pass: {st.blockers.join(' · ')}.
        </p>
      )}

      {(ev.breached || ev.passed) && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" style={{ flex: 1 }} onClick={() => dispatch({ type: 'RESET_PROP_EVAL' })}>
            Start a new evaluation
          </button>
        </div>
      )}
    </div>
  );
}
