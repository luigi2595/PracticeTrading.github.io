// The five journal mini-charts: equity curve, R-multiple histogram, net P&L
// by hour, MAE/MFE scatter, and rolling expectancy. Ported from
// drawEquity/drawRHist/drawHour/drawScatter/drawRolling in part4a.js. Each
// is a tiny canvas component that redraws whenever the trade list changes.
import React, { useEffect, useRef } from 'react';
import { fmt$, fmtSigned$ } from '../lib/spec';
import { SPEC } from '../lib/spec';
import type { Trade } from '../lib/types';

function css(name: string): string { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function usePrepCanvas(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const g = c.getContext('2d'); if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      draw(g, w, h);
    };
    render();
    const ro = window.ResizeObserver ? new ResizeObserver(render) : null;
    ro?.observe(c);
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function noData(g: CanvasRenderingContext2D, w: number, h: number, msg: string) {
  g.fillStyle = css('--muted'); g.font = '12px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(msg, w / 2, h / 2);
}
function roundRectTop(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h);
  g.moveTo(x, y + h); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h); g.closePath();
}

export function EquityChart({ list }: { list: Trade[] }) {
  const ref = usePrepCanvas((g, w, h) => {
    if (list.length < 1) return noData(g, w, h, 'No closed trades yet');
    const pts = [0]; let run = 0;
    for (const t of list) { run += t.net; pts.push(run); }
    const lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
    const pad = Math.max((hi - lo) * 0.12, 20);
    const y0 = 8, y1 = h - 20, x0 = 40, x1 = w - 8;
    const Y = (v: number) => y1 - (v - (lo - pad)) / ((hi + pad) - (lo - pad)) * (y1 - y0);
    const X = (i: number) => x0 + (i / Math.max(1, pts.length - 1)) * (x1 - x0);
    g.strokeStyle = css('--axis'); g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(x0, Y(0)); g.lineTo(x1, Y(0)); g.stroke(); g.setLineDash([]);
    g.fillStyle = css('--muted'); g.font = '10px ' + css('--mono'); g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText('$0', x0 - 5, Y(0));
    g.fillText(fmt$(hi, 0), x0 - 5, Y(hi));
    if (lo < 0) g.fillText(fmt$(lo, 0), x0 - 5, Y(lo));
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, 'rgba(57,135,229,.30)'); grad.addColorStop(1, 'rgba(57,135,229,0)');
    g.beginPath(); g.moveTo(X(0), Y(pts[0]));
    pts.forEach((v, i) => g.lineTo(X(i), Y(v)));
    g.lineTo(X(pts.length - 1), Y(0)); g.lineTo(X(0), Y(0)); g.closePath();
    g.fillStyle = grad; g.fill();
    g.beginPath(); pts.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.strokeStyle = css('--accent'); g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    const lx = X(pts.length - 1), ly = Y(run);
    g.fillStyle = css('--surface'); g.beginPath(); g.arc(lx, ly, 5, 0, 7); g.fill();
    g.fillStyle = css('--accent'); g.beginPath(); g.arc(lx, ly, 3.4, 0, 7); g.fill();
    g.fillStyle = css('--ink'); g.font = 'bold 11px ' + css('--mono'); g.textAlign = 'right'; g.textBaseline = 'bottom';
    g.fillText(fmtSigned$(run), x1, ly - 8);
    g.fillStyle = css('--muted'); g.font = '10px system-ui'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText('trade 1', x0 + 14, y1 + 4);
    if (list.length > 1) g.fillText('trade ' + list.length, x1 - 22, y1 + 4);
  }, [list]);
  return <canvas ref={ref} id="eqChart" className="mini-canvas" role="img" aria-label="Cumulative profit and loss across your trades. The same numbers are in the table below." />;
}

export function RHistChart({ list }: { list: Trade[] }) {
  const ref = usePrepCanvas((g, w, h) => {
    const rs = list.filter((t) => t.R != null && isFinite(t.R)).map((t) => t.R as number);
    if (!rs.length) return noData(g, w, h, 'No R data — set a stop when you enter');
    const edges = [-3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 5];
    const labels = ['<-3', '-3', '-2', '-1.5', '-1', '-0.5', '0', '+0.5', '+1', '+1.5', '+2', '+3', '5+'];
    const counts = new Array(edges.length + 1).fill(0);
    for (const r of rs) { let b = edges.length; for (let i = 0; i < edges.length; i++) { if (r < edges[i]) { b = i; break; } } counts[b]++; }
    const max = Math.max.apply(null, counts) || 1;
    const y0 = 10, y1 = h - 26, x0 = 6, x1 = w - 6;
    const bw = (x1 - x0) / counts.length;
    g.font = '9px ' + css('--mono'); g.textBaseline = 'top';
    for (let i = 0; i < counts.length; i++) {
      const hgt = (counts[i] / max) * (y1 - y0);
      const x = x0 + i * bw + 1.5;
      const neg = i <= 5;
      g.fillStyle = neg ? css('--down') : css('--up');
      if (counts[i] > 0) { g.beginPath(); roundRectTop(g, x, y1 - hgt, bw - 3, hgt, 4); g.fill(); }
      g.fillStyle = css('--muted'); g.textAlign = 'center';
      if (i % 2 === 0) g.fillText(labels[i] || '', x + (bw - 3) / 2, y1 + 4);
      if (counts[i] > 0) { g.fillStyle = css('--ink-2'); g.fillText(String(counts[i]), x + (bw - 3) / 2, y1 - hgt - 11); }
    }
    g.strokeStyle = css('--axis'); g.beginPath(); g.moveTo(x0, y1 + 0.5); g.lineTo(x1, y1 + 0.5); g.stroke();
    g.fillStyle = css('--muted'); g.textAlign = 'left'; g.font = '10px system-ui';
    g.fillText('R multiple per trade', x0 + 2, 0);
  }, [list]);
  return <canvas ref={ref} id="rChart" className="mini-canvas" role="img" aria-label="How many trades landed in each R-multiple band." />;
}

export function HourChart({ list }: { list: Trade[] }) {
  const ref = usePrepCanvas((g, w, h) => {
    if (!list.length) return noData(g, w, h, 'No closed trades yet');
    const buckets: Record<string, number> = {};
    for (const t of list) { const hr = (t.openedAt || t.t || '00:00').slice(0, 2); buckets[hr] = (buckets[hr] || 0) + t.net; }
    const keys = Object.keys(buckets).sort();
    const vals = keys.map((k) => buckets[k]);
    const max = Math.max.apply(null, vals.map(Math.abs)) || 1;
    const y0 = 12, y1 = h - 22, x0 = 8, x1 = w - 8;
    const zero = y0 + (y1 - y0) / 2;
    const slot = (x1 - x0) / keys.length;
    const bwi = Math.min(slot * 0.55, 56);
    const maxH = (y1 - y0) / 2 - 18;
    g.strokeStyle = css('--axis'); g.beginPath(); g.moveTo(x0, zero + 0.5); g.lineTo(x1, zero + 0.5); g.stroke();
    g.font = '10px ' + css('--mono'); g.textAlign = 'center';
    for (let i = 0; i < keys.length; i++) {
      const v = vals[i], hgt = Math.max(Math.abs(v) / max * maxH, 2);
      const cx = x0 + i * slot + slot / 2, x = cx - bwi / 2;
      g.fillStyle = v >= 0 ? css('--up') : css('--down');
      g.beginPath();
      if (v >= 0) roundRectTop(g, x, zero - hgt, bwi, hgt, 4);
      else { g.save(); g.translate(0, zero * 2); g.scale(1, -1); roundRectTop(g, x, zero - hgt, bwi, hgt, 4); }
      g.fill();
      if (v < 0) g.restore();
      g.fillStyle = css('--muted'); g.textBaseline = 'top';
      g.fillText(keys[i] + ':00', cx, y1 + 3);
      g.fillStyle = css('--ink-2'); g.textBaseline = v >= 0 ? 'bottom' : 'top';
      g.fillText((v >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(v)), cx, v >= 0 ? zero - hgt - 3 : zero + hgt + 3);
    }
  }, [list]);
  return <canvas ref={ref} id="hourChart" className="mini-canvas" role="img" aria-label="Net profit and loss grouped by the hour you entered." />;
}

export function ScatterChart({ list }: { list: Trade[] }) {
  const ref = usePrepCanvas((g, w, h) => {
    const pts = list.filter((t) => t.riskD > 0 && t.mfe != null && t.mae != null).map((t) => ({
      mfe: (t.mfe! * SPEC.pointValue * t.qty) / t.riskD,
      mae: Math.abs(t.mae! * SPEC.pointValue * t.qty) / t.riskD,
      win: t.net > 0,
    }));
    if (!pts.length) return noData(g, w, h, 'No trades with a stop yet');
    const maxX = Math.max(1, Math.ceil(Math.max.apply(null, pts.map((p) => p.mfe))));
    const maxY = Math.max(1, Math.ceil(Math.max.apply(null, pts.map((p) => p.mae))));
    const x0 = 34, y0 = 12, x1 = w - 10, y1 = h - 26;
    const X = (v: number) => x0 + (v / maxX) * (x1 - x0);
    const Y = (v: number) => y0 + (v / maxY) * (y1 - y0);
    g.strokeStyle = css('--grid'); g.lineWidth = 1;
    g.font = '9px ' + css('--mono'); g.fillStyle = css('--muted');
    for (let i = 0; i <= maxX; i++) {
      g.beginPath(); g.moveTo(Math.round(X(i)) + 0.5, y0); g.lineTo(Math.round(X(i)) + 0.5, y1); g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(i + 'R', X(i), y1 + 4);
    }
    for (let i = 0; i <= maxY; i++) {
      g.beginPath(); g.moveTo(x0, Math.round(Y(i)) + 0.5); g.lineTo(x1, Math.round(Y(i)) + 0.5); g.stroke();
      g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(i + 'R', x0 - 5, Y(i));
    }
    g.strokeStyle = css('--down'); g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(x0, Y(1)); g.lineTo(x1, Y(1)); g.stroke(); g.setLineDash([]);
    for (const p of pts) {
      g.beginPath(); g.arc(X(Math.min(p.mfe, maxX)), Y(Math.min(p.mae, maxY)), 3.6, 0, 7);
      g.fillStyle = p.win ? css('--up') : css('--down'); g.globalAlpha = 0.75; g.fill();
      g.globalAlpha = 1; g.strokeStyle = css('--surface'); g.lineWidth = 1.5; g.stroke();
    }
    g.fillStyle = css('--muted'); g.font = '10px system-ui';
    g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('heat taken (MAE)', x0 + 2, y0 - 2);
    g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText('move offered (MFE) →', x1, y1 - 2);
  }, [list]);
  return <canvas ref={ref} id="scatterChart" className="mini-canvas" role="img" aria-label="Each trade plotted by the move it offered against the heat it took. Same numbers in the table below." />;
}

export function RollingChart({ list }: { list: Trade[] }) {
  const ref = usePrepCanvas((g, w, h) => {
    const rs = list.filter((t) => t.R != null && isFinite(t.R)).map((t) => t.R as number);
    const N = 20;
    if (rs.length < 5) return noData(g, w, h, 'Needs at least 5 trades with a stop');
    const roll: number[] = [];
    for (let i = 0; i < rs.length; i++) {
      const seg = rs.slice(Math.max(0, i - N + 1), i + 1);
      roll.push(seg.reduce((a, b) => a + b, 0) / seg.length);
    }
    const lo = Math.min(-0.2, Math.min.apply(null, roll)), hi = Math.max(0.4, Math.max.apply(null, roll));
    const x0 = 40, y0 = 10, x1 = w - 8, y1 = h - 22;
    const X = (i: number) => x0 + (i / Math.max(1, roll.length - 1)) * (x1 - x0);
    const Y = (v: number) => y1 - (v - lo) / (hi - lo) * (y1 - y0);
    g.strokeStyle = css('--axis'); g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(x0, Y(0)); g.lineTo(x1, Y(0)); g.stroke(); g.setLineDash([]);
    g.fillStyle = css('--muted'); g.font = '10px ' + css('--mono');
    g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText('0R', x0 - 5, Y(0)); g.fillText(hi.toFixed(2), x0 - 5, Y(hi)); g.fillText(lo.toFixed(2), x0 - 5, Y(lo));
    g.beginPath(); roll.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.strokeStyle = css('--accent'); g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    const last = roll[roll.length - 1];
    g.fillStyle = last >= 0 ? css('--up') : css('--down');
    g.beginPath(); g.arc(X(roll.length - 1), Y(last), 3.5, 0, 7); g.fill();
    g.fillStyle = css('--ink'); g.font = 'bold 11px ' + css('--mono');
    g.textAlign = 'right'; g.textBaseline = 'bottom';
    g.fillText((last >= 0 ? '+' : '−') + Math.abs(last).toFixed(2) + 'R', x1, Y(last) - 7);
    g.fillStyle = css('--muted'); g.font = '10px system-ui'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('rolling ' + Math.min(N, rs.length) + '-trade expectancy', x0 + 2, y1 + 4);
  }, [list]);
  return <canvas ref={ref} id="rollChart" className="mini-canvas" role="img" aria-label="Average R per trade over a rolling window of your last twenty trades." />;
}
