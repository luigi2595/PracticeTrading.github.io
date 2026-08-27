// React context + provider for the sim store. Owns the three effects the
// original app ran as free-floating global code: the replay play-loop
// (part4a.js loop()/advance()), the debounced localStorage autosave
// (part5.js saveState()), and the one-time boot sequence (part5.js's
// trailing try{...} block: loadState → newSession → newScenario).
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { reducer, sessionTradesOf } from './reducer';
import type { Action } from './reducer';
import { initialState } from './state';
import type { SimState } from './state';
import { clamp } from '../lib/spec';
import { loadPayload, saveWithTrim, storageAvailable, STORE_KEY } from '../lib/persistence';
import type { SavePayload } from '../lib/persistence';

interface StoreContextValue {
  state: SimState;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function nowIso(): string {
  return new Date().toISOString();
}
/** Matches the original's `new Date().toISOString().slice(0,16).replace('T',' ')`
 *  used for a session-summary's human-readable timestamp. */
export function nowStamp(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}
export function freshSeed(): number {
  return (Math.random() * 4294967295) >>> 0;
}

function buildSavePayload(state: SimState): SavePayload {
  return {
    v: 1,
    savedAt: nowIso(),
    trades: state.trades,
    sessions: state.sessions,
    pl: {
      stats: state.patternLab.stats, asked: state.patternLab.asked, correct: state.patternLab.correct,
      best: state.patternLab.best, stopN: state.patternLab.stopN, stopOk: state.patternLab.stopOk,
      hardAsked: state.patternLab.hardAsked, hardCorrect: state.patternLab.hardCorrect, hard: state.patternLab.hard,
    },
    settings: state.settings, levels: state.levels, mas: state.mas, userLevels: state.userLevels, tf: state.tf,
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const bootedRef = useRef(false);

  // ---- one-time boot: restore any save, then always start a fresh session ----
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const payload = loadPayload();
    if (payload) dispatch({ type: 'LOAD_PERSISTED', payload });
    dispatch({ type: 'NEW_SESSION', keepSeed: false, quiet: true, randomSeed: freshSeed() });
    dispatch({ type: 'NEW_SCENARIO' });
  }, []);

  // ---- the replay play-loop: a self-rescheduling timer, exactly like the
  // original's recursive setTimeout(loop, ms) ----
  useEffect(() => {
    if (!state.playing || !state.session) return;
    if (state.cursor >= state.session.bars.length) return;
    const ms = clamp(420 / state.speed, 12, 500);
    const id = window.setTimeout(() => dispatch({ type: 'ADVANCE', now: nowIso() }), ms);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.playing, state.speed, state.cursor, state.sub, state.session]);

  // ---- debounced autosave ----
  const saveDeps = useMemo(
    () => JSON.stringify({ n: state.trades.length, s: state.sessions.length, pl: state.patternLab, settings: state.settings, levels: state.levels, mas: state.mas, userLevels: state.userLevels, tf: state.tf }),
    [state.trades, state.sessions, state.patternLab, state.settings, state.levels, state.mas, state.userLevels, state.tf],
  );
  useEffect(() => {
    if (!state.settings.autosave) return;
    if (!storageAvailable()) {
      dispatch({ type: 'MARK_SAVE_STATUS', available: false, savedAt: null, size: 0, trimmed: 0 });
      return;
    }
    const t = window.setTimeout(() => {
      const build = (trades: SimState['trades']) => JSON.stringify({ ...buildSavePayload(state), trades });
      const result = saveWithTrim(build, state.trades);
      if (result.ok) {
        let size = 0;
        try { size = (window.localStorage.getItem(STORE_KEY) || '').length; } catch { /* ignore */ }
        dispatch({ type: 'MARK_SAVE_STATUS', available: true, savedAt: nowIso(), size, trimmed: result.trimmed });
      } else {
        dispatch({ type: 'MARK_SAVE_STATUS', available: false, savedAt: null, size: 0, trimmed: 0 });
      }
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveDeps, state.settings.autosave]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside a StoreProvider');
  return ctx;
}

/** This session's trades only (for the debrief / "end of day" views). */
export function useSessionTrades(): SimState['trades'] {
  const { state } = useStore();
  return useMemo(() => sessionTradesOf(state), [state.trades, state.sessionStartIdx]);
}
