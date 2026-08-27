// The replay chart. A close, deliberate port of part3.js's drawChart() —
// same geometry, same layering order, same "why is this level missing"
// affordances — redrawn imperatively on a <canvas> inside a React component
// rather than as free functions closing over globals. Mouse/touch handling
// (crosshair, click-to-draw-a-level, tap-to-remove) is wired the same way
// the original's `bind()` wired `cv`.
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store/StoreContext';
import { specFromSettings } from '../store/reducer';
import { displayBars, lastPrice } from '../lib/session';
import { computeLevels, computeMA, maLabel } from '../lib/indicators';
import { PAT_COLOR } from '../lib/patterns';
import { clamp, px, fmtAxis, fmtVol, tfLabel, roundTick } from '../lib/spec';
import type { Bar } from '../lib/types';

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

interface LevelChip { price: number; x: number; y: number; w: number; h: number }
interface ChartGeom {
  x0: number; x1: number; y0: number; y1: number; yVol: number;
  lo: number; hi: number; bw: number;
  bars: Bar[];
  levelChips: LevelChip[];
}

const emptyGeom: ChartGeom = { x0: 0, x1: 0, y0: 0, y1: 0, yVol: 0, lo: 0, hi: 1, bw: 6, bars: [], levelChips: [] };

export default function Chart() {
  const { state, dispatch } = useStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const geomRef = useRef<ChartGeom>(emptyGeom);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const session = state.session;
    if (!cv || !session) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const spec = specFromSettings(state.settings);
    const LVL = state.levels;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, css('--chart-top')); g.addColorStop(1, css('--chart-bot'));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }

    const padR = 66, padB = 22, padT = 8, padL = 6;
    const volH = LVL.vol ? Math.max(32, Math.min(96, h * (w < 620 ? 0.15 : 0.19))) : 0;
    const x0 = padL, x1 = w - padR, y0 = padT;
    const timeY = h - padB;
    const yVol = volH ? timeY - 3 : timeY;
    const y1 = volH ? yVol - volH - 12 : timeY;
    const plotW = x1 - x0, plotH = y1 - y0;

    const all = displayBars(session, state.cursor, state.sub, state.tf);
    const minBW = w < 560 ? 4 : 5.5;
    const maxBars = Math.max(20, Math.floor(plotW / minBW));
    const bars = all.slice(Math.max(0, all.length - maxBars));
    if (!bars.length) return;
    const LV = computeLevels(session, state.cursor, state.sub, state.settings.orMinutes);
    const drawn: Record<string, boolean> = {};

    let lo = Infinity, hi = -Infinity;
    for (const b of bars) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
    const P = state.position;
    if (P) {
      if (P.hasStop !== false) { lo = Math.min(lo, P.stop); hi = Math.max(hi, P.stop); }
      if (P.hasTarget !== false) { lo = Math.min(lo, P.target); hi = Math.max(hi, P.target); }
    }
    for (const o of state.orders) { lo = Math.min(lo, o.price); hi = Math.max(hi, o.price); }
    {
      const span0 = Math.max(hi - lo, 1), mid0 = (hi + lo) / 2;
      for (const uv of state.userLevels) if (Math.abs(uv - mid0) < span0 * 0.9) { lo = Math.min(lo, uv); hi = Math.max(hi, uv); }
    }
    if (!state.settings.hideLevels) {
      const span = Math.max(hi - lo, 1), mid = (hi + lo) / 2;
      const cand: (number | null | undefined)[] = [session.priorClose, session.openPrice];
      if (LV) {
        if (LVL.vwap && LV.last != null) cand.push(LV.last);
        if (LVL.or) cand.push(LV.orHi, LV.orLo);
        if (LVL.pd) cand.push(LV.pdHigh, LV.pdLow);
        if (LVL.on) cand.push(LV.onHi, LV.onLo);
      }
      for (const lv of cand) {
        if (lv == null || !isFinite(lv)) continue;
        if (Math.abs(lv - mid) < span * 0.85) { lo = Math.min(lo, lv); hi = Math.max(hi, lv); }
      }
    }
    const pad = Math.max((hi - lo) * 0.08, 1);
    lo -= pad; hi += pad;

    const bw = plotW / bars.length;
    const Y = (p: number) => y1 - (p - lo) / (hi - lo) * plotH;
    const X = (idx: number) => x0 + idx * bw + bw / 2;
    const legend2: [string, string, string][] = [];

    // session shading
    {
      const rs = session.rthStart == null ? 0 : session.rthStart;
      // `pre` is optional on Bar, so read it through a helper that always
      // returns a boolean — same rule as the original (an explicit flag wins,
      // otherwise anything before the RTH start index counts as pre-market).
      const isPre = (b: Bar): boolean => (b.pre != null ? b.pre : b.i < rs);
      let runStart = 0, runPre = isPre(bars[0]);
      const paint = (a: number, b2: number, pre: boolean) => {
        if (pre) return;
        ctx.fillStyle = 'rgba(30,130,104,.10)';
        ctx.fillRect(x0 + a * bw, y0, (b2 - a) * bw, y1 - y0);
      };
      for (let i = 1; i <= bars.length; i++) {
        const pre = i < bars.length ? isPre(bars[i]) : !runPre;
        if (pre !== runPre || i === bars.length) {
          paint(runStart, i, runPre);
          if (!pre && runPre) {
            const bx = Math.round(x0 + i * bw) + 0.5;
            ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(bx, y0); ctx.lineTo(bx, timeY); ctx.stroke();
            ctx.setLineDash([]);
          }
          runStart = i; runPre = pre;
        }
      }
    }

    // grid + price axis
    const gridC = css('--chart-grid'), mutedC = css('--muted'), axisC = css('--chart-axis');
    const range = hi - lo;
    let stepP = Math.pow(10, Math.floor(Math.log10(range / 5)));
    const mult = range / 5 / stepP;
    stepP *= mult > 5 ? 10 : mult > 2 ? 5 : mult > 1 ? 2 : 1;
    const gridLabels: [string, number][] = [];
    ctx.font = '11px ' + css('--mono');
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (let p = Math.ceil(lo / stepP) * stepP; p < hi; p += stepP) {
      const y = Y(p);
      ctx.strokeStyle = gridC; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1, Math.round(y) + 0.5); ctx.stroke();
      gridLabels.push([fmtAxis(p), y]);
    }

    // time axis
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const labelEvery = Math.max(1, Math.round(bars.length / (w < 560 ? 4 : 8)));
    for (let i = 0; i < bars.length; i++) {
      if (i % labelEvery !== 0) continue;
      const x = X(i);
      ctx.strokeStyle = gridC; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y0); ctx.lineTo(Math.round(x) + 0.5, timeY); ctx.stroke();
      ctx.fillStyle = mutedC;
      const halfW = ctx.measureText(bars[i].t).width / 2;
      ctx.fillText(bars[i].t, clamp(x, x0 + halfW, x1 - halfW), timeY + 5);
    }
    ctx.strokeStyle = axisC; ctx.beginPath(); ctx.moveTo(x0, timeY + 0.5); ctx.lineTo(x1, timeY + 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(Math.round(x1) + 0.5, y0); ctx.lineTo(Math.round(x1) + 0.5, timeY); ctx.stroke();

    const tagRows = [Y(lastPrice(session, state.cursor, state.sub))];
    const axisTag = (y: number, color: string, text: string, solid: boolean) => {
      if (y < y0 + 8 || y > timeY - 8) return;
      for (const r of tagRows) if (Math.abs(r - y) < 15) return;
      tagRows.push(y);
      ctx.font = '10.5px ' + css('--mono'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const tw = padR - 3;
      ctx.fillStyle = css('--chart-bot'); ctx.fillRect(x1 + 1, y - 8, tw, 16);
      if (solid) { ctx.fillStyle = color; ctx.fillRect(x1 + 1, y - 8, tw, 16); ctx.fillStyle = '#06121a'; }
      else {
        ctx.fillStyle = 'rgba(8,16,20,.94)'; ctx.fillRect(x1 + 1, y - 8, tw, 16);
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x1 + 1.5, y - 7.5, tw - 1, 15);
        ctx.fillStyle = color;
      }
      ctx.fillText(text, x1 + 5, y);
    };

    const usedY: number[] = [];
    const roomFor = (y: number) => { for (const u of usedY) if (Math.abs(u - y) < 11) return false; usedY.push(y); return true; };
    const refLine = (price: number | null | undefined, color: string, label: string, dashed: number[] | null, key?: string) => {
      if (price == null || !isFinite(price) || price < lo || price > hi) return;
      if (key) drawn[key] = true;
      const y = Math.round(Y(price)) + 0.5;
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = 0.85;
      if (dashed) ctx.setLineDash(dashed);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      axisTag(y, color, fmtAxis(price), false);
      if (!label || !roomFor(y)) return;
      ctx.font = '10px ' + css('--mono'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(8,16,20,.82)'; ctx.fillRect(x0 + 2, y - 7, tw + 8, 14);
      ctx.fillStyle = color; ctx.fillText(label, x0 + 6, y);
    };

    const levelChips: LevelChip[] = [];
    if (!state.settings.hideLevels) {
      refLine(session.priorClose, '#6f6e68', 'prior close', [5, 4]);
      if (LV && LV.started) refLine(session.openPrice, '#6f6e68', 'RTH open', [5, 4]);
      if (LVL.pd && LV) { refLine(LV.pdHigh, '#898781', 'PDH', [7, 4], 'pd'); refLine(LV.pdLow, '#898781', 'PDL', [7, 4], 'pd'); }
      if (LVL.on && LV) { refLine(LV.onHi, '#9085e9', 'ON high', [4, 4], 'on'); refLine(LV.onLo, '#9085e9', 'ON low', [4, 4], 'on'); }
      if (LVL.or && LV) {
        const tag = LV.orLocked ? '' : ' (forming)';
        refLine(LV.orHi, '#fab219', LV.orMin + 'm OR high' + tag, [6, 3], 'or');
        refLine(LV.orLo, '#fab219', LV.orMin + 'm OR low' + tag, [6, 3], 'or');
      }
      if (LVL.orbExt && LV && LV.orHi != null && LV.orLo != null) {
        const r = LV.orHi - LV.orLo;
        refLine(LV.orHi + r, 'rgba(250,178,25,.55)', 'ORB +1×', [3, 5], 'orbExt');
        refLine(LV.orLo - r, 'rgba(250,178,25,.55)', 'ORB −1×', [3, 5], 'orbExt');
      }
      if (LVL.sess && LV) { refLine(LV.sHi, '#6f6e68', 'session high', [2, 4], 'sess'); refLine(LV.sLo, '#6f6e68', 'session low', [2, 4], 'sess'); }

      for (const uv of state.userLevels) {
        refLine(uv, '#ffffff', '', [9, 5]);
        if (uv < lo || uv > hi) continue;
        const cy = Math.round(Y(uv)) - 7, cw = 18, cx = x1 - cw - 6;
        ctx.fillStyle = 'rgba(255,255,255,.13)'; ctx.fillRect(cx, cy, cw, 14);
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, 13);
        ctx.fillStyle = '#ffffff'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('✕', cx + cw / 2, cy + 7);
        levelChips.push({ price: uv, x: cx, y: cy, w: cw, h: 14 });
      }

      state.mas.forEach((m) => {
        if (!m.on) return;
        const closes = all.map((b) => b.c);
        const series = computeMA(closes, m.type, m.period);
        const offset = all.length - bars.length;
        ctx.strokeStyle = m.color; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
        ctx.beginPath();
        let on = false, ex = 0, ey = 0;
        for (let i = 0; i < bars.length; i++) {
          const v = series[offset + i];
          if (v == null || v < lo || v > hi) { on = false; continue; }
          const xx = X(i), yy = Y(v);
          if (!on) { ctx.moveTo(xx, yy); on = true; } else ctx.lineTo(xx, yy);
          ex = xx; ey = yy;
        }
        ctx.stroke();
        const lastV = series[all.length - 1];
        if (lastV != null) legend2.push([maLabel(m), m.color, px(lastV)]);
        if (ex && ey > y0 + 6 && ey < y1 - 6) axisTag(ey, m.color, fmtAxis(lastV != null ? lastV : 0), false);
      });

      if (LV && LV.started && (LVL.vwap || LVL.bands)) {
        const curve = (mul: number, color: string, width: number, label: string, dash: number[] | null) => {
          ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
          if (dash) ctx.setLineDash(dash);
          ctx.beginPath();
          let on = false, ex = 0, ey = 0;
          for (let i = 0; i < bars.length; i++) {
            const src = Math.min(bars[i].i + state.tf - 1, LV.vwap.length - 1);
            let j = src, v = LV.vwap[j];
            while (v == null && j > bars[i].i) { j--; v = LV.vwap[j]; }
            if (v == null) continue;
            const val = v + mul * (LV.sdLine[j] || 0);
            const xx = X(i), yy = Y(val);
            if (!on) { ctx.moveTo(xx, yy); on = true; } else ctx.lineTo(xx, yy);
            ex = xx; ey = yy;
          }
          if (on) ctx.stroke();
          ctx.setLineDash([]);
          if (on && label) {
            const val = lo + (y1 - ey) / plotH * (hi - lo);
            if (mul === 0) legend2.push([label, color, px(val)]);
            if (ey > y0 + 6 && ey < y1 - 6) axisTag(ey, color, mul === 0 ? fmtAxis(val) : label, false);
          }
        };
        if (LVL.bands && LV.sd > 0) {
          drawn.bands = true;
          curve(2, 'rgba(57,135,229,.30)', 1, '+2σ', [2, 3]);
          curve(1, 'rgba(57,135,229,.50)', 1, '+1σ', [2, 3]);
          curve(-1, 'rgba(57,135,229,.50)', 1, '−1σ', [2, 3]);
          curve(-2, 'rgba(57,135,229,.30)', 1, '−2σ', [2, 3]);
        }
        if (LVL.vwap) { curve(0, css('--accent'), 1.6, 'VWAP', null); drawn.vwap = true; }
      }
    }

    // candles
    const upC = css('--up'), dnC = css('--down');
    const bodyW = Math.max(1, Math.min(bw * 0.68, 14));
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i], x = X(i), up = b.c >= b.o;
      ctx.strokeStyle = up ? upC : dnC; ctx.fillStyle = up ? upC : dnC;
      ctx.lineWidth = Math.max(1, Math.min(bodyW * 0.18, 2));
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Y(b.h)); ctx.lineTo(Math.round(x) + 0.5, Y(b.l)); ctx.stroke();
      const yo = Y(b.o), yc = Y(b.c);
      const top = Math.min(yo, yc), hgt = Math.max(Math.abs(yc - yo), 1.2);
      ctx.globalAlpha = b.forming ? 0.75 : 1;
      ctx.fillRect(x - bodyW / 2, top, bodyW, hgt);
      ctx.globalAlpha = 1;
    }

    // resting orders
    for (const o of state.orders) {
      if (o.price < lo || o.price > hi) continue;
      const y = Math.round(Y(o.price)) + 0.5;
      ctx.strokeStyle = o.side === 'Long' ? upC : dnC; ctx.lineWidth = 1; ctx.globalAlpha = 0.75;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.font = '10px ' + css('--mono'); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = o.side === 'Long' ? upC : dnC;
      ctx.fillText(o.side.toLowerCase() + ' ' + o.type + ' ' + o.qty, x0 + 4, y - 2);
    }

    const hLine = (y: number, color: string, label: string, xa: number, xb: number, dashed: boolean) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = dashed ? 0.8 : 0.95;
      if (dashed) ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(xa, Math.round(y) + 0.5); ctx.lineTo(xb, Math.round(y) + 0.5); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.font = '10px ' + css('--mono'); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = color; ctx.fillText(label, xa + 4, y - 2);
    };

    if (P) {
      hLine(Y(P.entry), '#ffffff', (P.side === 'Long' ? 'L' : 'S') + ' ' + P.qty + ' @ ' + px(P.entry), x0, x1, false);
      if (P.hasStop !== false) hLine(Y(P.stop), dnC, 'stop ' + px(P.stop), x0, x1, true);
      if (P.hasTarget !== false) hLine(Y(P.target), upC, 'target ' + px(P.target), x0, x1, true);
      ctx.globalAlpha = 0.07;
      if (P.hasStop !== false) { ctx.fillStyle = dnC; ctx.fillRect(x0, Math.min(Y(P.entry), Y(P.stop)), plotW, Math.abs(Y(P.stop) - Y(P.entry))); }
      if (P.hasTarget !== false) { ctx.fillStyle = upC; ctx.fillRect(x0, Math.min(Y(P.entry), Y(P.target)), plotW, Math.abs(Y(P.target) - Y(P.entry))); }
      ctx.globalAlpha = 1;
    }

    // volume
    if (LVL.vol && volH) {
      drawn.vol = true;
      const vmax = Math.max.apply(null, bars.map((b) => b.v)) || 1;
      const recent = bars.slice(-30).map((b) => b.v);
      const avgV = recent.length ? recent.reduce((a, c) => a + c, 0) / recent.length : 1;
      const vTop = yVol - volH;
      ctx.strokeStyle = axisC; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, Math.round(yVol) + 0.5); ctx.lineTo(x1, Math.round(yVol) + 0.5); ctx.stroke();
      ctx.font = '9.5px ' + css('--mono'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (const frac of [1, 0.5]) {
        const yy = yVol - frac * volH;
        ctx.strokeStyle = gridC;
        ctx.beginPath(); ctx.moveTo(x0, Math.round(yy) + 0.5); ctx.lineTo(x1, Math.round(yy) + 0.5); ctx.stroke();
        ctx.fillStyle = mutedC; ctx.fillText(fmtVol(vmax * frac), x1 + 6, yy);
      }
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const rng = Math.max(b.h - b.l, spec.tick);
        const buyShare = clamp((b.c - b.l) / rng, 0.08, 0.92);
        const hgt = Math.max(1, b.v / vmax * volH);
        const hBuy = hgt * buyShare, hSell = hgt - hBuy;
        const bx = X(i) - bodyW / 2;
        ctx.globalAlpha = b.v > avgV * 1.6 ? 0.95 : 0.6;
        ctx.fillStyle = dnC; ctx.fillRect(bx, yVol - hSell, bodyW, hSell);
        ctx.fillStyle = upC; ctx.fillRect(bx, yVol - hgt, bodyW, hBuy);
        ctx.globalAlpha = 1;
      }
      const ay = yVol - (avgV / vmax * volH);
      ctx.strokeStyle = 'rgba(200,220,225,.35)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, Math.round(ay) + 0.5); ctx.lineTo(x1, Math.round(ay) + 0.5); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = mutedC; ctx.font = '9px ' + css('--mono');
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('buy / sell volume · est.', x0 + 4, vTop - 2);
    }

    const waiting: string[] = [];
    if (LVL.vwap && !drawn.vwap) waiting.push('VWAP');
    if (LVL.or && !drawn.or) waiting.push('ORB');
    if (LVL.orbExt && !drawn.orbExt) waiting.push('ORB targets');
    if (LVL.bands && !drawn.bands) waiting.push('σ bands');
    if (waiting.length) {
      const note = waiting.join(', ') + (LV && !LV.started
        ? ' — waiting for the ' + (session.imported ? 'session' : '09:30') + ' open. Press Play.'
        : ' — not enough bars yet.');
      ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const tw = ctx.measureText(note).width;
      ctx.fillStyle = 'rgba(250,178,25,.12)'; ctx.fillRect(x0 + 4, y0 + 42, tw + 14, 20);
      ctx.strokeStyle = 'rgba(250,178,25,.4)'; ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 4.5, y0 + 42.5, tw + 13, 19);
      ctx.fillStyle = css('--warn'); ctx.fillText(note, x0 + 11, y0 + 48);
    }

    if (state.settings.patOn && state.patEvents.length) {
      ctx.font = '9px system-ui'; ctx.textBaseline = 'middle';
      const used: { x: number; y: number }[] = [];
      for (const ev of state.patEvents.slice(-8)) {
        let col = -1;
        for (let i = bars.length - 1; i >= 0; i--) { if (bars[i].i <= ev.bar) { col = i; break; } }
        if (col < 0) continue;
        const bx = X(col);
        const up = ev.dir > 0;
        let by = up ? Y(bars[col].l) + 16 : Y(bars[col].h) - 16;
        while (used.some((u) => Math.abs(u.x - bx) < 74 && Math.abs(u.y - by) < 14)) by += up ? 15 : -15;
        if (by < y0 + 8 || by > y1 - 8) continue;
        used.push({ x: bx, y: by });
        const c = PAT_COLOR[ev.kind] || '#c3c2b7';
        const tw = ctx.measureText(ev.text).width + 12;
        ctx.fillStyle = 'rgba(8,16,20,.9)'; ctx.fillRect(bx - tw / 2, by - 8, tw, 16);
        ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.strokeRect(bx - tw / 2 + 0.5, by - 7.5, tw - 1, 15);
        ctx.fillStyle = c; ctx.textAlign = 'center'; ctx.fillText(ev.text, bx, by);
        ctx.beginPath();
        ctx.moveTo(bx, up ? by - 8 : by + 8);
        ctx.lineTo(bx, up ? Y(bars[col].l) + 2 : Y(bars[col].h) - 2);
        ctx.strokeStyle = c; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
      }
    }

    ctx.font = '11px ' + css('--mono'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = mutedC;
    for (const g of gridLabels) {
      if (tagRows.some((r) => Math.abs(r - g[1]) < 15)) continue;
      ctx.fillText(g[0], x1 + 5, g[1]);
    }

    // legend
    {
      let lb = bars[bars.length - 1];
      if (state.hover && state.hover.x > x0 && state.hover.x < x1) {
        lb = bars[clamp(Math.floor((state.hover.x - x0) / bw), 0, bars.length - 1)];
      }
      const lUp = lb.c >= lb.o;
      const narrow = w < 620;
      const parts: [string, string, string][] = narrow ? [
        ['ES', '#e6f1f4', 'bold'], ['· ' + tfLabel(state.tf), mutedC, ''],
        ['  O', mutedC, ''], [px(lb.o), lUp ? upC : dnC, ''],
        [' H', mutedC, ''], [px(lb.h), lUp ? upC : dnC, ''],
        [' L', mutedC, ''], [px(lb.l), lUp ? upC : dnC, ''],
        [' C', mutedC, ''], [px(lb.c), lUp ? upC : dnC, ''],
      ] : [
        ['ES · E-mini S&P 500', '#e6f1f4', 'bold'],
        ['· ' + tfLabel(state.tf) + ' · ' + (session.imported ? 'REPLAY' : 'SIM'), mutedC, ''],
        ['  ' + lb.t, mutedC, ''],
        ['  O', mutedC, ''], [px(lb.o), lUp ? upC : dnC, ''],
        [' H', mutedC, ''], [px(lb.h), lUp ? upC : dnC, ''],
        [' L', mutedC, ''], [px(lb.l), lUp ? upC : dnC, ''],
        [' C', mutedC, ''], [px(lb.c), lUp ? upC : dnC, ''],
        ['  Vol', mutedC, ''], [fmtVol(lb.v), lUp ? upC : dnC, ''],
      ];
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      let lx = x0 + 8;
      const ly0 = y0 + 12;
      const lf = (narrow ? '9.5px ' : '11px ') + css('--mono');
      let total = 0;
      for (const pt of parts) { ctx.font = (pt[2] ? pt[2] + ' ' : '') + lf; total += ctx.measureText(pt[0]).width + 3; }
      ctx.fillStyle = 'rgba(8,16,20,.9)'; ctx.fillRect(x0 + 2, ly0 - 9, Math.min(total + 12, plotW - 4), 18);
      for (const pt of parts) {
        ctx.font = (pt[2] ? pt[2] + ' ' : '') + lf;
        ctx.fillStyle = pt[1];
        if (lx > x1 - 10) break;
        ctx.fillText(pt[0], lx, ly0);
        lx += ctx.measureText(pt[0]).width + 3;
      }
      if (legend2.length) {
        ctx.font = (narrow ? '9.5px ' : '10.5px ') + css('--mono');
        let gx = x0 + 8; const gy = ly0 + 17;
        let gtot = 0;
        for (const e of legend2) gtot += ctx.measureText(narrow ? e[0] : e[0] + ' ' + e[2]).width + 25;
        ctx.fillStyle = 'rgba(8,16,20,.9)'; ctx.fillRect(x0 + 2, gy - 8, Math.min(gtot + 8, plotW - 4), 16);
        for (const e of legend2) {
          const txt = narrow ? e[0] : e[0] + ' ' + e[2];
          const need = 13 + ctx.measureText(txt).width;
          if (gx + need > x1 - 4) break;
          ctx.fillStyle = e[1];
          ctx.fillRect(gx, gy - 1.5, 9, 3);
          gx += 13;
          ctx.fillText(txt, gx, gy);
          gx += ctx.measureText(txt).width + 12;
        }
      }
    }

    const lp = lastPrice(session, state.cursor, state.sub), ly = Y(lp);
    const lastUp = bars.length > 0 && lp >= bars[bars.length - 1].o;
    ctx.fillStyle = lastUp ? upC : dnC;
    ctx.fillRect(x1 + 1, ly - 9, padR - 2, 18);
    ctx.fillStyle = '#06121a'; ctx.font = 'bold 11px ' + css('--mono');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(fmtAxis(lp), x1 + 6, ly);
    ctx.setLineDash([2, 3]); ctx.strokeStyle = lastUp ? upC : dnC; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(x1, ly); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    if (state.hover && state.hover.x > x0 && state.hover.x < x1) {
      const idx = clamp(Math.floor((state.hover.x - x0) / bw), 0, bars.length - 1);
      ctx.strokeStyle = 'rgba(190,220,230,.32)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(idx), y0); ctx.lineTo(X(idx), timeY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, state.hover.y); ctx.lineTo(x1, state.hover.y); ctx.stroke();
      ctx.setLineDash([]);
      const pAt = lo + (y1 - state.hover.y) / plotH * (hi - lo);
      ctx.fillStyle = '#2e4550'; ctx.fillRect(x1 + 1, state.hover.y - 8, padR - 2, 16);
      ctx.fillStyle = '#fff'; ctx.font = '11px ' + css('--mono'); ctx.textAlign = 'left';
      ctx.fillText(fmtAxis(pAt), x1 + 6, state.hover.y);
    }

    geomRef.current = { x0, x1, y0, y1, yVol, lo, hi, bw, bars, levelChips };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !window.ResizeObserver) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(cv);
    return () => ro.disconnect();
  }, [draw]);

  const priceAtY = (y: number): number | null => {
    const g = geomRef.current;
    if (g.y1 && y > g.y1 + 6) return null;
    if (g.y0 != null && y < g.y0 - 6) return null;
    const t = (g.y1 - y) / (g.y1 - g.y0);
    return roundTick(g.lo + t * (g.hi - g.lo), specFromSettings(state.settings));
  };

  const levelHandleAt = (x: number, y: number): number | null => {
    for (const c of geomRef.current.levelChips) {
      if (x >= c.x - 6 && x <= c.x + c.w + 6 && y >= c.y - 10 && y <= c.y + c.h + 10) return c.price;
    }
    return null;
  };

  const addLevelAt = (y: number) => {
    const p = priceAtY(y);
    if (p == null || !isFinite(p)) return;
    const pricePerPx = (geomRef.current.hi - geomRef.current.lo) / Math.max(1, geomRef.current.y1 - geomRef.current.y0);
    const tol = pricePerPx * 14;
    const near = state.userLevels.find((v) => Math.abs(v - p) < tol);
    if (near != null) dispatch({ type: 'REMOVE_USER_LEVEL', price: near });
    else dispatch({ type: 'ADD_USER_LEVEL', price: p });
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current; if (!cv) return;
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const handle = levelHandleAt(x, y);
    if (handle != null) { dispatch({ type: 'REMOVE_USER_LEVEL', price: handle }); return; }
    if (!state.drawing) return;
    addLevelAt(y);
  };

  const setHoverFromEvent = (clientX: number, clientY: number) => {
    const cv = canvasRef.current; if (!cv) return;
    const r = cv.getBoundingClientRect();
    dispatch({ type: 'SET_HOVER', x: clientX - r.left, y: clientY - r.top });
  };

  return (
    <canvas
      ref={canvasRef}
      id="chart"
      role="img"
      aria-label="Price chart for the session being replayed. Use the levels and readouts above for the same information as text."
      className={state.drawing ? 'drawing' : undefined}
      onClick={handleClick}
      onMouseMove={(e) => setHoverFromEvent(e.clientX, e.clientY)}
      onMouseLeave={() => dispatch({ type: 'CLEAR_HOVER' })}
      onTouchStart={(e) => { const t = e.touches[0]; if (t) setHoverFromEvent(t.clientX, t.clientY); }}
      onTouchMove={(e) => { const t = e.touches[0]; if (t) setHoverFromEvent(t.clientX, t.clientY); }}
      onTouchEnd={(e) => {
        const t = e.changedTouches[0];
        if (t) {
          const cv = canvasRef.current;
          if (cv) {
            const r = cv.getBoundingClientRect();
            const x = t.clientX - r.left, y = t.clientY - r.top;
            const handle = levelHandleAt(x, y);
            if (handle != null) { dispatch({ type: 'REMOVE_USER_LEVEL', price: handle }); dispatch({ type: 'CLEAR_HOVER' }); return; }
            if (state.drawing) addLevelAt(y);
          }
        }
        dispatch({ type: 'CLEAR_HOVER' });
      }}
    />
  );
}
