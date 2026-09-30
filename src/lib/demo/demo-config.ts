/**
 * Demo mode — the shoot rig.
 *
 * A build-time switch that swaps every backend answer the app needs for a
 * scripted one, so a camera take runs the same way every time: paste a YouTube
 * link, get the same four calls, buy without a wallet prompt or a cent of real
 * money, and find the position on the profile at a fixed, healthy return.
 *
 * It is deliberately a compile-time flag rather than an in-app toggle. Nothing
 * here can be reached in a normal build — `isDemoMode()` is a constant, so the
 * fixtures fold out — and there is no gesture that can turn it on by accident
 * in front of a real wallet.
 *
 * Turn it on for a shoot build only:
 *
 *   EXPO_PUBLIC_DEMO_MODE=1 npx expo start -c
 *
 * Everything a shot depends on is a constant in this file. Change the tickers,
 * the timings and the numbers here; nothing else should need editing on set.
 */

/** The one switch. Anything false-y (including unset) means a normal app. */
export const DEMO_MODE =
  process.env.EXPO_PUBLIC_DEMO_MODE === '1' || process.env.EXPO_PUBLIC_DEMO_MODE === 'true';

export function isDemoMode(): boolean {
  return DEMO_MODE;
}

// ── Shot 1: the episode ──────────────────────────────────────────────────────

/**
 * How long the "analyzing" sequence runs before the moments feed appears.
 *
 * The real pipeline takes 1–3 minutes; this is the same UI, on a stopwatch you
 * can cut around. The three stage labels the screen shows are driven by the
 * progress split below.
 */
export const DEMO_ANALYZE_MS = 9_000;
/** Fraction of the wait spent on "Listening to the podcast…" before "Matching calls to markets…". */
export const DEMO_ANALYZE_EXTRACT_SHARE = 0.55;

/**
 * The video the demo episode pretends to be.
 *
 * `videoId` is what the in-app YouTube player loads, so it must be a real,
 * embeddable video — this is the only fixture that touches the network. Swap it
 * for whatever plays best on camera. The channel and host are invented on
 * purpose: the calls below are written by us, and putting invented calls in a
 * real person's mouth is not something a promo should do.
 */
export const DEMO_EPISODE = {
  videoId: 'dQw4w9WgXcQ',
  title: 'The compute cycle is not over — where the next $200B goes',
  channelName: 'Signal & Noise',
  channelHandle: '@signalandnoise',
  channelAvatarUrl: null as string | null,
  durationMs: 98 * 60 * 1000,
  /** How long ago the episode published — drives "3d ago" style labels. */
  publishedDaysAgo: 42,
  editorialSummary:
    'Two hours on where AI capex actually lands in 2026. The through-line: the constraint has moved from chips to power and packaging, and the market is still pricing the old bottleneck.',
  speakerName: 'Dan Mercer',
  speakerHandle: '@danmercer',
};

// ── Shot 2 + 3: the money ────────────────────────────────────────────────────

/**
 * The return the bought Sandwich shows on the profile.
 *
 * The weighted blend of the hero's three legs — 25% TAO +12.39, 50% VVV
 * +38.80, 25% CHIP −16.69 — so the card, the leg rows and the profile agree. Applied to whatever the
 * demo position holds, so it reads the same whether the buy on camera was $50
 * or $500 — the fake wallet balance is derived from the position's cost basis
 * times this.
 */
export const DEMO_HERO_RETURN_PCT = 18.33;

/**
 * The portfolio headline on Home, to the cent, before anything is bought on
 * camera. Cash is DERIVED from this — whatever is left after the side holdings,
 * the Sandwich legs and the perp short's collateral — so the figure is exact
 * rather than the sum of four fixtures that would have to be re-tuned together.
 * A buy on camera moves cash into legs at the scripted return, so the headline
 * drifts up by the return on the amount bought and nothing else.
 */
export const DEMO_PORTFOLIO_VALUE_USD = 1_024.18;

/** What the portfolio curve on Home says it has done over the selected range. */
export const DEMO_PORTFOLIO_CHANGE_PCT = 18.4;

/**
 * The position that already exists when the app opens, so the profile shot can
 * be filmed on its own without doing the buy first. A buy on camera adds to it.
 */
export const DEMO_SEEDED_INVESTED_USD = 150;

/** Loose holdings beside the Sandwich, so the portfolio isn't a single row. */
export const DEMO_SIDE_HOLDINGS = [
  { symbol: 'SOL', name: 'Solana', usdValue: 96.4, priceChange24h: 3.8, decimals: 9 },
  { symbol: 'AAPLX', name: 'Apple xStock', usdValue: 58.15, priceChange24h: 1.24, decimals: 8 },
];

/** 24h change shown against each leg of the hero basket. */
export const DEMO_LEG_DAY_CHANGE_PCT = 4.6;

/**
 * How far back the demo Sandwiches were "created" — the chart's x-axis span.
 * Kept inside the X post's age below so the Sandwich never predates the post
 * it was built from: the post is 2 days old, the Sandwich a day and a half.
 */
export const DEMO_SANDWICH_AGE_DAYS = 1.5;

// ── Shot 4: the card is already there ────────────────────────────────────────

/**
 * Pin the hero Sandwich to the top of the REAL home feed, so a take can open
 * the app, tap the card and buy — no paste, no analysis. Everything else in the
 * feed is whatever the server is serving that day.
 *
 * - `'x_post'`  — the hero renders as a plain Sandwich card sourced from the
 *                 post on X below. The same source is served on the detail
 *                 route, so the card and the screen agree.
 * - `'youtube'` — the hero keeps its episode source and pins as a video card
 *                 with one market row. Use this to also film the podcast shot.
 * - `null`      — no pin; the feed is untouched.
 *
 * It is put in front AFTER the feed's own ranking runs (`rankFeedItems`), so
 * its like count and return can be whatever reads right on camera.
 */
export const DEMO_FEED_PIN: 'x_post' | 'youtube' | null = 'x_post';

/**
 * The id of the pinned CARD. Lives here rather than in demo-data because the
 * feed ranker has to recognise it, and this module is the only demo import a
 * product file is allowed.
 */
export const DEMO_POST_ID = 'demo-post-episode-1';

/**
 * The X post the hero is sourced from. A real post by a real account, quoted
 * as written — the Sandwich is our reading of it, credited to the builder
 * below, and the post itself is cited and linked exactly as any origin is.
 */
export const DEMO_X_POST = {
  url: 'https://x.com/zeroxkyle/status/2096901027186590009',
  authorHandle: '@zeroxkyle',
  authorName: 'Kyle',
  authorAvatarUrl: 'https://pbs.twimg.com/profile_images/2009079698765303808/Pch25ugN_200x200.jpg',
  /** Always "2d ago", whatever day the take is filmed — not the post's real date. */
  postedDaysAgo: 2,
  text:
    'look im not against tao but the mkt seriously needs to move on from it as the de facto ai long u genuinely have so many good options - i cant rmb the last good thing on tao\n\nfirst obv vvv has pmf, second chip has done deals w various neos incl ones leopold invested in',
};

/**
 * The Bread user who built the hero Sandwich — the byline under the post.
 * Real account fields, so the avatar and handle are the ones on the profile.
 */
export const DEMO_BUILDER = {
  id: 'cmqt649qh001ph3f84t13sg8c',
  username: 'vzy',
  name: 'Vighnesh Shenekar',
  avatarUrl:
    'https://pub-4fb9771e1e1543e7988c0f7ad2c3ce33.r2.dev/avatars/did_privy_cmpz9alny00dp0ckz75fcwrp7_1784061176600.jpg',
  /** The builder's own read — the card's headline, in their words. */
  take: 'the ai trade is stuck on tao. fade it, own the two he actually names.',
};
