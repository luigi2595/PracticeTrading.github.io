// Shared types for the ES Practice Lab engine. Kept loose in a few spots
// (trade metadata, generator params on a trade) rather than over-modeled —
// the original app never enforced more than this at runtime either.

export type Side = 'Long' | 'Short';
export type OrderKind = 'market' | 'limit' | 'stop';

export interface Bar {
  i: number;
  t: string;          // "HH:MM"
  o: number; h: number; l: number; c: number;
  v: number;
  path?: number[];     // intrabar substeps, present on generated/imported bars
  pre?: boolean;       // pre-market context bar
  forming?: boolean;   // synthetic "bar in progress" snapshot
}

export interface DayHiLo { hi: number; lo: number }

export interface Session {
  bars: Bar[];
  priorClose: number;
  openPrice: number;
  pdHigh: number;
  pdLow: number;
  seed: number | string;
  rthStart: number;
  rthMinutes: number;
  imported?: boolean;
  date?: string;
  label?: string;
  dayStarts?: number[];
  dayHiLo?: DayHiLo[];
}

export interface ImportedSession extends Session {
  date: string;
  label: string;
}

export interface GenParams {
  seed: number;
  base: number;
  volMult: number;
  minutes: number;
}

export interface ContractSpec {
  tick: number;
  pointValue: number;
  commission: number;
  slipTicks: number;
}

export interface RestingOrder {
  id: number;
  side: Side;
  type: 'limit' | 'stop';
  qty: number;
  price: number;
  stop: number | null;
  target: number | null;
  tag: string;
  placedAt: string;
}

export interface PositionExit {
  qty: number;
  price: number;
  pts: number;
  reason: string;
  t: string;
}

export interface Position {
  side: Side;
  qty: number;
  entry: number;
  initQty: number;
  exits: PositionExit[];
  grossAcc: number;
  hi: number;
  lo: number;
  beMoved: boolean;
  trailed?: boolean;
  stop: number;
  target: number;
  stopPts: number;
  tgtPts: number;
  hasStop: boolean;
  hasTarget: boolean;
  mae: number;
  mfe: number;
  openedBar: number;
  openedAt: string;
  tag: string;
  riskD: number;
}

export interface Trade {
  id: number;
  t: string;
  openedAt: string;
  side: Side;
  qty: number;
  entry: number;
  exit: number;
  pts: number;
  gross: number;
  comm: number;
  net: number;
  riskD: number;
  R: number | null;
  mae: number | null;
  mfe: number | null;
  availableR: number | null;
  capture: number | null;
  exits: PositionExit[];
  scaled: boolean;
  barsHeld: number;
  entryBar: number;
  exitBar: number;
  initialStop: number | null;
  gen: GenParams | null;
  importedDate: string | null;
  reason: string;
  tag: string;
  note: string;
  source: 'sim' | 'manual';
  seed: string;
}

export interface SessionSummary {
  seed: string;
  when: string;
  n: number;
  net: number;
  winRate: number;
  expR: number | null;
  capture: number | null;
  fix: string;
}

export interface LevelToggles {
  vwap: boolean;
  bands: boolean;
  or: boolean;
  orbExt: boolean;
  pd: boolean;
  on: boolean;
  sess: boolean;
  vol: boolean;
}

export type MAType = 'ema' | 'sma' | 'cma';
export interface MAConfig { on: boolean; type: MAType; period: number; color: string }

export interface LevelSnapshot {
  vwap: (number | null)[];
  sdLine: (number | null)[];
  sd: number;
  last: number | null;
  orHi: number | null;
  orLo: number | null;
  orLocked: boolean;
  orMin: number;
  sHi: number | null;
  sLo: number | null;
  onHi: number | null;
  onLo: number | null;
  pdHigh: number | null;
  pdLow: number | null;
  started: boolean;
}

export type PatternKind = 'failed' | 'real' | 'sweep' | 'retest';

export interface PatternEvent {
  key: string;
  kind: PatternKind;
  text: string;
  detail: string;
  price: number;
  bar: number;
  breakBar: number;
  t: string;
  dir: 1 | -1;
}

export interface CandidateLevel {
  price: number;
  dir: 1 | -1;
  touches: number;
  firstIdx: number;
  lastIdx: number;
}

export interface Settings {
  equity: number;
  commission: number;
  slipTicks: number;
  pointValue: number;
  base: number;
  volMult: number;
  seedText: string;
  orMinutes: number;
  sessionMinutes: number;
  lossLimit: number;
  maxTrades: number;
  cvd: boolean;
  hideLevels: boolean;
  autoPause: boolean;
  enforceRules: boolean;
  trailMode: 'off' | 'atr' | 'swing';
  trailAtrMult: number;
  trailBars: number;
  beOnScale: boolean;
  debriefOnEnd: boolean;
  stopVal: number;
  stopUnit: 'pts' | 'ticks' | 'price';
  targetVal: number;
  targetUnit: 'pts' | 'ticks' | 'price';
  useStop: boolean;
  useTarget: boolean;
  combineDays: boolean;
  patOn: boolean;
  autosave: boolean;
  useReal: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  equity: 50000,
  commission: 2.25,
  slipTicks: 1,
  pointValue: 50,
  base: 6850,
  volMult: 1,
  seedText: '',
  orMinutes: 15,
  sessionMinutes: 390,
  lossLimit: 600,
  maxTrades: 0,
  cvd: false,
  hideLevels: false,
  autoPause: true,
  enforceRules: true,
  trailMode: 'off',
  trailAtrMult: 1.5,
  trailBars: 5,
  beOnScale: true,
  debriefOnEnd: true,
  stopVal: 6,
  stopUnit: 'pts',
  targetVal: 12,
  targetUnit: 'pts',
  useStop: true,
  useTarget: true,
  combineDays: false,
  patOn: true,
  autosave: true,
  useReal: false,
};
