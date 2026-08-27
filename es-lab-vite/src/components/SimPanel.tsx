// The "Replay sim" tab: banner, chart + its control rows, and the info
// sidebar. Ported from the #panel-sim section of part1.html.
import React, { useEffect } from 'react';
import { useStore } from '../store/StoreContext';
import Chart from './Chart';
import OrderTicket from './OrderTicket';
import { LiveReadCard, LevelsCard, OrdersCard, PositionCard, AccountCard, DisciplineCard } from './SimSidebar';
import { computeLevels, maLabel } from '../lib/indicators';
import { lastPrice } from '../lib/session';
import { px, sgnClass, tfLabel } from '../lib/spec';
import type { LevelToggles } from '../lib/types';

const TFS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 240];
const SPEEDS = [1, 2, 5, 20];
const LVL_KEYS: { key: keyof LevelToggles; label: string }[] = [
  { key: 'vol', label: 'Volume' }, { key: 'vwap', label: 'VWAP' }, { key: 'bands', label: '±σ' },
  { key: 'or', label: 'ORB' }, { key: 'orbExt', label: 'ORB targets' }, { key: 'pd', label: 'PD H/L' },
  { key: 'on', label: 'O/N H/L' }, { key: 'sess', label: 'Sess H/L' },
];

const LVL_WHY: Record<string, string> = {
  vwap: 'VWAP is anchored at the session open, and there are no session bars yet. Press Play or Step and it will draw.',
  or: 'The opening range needs the first few minutes of the session. Press Play and it will appear.',
  orbExt: 'ORB targets project from the opening range, which has not formed yet.',
  bands: 'The σ bands are built from VWAP, which starts at the session open.',
  pd: 'Prior-day high and low are further away than the visible price range, so there is nothing on screen to show.',
  on: 'There are no overnight bars in this data, so there is no overnight high or low.',
  sess: 'The session high and low need session bars. Press Play.',
  vol: 'Volume is hidden.',
};

export default function SimPanel({ onOpenMaCfg }: { onOpenMaCfg: () => void }) {
  const { state, dispatch } = useStore();
  const { session } = state;

  // keyboard shortcuts, scoped to this tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag || '')) return;
      if (tag === 'BUTTON' && e.key === ' ') return;
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); dispatch({ type: 'PLACE_ORDER', side: 'Long' }); }
      else if (k === 's') { e.preventDefault(); dispatch({ type: 'PLACE_ORDER', side: 'Short' }); }
      else if (k === 'f') { e.preventDefault(); dispatch({ type: 'FLATTEN' }); }
      else if (e.key === ' ') { e.preventDefault(); dispatch({ type: 'TOGGLE_PLAY' }); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); dispatch({ type: 'STEP_BAR', now: new Date().toISOString() }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  const lp = session ? lastPrice(session, state.cursor, state.sub) : 0;
  const chg = session ? lp - session.priorClose : 0;
  const bar = session ? session.bars[Math.min(state.cursor, session.bars.length - 1)] : null;
  const LV = session ? computeLevels(session, state.cursor, state.sub, state.settings.orMinutes) : null;

  return (
    <section className="panel" id="panel-sim">
      <div id="simBanner">
        {state.locked && <div className="banner stop"><b>Trading locked.</b> {state.lockReason}</div>}
        {!state.locked && state.settings.lossLimit > 0 && state.realized < -state.settings.lossLimit * 0.6 && (
          <div className="banner warn">
            You are {'$' + Math.abs(state.realized).toFixed(0)} down — {'$' + (state.settings.lossLimit + state.realized).toFixed(0)} from your cap. This is where most damage gets done.
          </div>
        )}
      </div>
      <div className="sim">
        <div className="chartwrap">
          <div className="chart-head">
            <div className="last">{session ? px(lp) : '—'}</div>
            <div className="meta">
              {session ? (
                <span className={sgnClass(chg)}>{chg >= 0 ? '+' : '−'}{Math.abs(chg).toFixed(2)} ({chg >= 0 ? '+' : '−'}{Math.abs((chg / session.priorClose) * 100).toFixed(2)}%)</span>
              ) : '—'} vs prior close
            </div>
            <div className="spacer" />
            <div className="meta">
              {LV && LV.last != null && state.levels.vwap
                ? <>VWAP {px(LV.last)} · <span className={sgnClass(lp - LV.last)}>{lp - LV.last >= 0 ? '+' : '−'}{Math.abs(lp - LV.last).toFixed(2)}</span></>
                : null}
            </div>
            <div className="meta">{bar ? bar.t + ' ET' + (state.cursor < 60 ? ' · pre-open' : '') : '09:30 ET'}</div>
            <div className="seg" id="tfSeg">
              {TFS.map((tf) => (
                <button key={tf} aria-pressed={state.tf === tf} onClick={() => {
                  dispatch({ type: 'SET_TF', tf });
                  const a = session ? Math.floor(state.cursor / tf) : 0;
                  if (a < 6) dispatch({ type: 'TOAST', text: tfLabel(tf) + ' bars need more history than this session has so far — only ' + a + ' so far.' });
                }}>{tfLabel(tf)}</button>
              ))}
            </div>
          </div>
          <Chart />
          <div className="playbar" style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '6px 8px' }}>
            <span className="hint" style={{ marginRight: 2 }}>Levels</span>
            <div className="seg" id="maSeg" style={{ marginRight: 6 }}>
              {state.mas.map((m, i) => (
                <button key={i} aria-pressed={m.on} onClick={() => dispatch({ type: 'TOGGLE_MA', index: i })}>{maLabel(m)}</button>
              ))}
            </div>
            <button className="btn sm" title="Change the moving averages" onClick={onOpenMaCfg}>MA…</button>
            <button className="btn sm" aria-pressed={state.drawing} title="Click the chart to drop a level"
              onClick={() => { dispatch({ type: 'TOGGLE_DRAWING' }); dispatch({ type: 'TOAST', text: !state.drawing ? 'Tap the chart to drop a level. Tap a level again to remove it.' : 'Drawing off.' }); }}>
              ✎ Levels
            </button>
            <div className="seg" id="lvlSeg">
              {LVL_KEYS.map(({ key, label }) => (
                <button key={key} aria-pressed={state.levels[key]} onClick={() => {
                  dispatch({ type: 'TOGGLE_LEVEL', key });
                  if (!state.levels[key] && LVL_WHY[key]) dispatch({ type: 'TOAST', text: LVL_WHY[key] });
                }}>{label}</button>
              ))}
            </div>
          </div>
          <div className="playbar">
            <button className="btn" title="Space" onClick={() => dispatch({ type: 'TOGGLE_PLAY' })}>{state.playing ? '❚❚ Pause' : '▶ Play'}</button>
            <button className="btn" title="Right arrow" onClick={() => dispatch({ type: 'STEP_BAR', now: new Date().toISOString() })}>Step ▸</button>
            <div className="seg" id="speedSeg">
              {SPEEDS.map((sp) => (
                <button key={sp} aria-pressed={state.speed === sp} onClick={() => dispatch({ type: 'SET_SPEED', speed: sp })}>{sp}×</button>
              ))}
            </div>
            <div className="spacer" />
            <button className="btn" onClick={() => dispatch({ type: 'NEW_SESSION', keepSeed: false, quiet: false, randomSeed: (Math.random() * 4294967295) >>> 0 })}>↺ New session</button>
          </div>
        </div>

        <aside style={{ display: 'grid', gap: 12 }}>
          <OrderTicket />
          <LiveReadCard />
          <LevelsCard />
          <OrdersCard />
          <PositionCard />
          <AccountCard />
          <DisciplineCard />
        </aside>
      </div>
    </section>
  );
}
