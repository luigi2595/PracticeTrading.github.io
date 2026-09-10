// The "Pattern lab" tab: a drill chart stopped at a decision point, the
// four-tells facts panel, the call/stop/reveal question flow, and the
// accuracy-by-pattern stats. Ported from part2.html's #panel-drills plus
// renderPattern()/drawDrillChart()/answerCall()/answerStop()/revealOutcome()
// in part5.js.
import React, { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store/StoreContext';
import { specFromSettings } from '../store/reducer';
import { TELL_LABEL, buildCallFeedback, buildOutcomeReveal } from '../lib/patternLab';
import { px } from '../lib/spec';
import type { LevelFacts } from '../lib/patternLab';

function css(name: string): string { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function mean(a: number[]): number { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

const MODES = [
  { key: 'mixed', label: 'Mixed' }, { key: 'support', label: 'Support' },
  { key: 'resistance', label: 'Resistance' }, { key: 'trend', label: 'Trend' },
] as const;

function DrillChart() {
  const { state } = useStore();
  const ref = useRef<HTMLCanvasElement | null>(null);
  const sc = state.patternLab.scenario;
  const reveal = state.patternLab.reveal;
  const step = state.patternLab.step;
  const stopPick = state.patternLab.stopPick;

  const draw = useCallback(() => {
    const c = ref.current;
    if (!c || !sc) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (!w) return;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d'); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);

    const shown = sc.bars.slice(0, sc.decision + reveal);
    const padR = 58, padB = 20, x0 = 6, x1 = w - padR, y0 = 8;
    const volH = Math.max(34, Math.min(56, h * 0.16));
    const yVol = h - padB, y1 = yVol - volH - 8;
    const plotW = x1 - x0, plotH = y1 - y0;
    let lo = Infinity, hi = -Infinity;
    for (const b of shown) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
    if (sc.level != null) { lo = Math.min(lo, sc.level); hi = Math.max(hi, sc.level); }
    if (step === 'reveal' && stopPick) { const s = sc.stops.find((x) => x.key === stopPick); if (s) { lo = Math.min(lo, s.price); hi = Math.max(hi, s.price); } }
    const pad = Math.max((hi - lo) * 0.07, 0.5); lo -= pad; hi += pad;
    const bw = plotW / Math.max(shown.length, sc.decision + 18);
    const Y = (p: number) => y1 - (p - lo) / (hi - lo) * plotH;
    const X = (i: number) => x0 + i * bw + bw / 2;

    g.fillStyle = 'rgba(255,255,255,.022)';
    g.fillRect(X(sc.decision) - bw / 2, y0, plotW - (X(sc.decision) - bw / 2 - x0), plotH);

    const range = hi - lo;
    let step2 = Math.pow(10, Math.floor(Math.log10(range / 4)));
    const m = range / 4 / step2; step2 *= m > 5 ? 10 : m > 2 ? 5 : m > 1 ? 2 : 1;
    g.font = '10px ' + css('--mono'); g.textBaseline = 'middle'; g.textAlign = 'left';
    for (let p = Math.ceil(lo / step2) * step2; p < hi; p += step2) {
      g.strokeStyle = css('--grid'); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, Math.round(Y(p)) + 0.5); g.lineTo(x1, Math.round(Y(p)) + 0.5); g.stroke();
      g.fillStyle = css('--muted'); g.fillText(p.toFixed(step2 < 1 ? 2 : 0), x1 + 6, Y(p));
    }

    if (sc.level != null) {
      const y = Math.round(Y(sc.level)) + 0.5;
      g.strokeStyle = '#c3c2b7'; g.lineWidth = 1.5; g.setLineDash([6, 4]);
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#c3c2b7'; g.font = '10px ' + css('--mono'); g.textAlign = 'left'; g.textBaseline = 'bottom';
      g.fillText('level ' + px(sc.level) + ' · tested ' + (sc.facts as LevelFacts).tests + '×', x0 + 4, y - 3);
    }

    const upC = css('--up'), dnC = css('--down'), bodyW = Math.max(1.5, Math.min(bw * 0.66, 12));
    for (let i = 0; i < shown.length; i++) {
      const b = shown[i], x = X(i), up = b.c >= b.o, future = i >= sc.decision;
      g.strokeStyle = up ? upC : dnC; g.fillStyle = up ? upC : dnC;
      g.globalAlpha = future ? 1 : 0.92;
      g.lineWidth = Math.max(1, Math.min(bodyW * 0.18, 2));
      g.beginPath(); g.moveTo(Math.round(x) + 0.5, Y(b.h)); g.lineTo(Math.round(x) + 0.5, Y(b.l)); g.stroke();
      const top = Math.min(Y(b.o), Y(b.c));
      g.fillRect(x - bodyW / 2, top, bodyW, Math.max(Math.abs(Y(b.c) - Y(b.o)), 1.2));
      g.globalAlpha = 1;
    }

    const preVolAvg = mean(sc.bars.slice(Math.max(0, sc.decision - 25), Math.max(1, sc.decision - 6)).map((b) => b.v)) || 1;
    const vMax = Math.max.apply(null, shown.map((b) => b.v)) || 1;
    for (let i = 0; i < shown.length; i++) {
      const b = shown[i], hgt = Math.max(1, (b.v / vMax) * volH);
      g.fillStyle = b.c >= b.o ? upC : dnC;
      g.globalAlpha = b.v > preVolAvg * 1.6 ? 0.85 : 0.4;
      g.fillRect(X(i) - bodyW / 2, yVol - hgt, bodyW, hgt);
    }
    g.globalAlpha = 1;
    const avgY = yVol - (preVolAvg / vMax) * volH;
    g.strokeStyle = css('--muted'); g.setLineDash([3, 3]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, Math.round(avgY) + 0.5); g.lineTo(x1, Math.round(avgY) + 0.5); g.stroke(); g.setLineDash([]);
    g.fillStyle = css('--muted'); g.font = '9px ' + css('--mono'); g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('avg vol', x1 + 6, avgY);

    const dx = Math.round(X(sc.decision) - bw / 2) + 0.5;
    g.strokeStyle = 'rgba(255,255,255,.45)'; g.setLineDash([4, 4]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(dx, y0); g.lineTo(dx, yVol); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '10px system-ui'; g.textAlign = 'right';
    const sweepNearTop = sc.family !== 'trend' && sc.sweepIdx != null && Math.abs(X(sc.sweepIdx) - dx) < 70 && Y(sc.sweep) < y0 + 40;
    if (sweepNearTop) { g.textBaseline = 'bottom'; g.fillText('you are here', dx - 4, y1 - 3); }
    else { g.textBaseline = 'top'; g.fillText('you are here', dx - 4, y0 + 2); }

    if (sc.family !== 'trend' && sc.sweepIdx != null) {
      const sy = Y(sc.sweep), sx = X(sc.sweepIdx);
      g.fillStyle = css('--warn');
      g.beginPath();
      const dn = sc.k > 0 ? 1 : -1;
      g.moveTo(sx, sy + dn * 4); g.lineTo(sx - 4, sy + dn * 10); g.lineTo(sx + 4, sy + dn * 10);
      g.closePath(); g.fill();
      g.font = '9px system-ui'; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText('sweep ' + px(sc.sweep), sx - 7, sy + dn * 8);
    }

    if (step === 'reveal' && sc.side) {
      const line = (p: number, col: string, lab: string, left: boolean) => {
        const y = Math.round(Y(p)) + 0.5;
        g.strokeStyle = col; g.setLineDash([3, 3]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]);
        g.fillStyle = col; g.font = '10px ' + css('--mono'); g.textBaseline = 'bottom';
        g.textAlign = left ? 'left' : 'right';
        g.fillText(lab, left ? x0 + 4 : x1 - 3, y - 2);
      };
      const sp = sc.stops.find((x) => x.key === stopPick);
      const close = !!sp && Math.abs(Y(sp.price) - Y(sc.entry)) < 14;
      line(sc.entry, '#ffffff', sc.side + ' from ' + px(sc.entry), close);
      if (sp) line(sp.price, dnC, 'your stop ' + px(sp.price), false);
    }
  }, [sc, reveal, step, stopPick]);

  useEffect(() => { draw(); }, [draw]);

  // The panel this chart lives in is kept mounted but hidden (not unmounted)
  // when another tab is active, so clientWidth is 0 at first mount if the
  // Pattern lab tab isn't the active one. A ResizeObserver catches the
  // moment it becomes visible (and any later resize) and redraws — mirrors
  // the pattern already used by Chart.tsx and MiniCharts.tsx.
  useEffect(() => {
    const c = ref.current;
    if (!c || !window.ResizeObserver) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(c);
    return () => ro.disconnect();
  }, [draw]);

  return <canvas ref={ref} id="dChart" />;
}

export default function PatternLab() {
  const { state, dispatch } = useStore();
  const pl = state.patternLab;
  const sc = pl.scenario;
  const spec = specFromSettings(state.settings);

  // the ~900ms pause after a call is made, before the stop-picker replaces
  // the (now disabled, right/wrong-highlighted) call options — matches the
  // original's setTimeout(renderPattern, 900) after answerCall().
  useEffect(() => {
    if (!sc || pl.step !== 'call' || pl.call == null) return;
    const t = window.setTimeout(() => { dispatch({ type: 'SET_DRILL_STEP', step: 'stop' }); }, 900);
    return () => window.clearTimeout(t);
  }, [sc, pl.step, pl.call, dispatch]);

  // reveal animation: step the bars in one at a time (respects reduced motion)
  useEffect(() => {
    if (pl.step !== 'reveal' || !sc) return;
    const max = sc.bars.length - sc.decision;
    if (pl.reveal >= max) return;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { dispatch({ type: 'REVEAL_TICK', amount: max }); return; }
    const t = window.setTimeout(() => dispatch({ type: 'REVEAL_TICK' }), 55);
    return () => window.clearTimeout(t);
  }, [pl.step, pl.reveal, sc, dispatch]);

  if (!sc) return <section className="panel" id="panel-drills" />;

  const aWord = sc.family === 'trend' ? 'exhaustion' : 'failed break';
  const bWord = sc.family === 'trend' ? 'continuation' : 'real break';
  const votes = (sc.facts.votes || []) as [string, 'trap' | 'real' | 'none'][];

  const statsKeys = Object.keys(pl.stats).sort();

  return (
    <section className="panel" id="panel-drills">
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <div className="seg" id="drillSeg">
          {MODES.map((m) => (
            <button key={m.key} aria-pressed={pl.mode === m.key} onClick={() => {
              dispatch({ type: 'SET_DRILL_MODE', mode: m.key });
              dispatch({ type: 'NEW_SCENARIO' });
            }}>{m.label}</button>
          ))}
        </div>
        <div className="spacer" />
        <label className="switch" title="Hide the measurements until after you call it">
          <input type="checkbox" checked={pl.hard} onChange={(e) => { dispatch({ type: 'SET_HARD', hard: e.target.checked }); dispatch({ type: 'NEW_SCENARIO' }); }} /> Hard mode
        </label>
        {pl.misses.length > 0 && <div className="chip">Review queue <b>{pl.misses.length}</b></div>}
        <div className="chip">Reads <b>{pl.correct} / {pl.asked}</b></div>
        <div className="chip">Streak <b>{pl.streak}{pl.best > pl.streak ? ' (best ' + pl.best + ')' : ''}</b></div>
      </div>

      <div className="sim side">
        <div className="chartwrap">
          <div className="chart-head">
            <div style={{ fontWeight: 650, fontSize: 14 }}>
              {pl.isReview && <span className="tag" style={{ borderColor: 'var(--warn)', color: 'var(--warn)', marginRight: 6 }}>review</span>}
              {sc.title}
            </div>
            <div className="spacer" />
            <div className="meta">{pl.step === 'call' ? 'decision point — what now?' : pl.step === 'stop' ? 'where does your risk go?' : 'outcome'}</div>
          </div>
          <DrillChart />
        </div>
        <aside style={{ display: 'grid', gap: 12 }}>
          <div className="card">
            <h3>What the tape is telling you</h3>
            {pl.hard && pl.step === 'call' ? (
              <p className="hint" style={{ margin: 0, lineHeight: 1.7 }}>
                <b style={{ color: 'var(--ink)' }}>Measurements hidden.</b><br />
                Read it off the chart: how far past the level did it go relative to the bars around it, how many candles <i>closed</i> beyond,
                did the volume bars expand or stay ordinary, and how long has it been content to sit there?<br /><br />
                The numbers appear as soon as you commit — that is the point. On a live chart nobody hands you a table.
              </p>
            ) : (
              <>
                {votes.map(([key, verdict]) => {
                  const meta = TELL_LABEL[key];
                  const w = verdict === 'trap' ? aWord : verdict === 'real' ? bWord : 'inconclusive';
                  return (
                    <div className="tell" key={key}>
                      <span className="tl">{meta[0]}</span>
                      <span><span className="tv">{meta[1](sc.facts)}</span> <span className={'tw t-' + verdict}>{w}</span></span>
                    </div>
                  );
                })}
                {sc.family !== 'trend' && (
                  <div className="tell"><span className="tl">Level tested before the break</span><span className="tv">{(sc.facts as LevelFacts).tests}×</span></div>
                )}
                <p className="hint" style={{ margin: '8px 0 0' }}>ATR here is {sc.atr.toFixed(2)} pts — that is the yardstick. Points mean nothing on their own.</p>
                {pl.hard && pl.step !== 'call' && <p className="hint" style={{ margin: '6px 0 0', color: 'var(--accent)' }}>Revealed after your call.</p>}
              </>
            )}
          </div>
          <div className="card">
            {pl.step === 'call' && (
              <>
                <h3>{sc.question}</h3>
                {sc.options.map((o) => (
                  <button key={o.key} className={'opt' + (pl.call != null ? (o.key === sc.truth ? ' right' : (o.key === pl.call ? ' wrong' : '')) : '')}
                    disabled={pl.call != null}
                    onClick={() => dispatch({ type: 'ANSWER_CALL', key: o.key })}>
                    <b>{o.label}</b><span>{o.desc}</span>
                  </button>
                ))}
              </>
            )}
            {pl.step === 'stop' && (
              <>
                <h3>You are {sc.side!.toLowerCase()} from {px(sc.entry)}. Where is the stop?</h3>
                {sc.entryNote && <p className="hint" style={{ margin: '-2px 0 10px' }}>{sc.entryNote}</p>}
                {sc.stops.map((s) => (
                  <button key={s.key} className="opt" onClick={() => dispatch({ type: 'ANSWER_STOP', key: s.key })}>
                    <b>{s.label}</b><span>{px(s.price)} · risking {Math.abs(sc.entry - s.price).toFixed(2)} pts</span>
                  </button>
                ))}
              </>
            )}
            {pl.step === 'reveal' && (
              <>
                <h3>Next one</h3>
                <button className="btn primary wide" onClick={() => dispatch({ type: 'NEW_SCENARIO' })}>New scenario ▸</button>
                <p className="hint" style={{ margin: '10px 0 0' }}>Chasing accuracy is the wrong goal here. The goal is that your reason for the call matches the four tells — being right for the wrong reason is what stops working.</p>
              </>
            )}
          </div>
        </aside>
      </div>

      <div style={{ marginTop: 12 }}>
        {pl.call != null && (
          <div dangerouslySetInnerHTML={{ __html: buildCallFeedback(sc, pl.call, pl.call === sc.truth) }} />
        )}
        {pl.step === 'reveal' && sc.bars.length - sc.decision === pl.reveal && (
          <div dangerouslySetInnerHTML={{ __html: buildOutcomeReveal(sc, pl.stopPick, pl.call === sc.truth, spec) }} />
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3>Accuracy by pattern</h3>
        {statsKeys.length === 0
          ? <p className="hint" style={{ margin: 0 }}>Call a few scenarios and your blind spot shows up here — most people are far better at spotting real breaks than failed ones, or the reverse, and never notice.</p>
          : (
            <>
              {statsKeys.map((k) => {
                const s = pl.stats[k];
                const pct = s.n ? (s.ok / s.n) * 100 : 0;
                return (
                  <div style={{ marginBottom: 9 }} key={k}>
                    <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
                      <span>{k}</span><b className="num">{pct.toFixed(0)}% <span className="hint">· {s.ok}/{s.n}</span></b>
                    </div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: pct + '%', background: pct >= 70 ? 'var(--up)' : pct >= 45 ? 'var(--warn)' : 'var(--down)' }} /></div>
                  </div>
                );
              })}
              {pl.hardAsked > 0 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span>Hard mode — chart only, no numbers</span><b className="num">{((pl.hardCorrect / pl.hardAsked) * 100).toFixed(0)}% <span className="hint">· {pl.hardCorrect}/{pl.hardAsked}</span></b>
                  </div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: (pl.hardCorrect / pl.hardAsked) * 100 + '%', background: 'var(--warn)' }} /></div>
                  <p className="hint" style={{ margin: '6px 0 0' }}>This is the number that matters. The easy-mode score measures whether you can read a table.</p>
                </div>
              )}
              {pl.stopN > 0 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span>Stop placed at the structure</span><b className="num">{((pl.stopOk / pl.stopN) * 100).toFixed(0)}% <span className="hint">· {pl.stopOk}/{pl.stopN}</span></b>
                  </div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: (pl.stopOk / pl.stopN) * 100 + '%' }} /></div>
                </div>
              )}
            </>
          )}
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>Anatomy of a failed breakdown (and how it differs from a real one)</summary>
        <div className="hint" style={{ marginTop: 8, fontSize: 13, lineHeight: 1.75 }}>
          A <b>failed breakdown</b> is not a pattern you see — it is a <i>sequence</i> you wait for. Price grinds along an obvious low that everyone can see.
          Resting sell-stops pile up under it. Something pushes price just far enough through to trigger them, those stops become market sell orders,
          and the traders who wanted to be long down there get filled by that forced selling. Then the selling is finished — because it was never real
          selling, it was <i>liquidation</i> — and price snaps back into the range. The snap-back is fast precisely because nobody is left to sell.<br /><br />
          The four things that separate a stop run from a real break, all visible at the moment of decision:<br />
          <b>1. Extension.</b> How far past the level did it travel, measured in ATRs, not points? A stop run rarely needs more than about one ATR.
          Real repricing runs further because new sellers keep hitting bids.<br />
          <b>2. Closes.</b> Wicks below a level are noise; <i>closes</i> below it are agreement. One or two closes beyond = still a run. Four, five,
          six consecutive closes beyond = the market has accepted the new price.<br />
          <b>3. Volume.</b> A break on ordinary volume is nobody&apos;s idea — it is stops. A break on 2× volume that keeps trading heavy is participation.<br />
          <b>4. Time.</b> Stop runs are quick. The longer price is content to sit beyond the level without bouncing, the more it is telling you it belongs there.<br /><br />
          <b>The trigger matters more than the read.</b> Being right that a breakdown failed is worth nothing if you buy while it is still falling.
          The entry is the <i>reclaim</i> — the first close back inside the level — and your risk is the low of the sweep. If that low breaks again,
          you were wrong, cheaply. Traders lose money on this pattern not by misreading it but by front-running it.<br /><br />
          <b>Reversals follow the same logic one level up.</b> An exhaustion reversal needs a stretched, tiring trend (distance from the mean),
          a climax (range and volume expansion on the final push) and then a trigger (a close back through the climax bar). Two out of three is a
          losing trade. A trend that is merely &quot;far up&quot; is not a reversal — it is a trend.
        </div>
      </details>
    </section>
  );
}
