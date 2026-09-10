# Contributing

Thanks for the interest. A few things to know before you open a pull request,
because this project is source-available rather than open source.

## Licensing and ownership

ES Practice Lab is licensed under the [Business Source License 1.1](LICENSE),
not an open-source license. The source is public so people can read it, run it,
and practise with it — but hosting it for others or building a commercial
product on it requires a commercial license.

By submitting a contribution (code, documentation, or anything else), you agree
that:

1. You are the author of the contribution, or you otherwise have the right to
   submit it.
2. You grant the Licensor a perpetual, worldwide, irrevocable, royalty-free
   license to use, modify, sublicense, and relicense your contribution as part
   of the project — including under the Business Source License, under a
   future Change License, and under separate commercial license terms.
3. Your contribution is provided as-is, without warranty.

This keeps the ownership of the project unambiguous, which matters for a
project that is commercially licensed. If you are not comfortable with that,
please open an issue to discuss instead of submitting code.

## Before you open a PR

- `npm run typecheck` and `npm run build` must both pass.
- Keep the pure logic in `src/lib` free of React and DOM dependencies. It is
  the part that is unit-testable and the part the trading math lives in.
- All state transitions belong in `src/store/reducer.ts`. Components dispatch
  actions; they do not mutate state or compute trading math inline.
- If you change anything that touches fills, commissions, slippage,
  R-multiples, or position sizing, say so explicitly in the PR description.
  Those numbers are the product.

## Reporting a bug

Include what you did, what you expected, and what happened. If it involves a
specific session, include the seed shown in the "New session" toast — sessions
are deterministic, so the seed reproduces the exact bars.

## Security

Please do not open a public issue for a security problem. Contact the
maintainer directly.
