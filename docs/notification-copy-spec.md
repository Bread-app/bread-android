# Notification copy & social events — spec

Status: proposal. Owner: mobile + `stock-backend`.

The inbox today reads like a system log ("@prakash bought this ($2)",
"$0.00 deposited"). This spec turns it into a social feed: every row names a
person, a ticker, a dollar amount and — when there is one — the call it came
from. It also adds two event families that do not exist yet: **trade social**
(people you follow trading) and **asset moves** (a ticker moving after a call,
whether the sandwich was built by a Bread user or from an external source).

Notification `title`/`body` are rendered by `stock-backend`. The client only
displays them (`src/screens/notifications-screen.tsx`), so almost all of this
lands server-side. The one client change is §6.

---

## 1. Voice

- Lead with **who** (`@handle`) or **what** (`$TICKER`). Never with "You".
- Present tense, past for fills: "just bought", "just shorted", "is up".
- Dollar amounts, not share counts: `$100`, `$1.2K`, `$25K`. No cents above $100.
- Tickers always `$`-prefixed and upper-case: `$ZEC`, `$BTC`, `$NKE`.
- Percent moves signed with one decimal below 10%, none above: `+4.2%`, `-12%`.
- Cite the call in the possessive: `Threadguy's $ZEC thesis`,
  `Jordi Visser's $BTC call`. Use `origins[0].name`, fall back to `handle`,
  then to the builder's `@username`, then to the sandwich `name`.
- Sandwich name in the body is truncated to 40 chars with `…`.
- No exclamation marks. No emoji in title. Body may end with one short clause
  of context ("after earnings", "since the call").
- Group repeats within a window (see §4) as `@vzy and 3 others`.

### 1.1 Multi-leg sandwiches

A sandwich is a basket; most spot ones hold 2–5 legs. The rule is: **the
trade is on the basket, the move is on a leg.**

- `{ticker}` = the **primary leg**: highest `legs[].weightBps`, ties broken
  by `pnlPct` magnitude.
- `{tickers}` = legs sorted by `weightBps` desc, `$`-prefixed, top **3**,
  then `+N more`: `$ZEC, $XMR, $DASH +2 more`.
- **1 leg** → ticker form: `@vzy just bought $100 $NKE`.
- **2+ legs** → basket form: `@vzy just bought $100 of {name}`, and the
  body carries `{tickers}` so the row still reads as assets, not a title.
- Perp sandwiches are single-leg by construction, so `follow_trade_short` /
  `_long` always use ticker form.
- Asset moves on a multi-leg sandwich fire as **`sandwich_move`** on the
  basket's `pnlPct`, with the body naming the leg that contributed most —
  never one `asset_move_*` per leg, which would be 4 rows for one event.
  `asset_move_up/down` is reserved for single-leg sandwiches.
  `asset_move_catalyst` is the exception: a catalyst is about one company,
  so it fires on that leg and names the basket in the body.

---

## 2. Copy catalog

Placeholders: `{actor}` = `@username`; `{origin}` = source author name;
`{name}` = sandwich name; `{amt}` = formatted USD; `{pct}` = signed percent;
`{n}` = count of grouped actors.

### 2.1 Trade social (`category: social`) — NEW

**Audience while the user base is small: every user.** A trade by anyone is
news to everyone — that is the whole social loop right now. Never sent to the
actor themself. See §4a for the audience switch that narrows this to
followers later; the copy does not change when it flips.

| type | title | body |
|---|---|---|
| `follow_trade_buy` (1 leg) | `{actor} just bought {amt} {ticker}` | `From {origin}'s {platform}` / `Own thesis` |
| `follow_trade_buy` (2+ legs) | `{actor} just bought {amt} of {name}` | `{direction_word} {tickers} · {origin}'s thesis` / `{direction_word} {tickers} · own thesis` |
| `follow_trade_short` | `{actor} just shorted {amt} {ticker}` | `Following {origin}'s call` / `Own call` |
| `follow_trade_long` | `{actor} just longed {amt} {ticker}` | same as above |
| `follow_trade_sell` | `{actor} closed {name} {pct}` | `Held {duration}` |
| `follow_trade_buy` (grouped) | `{actor} and {n} others bought {name}` | `{amt_total} in the last {window}` |
| `your_sandwich_bought` (rename of `sandwich_bought`) | `{actor} bought {amt} of your {name}` | `{n_total} people are now in` |

Examples:

- **@vzy just bought $100 $ZEC** / From Threadguy's YouTube
- **@vzy just bought $100 of Privacy coins rerate** / Long $ZEC, $XMR, $DASH +1 more · Threadguy's thesis
- **@prakash just shorted $300 $BTC** / Following Jordi Visser's call
- **@vzy and 3 others bought Memory supercycle** / $1.4K in the last hour
- **@prakash bought $5 of your Sandisk gamble** / 12 people are now in

Direction → verb: `venue === 'perp' && direction === 'short'` → shorted;
`perp && long` → longed; `spot` → bought.

### 2.2 Asset moves (`category: market`) — NEW

Fired to everyone **holding** the sandwich, plus everyone who **liked or
commented** on it in the last 14 days. Both in-app-built and external-origin
sandwiches, including curated ones.

| type | title | body |
|---|---|---|
| `asset_move_up` | `{ticker} is up {pct} since {origin} called it` | `{name} · you're up {your_pct}` (holders) / `{name}` (watchers) |
| `asset_move_down` | `{ticker} is down {pct} since {origin} called it` | same |
| `asset_move_catalyst` | `{ticker} is {up/down} {pct} after {catalyst}` | `{origin}'s thesis · {name}` |
| `sandwich_move` (2+ legs) | `{name} is {up/down} {pct}` | `{top_leg} {top_leg_pct} did most of it · {n_legs} assets` |
| `position_milestone` (existing) | `You're up {pct} on {name}` | `Bought {when} · {amt} → {amt_now}` |

Examples:

- **$BTC is up +6.1% since Threadguy called it** / BTC supercycle · you're up +4.8%
- **$NKE is down -9% after earnings** / Jordi Visser's thesis · Sneaker rebound
- **Rich privacy buyers is up +21%** / $ZEC +34% did most of it · 4 assets

`{catalyst}` comes from `research.catalysts[].label` when the move happens
within ±1 trading day of `catalysts[].date`; otherwise omit the clause and
fall back to `asset_move_up/down`.

### 2.2b Market pulse (`category: market`) — NEW

Asset moves for things the user does **not** hold. The goal is one tap from
"something happened" to a trade pad with the asset loaded. Every row here is
a reason to open the app; the budget in §4b is what keeps it from being
spam.

Universe: every asset tradable in the app — tokenized stocks and perp
markets — plus every ticker that appears as a leg in any sandwich (in-app,
external-origin or curated).

| type | trigger (see §4b) | title | body |
|---|---|---|---|
| `market_mover` | leg/asset move beyond its own volatility | `{ticker} {pct} today` | `{reason_clause} · {hook}` |
| `market_catalyst` | earnings / scheduled catalyst hit | `{ticker} {pct} after {catalyst}` | `{origin} called this in {name}` / `{hook}` |
| `market_call_vindicated` | an origin's call is up ≥ 15% since the call | `{origin} was right on {ticker}` | `{pct} since the call · {name}` |
| `market_call_wrong` | an origin's call is down ≥ 15% since the call | `{ticker} is going against {origin}` | `{pct} since the call · fade it?` |
| `market_open_digest` | daily, at the recipient's local 9:25am | `Before the open: {ticker1} {pct1}, {ticker2} {pct2}` | `{n} of your sandwiches move today · {top_catalyst}` |
| `market_ath` | asset closes at 52-week high/low | `{ticker} at a 52-week {high/low}` | `{pct_30d} in 30 days · {hook}` |

`{hook}` is one of a fixed rotation, chosen by direction and by whether the
recipient has an open sandwich on the ticker, never random:

| situation | hook |
|---|---|
| down, no position | `Buy the dip?` |
| down, holds long | `Your {name} is {your_pct}` |
| up, no position | `Still time to get in` (only if `pct < 15`) / `Short the top?` (perp available) |
| up, holds long | `You're up {your_pct}` |

`{reason_clause}` comes from the first that exists: a catalyst within ±1
trading day, the `editorialSummary` of the newest sandwich citing the ticker
(first sentence, 60 chars), or nothing.

Examples:

- **$NKE -9% today** / Earnings missed on China · Buy the dip?
- **$BTC +6.1% today** / Threadguy called this in BTC supercycle · Still time to get in
- **Threadguy was right on $ZEC** / +34% since the call · Privacy coins rerate
- **$NVDA is going against Jordi Visser** / -12% since the call · fade it?
- **Before the open: $NKE -9%, $TSLA +4%** / 2 of your sandwiches move today · Nike earnings

Deep links: `market_*` → `/stock-detail` `{ symbol }` for tokenized stocks,
`/phoenix-position` `{ symbol }` for perps, with `openTradePad: '1'` so
the pad is already up.
When the ticker is a leg in a sandwich the recipient holds or liked, go to
`/sandwich-detail` instead — the basket is the better trade.

### 2.2c News from X handles (`category: market`) — NEW

A curated list of X accounts (Threadguy, Jordi Visser, Tae Kim, the
@tokens-style feeds, whoever you add in the dashboard, §7) is polled, and
every new post that mentions a tradable asset becomes a notification with
the asset ready to trade. This is "news" for market pulse: not an earnings
calendar, but *the people the user already follows for calls, saying
something about a ticker*.

**Pipeline**

1. Poll each handle on its configured interval (default **2 min** for
   `tier: hot`, **15 min** for `tier: normal`). Store every post once
   (`news_posts`, keyed by tweet id); replies and retweets skipped unless
   the handle's settings say otherwise.
2. **Asset extraction.** For each new post, match against the tradable
   catalog: `$TICKER` cashtags first, then company/coin names by an alias
   table (`nike → NKE`, `bitcoin → BTC`), then an LLM pass for the
   implicit case ("memory stocks", "the privacy trade") that returns
   `{ assets: [{ symbol, confidence, direction: bullish|bearish|neutral }] }`.
   Keep assets with confidence ≥ 0.7. A post with no asset is stored but
   never notifies.
3. **Merge with the handle's pinned assets** (§7): a handle tagged `$BTC`
   gets `$BTC` attached at confidence 0.6 to every post that has no
   explicit asset, so a "we're so back" from a BTC account still routes to
   BTC — but only pushes if something else lifts the score (§4b).
4. Score per recipient with the §4b table, plus: **+40 if the recipient
   follows this handle on X** (we have the X OAuth link), **+25 if the
   handle is `tier: hot`**, **+20 if the recipient has ever traded a
   sandwich sourced from this handle**.
5. Write a `market_news` row; push within the §4b budget.
6. If the post scores ≥ 0.85 on the existing sandwich-build heuristic
   (the same gate the composer's "paste a tweet" flow uses), also queue an
   **auto-sandwich** draft, which lands as `origin_new_sandwich` when it
   publishes. Handle-level toggle, off by default.

**Copy**

| type | title | body |
|---|---|---|
| `market_news` | `{handle_name} on {ticker}` | `"{post_80}" · {hook}` |
| `market_news` (with a move) | `{ticker} {pct} after {handle_name}'s post` | `"{post_80}"` |
| `market_news` (multi-asset) | `{handle_name} on {tickers}` | `"{post_80}"` |
| `market_news_thread` | `{handle_name} posted a thread on {ticker}` | `{first_line_80} · {n} posts` |

`{post_80}` is the post text with URLs stripped, truncated at a word
boundary to 80 chars. `{pct}` is attached when the asset has moved ≥ 1%
since the post (checked at 15 and 60 minutes; the row is updated in place,
which is what "after {handle}'s post" needs to be true).

Examples:

- **Threadguy on $ZEC** / "privacy is the only trade that matters this cycle" · Buy the dip?
- **$BTC +4.2% after Jordi Visser's post** / "liquidity turning, this is the pivot"
- **Tae Kim on $NVDA, $MU** / "memory pricing is the tell for the whole AI complex"

Deep link: `/stock-detail` (or `/phoenix-position`) with `openTradePad`
**and** `tweetUrl`, so the detail screen embeds the post above the pad via
the existing `getTweetOembed`. The user sees the take and the trade on one
screen.

**Anti-spam specific to news**

- One `market_news` per (recipient, handle) per **2 hours**; a hotter post
  from the same handle inside the window replaces the row's text.
- One per (recipient, ticker) per **6 hours**, shared with `market_mover`.
- Handles marked `tier: hot` can bypass the 2-hour window once per day
  (`bypassBudget: true` in §7) for a post the extraction marks
  `direction != neutral` and confidence ≥ 0.9 — the "Threadguy just
  flipped short" case that's worth interrupting for.
- A handle whose 7-day push open rate falls below 10% is auto-demoted to
  inbox-only and flagged in the dashboard.

### 2.3 New sandwiches (`category: social`)

All three go to **every user** for now (§4a). `following_new_sandwich` keeps
its name so the existing preference toggle still applies; only its audience
widens.

| type | audience (now) | title | body |
|---|---|---|---|
| `following_new_sandwich` (existing, recopy) | everyone | `{actor} built {name}` | `{direction_word} {tickers} from {origin}'s {platform}` |
| `origin_new_sandwich` — NEW | everyone | `New {origin} call: {ticker}` | `{name} · {n_legs} markets` |
| `curated_new` — NEW | everyone opted into `product` | `{ticker} thesis just dropped` | `{origin} on {platform} · {summary_40}` |

Examples:

- **@vzy built ZEC privacy trade** / Long $ZEC, $XMR from Threadguy's YouTube
- **New Threadguy call: $SOL** / Solana ETF flows · 3 markets
- **$NVDA thesis just dropped** / Tae Kim on YouTube · Memory pricing is the tell

### 2.4 Money (`category: money`) — recopy only

| type | title | body |
|---|---|---|
| `deposit_received` | `{amt} landed` | `Ready to trade` |
| `withdrawal_sent` | `{amt} sent to {dest_short}` | `Usually arrives in {eta}` |

**Suppress** `deposit_received` when `amount < $0.01` — the `$0.00 deposited`
rows in the screenshot are dust settlements and must not notify.

### 2.5 Engagement (`category: social`) — recopy only

| type | title | body |
|---|---|---|
| `sandwich_like` | `{actor} liked {name}` | `{like_count} likes` |
| `sandwich_like` (grouped) | `{actor} and {n} others liked {name}` | — |
| `sandwich_comment` | `{actor}: "{comment_60}"` | `on {name}` |
| `comment_mention` | `{actor} mentioned you` | `"{comment_60}"` |
| `follow` | `{actor} followed you` | `{hit_rate}% hit rate · {resolved} calls` (only when `record.visible`) |
| `weekly_recap` | `Your week: {pct} across {n} sandwiches` | `Best: {best_name} {best_pct}` |

---

## 3. Payload additions

Add a `meta` object to `AppNotification`. Everything the copy above needs is
already in the notification's context at write time; storing it lets the
client render chips/bold spans later without a re-copy migration, and lets
the copy be regenerated if templates change.

```ts
meta: {
  ticker?: string;            // "$ZEC" — the primary leg (highest weightBps)
  tickers?: string[];         // all legs by weightBps desc, for the composer row
  legCount?: number;
  topLeg?: { ticker: string; pct: number } | null; // sandwich_move only
  amountUsd?: number;         // notional of the trade that fired this
  pct?: number;               // the move / P&L this row is about
  direction?: 'long' | 'short' | 'buy' | 'sell';
  venue?: 'spot' | 'perp';
  origin?: { name: string | null; handle: string | null; platform: string } | null;
  sandwichName?: string;
  catalyst?: string | null;
  groupedActorCount?: number;
  /** Market pulse: the trade hook to render as a chip, and where it goes. */
  hook?: string | null;
  symbol?: string;            // raw symbol for /stock-detail etc.
  relevanceScore?: number;    // for debugging why this pushed // > 1 when collapsed
} | null;
```

`target` for every new type:

| type | route | params |
|---|---|---|
| `follow_trade_*`, `your_sandwich_bought`, `asset_move_*`, `sandwich_move`, `origin_new_sandwich` | `/sandwich-detail` | `{ id }` |
| `follow_trade_*` on a perp | `/phoenix-position` (own) or `/sandwich-detail` (other's) | `{ id }` |
| `curated_new` | `/curated-sandwich` | `{ id: curatedId }` |
| `follow` | `/notifications` with `entityType: 'user'` | actor handled client-side |

---

## 4a. Audience mode

One server setting, `NOTIF_SOCIAL_AUDIENCE = 'everyone' | 'followers'`.

- **`everyone` (launch default).** `follow_trade_*`, `following_new_sandwich`
  and `origin_new_sandwich` fan out to every user with an account, minus the
  actor. With a few dozen users this is the feed; a fan-out per event is a
  single `INSERT … SELECT id FROM users WHERE id <> $actor`.
- **`followers`.** The original design: actor's followers + the sandwich's
  builder. Flip when daily trade-social volume per recipient regularly hits
  the push cap below, or when the user count passes ~500 — whichever first.
- `asset_move_*` is **not** affected: it is scoped to holders/likers in both
  modes, because a ticker moving is only news to someone with a stake in it.
- Nothing in the copy, the `meta` payload or the client depends on the mode,
  so the flip is a config change with no migration.

## 4. Triggers, thresholds, dedupe

**Trade social**

- Fire on every filled order ≥ **$1** notional in `everyone` mode (the point
  is to show activity; in a small app a $2 buy is worth a row). Raise to
  **$5** when the mode flips to `followers`. Below the floor accumulate
  silently into the grouped row.
- Group per `(recipient, sandwichId, type)` within a **60-minute** window:
  update the existing unread row in place (bump `actorCount`, `amountUsd`
  total, `createdAt`) instead of inserting. Twitter-style.
- Cap: **10 trade-social pushes per recipient per day**; overflow still lands
  in the inbox but is not pushed. The inbox row is the product; the push is
  the reminder.
- In `everyone` mode the actor's own trade must not come back to them under
  a grouped row either — exclude the actor at fan-out, not just at insert.

**Asset moves**

- Evaluate on the existing price poll. Single-leg sandwiches watch the leg's
  price; multi-leg sandwiches watch the basket `pnlPct` (already computed
  for the card) and fire `sandwich_move`. Scope: every sandwich with ≥ 1
  holder or ≥ 1 like in the last 14 days.
- `top_leg` for the `sandwich_move` body = the leg with the largest
  `weightBps × pnlPct` contribution, not the largest raw move — a 40% pop
  on a 5% leg is not what moved the basket.
- Fire when `|move since call| ≥ 5%` for the first time, then at every new
  **+5% band** crossed in either direction (`5, 10, 15, 20, 30, 50`) —
  reuse `positionAlertStepPct` for holders; watchers get the fixed ladder.
- `asset_move_catalyst` preempts the band logic: a move ≥ 3% within the
  catalyst window fires once, tagged with the catalyst.
- One `asset_move_*` per `(recipient, ticker)` and one `sandwich_move` per
  `(recipient, sandwichId)` per **6 hours**; bands crossed inside the
  cooldown roll up into the next row's `pct`.
- A ticker shared by several sandwiches the recipient holds (e.g. $BTC in
  three baskets) fires **once**, on the sandwich with the largest position,
  and the body appends `· also in {n} other sandwiches`.
- Never fire an asset move for a ticker the recipient already got a
  `position_milestone` for in the same 6-hour window — same news twice.

## 4b. Market pulse: the push budget

The failure mode is obvious — a price-alert app that fires on every 3% move
gets muted in a week. The design constraint is therefore not "what can we
notify" but **how many pushes a day is a user glad to get**. Everything
below serves that number.

**Budget**

- Each recipient has a daily push budget of **3 market-pulse pushes**,
  resetting at local midnight. The morning digest, when sent, spends 1.
- Rows beyond the budget still land in the inbox (silent, no push, no
  badge bump) — the inbox is allowed to be busier than the phone.
- Held-asset alerts (`asset_move_*`, `sandwich_move`, `position_milestone`)
  live outside this budget; those are about the user's money and are
  governed by §4.
- Trade-social (§2.1) has its own cap in §4. Total pushes across every
  category are hard-capped at **8/day**; past that, everything goes inbox-
  only until midnight.

**What earns a push: significance, not a fixed %**

- A move is significant at a fixed floor per asset class, measured
  against the previous daily close: **3% for tokenized stocks, 6% for
  crypto**. The class comes from the catalog (`legType` /
  `tokenized_stock` vs the perp/crypto venue). Two floors, not one,
  because $BTC moving 3% is Tuesday while $NKE moving 3% is news.

  *Later, optional:* replace the floors with `2 × σ30d` — twice the
  asset's own 30-day daily volatility — once the price service exposes 30
  daily closes per asset. Nothing else in this section changes.
- Catalysts: any move ≥ 3% within ±1 trading day of a `research.catalysts`
  date, or an earnings date from the market-data feed.
- `market_call_vindicated/wrong` fire once per (origin, ticker, sandwich)
  at the first 15% crossing, never again.

**What earns *this user's* push: relevance**

Each candidate event is scored per recipient and the day's budget goes to
the highest-scoring events at the moment they happen. Score, additive:

| signal | points |
|---|---|
| ticker is in a sandwich the user holds | (handled by §4, not here) |
| ticker is in a sandwich the user liked / commented / opened in 30d | +50 |
| ticker's origin is one the user has traded or liked before | +30 |
| ticker is in a curated sandwich currently live | +20 |
| user has traded this ticker before | +40 |
| user has opened the app in the last 3 days | +10 |
| event has a catalyst clause | +15 |
| event is a `call_vindicated/wrong` | +10 |
| no signal at all (pure market universe) | 0 |

- Score < 20 never pushes, only inboxes. A brand-new user with no history
  therefore gets only the morning digest and catalyst events — the two that
  don't need history to be relevant.
- Same ticker never pushes twice to one recipient within **24h**; a bigger
  move on a ticker already pushed today updates that row's `pct` in place.
- Same *sandwich* never gets more than one market-pulse push per day even if
  three of its legs move.

**Adaptive back-off (the actual anti-spam mechanism)**

Per recipient, track market-pulse pushes and whether each led to an open
within 30 minutes.

- 3 consecutive ignored pushes → budget drops to 1/day.
- 6 consecutive ignored → budget drops to digest-only.
- Any open resets to 3/day.
- Opening the app from a push and trading within 10 minutes marks that
  event *type* as high-value for that user (+20 on future scores).
- A user who disables the `market` preference gets nothing here, including
  the digest. A user who disables push but keeps `market` on gets inbox
  rows only.

**Timing**

- Quiet hours are respected (existing). Events inside quiet hours queue and
  the highest-scoring one goes out as the first push after they end — or
  folds into the morning digest if that's sooner.
- The digest is sent only if it has ≥ 2 items scoring ≥ 20 for this user;
  an empty digest is worse than none.
- No market-pulse push within 15 minutes of another push of any category
  to the same device — space them.

**Kill switch and metrics**

- `NOTIF_MARKET_PULSE=0` disables §2.2b entirely at the source.
- Log per push: type, score, opened-within-30m, traded-within-10m.
- Dashboard thresholds: if the 7-day `market` opt-out rate exceeds 2% of
  recipients, or open rate falls below 15%, cut the default budget to 1
  until it recovers. This is what "shouldn't feel like spam" means in
  numbers.

**New sandwiches**

- `origin_new_sandwich`: everyone in `everyone` mode; in `followers` mode,
  users who bought or liked ≥ 1 sandwich with the same `origins[].handle`.
  Max 1 per origin per recipient per day in both modes.
- `curated_new`: fires when `isActive` flips true. Max 2 per recipient per day.

**Quiet hours / preferences**: unchanged. Trade social and new sandwiches are
`social`; asset moves are `market`; `curated_new` is `product`.

---

## 5. Migration

1. Add `meta jsonb null` to `notifications`. Backfill nothing.
2. Add new `type` values; keep old ones readable — the client switch in
   `iconForType` falls through to a bell for unknowns.
3. Rename `sandwich_bought` → `your_sandwich_bought` at write time only; do
   not rewrite history.
4. Recopy is write-time only. Old rows keep their old text.
5. Ship behind `NOTIF_SOCIAL_COPY=1`; flip per-environment.

---

## 6. Client changes (mobile, this repo)

Small and independent of the flag:

- `AppNotification` gains `meta` (nullable) in `src/lib/api.ts`.
- `iconForType` in `src/screens/notifications-screen.tsx` learns:
  `follow_trade_buy|long` → `arrow-up-circle`, `follow_trade_short` →
  `arrow-down-circle`, `asset_move_up` → `trending-up`, `asset_move_down` →
  `trending-down`, `sandwich_move` → `layers`, `origin_new_sandwich` /
  `curated_new` → `sparkles`. Rows with an `actor` keep the avatar.
- When `meta.ticker` is present and the actor avatar is shown, render the
  ticker as a small pill under the avatar — optional, phase 2.
- Notification settings: add "People you follow trade" under Social, and
  under Markets: "Moves on sandwiches you hold or liked" and "Market pulse —
  big moves, earnings, calls playing out" with a sub-picker for the daily
  budget (`Off / 1 / 3`). Preference keys `socialTrades`, `marketMoves`,
  `marketPulse`, `marketPulseBudget` (defaults on / on / on / 3).
- `openTradePad` param: `/stock-detail` and `/phoenix-position` read it
  and open the trade sheet on mount. The
  screens already own those sheets; this is a one-line `useEffect` each.
- `tweetUrl` param on the same screens renders the post above the pad via
  the existing `getTweetOembed` — the news row's "take + trade" screen.

---

## 7. Ops dashboard: news sources (`bread-ops`)

A page in the existing Next.js ops app (`bread-ops/src/app/news-sources/`),
same auth as the curated-sandwich admin, backed by
`/api/admin/news-sources*` on `stock-backend`.

**Data model**

```ts
news_sources {
  id: uuid
  handle: text            // "threadguy", no @
  displayName: text       // from X profile, refreshed daily
  avatarUrl: text | null
  tier: 'hot' | 'normal'  // poll interval + score bonus + budget bypass
  pollIntervalSec: int    // override; null = tier default
  pinnedAssets: text[]    // ["BTC","ZEC"] — attached at confidence 0.6
  includeReplies: bool    // default false
  includeReposts: bool    // default false
  autoSandwich: bool      // default false — §2.2c step 6
  bypassBudget: bool      // default false — hot handles only
  pushEnabled: bool       // false = inbox-only for this handle
  active: bool
  addedBy: text
  lastPolledAt, lastPostAt: timestamptz
  createdAt, updatedAt
}

news_posts {
  id: text (tweet id)
  sourceId: uuid → news_sources
  text, url, postedAt
  assets: jsonb           // [{ symbol, confidence, direction, method: cashtag|alias|llm|pinned }]
  notifiedCount: int
  openedCount: int
  tradedCount: int
}
```

**Page: `/news-sources`**

Table of handles, one row each:

| column | |
|---|---|
| avatar + @handle + name | link out to X |
| tier | toggle `hot` / `normal` |
| pinned assets | chips, click to edit |
| status | active / paused / **auto-demoted** (red, with the open rate that did it) |
| last post | relative time + first 60 chars |
| 7d: posts / notified / opened / traded | four numbers; opened and traded as % of notified |
| toggles | push · auto-sandwich · bypass budget |
| ⋯ | pause · delete · "send test to me" |

Top bar: **Add handle** (paste `@handle` or a profile URL; the backend
resolves the profile, shows avatar + name + follower count for confirmation
before saving), search, filter by tier / status, and the global switches
`NOTIF_MARKET_PULSE` and the default daily budget from §4b, editable here
so a bad day can be turned down without a deploy.

**Row detail (click a handle)**

- Last 50 posts, each with: text, time, the extracted assets as chips with
  their confidence and method (`cashtag` / `alias` / `llm` / `pinned`),
  and the notification it generated — or the reason it didn't (`no asset`,
  `below score`, `budget exhausted`, `handle window`, `ticker window`).
  This is the debugging view: when a handle "isn't working", the answer
  is on this screen.
- Per-post actions: **re-extract** (rerun step 2 after editing the alias
  table), **notify now** (force a push to everyone, bypassing budget —
  logged with who did it), **make sandwich** (drop into the existing
  composer flow with the tweet as source).
- Edit pinned assets, tier, toggles inline.

**Page: `/news-sources/aliases`**

The name→ticker alias table (`nike → NKE`, `sol → SOL`), editable, with a "posts this alias matched in 7d"
count so dead aliases are visible.

**Page: `/news-sources/log`**

Every `market_news` and `market_pulse` push in the last 7 days: recipient
count, score distribution, open rate, trade rate, grouped by handle / type
/ ticker. The §4b kill-switch thresholds are shown as lines on the chart so
it's obvious when one is about to trip.

**API**

```
GET    /api/admin/news-sources                 list + 7d stats
POST   /api/admin/news-sources                 { handle } → resolves profile, creates
PATCH  /api/admin/news-sources/:id             any field above
DELETE /api/admin/news-sources/:id
GET    /api/admin/news-sources/:id/posts       last 50 with extraction + outcome
POST   /api/admin/news-sources/:id/posts/:postId/re-extract
POST   /api/admin/news-sources/:id/posts/:postId/notify
POST   /api/admin/news-sources/:id/test-push   to the caller only
GET/PUT /api/admin/news-aliases
GET    /api/admin/notifications/log?days=7
GET/PUT /api/admin/notifications/settings      market pulse switch + default budget
```

**Seed handles**

The first three, inserted by the migration so the feature works on day one:

| handle | tier | pinned assets | notes |
|---|---|---|---|
| `@tokens` | hot | — | Already the `feedSource: 'x'` behind the token news feed; its posts are per-asset so cashtag extraction alone should cover it. Reuse the existing ingestion rather than polling it twice — §2.2c step 1 reads from the current pipeline for this handle. |
| `@tradfi` | normal | — | Stock/TradFi flow. Mostly names, not cashtags — the alias table (§7, `/news-sources/aliases`) does the work here; seed it with every tokenized stock's company name before enabling push. |
| `@wallstengine` | hot | — | Breaking macro + single-stock headlines, high volume. Highest spam risk of the three: keep `bypassBudget: false`, `includeReposts: false`, and watch its 7d open rate in the log for the first week before promoting anything. |

All three start `pushEnabled: true`, `autoSandwich: false`. No pinned assets —
they're multi-asset feeds and a pinned ticker would mis-route every
off-topic post. Pinning is for single-thesis accounts (a Threadguy tagged
`$ZEC`), added later through the dashboard.

Expect `@tradfi` and `@wallstengine` to post the same headline minutes
apart. Dedupe across handles on **(ticker, direction) within 30 min**:
the second post attaches to the first row as `· also @wallstengine`
rather than firing again. That's a cross-handle window on top of the
per-handle one in §2.2c.

**X polling**

Uses the same X API credentials the auto-buy like-listener already has.
Budget math: 20 hot handles at 2 min + 80 normal at 15 min ≈ 14.4K + 7.7K
= ~22K user-timeline reads/day, inside the Basic tier's 10K/month **only
if** batched through `GET /2/tweets/search/recent` with `from:a OR from:b …`
(up to ~25 handles per query, 512-char cap) — one query per tier per
interval instead of one per handle. Plan for that from day one.

## 8. Position takes — "Add thesis" on a holding

Today a holder is a number on a card. The only text on a sandwich is the
builder's `commentary`, written once at build time. A **take** is a post a
holder writes *while holding* — "why I'm in", "still in after the dip",
"adding here" — attached to the position so the post carries a live,
verified P&L stamp. Only an **open** position can take a thesis; what a
holder says when they close is a separate feature, not covered here. It is the social loop's other half: trade-social (§2.1)
tells everyone *that* you bought; a take tells them *why*, and lets them
copy the trade from the post.

### 8.1 What the user sees

**On the own profile**, under every open holding card (sandwich, perp
sandwich, Phoenix position) a row with one button: **Add thesis** — or, if
the position already has takes, **Update thesis · {n}**. Never on another
user's profile; `PublicSandwichHoldingCard` shows the latest take as a
quote line instead.

**Composer** (`/position-take-composer?positionId=…`), a sheet:

- Header: the position as the reader will see it — name, direction,
  `+12% · 13d`, size band (§8.4).
- Text field, 500 chars, placeholder rotates by state:
  - first take: *"Why are you in this?"*
  - in profit: *"Still holding at +12%. What's the plan?"*
  - in loss: *"Down 8%. Conviction or exit?"*
- Optional attach: paste an X or YouTube link → rendered as an embed via
  the existing `getTweetOembed` / YouTube card. One link per take.
- Optional **Signal** chip, single-select: `Adding` · `Holding` ·
  `Trimming`. Optional — first posts should be frictionless; revisit
  making it required once people are used to it. When set it's stored as
  structured data and used in copy and filters. There is no `Out`: a take
  is written while holding.
- Post. Haptic, sheet closes, the take appears under the holding card
  immediately (optimistic), and on the sandwich detail screen.

**On the sandwich detail screen** a new section **Takes** between the
thesis and the comments: every take from every holder, newest first, each
with avatar, `@handle`, the verified stamp (`holding · +12% · 13d`, or
`closed at +21%`), signal chip, text, embed. Sorted by the taker's
position age so early holders with a track record float up, not by likes.

**In the feed** a take is a card (`SandwichPost.kind: 'take'`) with the
same layout plus a **Copy trade** button that opens the trade sheet for
the same sandwich with the taker's size band pre-selected. Likes and
comments go through the existing Post routes — a take *is* a Post.

**In the inbox**, per §2.1 audience rules (everyone, for now):

| type | title | body |
|---|---|---|
| `holder_take` | `{actor} on their {ticker} position` / `{actor} on {name}` | `"{take_80}" · {stamp}` |
| `holder_take` (signal set) | `{actor} is {adding to / holding / trimming} {name}` | `"{take_80}" · {stamp}` |
| `holder_take_reply` (to a take on *your* sandwich, builder only) | `{actor} wrote a thesis on your {name}` | `"{take_80}" · {stamp}` |

Examples:

- **@vzy on their $ZEC position** / "privacy is the only trade that matters this cycle" · +12% · 13d
- **@prakash is trimming Memory supercycle** / "taking half off into earnings" · +34% · 3w
- **@vzy wrote a thesis on your Sandisk gamble** / "the HBM angle nobody's pricing" · +4% · 2d

`meta` gains `takeId`, `signal`, `stamp: { pct, ageDays, closed }`.

### 8.2 Data model

A take is a row in the existing **Post** table (it must be — likes,
comments, feed paging and `postId` all key on it) plus one join row that
pins it to a verified position.

```ts
posts {                          // existing
  id, kind: 'episode'|'thesis'|'curated'|'take'   // + 'take'
  authorId, title, createdAt, …
}

position_takes {
  id: uuid
  postId: uuid → posts (unique)          // the take IS this post
  authorId: uuid → users
  // exactly one of the three is set — what the take is attached to
  sandwichPositionId: uuid | null → sandwich_positions
  perpPositionId:     uuid | null → perp_sandwich_positions
  phoenixPositionKey: text | null        // on-chain position pubkey
  sandwichId: uuid → sandwiches          // denormalised for the detail-screen query
  body: text (≤ 500)
  signal: 'adding'|'holding'|'trimming' | null
  attachmentUrl: text | null
  attachmentKind: 'x'|'youtube' | null
  // snapshot at write time — the stamp the reader sees is LIVE from the
  // position; this is what the take said at the moment it was written,
  // kept for the track record after the position closes
  snapshotPnlPct: numeric
  snapshotAgeDays: int
  snapshotSizeBand: text                 // §8.4
  // filled when the position closes; the take then renders "closed at"
  closedPnlPct: numeric | null
  closedAt: timestamptz | null
  editedAt: timestamptz | null
  deletedAt: timestamptz | null
  createdAt: timestamptz
}
index (sandwichId, createdAt desc)
index (authorId, createdAt desc)
index (sandwichPositionId), (perpPositionId), (phoenixPositionKey)
```

**Verification.** `POST /api/position-takes` refuses unless the referenced
position belongs to the caller **and is open**. A closed position cannot
take a new thesis, full stop. The server, not the client, reads the position's
current P&L for the snapshot. This is what makes the stamp mean something:
a take can't claim a position the author doesn't hold.

**Closing.** The existing close path (sell / settle / Phoenix close) runs
`UPDATE position_takes SET closedPnlPct = $realized, closedAt = now()
WHERE <position ref>`. Takes *written while open* survive the close: the
profile's closed list and the detail screen keep showing them with the
closed stamp, which is how a taker builds a visible record without Bread
having to score them. No new takes after that point.

### 8.3 API

```
POST   /api/position-takes                 { positionRef, body, signal?, attachmentUrl? } → take + post
PATCH  /api/position-takes/:id             { body, signal, attachmentUrl } — 15-min edit window
DELETE /api/position-takes/:id             soft delete; the post row stays for comment integrity
GET    /api/sandwiches/:id/takes?cursor    detail screen, newest first, holder-age sort
GET    /api/users/:id/takes?cursor         profile tab
GET    /api/positions/:ref/takes           the holding card's "Update thesis · n" and thread
```

`GET /api/posts` (the feed) returns takes as `kind: 'take'` with a `take`
sub-object: `{ stamp: { pct, ageDays, closed, closedPct }, signal,
sizeBand, attachment, author }`. The sandwich detail is included as
`sandwiches[0]` exactly like a thesis card so Copy trade needs nothing new.

### 8.4 Privacy: size bands

Dollar size is never shown raw on a take. The taker's position size is
bucketed server-side into `< $100 · $100–1K · $1K–10K · $10K+` and the
user can set it to **hidden** in settings (`showPositionSize: false`,
default `true`). Direction, return % and holding age are always shown —
without them a take is just a tweet.

### 8.5 Rules

- One take per position per **hour**; the composer shows the countdown
  rather than erroring after typing.
- 500 chars. No take with an empty body — an attachment alone isn't a
  thesis.
- Edit window 15 min, marked `edited`. Delete any time; comments on a
  deleted take stay attached to the (now hidden) post.
- Takes are `social` for preferences and follow the §4 trade-social cap.
- `holder_take` never fires for the author, and is deduped against
  `follow_trade_*` for the same (actor, sandwich) within 10 min — someone
  who buys and immediately writes why should generate one row, the take,
  with the amount folded into its stamp.

### 8.6 Client work (this repo)

- `src/components/sandwich-holding-card.tsx`: an optional `takes` prop
  (`{ count, latest } | null`) and an `onAddTake` callback. When
  `onAddTake` is set (own profile only) render the **Add thesis / Update
  thesis · n** row under the legs; when `takes.latest` is set render its
  first line as a quote under the byline in both the own and public card.
- Same on the Phoenix position sheet and the perp sandwich holding card.
- New `src/app/(app)/position-take-composer.tsx` + `src/screens/position-take-composer-screen.tsx`.
- `src/screens/sandwich-screen.tsx` and `podcast-sandwich-screen.tsx`: a
  **Takes** section, paged.
- `src/lib/api.ts`: `PositionTake` type, the six calls above,
  `SandwichPost.kind` gains `'take'` and the `take` sub-object; the feed
  renders a `TakeCard` variant with **Copy trade**.
- Notification icons: `holder_take` → `chatbox-ellipses`,
  `holder_take_reply` → `chatbubbles`.
- Settings: `showPositionSize` toggle under Profile.

## 9. Open questions

**Decided**

- News = X handles only (§2.2c). No earnings calendar from the data
  provider. `market_catalyst` stays, driven by `research.catalysts` dates.
- Liked-but-not-held watchers get `asset_move_*` for **14 days** after the
  like.
- Prediction markets are no longer supported; every reference removed.
  `venue` is `spot | perp`.
- `@tokens`: reuse its existing ingestion for tweet ids; do the same for
  any other handle the current pipeline already pulls, and poll only the
  ones it doesn't.
- Phoenix close hook: proceed on the assumption the close path has realized
  P&L (the close sheet renders it).
- Move thresholds: fixed **3% stocks / 6% crypto** vs previous daily
  close. No memecoin class. σ30d is a later upgrade, not a launch
  dependency.
- Takes: only on **open** positions. Signal chip optional, no `Out`
  option. A closing thesis is a separate, future feature.

**Still open**

- ~~Should the builder see trades from people they don't follow?~~ Moot in
  `everyone` mode; in `followers` mode the builder is always included.
