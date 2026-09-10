// The store's state shape — one place that mirrors what the original app
// kept in its global S / LVL / MAS / USER_LEVELS / PAT / PL objects. Kept as
// a single tree so the reducer can make atomic, consistent updates (e.g. a
// price tick that both fills a resting order and immediately checks the new
// position against its own stop in the same action).
import { DEFAULT_SETTINGS } from '../lib/types';
import { DEFAULT_MAS } from '../lib/indicators';
import type {
  ImportedSession, LevelToggles, MAConfig, PatternEvent, Position, RestingOrder,
  Session, SessionSummary, Settings, Trade,
} from '../lib/types';
import type { Scenario } from '../lib/patternLab';

export interface PatternLabState {
  mode: 'mixed' | 'support' | 'resistance' | 'trend';
  scenario: Scenario | null;
  step: 'call' | 'stop' | 'reveal';
  call: string | null;
  stopPick: string | null;
  reveal: number;
  asked: number; correct: number; streak: number; best: number;
  stats: Record<string, { n: number; ok: number }>;
  stopN: number; stopOk: number;
  hard: boolean; hardAsked: number; hardCorrect: number;
  misses: Scenario[]; sinceReview: number; isReview: boolean;
}

export const initialPatternLab: PatternLabState = {
  mode: 'mixed', scenario: null, step: 'call', call: null, stopPick: null, reveal: 0,
  asked: 0, correct: 0, streak: 0, best: 0, stats: {}, stopN: 0, stopOk: 0,
  hard: false, hardAsked: 0, hardCorrect: 0, misses: [], sinceReview: 0, isReview: false,
};

/** The part of a prop-firm evaluation that cannot be derived from the trade
 *  list: the running peak the trailing drawdown hangs off, and the fact of a
 *  breach (once an account is blown it stays blown, even if price comes back).
 *  Deliberately NOT reset by NEW_SESSION — an evaluation spans many days. */
export interface PropEvalState {
  startedAt: string | null;
  /** Index into `sessions` where this evaluation began. */
  startSessionIdx: number;
  /** Highest equity ever touched this evaluation, open P&L included. */
  peakEquity: number;
  breached: boolean;
  breachReason: string;
  passed: boolean;
  passedAt: string | null;
}

export const initialPropEval: PropEvalState = {
  startedAt: null, startSessionIdx: 0, peakEquity: 0,
  breached: false, breachReason: '', passed: false, passedAt: null,
};

export interface HoverState { x: number; y: number }

export interface TicketState {
  orderType: 'market' | 'limit' | 'stop';
  qty: number;
  price: string; // raw input text, parsed on submit — mirrors the original's #ordPrice
  setupTag: string;
}

export const initialTicket: TicketState = { orderType: 'market', qty: 1, price: '', setupTag: 'Untagged' };

export interface SimState {
  session: Session | null;
  cursor: number;
  sub: number;
  playing: boolean;
  speed: number;
  tf: number;
  drawing: boolean;
  ticket: TicketState;
  startEquity: number;
  realized: number;
  position: Position | null;
  orders: RestingOrder[];
  orderSeq: number;
  trades: Trade[];
  sessions: SessionSummary[];
  imported: ImportedSession[] | null;
  importIdx: number;
  sessionStartIdx: number;
  sessionTrades: number;
  locked: boolean;
  lockReason: string;
  hover: HoverState | null;
  seedText: string;
  genParams: { seed: number; base: number; volMult: number; minutes: number } | null;

  settings: Settings;
  levels: LevelToggles;
  mas: MAConfig[];
  userLevels: number[];
  patEvents: PatternEvent[];
  patLastScan: number;

  patternLab: PatternLabState;

  saveStatus: { available: boolean; savedAt: string | null; size: number; trimmed: number };
  propEval: PropEvalState;
  toast: { id: number; text: string } | null;
  announcement: { id: number; text: string } | null;
  /** Bumped whenever a session naturally ends with "show a debrief" on, or
   *  "End day" is used. The App shell watches this to pop the debrief modal
   *  without the reducer owning any modal-open UI state itself. */
  debriefRequestId: number;
}

export const DEFAULT_LEVELS: LevelToggles = { vwap: true, bands: false, or: true, orbExt: false, pd: true, on: false, sess: false, vol: true };

export const initialState: SimState = {
  session: null, cursor: 0, sub: 0, playing: false, speed: 2, tf: 1,
  drawing: false, ticket: { ...initialTicket },
  startEquity: DEFAULT_SETTINGS.equity, realized: 0, position: null,
  orders: [], orderSeq: 0, trades: [], sessions: [], imported: null, importIdx: 0,
  sessionStartIdx: 0, sessionTrades: 0, locked: false, lockReason: '', hover: null,
  seedText: '', genParams: null,
  settings: { ...DEFAULT_SETTINGS },
  levels: { ...DEFAULT_LEVELS },
  mas: DEFAULT_MAS.map((m) => ({ ...m })),
  userLevels: [],
  patEvents: [], patLastScan: -1,
  patternLab: initialPatternLab,
  saveStatus: { available: true, savedAt: null, size: 0, trimmed: 0 },
  propEval: { ...initialPropEval },
  toast: null, announcement: null, debriefRequestId: 0,
};
