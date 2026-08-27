// The app shell: header chips + tabs, the four panels (kept mounted, toggled
// via the native `hidden` attribute exactly like the original's
// `.panel[hidden]{display:none}` CSS), the mobile bar, the modal layer, and
// toast/announcer. Ported from part1.html's <header>/<main> structure and
// the tab-switching logic in part5.js's bind().
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from './store/StoreContext';
import { specFromSettings } from './store/reducer';
import { totalNet, openPnl } from './lib/engine';
import { lastPrice } from './lib/session';
import { fmt$, fmtSigned$, sgnClass } from './lib/spec';
import { seenBefore, markSeen } from './lib/persistence';
import SimPanel from './components/SimPanel';
import JournalPanel from './components/JournalPanel';
import PatternLab from './components/PatternLab';
import Settings from './components/Settings';
import MobileBar from './components/MobileBar';
import StatusLayer from './components/StatusLayer';
import { WelcomeModal, MaCfgModal, ReplayModal, DebriefModal } from './components/Modals';

type Tab = 'sim' | 'journal' | 'drills' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'sim', label: 'Replay sim' },
  { id: 'journal', label: 'Journal' },
  { id: 'drills', label: 'Pattern lab' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<Tab>('sim');
  const [maCfgOpen, setMaCfgOpen] = useState(false);
  const [replayTradeId, setReplayTradeId] = useState<number | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const lastDebriefId = useRef(state.debriefRequestId);
  const [debriefOpen, setDebriefOpen] = useState(false);

  // first-run welcome, exactly like the original's `if (!seenBefore()) showWelcome()`
  useEffect(() => { if (!seenBefore()) setWelcomeOpen(true); }, []);

  // colour-blind-safe candle palette is a CSS attribute on <html>, not React state
  useEffect(() => {
    document.documentElement.setAttribute('data-cvd', state.settings.cvd ? 'on' : 'off');
  }, [state.settings.cvd]);

  // pop the debrief automatically whenever the store bumps debriefRequestId
  // (a natural session end with "show a debrief" on, or "End day")
  useEffect(() => {
    if (state.debriefRequestId !== lastDebriefId.current) {
      lastDebriefId.current = state.debriefRequestId;
      if (state.settings.debriefOnEnd) setDebriefOpen(true);
    }
  }, [state.debriefRequestId, state.settings.debriefOnEnd]);

  const spec = specFromSettings(state.settings);
  const last = state.session ? lastPrice(state.session, state.cursor, state.sub) : 0;
  const pnl = openPnl(state.position, last, spec);
  const eq = state.startEquity + totalNet(state.trades) + pnl;
  const day = state.realized + pnl;

  const closeWelcome = () => { setWelcomeOpen(false); markSeen(); };

  return (
    <>
      <header className="top">
        <div className="top-row">
          <div className="brand">ES Practice Lab <span>· E-mini S&amp;P 500</span></div>
          <div className="spacer" />
          <div className="chip">Equity <b id="chipEquity">{fmt$(eq, 0)}</b></div>
          <div className="chip">Day <b id="chipDay" className={'num ' + sgnClass(day)}>{fmtSigned$(day)}</b></div>
          <div className="chip" id="chipPos">
            {state.position ? <b className={state.position.side === 'Long' ? 'pos' : 'neg'}>{state.position.side} {state.position.qty}</b> : 'Flat'}
          </div>
          <button className="helpbtn" id="btnHelp" title="What is this?" aria-label="What is this?" onClick={() => setWelcomeOpen(true)}>?</button>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} data-tab={t.id} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
      </header>

      <main>
        <div hidden={tab !== 'sim'}><SimPanel onOpenMaCfg={() => setMaCfgOpen(true)} /></div>
        <div hidden={tab !== 'journal'}><JournalPanel onReplayTrade={setReplayTradeId} /></div>
        <div hidden={tab !== 'drills'}><PatternLab /></div>
        <div hidden={tab !== 'settings'}><Settings /></div>
      </main>

      <MobileBar activeTab={tab} onScrollToTicket={() => {
        const el = document.querySelector('#panel-sim aside');
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }} />

      <StatusLayer />

      <WelcomeModal open={welcomeOpen} onClose={closeWelcome} onStart={() => { closeWelcome(); setTab('drills'); }} />
      <MaCfgModal open={maCfgOpen} onClose={() => setMaCfgOpen(false)} />
      <ReplayModal tradeId={replayTradeId} onClose={() => setReplayTradeId(null)} />
      <DebriefModal
        open={debriefOpen}
        onClose={() => setDebriefOpen(false)}
        onNewSession={() => {
          setDebriefOpen(false);
          dispatch({ type: 'NEW_SESSION', keepSeed: false, quiet: false, randomSeed: (Math.random() * 4294967295) >>> 0 });
        }}
        onOpenJournal={() => { setDebriefOpen(false); setTab('journal'); }}
      />
    </>
  );
}
