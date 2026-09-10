// The commercial tier model, expressed in one place.
//
// NOTHING IS GATED YET. Every feature below is currently granted to the free
// tier, so the app behaves exactly as it always has. This module exists so
// that when the paid tier ships, the question "is this user allowed to do X?"
// has exactly one answer, in one file, rather than being scattered through
// components as ad hoc checks.
//
// See docs/BUSINESS.md for the reasoning behind the split.

export type Tier = 'free' | 'pro';

/** Everything that might ever be gated. Add here, not inline in components. */
export type Feature =
  /** Replay sim, all timeframes, all indicators, Pattern Lab drills. */
  | 'core'
  /** Import your own CSV of real bars and replay them. */
  | 'byoBars'
  /** Journal kept in this browser's localStorage, with CSV/JSON export. */
  | 'localJournal'
  /** Prop-firm rule presets: trailing drawdown, profit target, consistency. */
  | 'propFirmRules'
  /** Account-backed journal that survives clearing site data and syncs. */
  | 'cloudJournal'
  /** "Across your last N sessions you would have passed X of Y evals." */
  | 'evalReadinessReport'
  /** Journal history beyond the free-tier cap. */
  | 'unlimitedHistory'
  /** Contract specs beyond ES/MES. */
  | 'multiInstrument';

const GRANTS: Record<Tier, Feature[]> = {
  // Deliberately generous: the drills have to be genuinely useful for free or
  // nobody gets far enough to have an opinion about paying.
  free: ['core', 'byoBars', 'localJournal'],
  pro: [
    'core', 'byoBars', 'localJournal',
    'propFirmRules', 'cloudJournal', 'evalReadinessReport',
    'unlimitedHistory', 'multiInstrument',
  ],
};

/** Trades kept in the free tier's journal. `null` means no cap. */
export const FREE_JOURNAL_TRADE_CAP: number | null = null;

/**
 * The current tier. Hard-coded to 'pro' until subscriptions exist, so that
 * wiring `can()` into a component today changes nothing. When billing ships,
 * this becomes a lookup against the signed-in user's subscription.
 */
export function currentTier(): Tier {
  return 'pro';
}

export function can(feature: Feature, tier: Tier = currentTier()): boolean {
  return GRANTS[tier].includes(feature);
}

/** Short marketing label for a feature, for use in an upgrade prompt. */
export const FEATURE_LABEL: Record<Feature, string> = {
  core: 'Replay sim and Pattern Lab',
  byoBars: 'Replay your own CSV bars',
  localJournal: 'Trade journal on this device',
  propFirmRules: 'Prop firm rule presets',
  cloudJournal: 'Journal that syncs and survives',
  evalReadinessReport: 'Evaluation readiness report',
  unlimitedHistory: 'Unlimited journal history',
  multiInstrument: 'More instruments than ES/MES',
};
