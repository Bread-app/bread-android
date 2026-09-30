/**
 * The scripted content demo mode serves: one episode, its calls, the baskets
 * they build into, and a wallet that holds one of them at a profit.
 *
 * Everything is written as the RAW payload shape the backend would return, not
 * the normalized app type, so it travels through exactly the same parsing the
 * real responses do. If a fixture is wrong, the app rejects it the same way it
 * would reject a bad server — which is the point.
 */

import {
  DEMO_BUILDER,
  DEMO_EPISODE,
  DEMO_FEED_PIN,
  DEMO_HERO_RETURN_PCT,
  DEMO_LEG_DAY_CHANGE_PCT,
  DEMO_POST_ID,
  DEMO_SANDWICH_AGE_DAYS,
  DEMO_X_POST,
} from './demo-config';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Base58-shaped, and deliberately not a real mint: nothing here can be traded. */
function demoMint(tag: string): string {
  return `Demo${tag}`.padEnd(44, '1');
}

export const DEMO_SOURCE_ID = 'demo-source-episode-1';
/**
 * The CARD every demo market sits on. One id for the whole episode, because
 * that is the shape the real model has: N markets, one thing you like.
 * Declared in demo-config so the feed ranker can recognise it; re-exported
 * here for the fixture callers.
 */
export { DEMO_POST_ID };
/** Modest on purpose: 8 likes and no comments reads like a real post, not a plant. */
const DEMO_POST_LIKE_COUNT = 8;
const DEMO_POST_COMMENT_COUNT = 0;

export function demoNow(): number {
  return Date.now();
}

function iso(msAgo: number): string {
  return new Date(demoNow() - msAgo).toISOString();
}

export const DEMO_SANDWICH_CREATED_AT_MS = DEMO_SANDWICH_AGE_DAYS * DAY_MS;

// ── Instruments ──────────────────────────────────────────────────────────────

export type DemoAsset = {
  mint: string;
  symbol: string;
  underlyingSymbol: string;
  name: string;
  /** Price when the call was made — the entry basis every return is measured from. */
  entryPriceUsd: number;
  /** Price now. Its ratio to the entry is what the leg's chart walks toward. */
  currentPriceUsd: number;
  imageUrl: string;
  /**
   * The move since entry, stated rather than derived, so a row can report
   * exactly the figure it was written for (a rounded entry price would drift
   * it by a few bps). Absent means "compute it from the two prices".
   */
  movePct?: number;
};

function asset(
  tag: string,
  symbol: string,
  name: string,
  entryPriceUsd: number,
  returnPct: number,
): DemoAsset {
  return {
    mint: demoMint(tag),
    symbol,
    underlyingSymbol: symbol.replace(/X$/, ''),
    name,
    entryPriceUsd,
    currentPriceUsd: Number((entryPriceUsd * (1 + returnPct / 100)).toFixed(2)),
    imageUrl: demoLogoUri(symbol),
  };
}

/**
 * A crypto asset, pinned to the price it shows NOW and the move it has made
 * since the call — the two figures a viewer reads off the row — with the
 * entry derived. Small prices keep more digits so a $0.0452 token does not
 * walk from $0.05.
 */
function cryptoAsset(
  tag: string,
  symbol: string,
  name: string,
  currentPriceUsd: number,
  movePct: number,
  imageUrl: string,
): DemoAsset {
  const digits = currentPriceUsd < 1 ? 5 : 2;
  return {
    mint: demoMint(tag),
    symbol,
    underlyingSymbol: symbol,
    name,
    entryPriceUsd: Number((currentPriceUsd / (1 + movePct / 100)).toFixed(digits)),
    currentPriceUsd,
    imageUrl,
    movePct,
  };
}

/**
 * The hero basket's legs carry the headline return between them; the weights
 * below make the weighted average land on DEMO_HERO_RETURN_PCT, so the card,
 * the chart and the profile agree without anything having to be nudged.
 */
export const DEMO_ASSETS = {
  // The hero: Kyle's post. TAO has moved −4.13%, which at the short's 3x is the
  // +12.39% the row reports; the other two are 1x spot and read as their move.
  TAO: cryptoAsset(
    'TAOxx',
    'TAO',
    'Bittensor',
    234.21,
    -4.13,
    'https://coin-images.coingecko.com/coins/images/28452/large/ARUsPeNQ_400x400.jpeg',
  ),
  VVV: cryptoAsset(
    'VVVxx',
    'VVV',
    'Venice Token',
    23.62,
    38.8,
    'https://coin-images.coingecko.com/coins/images/54023/large/VVV_Token_Transparent.png',
  ),
  CHIP: cryptoAsset(
    'CHIPx',
    'CHIP',
    'USD.AI',
    0.0452,
    -16.69,
    'https://coin-images.coingecko.com/coins/images/102171777/large/CHIP_Token_Logo_Large.png',
  ),
  // The episode's other calls.
  COIN: asset('COINx', 'COINX', 'Coinbase xStock', 168.9, 61.0),
  MSTR: asset('MSTRx', 'MSTRX', 'Strategy xStock', 288.4, 34.5),
  GOOGL: asset('GOOGx', 'GOOGLX', 'Alphabet xStock', 174.25, 22.8),
} satisfies Record<string, DemoAsset>;

export const DEMO_ASSET_BY_MINT: Record<string, DemoAsset> = Object.fromEntries(
  Object.values(DEMO_ASSETS).map((a) => [a.mint, a]),
);

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export function demoLogoUri(symbol: string): string {
  const ticker = symbol.trim().toUpperCase().replace(/X$/, '');
  return `https://www.tokens.xyz/logos/xstocks/${ticker}x.png`;
}

// ── The calls ────────────────────────────────────────────────────────────────

type DemoLegSpec = {
  asset: DemoAsset;
  weightBps: number;
  reason: string;
  /**
   * DEMO-ONLY MIXED VENUE. The real model is homogeneous — a Sandwich is all
   * spot or a single perp — and the server would reject this payload. Here the
   * sandwich stays `venue: 'spot'` so the buy runs the spot pad (no signatures),
   * while the leg row draws its own LONG/SHORT pill off `leg.venue === 'perp'`.
   */
  venue?: 'spot' | 'perp';
  side?: 'long' | 'short';
  /** Multiplies the perp leg's reported PnL, the way leverage would. */
  leverage?: number;
};

/** The leg's PnL as the row reports it: signed by side, scaled by leverage. */
function legPnlPct(spec: DemoLegSpec): number {
  const { asset: a } = spec;
  const move = a.movePct ?? ((a.currentPriceUsd - a.entryPriceUsd) / a.entryPriceUsd) * 100;
  const signed = spec.side === 'short' ? -move : move;
  return Number((signed * (spec.leverage ?? 1)).toFixed(2));
}

type DemoCallSpec = {
  id: string;
  startMs: number;
  endMs: number;
  headline: string;
  summary: string;
  quote: string;
  ticker: string;
  conviction: string;
  bucket: string;
  /** The weighted return this call is up since it was made. */
  returnPct: number;
  legs: DemoLegSpec[];
  reasoning: string[];
  /** Set to decline the call: it renders with the reason and no buy button. */
  unroutedReason?: string;
  direction?: 'up' | 'down';
};

/**
 * Four calls, in the order they appear in the episode. Three route and can be
 * bought; the fourth is deliberately declined, because an app that shows its
 * refusals reads as an app that checked.
 */
export const DEMO_CALLS: DemoCallSpec[] = [
  {
    id: 'demo-moment-tao-rotation',
    startMs: 0,
    endMs: 0,
    headline: DEMO_BUILDER.take,
    summary:
      'The AI trade has defaulted to TAO for lack of alternatives, and the post names two with real traction. Short the incumbent, long the two it points at.',
    quote: DEMO_X_POST.text,
    ticker: 'TAO',
    conviction: 'medium',
    bucket: 'pick',
    returnPct: DEMO_HERO_RETURN_PCT,
    legs: [
      {
        asset: DEMO_ASSETS.TAO,
        weightBps: 2500,
        reason: 'look im not against tao but the mkt seriously needs to move on from it',
        venue: 'perp',
        side: 'short',
        leverage: 3,
      },
      { asset: DEMO_ASSETS.VVV, weightBps: 5000, reason: 'first obv vvv has pmf' },
      {
        asset: DEMO_ASSETS.CHIP,
        weightBps: 2500,
        reason: 'second chip has done deals w various neos incl ones leopold invested in',
      },
    ],
    reasoning: [
      'The claim is about rotation, not about TAO going to zero: a short against two longs, not a short alone.',
      'VVV and CHIP are the two names the post actually gives, and both trade.',
    ],
  },
  {
    id: 'demo-moment-crypto',
    startMs: 41 * 60_000 + 5_000,
    endMs: 42 * 60_000 + 12_000,
    headline: 'Exchange volumes are the cleanest read on the flows',
    summary:
      'Points at the gap between spot ETF inflows and exchange take rates — the flows are being intermediated somewhere, and the listed venues are the only ones you can own.',
    quote:
      "If you believe the flows are real, you don't need to pick the coin. You can own the toll booth.",
    ticker: 'COIN',
    conviction: 'medium',
    bucket: 'idea',
    returnPct: 49.4,
    legs: [
      { asset: DEMO_ASSETS.COIN, weightBps: 6000, reason: 'The toll booth the call names directly.' },
      { asset: DEMO_ASSETS.MSTR, weightBps: 4000, reason: 'Levered balance-sheet exposure to the same flows.' },
    ],
    reasoning: [
      'The claim is about intermediation volume, not price direction.',
      'Volume accrues to venues before it accrues to holders.',
    ],
  },
  {
    id: 'demo-moment-search',
    startMs: 67 * 60_000 + 48_000,
    endMs: 68 * 60_000 + 40_000,
    headline: 'Search economics survive the assistant transition',
    summary:
      'The bear case assumes query volume moves to assistants at zero margin. Argues distribution and ad load carry over, and the market is paying a discount for a transition already half-priced.',
    quote:
      'The distribution did not change hands. That is the whole argument.',
    ticker: 'GOOGL',
    conviction: 'medium',
    bucket: 'position',
    returnPct: 22.8,
    legs: [
      { asset: DEMO_ASSETS.GOOGL, weightBps: 10000, reason: 'A single-name call, kept as one.' },
    ],
    reasoning: [
      'The disagreement is about margin transfer, not about usage.',
      'No second instrument adds anything the primary does not already carry.',
    ],
  },
  {
    id: 'demo-moment-declined',
    startMs: 86 * 60_000 + 31_000,
    endMs: 87 * 60_000 + 9_000,
    headline: 'Private credit spreads are too tight',
    summary:
      'A macro view on private credit marks. There is no listed instrument that expresses it without taking a different risk than the one described.',
    quote: "The marks in private credit are three quarters stale and everyone knows it.",
    ticker: null as unknown as string,
    conviction: 'low',
    bucket: 'idea',
    returnPct: 0,
    direction: 'down',
    legs: [],
    reasoning: [],
    unroutedReason:
      'No instrument tracks this closely enough to trade. The listed proxies carry rate risk the call never mentions.',
  },
];

export const DEMO_HERO_CALL = DEMO_CALLS[0];

// ── Payload builders ─────────────────────────────────────────────────────────

export function demoSourcePayload(status: 'extracting' | 'resolving' | 'ready', input: string) {
  return {
    id: DEMO_SOURCE_ID,
    status,
    statusReason: null,
    momentCount: status === 'ready' ? DEMO_CALLS.length : null,
    videoId: DEMO_EPISODE.videoId,
    durationMs: DEMO_EPISODE.durationMs,
    sourceUrl: input,
    title: DEMO_EPISODE.title,
    channelName: DEMO_EPISODE.channelName,
    channelHandle: DEMO_EPISODE.channelHandle,
    channelAvatarUrl: DEMO_EPISODE.channelAvatarUrl,
    publishedAt: iso(DEMO_EPISODE.publishedDaysAgo * DAY_MS),
    editorialSummary: DEMO_EPISODE.editorialSummary,
    createdAt: iso(60_000),
  };
}

function momentLegPayload(spec: DemoLegSpec) {
  const { asset: a } = spec;
  return {
    mint: a.mint,
    symbol: a.symbol,
    underlyingSymbol: a.underlyingSymbol,
    label: a.name,
    iconUrl: a.imageUrl,
    provider: 'xstock',
    // Always long here, whatever the SANDWICH leg says: `isTradableMoment`
    // drops the feed card's buy button if any leg's side disagrees with the
    // call's direction, and the feed never renders a per-leg side. The mixed
    // venue lives on the built sandwich's leg rows, which is where it is seen.
    side: 'long',
    weightBps: spec.weightBps,
    entryPriceUsd: a.entryPriceUsd,
    entryAt: iso(DEMO_SANDWICH_CREATED_AT_MS),
    entryBasis: 'source_timestamp',
    reason: spec.reason,
    exposureType: 'direct',
    resolutionSource: 'grounded_primary',
    currentPriceUsd: a.currentPriceUsd,
    pnlPct: legPnlPct(spec),
  };
}

export function demoMomentPayload(call: DemoCallSpec) {
  const routed = !call.unroutedReason;
  const primary = call.legs[0]?.asset ?? null;
  return {
    id: call.id,
    startMs: call.startMs,
    endMs: call.endMs,
    headline: call.headline,
    summary: call.summary,
    quote: call.quote,
    direction: call.direction ?? 'up',
    conviction: call.conviction,
    assetClass: 'stock',
    entities: call.legs.map((leg) => ({
      label: leg.asset.name.replace(/ xStock$/, ''),
      kind: leg.asset.symbol === leg.asset.underlyingSymbol ? 'token' : 'company',
      ticker: leg.asset.underlyingSymbol,
    })),
    ticker: call.ticker ?? null,
    callPrice: primary?.entryPriceUsd ?? null,
    callPriceAt: iso(DEMO_SANDWICH_CREATED_AT_MS),
    callPriceBasis: 'source_timestamp',
    currentPrice: primary?.currentPriceUsd ?? null,
    dayChangePct: routed ? DEMO_LEG_DAY_CHANGE_PCT : null,
    legs: call.legs.map(momentLegPayload),
    legStatus: routed ? 'resolved' : 'no_instrument',
    venue: 'spot',
    routeStatus: routed ? 'routed' : 'unrouted',
    unroutedReason: call.unroutedReason ?? null,
    bucket: call.bucket,
    firstMention: call === DEMO_CALLS[0],
    speakerName: DEMO_EPISODE.speakerName,
    speakerHandle: DEMO_EPISODE.speakerHandle,
    speakerVerified: true,
    tickerContext: null,
    timestampGrounded: true,
    segments: [
      {
        quote: call.quote,
        speaker: DEMO_EPISODE.speakerName,
        startMs: call.startMs,
        endMs: call.endMs,
      },
    ],
    reasoningSteps: call.reasoning.map((text, index) => ({ text, segmentIndex: index === 0 ? 0 : null })),
    counterNote: null,
    counterCalls: [],
    peakPct: routed ? Number((call.returnPct * 1.12).toFixed(1)) : null,
    peakAt: routed ? iso(6 * DAY_MS) : null,
  };
}

export function demoSandwichId(call: DemoCallSpec): string {
  return `${call.id}-sandwich`;
}

function sandwichLegPayload(spec: DemoLegSpec, order: number) {
  const { asset: a } = spec;
  return {
    id: `${a.mint}-leg`,
    order,
    type: 'tokenized_stock',
    venue: spec.venue ?? 'spot',
    leverage: spec.venue === 'perp' ? spec.leverage ?? null : null,
    label: a.name,
    imageUrl: a.imageUrl,
    symbol: a.symbol,
    underlyingSymbol: a.underlyingSymbol,
    mint: a.mint,
    marketId: null,
    eventId: null,
    question: null,
    side: spec.side ?? 'long',
    weightBps: spec.weightBps,
    priceUsd: a.entryPriceUsd,
    currentPriceUsd: a.currentPriceUsd,
    pnlPct: legPnlPct(spec),
    volume24hUsd: 4_120_000 + spec.weightBps * 91,
    holderCount: 1_800 + spec.weightBps,
    closeTime: null,
    reason: spec.reason,
    matchSummary: spec.reason,
    legRole: order === 0 ? 'Primary' : 'Supporting',
    legMechanism: spec.reason,
    startMs: null,
    endMs: null,
  };
}

/**
 * Whether this call is served as an X post instead of the episode. Only the
 * hero, and only while the feed pin asks for it — see DEMO_FEED_PIN.
 */
function isXPostCall(call: DemoCallSpec): boolean {
  return DEMO_FEED_PIN === 'x_post' && call === DEMO_HERO_CALL;
}

function demoSandwichSourcePayload(call: DemoCallSpec, input: string, createdAt: string) {
  if (isXPostCall(call)) {
    return {
      id: DEMO_SOURCE_ID,
      input: DEMO_X_POST.url,
      sourceType: 'x_post',
      sourceUrl: DEMO_X_POST.url,
      authorHandle: DEMO_X_POST.authorHandle,
      authorName: DEMO_X_POST.authorName,
      authorAvatarUrl: DEMO_X_POST.authorAvatarUrl,
      publishedAt: iso(DEMO_X_POST.postedDaysAgo * DAY_MS),
      quote: DEMO_X_POST.text,
      videoId: null,
      editorialSummary: null,
      text: DEMO_X_POST.text,
      createdAt,
    };
  }
  return {
    id: DEMO_SOURCE_ID,
    input,
    sourceType: 'youtube',
    sourceUrl: `https://www.youtube.com/watch?v=${DEMO_EPISODE.videoId}`,
    authorHandle: DEMO_EPISODE.channelHandle,
    authorName: DEMO_EPISODE.channelName,
    authorAvatarUrl: DEMO_EPISODE.channelAvatarUrl,
    publishedAt: iso(DEMO_EPISODE.publishedDaysAgo * DAY_MS),
    quote: call.quote,
    videoId: DEMO_EPISODE.videoId,
    editorialSummary: DEMO_EPISODE.editorialSummary,
    text: call.quote,
    createdAt,
  };
}

export function demoSandwichPayload(call: DemoCallSpec, input = 'https://youtu.be/demo') {
  const createdAt = iso(DEMO_SANDWICH_CREATED_AT_MS);
  const sourcePayload = demoSandwichSourcePayload(call, input, createdAt);
  const xPost = isXPostCall(call);

  return {
    id: demoSandwichId(call),
    postId: DEMO_POST_ID,
    sourceId: DEMO_SOURCE_ID,
    thesisId: `${call.id}-thesis`,
    name: call.headline,
    direction: call.direction ?? 'up',
    summary: call.summary,
    horizon: '6-12 months',
    confidence: call.conviction,
    status: 'published',
    venue: 'spot',
    venueReason: null,
    totalWeightBps: call.legs.reduce((sum, leg) => sum + leg.weightBps, 0),
    pnlPct: Number(call.returnPct.toFixed(2)),
    pnlStatus: 'live',
    pnlBasis: 'spot',
    // The card's counts, identical on every market of it — a per-market number
    // here would render as the episode disagreeing with itself.
    likeCount: DEMO_POST_LIKE_COUNT,
    commentCount: DEMO_POST_COMMENT_COUNT,
    viewerHasLiked: false,
    warnings: [],
    research: null,
    derivation: {
      explanation: call.summary,
      segments: [
        {
          quote: call.quote,
          speaker: xPost ? DEMO_X_POST.authorName : DEMO_EPISODE.speakerName,
          sourceUrl: sourcePayload.sourceUrl,
        },
      ],
      steps: call.reasoning.map((text) => ({ text, source: 'quote' })),
    },
    comparison: [],
    createdAt,
    updatedAt: iso(2 * 60_000),
    // The builder byline (under the cited post) and their take (the headline).
    builder: xPost
      ? {
          id: DEMO_BUILDER.id,
          username: DEMO_BUILDER.username,
          name: DEMO_BUILDER.name,
          avatarUrl: DEMO_BUILDER.avatarUrl,
          record: null,
        }
      : null,
    commentary: xPost ? DEMO_BUILDER.take : null,
    origins: [
      {
        handle: sourcePayload.authorHandle,
        name: sourcePayload.authorName,
        avatarUrl: sourcePayload.authorAvatarUrl,
        url: sourcePayload.sourceUrl,
        platform: xPost ? 'x' : 'youtube',
        publishedAt: sourcePayload.publishedAt,
        unavailable: false,
        claimedBy: null,
      },
    ],
    source: sourcePayload,
    thesis: {
      id: `${call.id}-thesis`,
      sourceId: DEMO_SOURCE_ID,
      summary: call.summary,
      quote: call.quote,
      headlineQuote: call.quote,
      horizon: '6-12 months',
      direction: call.direction ?? 'up',
      confidence: call.conviction,
      subjects: call.legs.map((leg) => leg.asset.underlyingSymbol),
      catalysts: [],
      quotes: [call.quote],
      // A post has no timeline to seek; a timestamp here would draw play chips.
      startMs: xPost ? null : call.startMs,
      endMs: xPost ? null : call.endMs,
      createdAt,
    },
    legs: call.legs.map(sandwichLegPayload),
  };
}

/** Every buildable Sandwich in the episode, in feed order. */
export function demoSandwichPayloads(input?: string) {
  return DEMO_CALLS.filter((call) => !call.unroutedReason).map((call) => demoSandwichPayload(call, input));
}

/**
 * The card pinned to the top of the real home feed — one post, the hero
 * Sandwich as its only market, in the shape `/api/posts` puts on the wire.
 */
export function demoFeedPostPayload() {
  const call = DEMO_HERO_CALL;
  const sandwich = demoSandwichPayload(call);
  return {
    id: DEMO_POST_ID,
    kind: 'thesis',
    sourceId: DEMO_SOURCE_ID,
    title: call.headline,
    coverUrl: null,
    originHandle: sandwich.source.authorHandle,
    marketCount: 1,
    publishedAt: sandwich.source.publishedAt,
    createdAt: sandwich.createdAt,
    sandwiches: [sandwich],
    likeCount: sandwich.likeCount,
    commentCount: sandwich.commentCount,
    viewerHasLiked: sandwich.viewerHasLiked,
  };
}

export function demoCallBySandwichId(sandwichId: string): DemoCallSpec | null {
  return DEMO_CALLS.find((call) => demoSandwichId(call) === sandwichId) ?? null;
}
