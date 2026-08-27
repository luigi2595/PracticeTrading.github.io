// Browser file I/O — CSV/JSON export and import. Pure DOM/Blob work, kept
// out of the reducer (which must stay a pure state transform) and out of
// components (which just call these from an onClick/onChange handler).
// Ported from part4a.js's download()/exportCsv()/exportJson() — minus the
// original's claude.ai-preview-specific `claude.use('downloads')` branch,
// which has no equivalent (or need) once this runs as a normal deployed site.
import type { Trade } from './types';

export function downloadText(name: string, text: string, type = 'text/plain'): void {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

const CSV_COLS: (keyof Trade)[] = [
  'id', 'openedAt', 't', 'side', 'qty', 'entry', 'exit', 'pts', 'gross', 'comm', 'net',
  'R', 'mae', 'mfe', 'reason', 'tag', 'note', 'source', 'seed',
];

export function exportTradesCsv(trades: Trade[]): void {
  const rows = [CSV_COLS.join(',')].concat(
    trades.map((t) => CSV_COLS.map((c) => {
      const v = t[c];
      if (v == null) return '';
      return /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    }).join(',')),
  );
  downloadText('es-journal-' + new Date().toISOString().slice(0, 10) + '.csv', rows.join('\n'), 'text/csv');
}

export interface BackupPayload {
  version: 1;
  savedAt: string;
  trades: Trade[];
  patternLab: { stats: Record<string, { n: number; ok: number }>; asked: number; correct: number; stopN: number; stopOk: number };
}

export function exportBackupJson(payload: BackupPayload): void {
  downloadText('es-practice-backup-' + payload.savedAt.slice(0, 10) + '.json', JSON.stringify(payload, null, 2), 'application/json');
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.readAsText(file);
  });
}
