# Demo mode — the shoot rig

A build-time switch that replaces every backend answer a filmed sequence needs
with a scripted one. Same screens, same animations, same code paths — no real
money, no wallet prompts, no network dependency beyond the video player.

```bash
EXPO_PUBLIC_DEMO_MODE=1 npx expo start -c
```

Anything else (unset, `0`) is a completely normal app: `isDemoMode()` is a
compile-time constant and the fixture module is only imported when it is true.

## The three shots

**1 — Paste a podcast.** Paste *any* YouTube URL into the composer. Captions are
skipped, and the real analysing UI runs on a stopwatch: "Listening to the
podcast…" → "Matching calls to markets…" → the moments feed, in
`DEMO_ANALYZE_MS` (9s). Four calls land at fixed timestamps. Three are tradeable;
the fourth is declined on camera with its reason, which is worth keeping — it
shows the app saying no.

**2 — Buy.** Open any call and buy any amount. The keypad quotes, the slippage
card fills, the confirm lands and the success sheet plays. The buy route answers
with a run that requires **zero signatures**, so no wallet sheet appears and
nothing can reach a chain. The portfolio headline opens at exactly
`DEMO_PORTFOLIO_VALUE_USD` ($1,024.18); cash is whatever that leaves after the
holdings, so the figure never has to be re-tuned.

**3 — The profile.** The bought Sandwich sits in the portfolio at
`DEMO_HERO_RETURN_PCT` (+18.33%), with the portfolio value curve around it, up
`DEMO_PORTFOLIO_CHANGE_PCT` over the range.

Shots 2 and 3 are independent: a position already exists when the app opens, so
the profile can be filmed first, or re-filmed, without redoing the buy.

**4 — It's already there.** Open the app: the hero Sandwich is the top card on
the real home feed (`DEMO_FEED_PIN`). No paste, no analysis — tap it and buy.
The rest of the feed is whatever the server is serving that day; the ranker
puts the pinned card in front after it has sorted, so its numbers can be
whatever reads right.

The hero is built from a real post on X by @zeroxkyle (`DEMO_X_POST`, quoted
as written and linked), credited to @vzy as the builder (`DEMO_BUILDER`, with
the builder's take as the headline). It is a *mixed* basket, which the real
product does not allow:

| leg  | venue | side  | price   | reports  |
| ---- | ----- | ----- | ------- | -------- |
| TAO  | perp  | SHORT | $234.21 | +12.39%  |
| VVV  | spot  | LONG  | $23.62  | +38.80%  |
| CHIP | spot  | LONG  | $0.0452 | −16.69%  |

Weighted 25 / 50 / 25; the headline is their blend, +18.33%. The Sandwich itself stays
`spot`, which is what keeps it buyable through the ordinary keypad. The card
carries 8 likes and no comments.

On the profile the short is also its own row in the Phoenix layout — **TAO 3x /
SHORT / $42.15 / +$4.65** — served as an already-open position
(`demoPhoenixAccount`), sized off the seeded $150 and constant across takes.

Two things not to do on camera with the mixed basket: don't tap the TAO leg
row on the Sandwich screen (it resolves a real Phoenix market over the
network), and don't drill into the Sandwich position on the profile (stored
legs don't carry a venue, so that sheet labels every leg "Spot").

## Why the numbers agree

Nothing is hard-coded twice. The fake wallet balance for each leg is derived at
request time from that position's own cost basis:

```
quantity = invested x (1 + DEMO_HERO_RETURN_PCT / 100) / price
```

So a $50 buy and a $500 buy both read +167.4%, and the leg rows, the basket
header and the portfolio total are the app's own arithmetic over those balances
rather than three fixtures that could drift apart on screen.

Charts are seeded random walks (`demo-candles.ts`) pinned to each leg's entry and
current price — real-looking noise, identical every take. The basket chart then
anchors the blend onto the headline figure exactly as it does with live candles.

## Tuning on set

Everything a shot depends on is a constant in `demo-config.ts`: the analysis
duration, the return, the cash, the episode's title and channel, the side
holdings. The calls themselves — timestamps, quotes, tickers, weights — are
`DEMO_CALLS` in `demo-data.ts`.

The episode's `videoId` is the one fixture that touches the network, since the
player loads it for real. Point it at whatever plays best on camera.

## What is NOT faked

Auth, your profile, avatar, followers and the social graph are real: sign in
normally and the profile on screen is yours. Only cash, holdings, the episode,
the baskets and the trade are scripted.

Share links (`breadapp.fun/s/<id>`) will not resolve for a demo Sandwich — do not
film the share sheet's opened link.

`demo-fixtures.test.ts` drives the real API functions with the flag on and
asserts the payloads survive the app's own normalizers, so a shoot is never the
thing that discovers a missing field.
