// The app's four modal dialogs: the first-run Welcome sheet, the moving-
// average configuration sheet, a single trade's Replay chart, and the
// closing-bell Debrief. Ported from the #welcome/#maCfg/#replay/#debrief
// markup in part1.html and their logic in part4a.js/part5.js. Each modal
// owns none of its own open/closed state — that lives in App.tsx — so these
// components are pure "given open, render; given close, call back" shells.
import React, { useEffect, useRef } from 'react';
import { useStore } from '../store/StoreContext';
import { generateSession } from '../lib/generator';
import { computeStats, oneThingToFix, totalNet } from '../lib/engine';
import { mean, px, esc, fmt$, fmtSigned$, sgnClass, clamp } from '../lib/spec';
import { maLabel } from '../lib/indicators';
import type { MAType } from '../lib/types';

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ---------------- Welcome ---------------- */

export function WelcomeModal({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: () => void }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="modal" id="welcome" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card">
        <h2>ES Practice Lab</h2>
        <div className="modal-body">
          <p className="sub">A flight simulator for E-mini S&amp;P 500 futures. You practise the parts that are actually trainable — reading a break, placing risk, sitting still — without money on the line.</p>
          <ul className="wl">
            <li><span className="n">1</span><span><b>Pattern lab</b> — start here. You get a chart stopped at a decision: a level just broke. Was that real selling, or stops being run? Call it, place your stop, and watch what happened next. Turn on <b>Hard mode</b> once the tells start making sense.</span></li>
            <li><span className="n">2</span><span><b>Replay sim</b> — a full session plays out bar by bar. Buy and sell from the bar at the bottom. Every trade carries real commissions and slippage, so the P&amp;L is honest. Set a daily loss cap and the app will refuse the trade that would blow through it.</span></li>
            <li><span className="n">3</span><span><b>Journal</b> — every trade logs itself. Win rate, expectancy in R, how far trades went against you before they worked, and which setup tag is quietly paying for all the others.</span></li>
          </ul>
          <p className="fine">The price data is synthetic — built to move like an intraday session, but it is not the real ES and contains no real news. Treat this as practice for execution and risk habits, not as a place to discover a strategy. Nothing here is trading advice, and futures can lose more than you deposit. Your journal is saved on your own device and is not shared with anyone.</p>
        </div>
        <div className="row wrap modal-actions">
          <button className="btn primary" id="wlStart" style={{ flex: 1, minWidth: 180 }} onClick={onStart}>Start with the Pattern lab</button>
          <button className="btn" id="wlClose" style={{ flex: 1, minWidth: 140 }} onClick={onClose}>Look around first</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- MA config ---------------- */

export function MaCfgModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useStore();
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="modal" id="maCfg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ maxWidth: 440 }}>
        <h2>Moving averages</h2>
        <p className="sub">Three slots. CMA is the running average of the session so far — VWAP's unweighted cousin.</p>
        <div className="modal-body" id="maRows">
          {state.mas.map((m, i) => (
            <div className="row wrap" key={i} style={{ gap: 8, marginBottom: 10, alignItems: 'flex-end' }}>
              <label className="switch" style={{ flex: '0 0 auto' }}>
                <input type="checkbox" checked={m.on} onChange={(e) => dispatch({ type: 'CONFIGURE_MA', index: i, patch: { on: e.target.checked } })} />
                {' '}<span style={{ color: m.color }}>line {i + 1}</span>
              </label>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label className="lbl">Type</label>
                <select value={m.type} onChange={(e) => dispatch({ type: 'CONFIGURE_MA', index: i, patch: { type: e.target.value as MAType } })}>
                  {(['ema', 'sma', 'cma'] as const).map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                </select>
              </div>
              <div style={{ flex: '0 0 90px' }}>
                <label className="lbl">Period</label>
                <input type="number" min={2} max={400} step={1} value={m.period} disabled={m.type === 'cma'}
                  onChange={(e) => dispatch({ type: 'CONFIGURE_MA', index: i, patch: { period: clamp(Math.round(parseFloat(e.target.value) || 9), 2, 400) } })} />
              </div>
              <span className="hint" style={{ flex: '0 0 auto' }}>{maLabel(m)}</span>
            </div>
          ))}
        </div>
        <div className="row modal-actions"><button className="btn primary" id="maDone" style={{ flex: 1 }} onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

/* ---------------- Trade replay ---------------- */

export function ReplayModal({ tradeId, onClose }: { tradeId: number | null; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const open = tradeId != null;
  useEscape(open, onClose);

  const t = tradeId != null ? state.trades.find((x) => x.id === tradeId) || null : null;
  let bars: import('../lib/types').Bar[] | null = null;
  if (t) {
    if (t.gen) bars = generateSession(t.gen).bars;
    else if (t.importedDate && state.imported) {
      const d = state.imported.find((x) => x.date === t.importedDate);
      if (d) bars = d.bars;
    }
  }
  const usable = !!(t && bars && t.entryBar != null);

  useEffect(() => {
    if (!open || !usable || !t || !bars) return;
    const c = canvasRef.current; if (!c) return;
    const draw = () => {
      if (!c.clientWidth) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const g = c.getContext('2d'); if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);

      const from = Math.max(0, t.entryBar - 40), to = Math.min(bars!.length, t.exitBar + 25);
      const seg = bars!.slice(from, to);
      if (!seg.length) return;
      const padR = 56, x0 = 6, x1 = w - padR, y0 = 8, y1 = h - 20;
      let lo = Math.min.apply(null, seg.map((b) => b.l)), hi = Math.max.apply(null, seg.map((b) => b.h));
      [t.entry, t.exit, t.initialStop].forEach((v) => { if (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
      const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
      const bw = (x1 - x0) / seg.length;
      const Y = (p: number) => y1 - ((p - lo) / (hi - lo)) * (y1 - y0);
      const X = (i: number) => x0 + i * bw + bw / 2;

      g.font = '10px ' + css('--mono'); g.textBaseline = 'middle';
      const upC = css('--up'), dnC = css('--down'), bodyW = Math.max(1.5, Math.min(bw * 0.66, 11));
      g.fillStyle = 'rgba(57,135,229,.08)';
      g.fillRect(X(t.entryBar - from) - bw / 2, y0, Math.max(bw, (t.exitBar - t.entryBar) * bw), y1 - y0);

      for (let i = 0; i < seg.length; i++) {
        const b = seg[i], x = X(i), up = b.c >= b.o;
        g.strokeStyle = up ? upC : dnC; g.fillStyle = up ? upC : dnC; g.lineWidth = 1;
        g.beginPath(); g.moveTo(Math.round(x) + 0.5, Y(b.h)); g.lineTo(Math.round(x) + 0.5, Y(b.l)); g.stroke();
        g.fillRect(x - bodyW / 2, Math.min(Y(b.o), Y(b.c)), bodyW, Math.max(Math.abs(Y(b.c) - Y(b.o)), 1.2));
      }
      const line = (p: number | null, col: string, lab: string, dash: number[] | null) => {
        if (p == null) return;
        const y = Math.round(Y(p)) + 0.5;
        g.strokeStyle = col; g.lineWidth = 1; if (dash) g.setLineDash(dash);
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]);
        g.fillStyle = col; g.textAlign = 'left'; g.fillText(lab, x1 + 5, y);
      };
      line(t.initialStop, dnC, 'stop', [4, 3]);
      line(t.entry, '#ffffff', 'in', null);
      line(t.exit, css('--accent'), 'out', [4, 3]);
      (t.exits || []).forEach((e) => {
        g.fillStyle = css('--accent');
        g.beginPath(); g.arc(X(Math.min(seg.length - 1, t.exitBar - from)), Y(e.price), 3, 0, 7); g.fill();
      });
      const mark = (idx: number, col: string, label: string) => {
        const i = idx - from; if (i < 0 || i >= seg.length) return;
        g.fillStyle = col; g.beginPath();
        g.moveTo(X(i), Y(seg[i].l) + 14); g.lineTo(X(i) - 4, Y(seg[i].l) + 22); g.lineTo(X(i) + 4, Y(seg[i].l) + 22);
        g.closePath(); g.fill();
        g.textAlign = 'center'; g.textBaseline = 'top'; g.font = '9px system-ui';
        g.fillText(label, X(i), Y(seg[i].l) + 24);
      };
      mark(t.entryBar, '#ffffff', 'in');
      mark(t.exitBar, css('--accent'), 'out');
    };
    draw();
    const ro = window.ResizeObserver ? new ResizeObserver(draw) : null;
    if (canvasRef.current) ro?.observe(canvasRef.current);
    return () => ro?.disconnect();
  }, [open, usable, t, bars]);

  useEffect(() => {
    if (open && t && !usable) {
      dispatch({
        type: 'TOAST',
        text: t.source === 'manual' ? 'Hand-logged trades have no chart to replay.' : 'That trade was taken before replay existed, or its bars are no longer loaded.',
      });
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, usable]);

  if (!open || !t) return null;

  return (
    <div className="modal" id="replay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ maxWidth: 700 }}>
        <h2 id="rpTitle">
          {t.side} {t.qty} · {t.openedAt} → {t.t} · {(t.R != null && t.R >= 0 ? '+' : '−') + Math.abs(t.R || 0).toFixed(2)}R
        </h2>
        <p className="sub" id="rpSub" dangerouslySetInnerHTML={{
          __html: 'Entry ' + px(t.entry) + ' · exit ' + px(t.exit) +
            (t.initialStop ? ' · stop ' + px(t.initialStop) : '') +
            (t.scaled ? ' · scaled out in ' + t.exits.length + ' pieces' : '') + ' · ' + esc(t.reason || ''),
        }} />
        <div className="modal-body">
          <canvas ref={canvasRef} id="rpChart" style={{ width: '100%', height: 320, display: 'block' }} />
          <p className="hint" style={{ margin: '10px 0 0' }}>The shaded band is the time you were in. Watching your own entry land inside its own context is the fastest way to see whether you were early, late, or right.</p>
        </div>
        <div className="row modal-actions">
          <button className="btn" id="rpClose" style={{ flex: 1 }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Closing-bell debrief ---------------- */

function tile(label: string, val: string, cls: string, sub: string): React.ReactNode {
  return (
    <div className="tile">
      <div className="t-label">{label}</div>
      <div className={'t-val ' + cls}>{val}</div>
      {sub ? <div className="t-sub">{sub}</div> : null}
    </div>
  );
}

export function DebriefModal({ open, onClose, onNewSession, onOpenJournal }: {
  open: boolean; onClose: () => void; onNewSession: () => void; onOpenJournal: () => void;
}) {
  const { state } = useStore();
  useEscape(open, onClose);
  if (!open) return null;

  const list = state.trades.slice(state.sessionStartIdx || 0).filter((tr) => tr.source === 'sim');

  if (!list.length) {
    return (
      <div className="modal" id="debrief" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal-card">
          <h2>Closing bell</h2>
          <p className="sub">What the session actually says about how you traded it.</p>
          <div className="modal-body" id="dbBody">
            <p className="sub" style={{ margin: 0 }}>No trades this session. Sitting on your hands through a session you did not understand is a legitimate outcome — it just leaves nothing to review.</p>
          </div>
          <div className="row wrap modal-actions">
            <button className="btn primary" id="dbNew" style={{ flex: 1, minWidth: 170 }} onClick={onNewSession}>Trade another session</button>
            <button className="btn" id="dbJournal" style={{ flex: 1, minWidth: 130 }} onClick={onOpenJournal}>Open the journal</button>
            <button className="btn" id="dbClose" style={{ flex: '0 0 90px' }} onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  const st = computeStats(list);
  const capt = list.filter((tr) => tr.capture != null).map((tr) => tr.capture as number);
  const avgCapture = capt.length ? mean(capt) : null;
  const eq = state.startEquity + totalNet(state.trades);
  const maxRiskPct = list.length ? Math.max.apply(null, list.map((tr) => ((tr.riskD || 0) / eq) * 100)) : 0;
  const cap = state.settings.lossLimit || 0;
  const maxT = state.settings.maxTrades || 0;
  const best = list.filter((tr) => tr.R != null).sort((a, b) => (b.R as number) - (a.R as number))[0];
  const worst = list.filter((tr) => tr.R != null).sort((a, b) => (a.R as number) - (b.R as number))[0];
  const scaled = list.filter((tr) => tr.scaled).length;
  const fix = oneThingToFix(list, st, eq, state.locked, state.lockReason);

  const checks = [
    { ok: !(cap > 0 && state.realized <= -cap), label: 'Stayed inside the daily loss cap', detail: cap > 0 ? fmtSigned$(state.realized) + ' against a ' + fmt$(cap, 0) + ' cap' : 'no cap set' },
    { ok: !(maxT > 0 && list.length > maxT), label: 'Stayed inside the trade limit', detail: list.length + ' of ' + (maxT || '∞') },
    { ok: maxRiskPct <= 1.5, label: 'Kept every trade under 1.5% risk', detail: 'largest was ' + maxRiskPct.toFixed(2) + '%' },
    { ok: list.every((tr) => tr.riskD > 0), label: 'Every trade had a stop from the start', detail: list.filter((tr) => !tr.riskD).length + ' without one' },
  ];

  return (
    <div className="modal" id="debrief" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card">
        <h2>Closing bell</h2>
        <p className="sub">What the session actually says about how you traded it.</p>
        <div className="modal-body" id="dbBody">
          <div className="tiles" style={{ marginBottom: 14 }}>
            {tile('Net', fmtSigned$(st.net), sgnClass(st.net), st.n + ' trades · ' + st.winRate.toFixed(0) + '% won')}
            {tile('Expectancy', st.expR == null ? '—' : (st.expR >= 0 ? '+' : '−') + Math.abs(st.expR).toFixed(2) + 'R', st.expR == null ? '' : sgnClass(st.expR), 'per trade')}
            {tile(
              'Capture',
              avgCapture == null ? '—' : (avgCapture < 0 ? '−' : '') + Math.abs(avgCapture * 100).toFixed(0) + '%',
              avgCapture == null ? '' : avgCapture >= 0.4 ? 'pos' : avgCapture < 0 ? 'neg' : '',
              avgCapture == null ? 'set a stop to measure this' : avgCapture < 0 ? 'you gave back more than was offered' : 'of the best excursion, kept',
            )}
          </div>
          <h3 style={{ margin: '0 0 8px' }}>Did you follow your own rules?</h3>
          <div style={{ marginBottom: 14 }}>
            {checks.map((c, i) => (
              <div className="tell" key={i}>
                <span className="tl">{c.ok ? <span className="pos">✓</span> : <span className="neg">✗</span>} {c.label}</span>
                <span className="tv hint">{c.detail}</span>
              </div>
            ))}
          </div>
          {best ? <div className="tell"><span className="tl">Best decision</span><span className="tv pos">{best.openedAt} · {best.side} · +{(best.R as number).toFixed(2)}R</span></div> : null}
          {worst ? <div className="tell"><span className="tl">Worst decision</span><span className="tv neg">{worst.openedAt} · {worst.side} · {(worst.R as number).toFixed(2)}R</span></div> : null}
          {scaled ? <div className="tell"><span className="tl">Trades you scaled out of</span><span className="tv">{scaled} of {st.n}</span></div> : null}
          <div className="card" style={{ marginTop: 14, background: 'var(--plane)' }}>
            <h3 style={{ color: 'var(--accent)' }}>One thing to fix — {fix.tag}</h3>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7 }}>{fix.body}</p>
          </div>
        </div>
        <div className="row wrap modal-actions">
          <button className="btn primary" id="dbNew" style={{ flex: 1, minWidth: 170 }} onClick={onNewSession}>Trade another session</button>
          <button className="btn" id="dbJournal" style={{ flex: 1, minWidth: 130 }} onClick={onOpenJournal}>Open the journal</button>
          <button className="btn" id="dbClose" style={{ flex: '0 0 90px' }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
