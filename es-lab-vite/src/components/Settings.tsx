// The Settings tab: account & cost assumptions, the market generator (plus
// "bring your own bars" CSV import), display toggles, and data management
// (autosave status, backup export/import, forget/reset). Ported from the
// #panel-settings markup in part2.html and its wiring in part5.js.
import React, { useRef } from 'react';
import { useStore } from '../store/StoreContext';
import { freshSeed } from '../store/StoreContext';
import { parseBarsCSV } from '../lib/csv';
import { readFileAsText, exportBackupJson } from '../lib/io';
import { forgetSaved } from '../lib/persistence';

const VOL_OPTS = [
  { v: 0.6, label: 'Quiet (summer grind)' },
  { v: 1, label: 'Normal' },
  { v: 1.8, label: 'Busy (CPI / FOMC day)' },
  { v: 3, label: 'Wild (news shock)' },
];
const OR_OPTS = [
  { v: 5, label: 'First 5 minutes' },
  { v: 15, label: 'First 15 minutes' },
  { v: 30, label: 'First 30 minutes' },
];
const SESS_OPTS = [
  { v: 390, label: 'Full RTH (6.5 h)' },
  { v: 150, label: 'Morning only (2.5 h)' },
  { v: 60, label: 'Power hour (1 h)' },
];

export default function Settings() {
  const { state, dispatch } = useStore();
  const { settings } = state;
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  const takesEffectNext = () => dispatch({ type: 'TOAST', text: 'Takes effect on the next session.' });

  const onImportFile = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const res = parseBarsCSV(text);
      dispatch({ type: 'SET_IMPORTED', sessions: res.sessions });
      dispatch({ type: 'SET_SETTINGS', patch: { useReal: true } });
      dispatch({ type: 'NEW_SESSION', keepSeed: true, quiet: false, randomSeed: freshSeed() });
      dispatch({
        type: 'TOAST',
        text: 'Loaded ' + res.sessions.length + ' session' + (res.sessions.length > 1 ? 's' : '') +
          (res.skipped ? ' · ' + res.skipped + ' rows skipped' : ''),
      });
    } catch (e) {
      dispatch({
        type: 'TOAST',
        text: 'Could not read that file — ' + ((e as Error).message || 'unknown error') +
          '. The app needs one row per bar with open, high, low and close columns.',
      });
    }
  };

  const onRestoreBackup = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const data = JSON.parse(text);
      if (!Array.isArray(data.trades)) throw new Error('no trades');
      dispatch({ type: 'IMPORT_TRADES_JSON', trades: data.trades, patternLab: data.patternLab });
    } catch {
      dispatch({ type: 'TOAST', text: 'That file did not look like a backup.' });
    }
  };

  const saveStatusText = (): React.ReactNode => {
    if (!state.saveStatus.available) {
      return (
        <>
          <span style={{ color: 'var(--down)' }}>
            Auto-save is off — this browser refused to store anything (private mode, an embedded viewer, or a full disk).
          </span>{' '}
          Your journal is being kept in memory only for this visit. Open the file directly in Safari or Chrome and it will save. Use <b>Save backup file</b> either way.
        </>
      );
    }
    if (!settings.autosave) return 'Auto-save is off. Nothing is being written to this browser.';
    if (!state.saveStatus.savedAt) return 'Nothing saved yet — the first trade or answer will write it.';
    return (
      <>
        Saved on this device · {state.trades.length} trades · {(state.saveStatus.size / 1024).toFixed(1)} KB.{' '}
        {state.saveStatus.trimmed ? (
          <span style={{ color: 'var(--warn)' }}>
            Storage filled up, so the oldest {state.saveStatus.trimmed} trades are no longer being saved — export a backup to keep them.
          </span>
        ) : null}{' '}
        Stays in this browser only — clearing site data wipes it, so keep the odd backup file.
      </>
    );
  };

  return (
    <section className="panel" id="panel-settings">
      <div className="sim half">
        <div className="card">
          <h3>Account &amp; costs</h3>
          <div className="grid2">
            <div>
              <label className="lbl" htmlFor="setEquity">Starting equity ($)</label>
              <input id="setEquity" type="number" step={1000} value={settings.equity}
                onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { equity: parseFloat(e.target.value) || 0 } })} />
            </div>
            <div>
              <label className="lbl" htmlFor="setComm">Commission per side / contract ($)</label>
              <input id="setComm" type="number" step={0.25} value={settings.commission}
                onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { commission: parseFloat(e.target.value) || 0 } })} />
            </div>
            <div>
              <label className="lbl" htmlFor="setSlip">Market-order slippage (ticks)</label>
              <input id="setSlip" type="number" step={1} min={0} value={settings.slipTicks}
                onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { slipTicks: parseFloat(e.target.value) || 0 } })} />
            </div>
            <div>
              <label className="lbl" htmlFor="setPointVal">Point value ($)</label>
              <input id="setPointVal" type="number" step={5} value={settings.pointValue}
                onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { pointValue: parseFloat(e.target.value) || 0 } })} />
            </div>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Set point value to <b>5</b> to practise the micro (MES) instead. Commission and slippage default to realistic retail numbers — leaving them at zero is the fastest way to build a strategy that only works in a simulator.
          </p>
        </div>

        <div className="card">
          <h3>Market generator</h3>
          <div className="grid2">
            <div>
              <label className="lbl" htmlFor="setBase">Starting price</label>
              <input id="setBase" type="number" step={25} value={settings.base}
                onChange={(e) => { dispatch({ type: 'SET_SETTINGS', patch: { base: parseFloat(e.target.value) || 0 } }); takesEffectNext(); }} />
            </div>
            <div>
              <label className="lbl" htmlFor="setVol">Volatility</label>
              <select id="setVol" value={settings.volMult}
                onChange={(e) => { dispatch({ type: 'SET_SETTINGS', patch: { volMult: parseFloat(e.target.value) } }); takesEffectNext(); }}>
                {VOL_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="lbl" htmlFor="setSeed">Seed (blank = random)</label>
              <input id="setSeed" type="text" placeholder="e.g. 42" value={settings.seedText}
                onChange={(e) => { dispatch({ type: 'SET_SETTINGS', patch: { seedText: e.target.value } }); takesEffectNext(); }} />
            </div>
            <div>
              <label className="lbl" htmlFor="setOR">Opening range</label>
              <select id="setOR" value={settings.orMinutes}
                onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { orMinutes: parseInt(e.target.value, 10) } })}>
                {OR_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="lbl" htmlFor="setSess">Session length</label>
              <select id="setSess" value={settings.sessionMinutes}
                onChange={(e) => { dispatch({ type: 'SET_SETTINGS', patch: { sessionMinutes: parseInt(e.target.value, 10) } }); takesEffectNext(); }}>
                {SESS_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <label className="switch">
              <input type="checkbox" id="setUseReal" disabled={!state.imported || !state.imported.length}
                checked={settings.useReal}
                onChange={(e) => {
                  dispatch({ type: 'SET_SETTINGS', patch: { useReal: e.target.checked } });
                  dispatch({ type: 'NEW_SESSION', keepSeed: false, quiet: false, randomSeed: freshSeed() });
                }} />
              {' '}Replay my own bars instead of generated ones
            </label>
            <div className="row wrap" style={{ marginTop: 8 }}>
              <button className="btn sm" id="btnImportBars" onClick={() => fileRef.current?.click()}>Load a CSV of ES bars</button>
              {state.imported && state.imported.length ? (
                <select id="importPick" style={{ width: 'auto' }} value={state.importIdx}
                  onChange={(e) => {
                    dispatch({ type: 'SET_IMPORT_IDX', idx: parseInt(e.target.value, 10) });
                    dispatch({ type: 'NEW_SESSION', keepSeed: true, quiet: false, randomSeed: freshSeed() });
                  }}>
                  {state.imported.map((d, i) => <option key={i} value={i}>{d.label}</option>)}
                </select>
              ) : null}
              {state.imported && state.imported.length ? (
                <button className="btn sm" id="btnClearBars" onClick={() => {
                  dispatch({ type: 'CLEAR_IMPORTED' });
                  dispatch({ type: 'NEW_SESSION', keepSeed: false, quiet: false, randomSeed: freshSeed() });
                  dispatch({ type: 'TOAST', text: 'Back to generated sessions.' });
                }}>Clear</button>
              ) : null}
              <input ref={fileRef} type="file" id="fileBars" accept=".csv,.txt" className="sr"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ''; }} />
            </div>
            <label className="switch" style={{ marginTop: 8 }}>
              <input type="checkbox" id="setCombine" checked={settings.combineDays}
                onChange={(e) => {
                  dispatch({ type: 'SET_SETTINGS', patch: { combineDays: e.target.checked } });
                  dispatch({ type: 'NEW_SESSION', keepSeed: false, quiet: false, randomSeed: freshSeed() });
                }} />
              {' '}Replay every loaded day as one continuous chart
            </label>
            <p className="hint" id="importStatus" style={{ marginTop: 8 }}>
              {state.imported && state.imported.length ? (
                <>
                  <b style={{ color: 'var(--ink)' }}>{state.imported.length} session{state.imported.length > 1 ? 's' : ''} loaded.</b>{' '}
                  Real bars record only the open, high, low and close — not the order ticks arrived in — so within each bar the app walks open → one extreme → the other → close to decide whether your stop or your target was reached first.
                  That ordering is an assumption, and it is the one place imported replay is not literally what happened.
                </>
              ) : (
                'Export 1-minute bars from TradingView, NinjaTrader, Sierra or anything that writes CSV. It needs date, time, open, high, low, close and ideally volume — column order and header names are worked out for you, and multiple days are split into separate sessions automatically.'
              )}
            </p>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Same seed = same session, so you can replay one day repeatedly and test whether a different plan would have worked. Seed is shown on every new session. VWAP is anchored at the 09:30 open (RTH), the way most ES traders run it, and every level is computed only from bars that have already printed — the chart never knows the future.
          </p>
        </div>

        <div className="card">
          <h3>Display</h3>
          <label className="switch">
            <input type="checkbox" id="setCvd" checked={settings.cvd}
              onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { cvd: e.target.checked } })} />
            {' '}Colour-blind safe candles (blue / orange)
          </label>
          <label className="switch" style={{ marginTop: 8 }}>
            <input type="checkbox" id="setHideLevels" checked={settings.hideLevels}
              onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { hideLevels: e.target.checked } })} />
            {' '}Hide session open / prior close lines
          </label>
          <label className="switch" style={{ marginTop: 8 }}>
            <input type="checkbox" id="setAutoPause" checked={settings.autoPause}
              onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { autoPause: e.target.checked } })} />
            {' '}Auto-pause playback when a position closes
          </label>
          <label className="switch" style={{ marginTop: 8 }}>
            <input type="checkbox" id="setBeOnScale" checked={settings.beOnScale}
              onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { beOnScale: e.target.checked } })} />
            {' '}Move the stop to break-even after I scale out
          </label>
          <label className="switch" style={{ marginTop: 8 }}>
            <input type="checkbox" id="setDebrief" checked={settings.debriefOnEnd}
              onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { debriefOnEnd: e.target.checked } })} />
            {' '}Show me a debrief at the closing bell
          </label>
        </div>

        <div className="card">
          <h3>Data</h3>
          <label className="switch">
            <input type="checkbox" id="setAutosave" checked={settings.autosave}
              onChange={(e) => {
                const on = e.target.checked;
                dispatch({ type: 'SET_SETTINGS', patch: { autosave: on } });
                if (!on) { forgetSaved(); dispatch({ type: 'MARK_SAVE_STATUS', available: true, savedAt: null, size: 0, trimmed: 0 }); }
              }} />
            {' '}Auto-save my journal and stats to this browser
          </label>
          <p className="hint" id="saveStatus" style={{ margin: '10px 0 0' }}>{saveStatusText()}</p>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button className="btn sm" id="btnExportJson2" onClick={() => exportBackupJson({
              version: 1,
              savedAt: new Date().toISOString(),
              trades: state.trades,
              patternLab: { stats: state.patternLab.stats, asked: state.patternLab.asked, correct: state.patternLab.correct, stopN: state.patternLab.stopN, stopOk: state.patternLab.stopOk },
            })}>Save backup file</button>
            <button className="btn sm" id="btnImportJson2" onClick={() => backupRef.current?.click()}>Restore backup</button>
            <input ref={backupRef} type="file" id="fileImport" accept=".json" className="sr"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onRestoreBackup(f); e.target.value = ''; }} />
            <button className="btn sm" id="btnForget" onClick={() => {
              forgetSaved();
              dispatch({ type: 'MARK_SAVE_STATUS', available: true, savedAt: null, size: 0, trimmed: 0 });
              dispatch({ type: 'TOAST', text: 'Saved data cleared from this browser.' });
            }}>Forget saved data</button>
            <button className="btn sm" id="btnResetAll" onClick={() => {
              if (!window.confirm('Delete the journal, pattern-lab stats and current session?')) return;
              forgetSaved();
              dispatch({ type: 'RESET_ALL' });
              dispatch({ type: 'NEW_SESSION', keepSeed: false, quiet: false, randomSeed: freshSeed() });
              dispatch({ type: 'NEW_SCENARIO' });
              dispatch({ type: 'MARK_SAVE_STATUS', available: true, savedAt: null, size: 0, trimmed: 0 });
            }}>Reset everything</button>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Nothing is ever uploaded — this file has no network access. Auto-save writes to your own browser's storage on this device only.
          </p>
        </div>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>What this simulator does and does not teach</summary>
        <div className="hint" style={{ marginTop: 8, fontSize: 13, lineHeight: 1.7 }}>
          Synthetic price is built to have the <i>statistical texture</i> of an intraday ES session — volatility clustering, trending and choppy regimes, an active open and close, gaps, and occasional shocks. What it cannot contain is real market context: the actual news, the order flow, the levels other traders are watching. So treat it as a <b>flight simulator for execution and risk habits</b> — order placement, stop discipline, sizing, sitting through noise, not revenge trading — rather than a place to discover a strategy that will then work on the real ES.
          <br /><br />
          The reference levels are real in the sense that they are computed correctly from the session in front of you — VWAP, the opening range, session and overnight extremes. What synthetic data cannot give you is the <i>reason</i> a level matters on a given day: yesterday's rejection, an economic release, a big seller who keeps showing up at one price. So use the sim to build the habit of always knowing where price is relative to VWAP and the opening range, and get the context from real charts.
          <br /><br />
          Practising on synthetic data also can't reproduce the psychology of real money at risk, which is the part that breaks most traders. The usual bridge is: build the habits here → run the same rules on live data in a broker demo → trade one micro (MES, $5/point) with real money → scale only after a written, dated log of consistent results.
          <br /><br />
          Nothing here is trading advice, and futures trading can lose more than you deposit.
        </div>
      </details>
    </section>
  );
}
