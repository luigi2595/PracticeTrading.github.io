// The order ticket card — market/limit/stop, contracts, setup tag, exits
// (target/stop/trail), a live risk preview, and the buy/sell/flatten row.
// Ported from the #panel-sim aside markup in part1.html plus renderRisk()/
// syncTicket() from part4a.js/part5.js.
import React from 'react';
import { useStore } from '../store/StoreContext';
import { specFromSettings } from '../store/reducer';
import { lastPrice } from '../lib/session';
import { ticketPlan, maxContracts, totalNet } from '../lib/engine';
import { roundTick, px, fmt$ } from '../lib/spec';

const SETUP_TAGS = [
  'Untagged', 'Trend pullback', 'Breakout', 'Failed breakout', 'Failed breakdown',
  'Range fade', 'Open drive', 'VWAP reclaim', 'Reversal', 'Revenge trade', 'FOMO chase',
];

export default function OrderTicket() {
  const { state, dispatch } = useStore();
  const { settings, ticket, session } = state;
  const spec = specFromSettings(settings);
  const last = session ? lastPrice(session, state.cursor, state.sub) : 0;

  const orderRef = ticket.orderType === 'market' ? last : roundTick(parseFloat(ticket.price) || last, spec);
  const plan = ticketPlan('Long', orderRef, settings, spec);
  const eq = state.startEquity + totalNet(state.trades);
  const stopPts = plan.stop != null ? Math.abs(orderRef - plan.stop) : null;
  const tgtPts = plan.target != null ? Math.abs(plan.target - orderRef) : null;
  const risk = stopPts != null ? stopPts * spec.pointValue * ticket.qty : null;
  const rew = tgtPts != null ? tgtPts * spec.pointValue * ticket.qty : null;

  const exitSummary = (plan.target != null ? tgtPts!.toFixed(2) + ' pts / ' + Math.round(tgtPts! / spec.tick) + ' ticks up' : 'no target') +
    ' · ' + (plan.stop != null ? stopPts!.toFixed(2) + ' pts / ' + Math.round(stopPts! / spec.tick) + ' ticks down' : 'no stop');

  let riskNode: React.ReactNode;
  if (risk == null) {
    riskNode = (
      <>
        <span style={{ color: 'var(--down)' }}>No stop set.</span> The app will let you do it, and it will not compute R for
        the trade — a position without a predefined loss is the one habit worth refusing to practise.
      </>
    );
  } else {
    const pctRisk = eq > 0 ? (risk / eq) * 100 : 0;
    const allowed = maxContracts(stopPts!, state.realized, settings, spec);
    const overCap = ticket.qty > allowed;
    const warnStyle = pctRisk > 1.5 || overCap ? { color: 'var(--warn)' } : undefined;
    const rr = rew != null ? rew / risk : null;
    riskNode = (
      <>
        Risk <b style={warnStyle}>{fmt$(risk, 0)}</b> ({pctRisk.toFixed(2)}% of equity)
        {rew != null
          ? <> · reward <b>{fmt$(rew, 0)}</b> · <b>{rr!.toFixed(2)}:1</b> — needs <b>{(100 / (1 + rr!)).toFixed(0)}%</b> win rate to break even.</>
          : ' · no target, so you are exiting by hand.'}
        {overCap
          ? <><br /><span style={{ color: 'var(--down)' }}>Your daily cap allows {allowed} contract{allowed === 1 ? '' : 's'} at this stop. This order will be refused.</span></>
          : pctRisk > 1.5
            ? <><br /><span style={{ color: 'var(--warn)' }}>That is a big bet for one idea. Most consistent traders risk 0.25–1%.</span></>
            : null}
      </>
    );
  }

  const priceHint = () => {
    if (ticket.orderType === 'market') return null;
    const raw = parseFloat(ticket.price);
    const val = isFinite(raw) ? raw : last;
    const diff = val - last;
    const ticks = Math.round(Math.abs(diff) / spec.tick);
    return diff === 0 ? '· at the market' : '· ' + ticks + ' tick' + (ticks === 1 ? '' : 's') + (diff > 0 ? ' above' : ' below') + ' the market';
  };

  const buyLabel = ticket.orderType === 'market' ? 'BUY · B' : 'BUY ' + ticket.qty + ' @ ' + px(orderRef);
  const sellLabel = ticket.orderType === 'market' ? 'SELL · S' : 'SELL ' + ticket.qty + ' @ ' + px(orderRef);

  return (
    <div className="card">
      <h3>Order ticket</h3>

      <div className="seg" style={{ width: '100%', marginBottom: 10 }}>
        {(['market', 'limit', 'stop'] as const).map((t) => (
          <button key={t} type="button" style={{ flex: 1 }} aria-pressed={ticket.orderType === t}
            onClick={() => dispatch({ type: 'SET_TICKET_ORDER_TYPE', orderType: t })}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {ticket.orderType !== 'market' && (
        <div style={{ marginBottom: 8 }}>
          <label className="lbl" htmlFor="ordPrice">Order price <span className="hint">{priceHint()}</span></label>
          <div className="stepper">
            <button type="button" aria-label="Lower the order price" onClick={() => dispatch({ type: 'STEP_TICKET_PRICE', delta: -1 })}>&minus;</button>
            <input id="ordPrice" type="number" step="0.25" inputMode="decimal"
              value={ticket.price || (session ? roundTick(last, spec).toFixed(2) : '')}
              onChange={(e) => dispatch({ type: 'SET_TICKET_PRICE', price: e.target.value })} />
            <button type="button" aria-label="Raise the order price" onClick={() => dispatch({ type: 'STEP_TICKET_PRICE', delta: 1 })}>+</button>
          </div>
        </div>
      )}

      <div className="grid2">
        <div>
          <label className="lbl" htmlFor="qty">Contracts</label>
          <div className="stepper">
            <button type="button" aria-label="Fewer contracts" onClick={() => dispatch({ type: 'STEP_TICKET_QTY', delta: -1 })}>&minus;</button>
            <input id="qty" type="number" min={1} max={20} step={1} inputMode="numeric" value={ticket.qty}
              onChange={(e) => dispatch({ type: 'SET_TICKET_QTY', qty: parseInt(e.target.value, 10) || 1 })} />
            <button type="button" aria-label="More contracts" onClick={() => dispatch({ type: 'STEP_TICKET_QTY', delta: 1 })}>+</button>
          </div>
        </div>
        <div>
          <label className="lbl" htmlFor="setupTag">Setup tag</label>
          <select id="setupTag" value={ticket.setupTag} onChange={(e) => dispatch({ type: 'SET_SETUP_TAG', tag: e.target.value })}>
            {SETUP_TAGS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="exits">
        <div className="row" style={{ justifyContent: 'space-between', margin: '12px 0 8px' }}>
          <b style={{ fontSize: 12.5 }}>Exits</b>
          <span className="hint">{exitSummary}</span>
        </div>

        <label className="switch" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span>Take profit</span>
          <input type="checkbox" checked={settings.useTarget} onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { useTarget: e.target.checked } })} />
        </label>
        <div className="row" style={{ gap: 6, margin: '6px 0 10px' }}>
          <input type="number" step="0.25" min={0.25} inputMode="decimal" aria-label="Take profit amount" disabled={!settings.useTarget}
            value={settings.targetVal} onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { targetVal: parseFloat(e.target.value) || 0 } })} />
          <select style={{ width: 'auto' }} aria-label="Take profit unit" disabled={!settings.useTarget} value={settings.targetUnit}
            onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { targetUnit: e.target.value as typeof settings.targetUnit } })}>
            <option value="pts">points</option><option value="ticks">ticks</option><option value="price">price</option>
          </select>
        </div>

        <label className="switch" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span>Stop loss</span>
          <input type="checkbox" checked={settings.useStop} onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { useStop: e.target.checked } })} />
        </label>
        <div className="row" style={{ gap: 6, margin: '6px 0 0' }}>
          <input type="number" step="0.25" min={0.25} inputMode="decimal" aria-label="Stop loss amount" disabled={!settings.useStop}
            value={settings.stopVal} onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { stopVal: parseFloat(e.target.value) || 0 } })} />
          <select style={{ width: 'auto' }} aria-label="Stop loss unit" disabled={!settings.useStop} value={settings.stopUnit}
            onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { stopUnit: e.target.value as typeof settings.stopUnit } })}>
            <option value="pts">points</option><option value="ticks">ticks</option><option value="price">price</option>
          </select>
        </div>

        <div className="row" style={{ gap: 6, marginTop: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label className="lbl" htmlFor="setTrail">Trail the stop</label>
            <select id="setTrail" value={settings.trailMode} onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { trailMode: e.target.value as typeof settings.trailMode } })}>
              <option value="off">Off — stop stays put</option>
              <option value="atr">Behind volatility (ATR)</option>
              <option value="swing">Behind structure (swings)</option>
            </select>
          </div>
          <div style={{ flex: '0 0 84px', visibility: settings.trailMode === 'off' ? 'hidden' : 'visible' }}>
            <label className="lbl" htmlFor="setTrailAtr">Distance</label>
            {settings.trailMode === 'swing' ? (
              <input id="setTrailBars" type="number" step={1} min={2} title="Swing lookback in bars" aria-label="Trail lookback in bars"
                value={settings.trailBars} onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { trailBars: parseInt(e.target.value, 10) || 5 } })} />
            ) : (
              <input id="setTrailAtr" type="number" step="0.25" min={0.5} title="ATR multiple" aria-label="Trail distance in ATR multiples"
                value={settings.trailAtrMult} onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { trailAtrMult: parseFloat(e.target.value) || 1.5 } })} />
            )}
          </div>
        </div>
      </div>

      <div className="hint" style={{ margin: '10px 0' }}>{riskNode}</div>

      <div className="grid2">
        <button className="btn buy" onClick={() => dispatch({ type: 'PLACE_ORDER', side: 'Long' })}>{buyLabel}</button>
        <button className="btn sell" onClick={() => dispatch({ type: 'PLACE_ORDER', side: 'Short' })}>{sellLabel}</button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn flat sm" style={{ flex: 1 }} onClick={() => dispatch({ type: 'FLATTEN' })}>Flatten · F</button>
        <button className="btn flat sm" style={{ flex: 1 }} onClick={() => dispatch({ type: 'REVERSE' })}>Reverse</button>
        <button className="btn flat sm" style={{ flex: 1 }} title="Move stop to entry" onClick={() => dispatch({ type: 'STOP_TO_BE' })}>Stop&rarr;BE</button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn flat sm" style={{ flex: 1 }} title="Bank the whole position at market" onClick={() => dispatch({ type: 'TAKE_PROFIT' })}>Take profit</button>
        <button className="btn flat sm" style={{ flex: 1 }} title="Bank half, let the rest run" onClick={() => dispatch({ type: 'TAKE_HALF' })}>Take &frac12; off</button>
        <button className="btn flat sm" style={{ flex: 1 }} title="Close the day and review it"
          onClick={() => dispatch({ type: 'END_DAY', now: new Date().toISOString().slice(0, 16).replace('T', ' ') })}>End day</button>
      </div>
    </div>
  );
}
