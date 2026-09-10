# Business model

Working document. This is the commercial plan the repository is now structured
around — the licensing, the free/paid split, and the sequence to first revenue.
Edit freely; nothing here is set in stone.

## Positioning

**Not** "another trading simulator." The category is crowded and the incumbents
bundle real market data at $79–89/month, which is a fight this product cannot
win on data alone.

The wedge is narrower and sharper:

> **Practice the prop firm rules before you pay for the evaluation.**

Futures prop firm evaluations cost roughly $99–$1,080 per attempt. Published
pass rates run from about 9% to 36%. The commonly cited reason for failure is
not bad trading — it is misalignment with the firm's rules: blowing the daily
loss limit, tripping a trailing drawdown, violating a consistency rule.

That is exactly what this app already enforces: a daily loss cap, a maximum
trade count, and a hard lockout when either is breached. The closing-bell
debrief already grades rule compliance rather than P&L. The product is one
feature set away from being purpose-built for that buyer.

## Who pays

| Segment | Why they pay | Willingness |
| --- | --- | --- |
| **Prop firm eval candidates** (primary) | About to spend $150–$500 on an attempt with a <36% pass rate | High — the alternative is expensive |
| Newer retail futures traders | Want reps without risking money | Medium |
| Trading educators / small mentorship groups | Want a drilling tool for students | Medium-high, seat-based |

The first segment is the one to build for. They have an urgent, dated,
expensive problem, and they are already used to paying for tooling.

## Free vs paid

The free tier has to be genuinely good or nobody gets far enough to convert.
The paid tier should be the things a serious, repeat user needs.

**Free**

- The replay sim on synthetic sessions, all timeframes, all indicators
- Pattern Lab drills
- Journal for the current browser (localStorage), with CSV export
- Bring-your-own-CSV replay

**Pro**

- **Prop firm rule presets** — trailing drawdown (intraday and end-of-day),
  profit targets, consistency rules, presets. The core paid feature. *(Built —
  currently ungated while the free tier is being validated.)*
- **Account + cloud journal** — history that survives clearing site data, and
  syncs across devices
- **Eval readiness report** — "on these rules, across your last 40 sessions,
  you would have passed 6 of 10 evaluations; here is what broke them"
- Unlimited journal history and richer analytics
- Multi-instrument specs beyond ES/MES

Pricing to test: **$19/month**, or **$149/year**. Deliberately far below the
$79–89 incumbents, because this is a focused tool rather than a data platform,
and because it is priced against the cost of one failed evaluation.

## Why the license changed

The project was briefly MIT. It is now the [Business Source License 1.1](../LICENSE):
source stays public and readable, personal use is free, but hosting it for
other people or reselling it requires a commercial license. It converts to
GPL 2.0-or-later on the Change Date.

This matters because the entire product is client-side. Under MIT, anyone could
have taken the build output, put a payment wall in front of it, and competed
with the original using the original's own code.

## Sequencing to revenue

**Phase 1 — ship free, learn (now)**

- Public demo on GitHub Pages (the workflow is already in the repo)
- Instrument it: does anyone run a second Pattern Lab session? A tenth?
- No payments, no accounts. The only question being answered is whether the
  drills are sticky.

**Phase 2 — build the paid feature (if Phase 1 shows retention)**

- ~~Prop firm rule presets.~~ **Done.** `src/lib/propfirm.ts` holds the pure
  rule engine (unit-tested, `npm test`), `src/store/reducer.ts` enforces it on
  every substep, and `src/components/PropFirmCard.tsx` shows live status.
  Presets are deliberately generic shapes rather than any named firm's
  rulebook — those change, and practising a stale copy teaches wrong limits.
- Accounts and a cloud journal. This is the first real backend and the first
  real cost.
- Wire `src/lib/entitlements.ts` (already scaffolded) to a real subscription.

**Phase 3 — charge**

- A payment processor whose terms this business fits (see the payment
  processor risk below), a trial, and a paywall on the Pro features only.
- Distribution where the buyer already is: prop firm communities, r/FuturesTrading,
  the Discords around Apex/Topstep/MyFundedFutures, YouTube reviewers.
- **Marketing guardrails, checked before any of that distribution goes live**
  (driven by the 2026 regulatory posture below): never use "guaranteed,"
  "you will pass," or similar outcome language; never imply this product is
  made by, endorsed by, or partnered with any named firm unless a real,
  documented partnership exists; keep "simulated" and "practice" in the first
  sentence of any ad or post, not just the fine print; and if any of this
  distribution becomes a paid affiliate or referral relationship rather than
  organic posting, check it against NFA Notice I-26-12 specifically before it
  runs, since that notice regulates affiliate marketing for prop-firm
  evaluations directly.

## Data strategy

The current design — synthetic bars plus user-supplied CSV — deliberately
avoids market data licensing. That is a feature, not a gap.

Bundling real ES data means a CME Historical Distribution License, and if users
can export bars (not merely view them) a Subscriber Feed Distribution License
with an annual fee. Display-only charts sit in the cheaper bucket. Before
shipping bundled data, price this properly; it may be that "import your own
data, which you already license through your broker or TradingView" stays the
right answer indefinitely.

## Costs to expect

| Item | Rough cost |
| --- | --- |
| Static hosting (free tier) | $0 — it is a static bundle |
| Backend + database (Phase 2) | $20–100/month at small scale |
| Stripe | 2.9% + $0.30 per transaction |
| Domain | ~$15/year |
| Legal review (see below) | The one line item worth not skipping |

The product is unusually cheap to run: no market data feed, no execution
venue, no per-user compute until accounts exist.

## Open risks

1. **Synthetic data credibility.** Serious traders may bounce on principle. The
   prop-firm framing partly answers this — you are practising *rules and
   discipline*, where synthetic price is fine — but it is the main objection to
   handle in the marketing copy.
2. **Regulatory posture — getting more active, not less.** Displaying
   simulated performance results pulls in CFTC/NFA hypothetical-performance
   disclosure expectations (see [LEGAL-DISCLAIMERS.md](LEGAL-DISCLAIMERS.md)),
   and as of Q3 2026 the whole prop-firm-evaluation category is under fresh
   scrutiny: the CFTC has a public consultation open (closing Nov 30, 2026) on
   whether challenge fees make evaluation programs commodity-pool interests,
   the SEC has already brought enforcement against firms for marketing that
   blurred simulated vs. live accounts, and the NFA's new affiliate-marketing
   notice (I-26-12, effective Dec 1, 2026) bans language like "guaranteed
   funded account" and requires an explicit simulated/live distinction in any
   promotional material. None of this targets a practice tool directly — it
   targets the prop firms and their affiliates — but it sets the bar this
   product's own marketing copy should clear voluntarily: never imply a
   funded account, a guarantee, or affiliation with any named firm, and keep
   "simulated" load-bearing in every screenshot and ad, not just the fine
   print. If Phase 3 distribution leans on prop-firm communities or
   affiliate-style partnerships, get a lawyer to check I-26-12 specifically
   before that starts. Get a lawyer who knows futures marketing rules to
   review the whole app and its copy before taking money, regardless.
3. **Payment processor risk.** Stripe (the processor assumed in the costs
   table above) treats "investment and brokerage services" as a *restricted*,
   not prohibited, category — meaning it may approve a trading-adjacent
   business, but can also decline or pull support later without much notice.
   A practice/education tool with no real money or real market access is a
   reasonable case to make, but say exactly that in the Stripe application
   (no live trading, no signals, no funds custody), and have a fallback
   processor identified in case of a sudden account review.
4. **Prop firms could build this themselves.** They have the rules and the
   audience. Mitigations: be firm-agnostic (compare across firms, which no
   single firm will do), and move faster.
5. **Single-founder execution.** Phase 2 is real backend work.
