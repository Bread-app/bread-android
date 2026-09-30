# Later: paying the people who bring the alpha

Not in the notification spec on purpose. A reminder, not a design.

**The gap.** Right now nobody has a reason to post on Bread. A user who
digs a thesis out of a podcast and builds a sandwich gets a card and some
likes; the value they created — other people trading it — flows to the
protocol and the venue, not to them.

**Two fee streams, same mechanism.**

1. **Builder fee.** When someone trades a sandwich, a slice of the fee
   goes to the Bread user who built it (`Sandwich.builder`). Curation is
   the work: picking the one post out of thousands and mapping it to
   markets. Pay for it.

2. **Origin fee.** The other slice accrues to the *source* — Threadguy,
   Jordi Visser, Tae Kim — whether or not they're on Bread yet. It sits
   unclaimed against their handle. Later they log in with the same X /
   YouTube account, and the claim flow hands them the balance plus every
   citation. That's the creator-onboarding wedge: "you've already earned
   $X here, come get it" beats any cold outreach.

**What already exists.** `SandwichOrigin.claimedBy` and the
X-summon claim endpoint (`api.ts` ~line 1876) already move sandwiches to
an origin who signs in. The fee ledger would hang off the same identity
key — the missing pieces are accrual per trade and a claimable balance,
not the claim itself.

**Open, for when this is picked up.**

- Split ratio builder / origin / protocol, and whether it changes when the
  builder *is* the origin (own thesis).
- Accrue on entry only, or on entry and exit?
- Unclaimed origin balances: escrow forever, or expire to the builder /
  protocol after N months?
- Does a take (position thesis) earn anything when someone hits
  **Copy trade** from it? Probably yes — it's the same curation act.
- Tax / KYC threshold for payouts.
