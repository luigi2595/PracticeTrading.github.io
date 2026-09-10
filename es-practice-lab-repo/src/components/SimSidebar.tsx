// The right-hand info cards in the replay sim: live pattern read, drawn
// levels, working orders, current position, account summary, and the
// discipline-rules card. Ported from part1.html's markup plus
// renderPatternRead()/renderLevels()/renderOrders()/renderPosBox() in
// part4a.js/part5.js.
import React from 'react';
import { useStore } from '../store/StoreContext';
import { specFromSettings } from '../store/reducer';
import { openPnl, totalNet } from '../lib/engine';
import { px, fmt$, fmtSigned$, sgnClass } from '../lib/spec';
import { lastPrice } from '../lib/session';
import { PAT_COLOR } from '../lib/patterns';

export function LiveReadCard() {
  const { state, dispatch } = useStore();
  const evs = state.patEvents.slice(-3).reverse();
  return (
    <div className="card" id="patCard">
      <h3 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>Live read</span>
        <label className="switch" style={{ fontWeight: 400 }}>
          <span className="hint">on</span>
          <input type="checkbox" checked={state.settings.patOn} onChange={() => dispatch({ type: 'TOGGLE_PAT' })} />
        </label>
      </h3>
      {!state.settings.patOn ? (
        <p className="hint" style={{ margin: 0 }}>Off. You are reading the tape unaided — which is the point, once the tells are in your hands.</p>
      ) : evs.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          {(() => {
            const need = state.session ? Math.max(0, 45 - state.cursor) : 45;
            return need > 0
              ? 'Watching. Needs about ' + need + ' more bars before there is enough structure to call anything.'
              : 'Watching. No level has been tested decisively yet.';
          })()}
        </p>
      ) : (
        evs.map((ev) => {
          const c = PAT_COLOR[ev.kind] || '#c3c2b7';
          return (
            <div className="patEv" key={ev.key} style={{ borderLeft: '3px solid ' + c }}>
              <div className="patHd"><b style={{ color: c }}>{ev.text}</b><span className="hint">{ev.t}</span></div>
              <p className="hint patDetail">{ev.detail}</p>
            </div>
          );
        })
      )}
    </div>
  );
}

export function LevelsCard() {
  const { state, dispatch } = useStore();
  if (!state.userLevels.length) return null;
  const sorted = state.userLevels.slice().sort((a, b) => b - a);
  return (
    <div className="card" id="levelsCard">
      <h3>My levels</h3>
      <div>
        {sorted.map((v) => (
          <div className="lvlrow" key={v}>
            <span className="num">{px(v)}</span>
            <button className="btn sm" aria-label={'Remove the level at ' + px(v)} onClick={() => dispatch({ type: 'REMOVE_USER_LEVEL', price: v })}>Remove</button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm" style={{ flex: 1 }} onClick={() => dispatch({ type: 'CLEAR_LEVELS' })}>Clear all</button>
      </div>
    </div>
  );
}

export function OrdersCard() {
  const { state, dispatch } = useStore();
  if (!state.orders.length) return null;
  return (
    <div className="card" id="ordersCard">
      <h3>Working orders</h3>
      <div>
        {state.orders.map((o) => (
          <div className="ordrow" key={o.id}>
            <span>
              <b className={o.side === 'Long' ? 'pos' : 'neg'}>{o.side} {o.qty}</b> {o.type} @ <span className="num">{px(o.price)}</span>{' '}
              {o.stop != null ? <span className="hint">stop {px(o.stop)}</span> : <span className="hint">no stop</span>}
            </span>
            <button className="btn sm" onClick={() => dispatch({ type: 'CANCEL_ORDER', id: o.id })}>Cancel</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PositionCard() {
  const { state, dispatch } = useStore();
  const P = state.position;
  const spec = specFromSettings(state.settings);
  if (!P || !state.session) {
    return (
      <div className="card">
        <h3 id="posHeading">Position</h3>
        <p className="hint" style={{ margin: 0 }}>Flat. Set your stop and target <i>before</i> you click — the ticket sizes the risk for you.</p>
      </div>
    );
  }
  const last = lastPrice(state.session, state.cursor, state.sub);
  const pnl = openPnl(P, last, spec);
  const rNow = P.riskD ? pnl / P.riskD : 0;
  const banked = P.exits.reduce((a, e) => a + e.pts * spec.pointValue * e.qty, 0);
  return (
    <div className="card">
      <h3 id="posHeading">Position</h3>
      <div className="kv"><span>{P.side} {P.qty}{P.initQty > P.qty ? ' of ' + P.initQty : ''} @ {px(P.entry)}</span><b className={sgnClass(pnl)}>{fmtSigned$(pnl)}</b></div>
      {P.exits.length > 0 && (
        <div className="kv">
          <span>Banked so far</span>
          <b className={sgnClass(banked)}>{fmtSigned$(banked)} <span className="hint">· {P.exits.map((e, i) => <span key={i}>{i > 0 ? ', ' : ''}{e.qty}@{px(e.price)}</span>)}</span></b>
        </div>
      )}
      {P.trailed && <div className="kv"><span>Stop</span><b className="pos">trailing</b></div>}
      <div className="kv"><span>Open R</span><b className={sgnClass(rNow)}>{rNow.toFixed(2)}R</b></div>
      <div className="kv"><span>Stop</span><b>{px(P.stop)} <span className="hint">({Math.abs(P.entry - P.stop).toFixed(2)} pts)</span></b></div>
      <div className="kv"><span>Target</span><b>{px(P.target)} <span className="hint">({Math.abs(P.target - P.entry).toFixed(2)} pts)</span></b></div>
      <div className="kv"><span>MAE / MFE</span><b>{P.mae.toFixed(2)} / +{P.mfe.toFixed(2)}</b></div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm" style={{ flex: 1 }} onClick={() => dispatch({ type: 'ADJUST_STOP_TARGET', field: 'stop', delta: -1 })}>Stop −</button>
        <button className="btn sm" style={{ flex: 1 }} onClick={() => dispatch({ type: 'ADJUST_STOP_TARGET', field: 'stop', delta: 1 })}>Stop +</button>
        <button className="btn sm" style={{ flex: 1 }} onClick={() => dispatch({ type: 'ADJUST_STOP_TARGET', field: 'target', delta: -1 })}>Tgt −</button>
        <button className="btn sm" style={{ flex: 1 }} onClick={() => dispatch({ type: 'ADJUST_STOP_TARGET', field: 'target', delta: 1 })}>Tgt +</button>
      </div>
    </div>
  );
}

export function AccountCard() {
  const { state } = useStore();
  const spec = specFromSettings(state.settings);
  const P = state.position;
  const last = state.session ? lastPrice(state.session, state.cursor, state.sub) : 0;
  const pnl = P ? openPnl(P, last, spec) : 0;
  const eq = state.startEquity + totalNet(state.trades) + pnl;
  let run = state.startEquity, peak = state.startEquity, dd = 0;
  for (const t of state.trades) { if (t.source !== 'sim') continue; run += t.net; peak = Math.max(peak, run); dd = Math.min(dd, run - peak); }
  const sim = state.trades.filter((t) => t.source === 'sim');
  const wins = sim.filter((t) => t.net > 0).length;
  return (
    <div className="card">
      <h3>Account</h3>
      <div className="kv"><span>Equity</span><b>{fmt$(eq, 0)}</b></div>
      <div className="kv"><span>Realized (session)</span><b className={sgnClass(state.realized)}>{fmtSigned$(state.realized)}</b></div>
      <div className="kv"><span>Open P&amp;L</span><b className={P ? sgnClass(pnl) : undefined}>{P ? fmtSigned$(pnl) : '—'}</b></div>
      <div className="kv"><span>Max drawdown</span><b>{dd ? fmt$(dd, 0) : '$0'}</b></div>
      <div className="kv"><span>Trades / Win rate</span><b>{sim.length} / {sim.length ? ((wins / sim.length) * 100).toFixed(0) + '%' : '—'}</b></div>
    </div>
  );
}

export function DisciplineCard() {
  const { state, dispatch } = useStore();
  const { settings } = state;
  return (
    <div className="card">
      <h3>Discipline rules</h3>
      <div className="grid2">
        <div>
          <label className="lbl" htmlFor="lossLimit">Daily loss cap ($)</label>
          <input id="lossLimit" type="number" min={0} step={50} inputMode="numeric" value={settings.lossLimit}
            onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { lossLimit: parseFloat(e.target.value) || 0 } })} />
        </div>
        <div>
          <label className="lbl" htmlFor="maxTrades">Max trades / day</label>
          <input id="maxTrades" type="number" min={1} step={1} inputMode="numeric" value={settings.maxTrades}
            onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { maxTrades: parseInt(e.target.value, 10) || 0 } })} />
        </div>
      </div>
      <label className="switch" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={settings.enforceRules} onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { enforceRules: e.target.checked } })} />
        Lock me out when a limit is hit
      </label>
      <p className="hint" style={{ margin: '8px 0 0' }}>Keys: <b>B</b> buy · <b>S</b> sell · <b>F</b> flatten · <b>Space</b> play/pause · <b>→</b> step one bar.</p>
    </div>
  );
}

