// The one-handed phone trading bar that docks to the bottom of the screen
// on the Replay sim tab. Ported from the #mobileBar markup in part1.html and
// syncMobileBar()/bindMobileBar() in part5.js. Visibility is pure CSS (the
// `body.mobile-sim` class + a max-width media query), so this component's
// only job re: showing/hiding is keeping that body class in sync with the
// active tab and viewport, exactly like the original's resize/orientation
// listeners did.
import React, { useEffect } from 'react';
import { useStore } from '../store/StoreContext';
import { specFromSettings } from '../store/reducer';
import { lastPrice } from '../lib/session';
import { ticketPlan, maxContracts, openPnl } from '../lib/engine';
import { clamp, px, fmt$, fmtSigned$, sgnClass } from '../lib/spec';

function isPhone(): boolean {
  return window.matchMedia('(max-width:900px)').matches;
}

export default function MobileBar({ activeTab, onScrollToTicket }: { activeTab: string; onScrollToTicket: () => void }) {
  const { state, dispatch } = useStore();
  const { settings, ticket, session, position: P } = state;
  const spec = specFromSettings(settings);

  useEffect(() => {
    const sync = () => document.body.classList.toggle('mobile-sim', isPhone() && activeTab === 'sim');
    sync();
    window.addEventListener('resize', sync);
    const onOrient = () => window.setTimeout(sync, 250);
    window.addEventListener('orientationchange', onOrient);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', onOrient);
    };
  }, [activeTab]);

  const last = session ? lastPrice(session, state.cursor, state.sub) : 0;
  const qty = clamp(Math.round(ticket.qty || 1), 1, 20);

  let posNode: React.ReactNode;
  let riskText = '';
  if (P) {
    const pnl = openPnl(P, last, spec);
    const rNow = P.riskD ? pnl / P.riskD : 0;
    posNode = (
      <>
        <b className={P.side === 'Long' ? 'pos' : 'neg'}>{P.side} {P.qty}</b>{' '}
        <span className={'num ' + sgnClass(pnl)}>{fmtSigned$(pnl)}</span>{' '}
        <span className="hint">· {rNow.toFixed(2)}R · stop {px(P.stop)}</span>
      </>
    );
  } else if (state.locked) {
    posNode = <><b style={{ color: 'var(--down)' }}>Locked out</b> <span className="hint">rule hit — done for the day</span></>;
  } else {
    const plan = ticketPlan('Long', last, settings, spec);
    const stopPts = plan.stop != null ? Math.abs(last - plan.stop) : null;
    const tgtPts = plan.target != null ? Math.abs(plan.target - last) : null;
    const allowed = stopPts != null ? maxContracts(stopPts, state.realized, settings, spec) : 20;
    posNode = (
      <>
        <span className="flat">Flat</span>
        {qty > allowed ? <> <b style={{ color: 'var(--down)' }}>cap allows {allowed}</b></> : null}
        {ticket.orderType !== 'market' ? <> <span className="hint">{ticket.orderType} order</span></> : null}
      </>
    );
    riskText = stopPts == null
      ? 'no stop set'
      : 'stop ' + stopPts.toFixed(2) + ' · ' + (tgtPts != null ? 'tgt ' + tgtPts.toFixed(2) : 'no tgt') +
        ' · risk ' + fmt$(stopPts * spec.pointValue * qty, 0) +
        (tgtPts != null ? ' (' + (tgtPts / stopPts).toFixed(1) + ':1)' : '');
  }

  return (
    <div className="mobilebar" id="mobileBar" onClick={(e) => {
      const btn = (e.target as HTMLElement).closest('[data-mb]') as HTMLElement | null;
      if (!btn) return;
      const a = btn.dataset.mb;
      if (a === 'buy') dispatch({ type: 'PLACE_ORDER', side: 'Long' });
      else if (a === 'sell') dispatch({ type: 'PLACE_ORDER', side: 'Short' });
      else if (a === 'flatten') dispatch({ type: 'FLATTEN' });
      else if (a === 'be') dispatch({ type: 'STOP_TO_BE' });
      else if (a === 'half') dispatch({ type: 'TAKE_HALF' });
      else if (a === 'tp') dispatch({ type: 'TAKE_PROFIT' });
      else if (a === 'play') dispatch({ type: 'TOGGLE_PLAY' });
      else if (a === 'step') { dispatch({ type: 'PAUSE' }); dispatch({ type: 'STEP_BAR', now: new Date().toISOString() }); }
      else if (a === 'qty+' || a === 'qty-') dispatch({ type: 'STEP_TICKET_QTY', delta: a === 'qty+' ? 1 : -1 });
      else if (a === 'ticket') onScrollToTicket();
    }}>
      <div className="mb-info">
        <span id="mbPos">{posNode}</span>
        <span className="spacer" />
        <span id="mbRisk" className="hint">{riskText}</span>
      </div>
      <div className="mb-row">
        <div className="mb-step" title="Contracts">
          <button type="button" data-mb="qty-">&minus;</button>
          <span id="mbQty">{qty}</span>
          <button type="button" data-mb="qty+">+</button>
        </div>
        <button className="btn buy" data-mb="buy">BUY</button>
        <button className="btn sell" data-mb="sell">SELL</button>
        <button className="btn flat narrow" data-mb="flatten">Flat</button>
      </div>
      <div className="mb-row">
        <button className="btn flat" data-mb="play" id="mbPlay">{state.playing ? '❚❚ Pause' : '▶ Play'}</button>
        <button className="btn flat" data-mb="step">Step ▸</button>
        <button className="btn flat" data-mb="tp">Take profit</button>
        <button className="btn flat" data-mb="half">&frac12;</button>
        <button className="btn flat" data-mb="be">&rarr;BE</button>
        <button className="btn flat narrow" data-mb="ticket">&#9881;</button>
      </div>
    </div>
  );
}
