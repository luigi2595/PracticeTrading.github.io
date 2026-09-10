// The "Journal" tab: filters, stat tiles, the five mini-charts, expectancy
// by setup tag, session history, the trade table, and manual-entry/backup
// import-export. Ported from part2.html's #panel-journal plus
// renderJournal()/renderByTag()/renderSessions() in part4a.js.
import React, { useMemo, useRef, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { computeStats } from '../lib/engine';
import { fmt$, fmtSigned$, sgnClass, px } from '../lib/spec';
import { exportTradesCsv, exportBackupJson, readFileAsText } from '../lib/io';
import { EquityChart, RHistChart, HourChart, ScatterChart, RollingChart } from './MiniCharts';
import type { Side, Trade } from '../lib/types';

const TABLE_CAP = 200;
const ROW_CAP = 300;

function ChartTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (!rows.length) return <p className="hint" style={{ margin: 0 }}>Nothing to tabulate yet.</p>;
  const total = rows.length;
  const shown = total > TABLE_CAP ? rows.slice(-TABLE_CAP) : rows;
  return (
    <>
      {total > TABLE_CAP && <p className="hint" style={{ margin: '0 0 6px' }}>Showing the most recent {TABLE_CAP} of {total} — <b>Export CSV</b> gives you every row.</p>}
      <div className="tablewrap">
        <table>
          <thead><tr>{head.map((h) => <th className="l" key={h}>{h}</th>)}</tr></thead>
          <tbody>{shown.map((r, i) => <tr key={i}>{r.map((c, j) => <td className="l num" key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

function ManualTradeForm({ onClose }: { onClose: () => void }) {
  const { dispatch } = useStore();
  const [timeIn, setTimeIn] = useState('09:45');
  const [timeOut, setTimeOut] = useState('10:05');
  const [side, setSide] = useState<Side>('Long');
  const [qty, setQty] = useState(1);
  const [entry, setEntry] = useState('');
  const [exitP, setExitP] = useState('');
  const [stop, setStop] = useState('');
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');

  const save = () => {
    const e = parseFloat(entry), x = parseFloat(exitP), s = parseFloat(stop);
    dispatch({
      type: 'ADD_MANUAL_TRADE', side, qty: Math.max(1, qty || 1), entry: e, exitP: x,
      stop: isFinite(s) && s ? s : null, timeIn, timeOut, tag, note,
    });
    onClose();
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h3>Log a trade by hand</h3>
      <div className="grid2">
        <div><label className="lbl">Time in (HH:MM)</label><input value={timeIn} onChange={(e) => setTimeIn(e.target.value)} /></div>
        <div><label className="lbl">Time out</label><input value={timeOut} onChange={(e) => setTimeOut(e.target.value)} /></div>
        <div><label className="lbl">Side</label>
          <select value={side} onChange={(e) => setSide(e.target.value as Side)}><option>Long</option><option>Short</option></select>
        </div>
        <div><label className="lbl">Contracts</label><input type="number" min={1} value={qty} onChange={(e) => setQty(parseInt(e.target.value, 10) || 1)} /></div>
        <div><label className="lbl">Entry</label><input type="number" step="0.25" placeholder="6842.25" value={entry} onChange={(e) => setEntry(e.target.value)} /></div>
        <div><label className="lbl">Exit</label><input type="number" step="0.25" placeholder="6848.00" value={exitP} onChange={(e) => setExitP(e.target.value)} /></div>
        <div><label className="lbl">Initial stop (for R)</label><input type="number" step="0.25" placeholder="6836.75" value={stop} onChange={(e) => setStop(e.target.value)} /></div>
        <div><label className="lbl">Setup tag</label><input placeholder="Trend pullback" value={tag} onChange={(e) => setTag(e.target.value)} /></div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="lbl">Note — what did you actually do right or wrong?</label>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={save}>Save trade</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export default function JournalPanel({ onReplayTrade }: { onReplayTrade: (id: number) => void }) {
  const { state, dispatch } = useStore();
  const [fltDir, setFltDir] = useState('');
  const [fltTag, setFltTag] = useState('');
  const [fltSrc, setFltSrc] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const fileImportRef = useRef<HTMLInputElement | null>(null);

  const list = useMemo(
    () => state.trades.filter((t) => (!fltDir || t.side === fltDir) && (!fltTag || t.tag === fltTag) && (!fltSrc || t.source === fltSrc)),
    [state.trades, fltDir, fltTag, fltSrc],
  );
  const st = useMemo(() => computeStats(list), [list]);
  const tags = useMemo(() => Array.from(new Set(state.trades.map((t) => t.tag).filter(Boolean))), [state.trades]);

  const tiles: [string, string, string, string][] = [
    ['Net P&L', fmtSigned$(st.net), sgnClass(st.net), st.n + ' trades · ' + fmt$(st.commissions, 0) + ' in fees'],
    ['Win rate', st.n ? st.winRate.toFixed(1) + '%' : '—', '', st.n ? st.wins + ' W / ' + st.losses + ' L' : ''],
    ['Expectancy', st.expR == null ? '—' : (st.expR >= 0 ? '+' : '−') + Math.abs(st.expR).toFixed(2) + 'R', st.expR == null ? '' : sgnClass(st.expR), st.n ? fmtSigned$(st.expD) + ' per trade' : ''],
    ['Profit factor', st.pf === Infinity ? '∞' : st.pf.toFixed(2), st.pf >= 1 ? 'pos' : 'neg', 'gross win ÷ gross loss'],
    ['Avg win / loss', st.n ? fmt$(st.avgWin, 0) + ' / ' + fmt$(st.avgLoss, 0) : '—', '', st.avgLoss ? (st.avgWin / st.avgLoss).toFixed(2) + ' payoff ratio' : ''],
    ['Max drawdown', fmt$(st.maxDD, 0), st.maxDD < 0 ? 'neg' : '', st.worstStreak + ' loss streak'],
    ['Capture',
      st.capture == null ? '—' : (st.capture < 0 ? '−' : '') + Math.abs(st.capture * 100).toFixed(0) + '%',
      st.capture == null ? '' : st.capture >= 0.4 ? 'pos' : st.capture >= 0.25 ? '' : 'neg',
      st.capture == null ? 'set a stop to measure this' : st.capture < 0 ? 'gave back more than the ' + st.avgAvail.toFixed(2) + 'R offered' : 'of the ' + st.avgAvail.toFixed(2) + 'R offered, per trade'],
  ];

  const byTagGroups = useMemo(() => {
    const groups: Record<string, Trade[]> = {};
    for (const t of list) { const k = t.tag || 'Untagged'; (groups[k] = groups[k] || []).push(t); }
    return groups;
  }, [list]);
  const byTagKeys = Object.keys(byTagGroups).sort((a, b) => computeStats(byTagGroups[b]).net - computeStats(byTagGroups[a]).net);
  const byTagMax = Math.max.apply(null, byTagKeys.map((k) => Math.abs(computeStats(byTagGroups[k]).net))) || 1;

  const shownTrades = list.slice().reverse().slice(0, ROW_CAP);

  const doImportJson = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const data = JSON.parse(text);
      if (!Array.isArray(data.trades)) throw new Error('no trades');
      dispatch({ type: 'IMPORT_TRADES_JSON', trades: data.trades, patternLab: data.patternLab });
    } catch {
      dispatch({ type: 'TOAST', text: 'That file did not look like a backup.' });
    }
  };

  return (
    <section className="panel" id="panel-journal">
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <select style={{ width: 'auto' }} value={fltDir} onChange={(e) => setFltDir(e.target.value)}>
          <option value="">All directions</option><option value="Long">Long only</option><option value="Short">Short only</option>
        </select>
        <select style={{ width: 'auto' }} value={fltTag} onChange={(e) => setFltTag(e.target.value)}>
          <option value="">All setups</option>{tags.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select style={{ width: 'auto' }} value={fltSrc} onChange={(e) => setFltSrc(e.target.value)}>
          <option value="">Sim + manual</option><option value="sim">Sim only</option><option value="manual">Manual only</option>
        </select>
        <div className="spacer" />
        <button className="btn sm" onClick={() => setShowAdd((v) => !v)}>+ Log a trade</button>
        <button className="btn sm" onClick={() => exportTradesCsv(state.trades)}>Export CSV</button>
        <button className="btn sm" onClick={() => exportBackupJson({
          version: 1, savedAt: new Date().toISOString(), trades: state.trades,
          patternLab: { stats: state.patternLab.stats, asked: state.patternLab.asked, correct: state.patternLab.correct, stopN: state.patternLab.stopN, stopOk: state.patternLab.stopOk },
        })}>Save backup</button>
        <button className="btn sm" onClick={() => fileImportRef.current?.click()}>Restore</button>
        <input ref={fileImportRef} type="file" accept=".json" className="sr" onChange={(e) => { const f = e.target.files?.[0]; if (f) doImportJson(f); e.target.value = ''; }} />
      </div>

      {showAdd && <ManualTradeForm onClose={() => setShowAdd(false)} />}

      <div className="tiles">
        {tiles.map(([label, val, cls, sub]) => (
          <div className="tile" key={label}>
            <div className="t-label">{label}</div>
            <div className={'t-val ' + cls}>{val}</div>
            <div className="t-sub">{sub}</div>
          </div>
        ))}
      </div>

      <div className="sim half" style={{ marginBottom: 12 }}>
        <div className="card"><h3>Equity curve (cumulative $)</h3><EquityChart list={list} />
          <details style={{ marginTop: 8, border: 'none', padding: 0, background: 'none' }}>
            <summary className="hint">View as a table</summary>
            <div style={{ marginTop: 8 }}>
              <ChartTable head={['#', 'Trade', 'Net', 'Cumulative']} rows={(() => { let run = 0; return list.map((t, i) => { run += t.net; return [i + 1, t.side + ' ' + t.qty + ' @ ' + px(t.entry), fmtSigned$(t.net), fmtSigned$(run)]; }); })()} />
            </div>
          </details>
        </div>
        <div className="card"><h3>R-multiple distribution</h3><RHistChart list={list} /></div>
      </div>

      <div className="sim half" style={{ marginBottom: 12 }}>
        <div className="card"><h3>Heat taken vs move offered</h3><ScatterChart list={list} />
          <p className="hint" style={{ margin: '8px 0 0' }}>Each dot is a trade. Far right = the market offered you a lot. Low down = it barely went against you first. Dots sitting on the dashed line were stopped out. A cluster of green dots low and right is what a good entry looks like; green dots far right but high up mean you are getting in early and paying for it.</p>
          <details style={{ marginTop: 8, border: 'none', padding: 0, background: 'none' }}>
            <summary className="hint">View as a table</summary>
            <div style={{ marginTop: 8 }}>
              <ChartTable head={['#', 'Move offered', 'Heat taken', 'Result']} rows={list.filter((t) => t.riskD > 0).map((t, i) => [i + 1, ((t.mfe! * 50 * t.qty) / t.riskD).toFixed(2) + 'R', ((Math.abs(t.mae!) * 50 * t.qty) / t.riskD).toFixed(2) + 'R', (t.R! >= 0 ? '+' : '−') + Math.abs(t.R!).toFixed(2) + 'R'])} />
            </div>
          </details>
        </div>
        <div className="card"><h3>Rolling expectancy</h3><RollingChart list={list} />
          <p className="hint" style={{ margin: '8px 0 0' }}>Average R over your last 20 trades. One bad day barely moves it; a drift below zero that persists is the signal that something in your process has changed.</p>
        </div>
      </div>

      <div className="sim half" style={{ marginBottom: 12 }}>
        <div className="card">
          <h3>Expectancy by setup tag</h3>
          {byTagKeys.length === 0
            ? <p className="hint" style={{ margin: 0 }}>Tag your trades in the ticket and the pattern shows up here fast — usually one tag is quietly paying for all the others.</p>
            : byTagKeys.map((k) => {
              const s = computeStats(byTagGroups[k]);
              const w = (Math.abs(s.net) / byTagMax) * 100;
              return (
                <div style={{ marginBottom: 9 }} key={k}>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span>{k} <span className="hint">· {s.n} trades · {s.winRate.toFixed(0)}% win</span></span>
                    <b className={'num ' + sgnClass(s.net)}>{fmtSigned$(s.net)}{s.expR != null ? ' · ' + (s.expR >= 0 ? '+' : '−') + Math.abs(s.expR).toFixed(2) + 'R' : ''}</b>
                  </div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: w + '%', background: s.net >= 0 ? 'var(--up)' : 'var(--down)' }} /></div>
                </div>
              );
            })}
        </div>
        <div className="card"><h3>Net P&amp;L by hour of day (ET)</h3><HourChart list={list} />
          <details style={{ marginTop: 8, border: 'none', padding: 0, background: 'none' }}>
            <summary className="hint">View as a table</summary>
            <div style={{ marginTop: 8 }}>
              <ChartTable head={['Hour', 'Net']} rows={(() => {
                const byHour: Record<string, number> = {};
                list.forEach((t) => { const k = (t.openedAt || '00:00').slice(0, 2); byHour[k] = (byHour[k] || 0) + t.net; });
                return Object.keys(byHour).sort().map((k) => [k + ':00', fmtSigned$(byHour[k])]);
              })()} />
            </div>
          </details>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3>Session history</h3>
        {state.sessions.length === 0
          ? <p className="hint" style={{ margin: 0 }}>Finish a session — play to the closing bell, or hit <b>End day</b> — and each day lands here with the one thing it told you to fix.</p>
          : state.sessions.slice().reverse().slice(0, 20).map((x, i) => (
            <div className="tell" key={i}>
              <span className="tl">{x.when} <span className="hint">· {x.n} trades · {x.capture != null ? (x.capture * 100).toFixed(0) + '% capture' : 'no capture data'}</span></span>
              <span><b className={'tv ' + sgnClass(x.net)}>{fmtSigned$(x.net)}</b> <span className="tag">{x.fix}</span></span>
            </div>
          ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="tablewrap" style={{ border: 'none', borderRadius: 0, maxHeight: 460, overflowY: 'auto' }}>
          <table>
            <thead><tr>
              <th className="l">#</th><th className="l">Time</th><th className="l">Side</th><th className="num">Qty</th>
              <th className="num">Entry</th><th className="num">Exit</th><th className="num">Pts</th><th className="num">Net $</th>
              <th className="num">R</th><th className="num">MAE</th><th className="num">MFE</th><th className="l">Exit</th>
              <th className="l">Setup</th><th className="l">Note</th><th /><th />
            </tr></thead>
            <tbody>
              {shownTrades.map((t) => (
                <tr key={t.id}>
                  <td className="l num">{t.id}</td>
                  <td className="l num">{t.openedAt || t.t}→{t.t}</td>
                  <td className="l"><span className={'tag ' + (t.side === 'Long' ? 'pos' : 'neg')}>{t.side}</span></td>
                  <td className="num">{t.qty}</td>
                  <td className="num">{px(t.entry)}</td>
                  <td className="num">{px(t.exit)}</td>
                  <td className={'num ' + sgnClass(t.pts)}>{t.pts >= 0 ? '+' : '−'}{Math.abs(t.pts).toFixed(2)}</td>
                  <td className={'num ' + sgnClass(t.net)}><b>{fmtSigned$(t.net)}</b></td>
                  <td className={'num ' + (t.R == null ? '' : sgnClass(t.R))}>{t.R == null ? '—' : (t.R >= 0 ? '+' : '−') + Math.abs(t.R).toFixed(2)}</td>
                  <td className="num">{t.mae == null ? '—' : t.mae.toFixed(2)}</td>
                  <td className="num">{t.mfe == null ? '—' : '+' + t.mfe.toFixed(2)}</td>
                  <td className="l">{t.reason}</td>
                  <td className="l"><span className="tag">{t.tag || 'Untagged'}</span></td>
                  <td className="l">
                    <input type="text" value={t.note || ''} placeholder="why?" style={{ minHeight: 26, padding: '2px 6px', fontSize: 12, minWidth: 130 }}
                      onChange={(e) => dispatch({ type: 'SET_TRADE_NOTE', id: t.id, note: e.target.value })} />
                  </td>
                  <td><button className="btn sm" title="Replay this trade" onClick={() => onReplayTrade(t.id)}>▶</button></td>
                  <td><button className="btn sm" title="Delete this trade" onClick={() => dispatch({ type: 'DELETE_TRADE', id: t.id })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length > ROW_CAP && (
          <p className="hint" style={{ padding: '8px 10px', margin: 0, borderTop: '1px solid var(--border)' }}>
            Showing your {ROW_CAP} most recent trades of {list.length}. The statistics above use all of them; Export CSV gives you every row.
          </p>
        )}
        {list.length === 0 && <div className="empty">No trades yet. Take some in the replay sim — they land here automatically.</div>}
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>How to read these numbers</summary>
        <div className="hint" style={{ marginTop: 8, fontSize: 13, lineHeight: 1.7 }}>
          <b>R</b> is the trade&apos;s result divided by the money you had at risk when you entered (stop distance × $50 × contracts). Thinking in R instead of dollars is the single fastest way to stop sizing emotionally.<br />
          <b>Expectancy</b> = average R per trade. Positive means the edge survives your losers. Anything above +0.15R with 50+ trades is a real, tradeable edge.<br />
          <b>Profit factor</b> = gross wins ÷ gross losses. Below 1.0 you are paying the market to practise; 1.3–1.6 is a solid intraday number.<br />
          <b>MAE</b> (max adverse excursion) = how far the trade went against you before it worked. If your winners rarely go more than 3 points against you, your stop is probably wider than it needs to be.<br />
          <b>MFE</b> (max favourable excursion) = how far it went your way. Winners with big MFE and small capture mean you&apos;re exiting early.
        </div>
      </details>
    </section>
  );
}

