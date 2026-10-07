import { isDemoMode } from './demo/demo-config';
import { ONDO_TRADE_UNAVAILABLE_MESSAGE } from './market-hours';

export type StockType = 'xstock' | 'ondo' | 'prestock' | 'token';

// Home filter pills. Mostly asset classes (tokens.xyz `asset.category`), plus
// `ipos` which is the prestock subset of equities (filtered server-side by type).
export type AssetFilter =
  | 'all'
  | 'ipos'
  | 'stocks'
  | 'etfs'
  | 'commodities'
  | 'metals'
  | 'crypto';

export type Stock = {
  id: string;
  assetId?: string;
  symbol: string;
  name: string;
  /** Raw tokens.xyz asset class (equity|etf|commodity|crypto|stablecoin|rwa). */
  category?: string;
  type: StockType;
  holderCount: number | null;
  icon: string | null;
  usdPrice: number | null;
  priceChange1h: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  mcap?: number | null;
  /**
   * The mint a BUY of this asset should spend, when this row's own mint is not
   * a market a buy belongs in (a thin Ondo wrapper, a pool that has stopped
   * trading). Undefined — the common case — means route to `id`.
   *
   * `id` stays the token this row IS: sells, balances and decimals key off it.
   * Only the server's asset-detail path can populate this, because only that
   * response lists an asset's sibling variants.
   */
  buyVariantMint?: string | null;
};

export type ListStocksParams = {
  limit?: number;
  offset?: number;
  /** Asset-class pill filter (Stocks/ETFs/Commodities/Metals/Crypto). */
  category?: AssetFilter;
  type?: StockType;
  minHolders?: number;
  maxHolders?: number;
  /** Free-text query — routes to the server-side tokens.xyz search instead of the curated list. */
  q?: string;
};

type StockApiRecord = {
  id: string;
  assetId?: string;
  symbol: string;
  name: string;
  type: string;
  holderCount: number | null;
  icon: string | null;
  usdPrice: number | null;
  priceChange1h: number | null;
  priceChange24h: number | null;
  volume24h?: number | null;
};

type ApiErrorBody = {
  error?: string;
  errorMessage?: string;
  message?: string;
};

export type AppUserPayload = {
  privyUserId: string;
  email: string | null;
  walletAddress: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type JupiterQuoteRequest = {
  inputMint: string;
  outputMint: string;
  amount: string;
  /** Optional wallet to build against, so the quote reflects swap buildability. */
  taker?: string;
};

export type JupiterQuoteResponse = {
  outAmount: string;
};

export type JupiterOrderRequest = {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
  /**
   * Comma-separated routers to exclude. Sells pass "jupiterz" so the order
   * skips the JupiterZ RFQ path (short-lived quotes that expire while the user
   * signs in their wallet) and uses the Metis aggregator instead.
   */
  excludeRouters?: string;
};

/** Which Jupiter engine built the order; `execute` must be told the same one. */
export type JupiterEngine = 'swap' | 'ultra';

export type JupiterOrderResponse = {
  transaction: string;
  requestId: string;
  lastValidBlockHeight: string | null;
  /** Defaults to 'swap'; 'ultra' for RFQ-only tokens routed through Ultra. */
  engine: JupiterEngine;
};

export type AtomicBuyRequest = {
  taker: string;
  outputMint: string;
  /** USDC to spend, in smallest units (6 decimals). */
  amountInUsdc: string;
};

export type AtomicBuyResponse = {
  /** Base64 unsigned tx when atomic; null when the caller must use two-tx. */
  transaction: string | null;
  /** true → no atomic tx (RFQ-only token / oversized / sim failed); fall back. */
  fallback: boolean;
  /**
   * The backend's execution guard refused these terms (empty order book, price
   * far off the real one). NOT a fallback: retrying down the order/execute path
   * would place the exact trade the guard just rejected. Callers must stop and
   * show `rejectionReason`.
   */
  rejected?: boolean;
  rejectionReason?: string | null;
};

export type AtomicSellRequest = {
  taker: string;
  inputMint: string;
  /** Token to sell, in smallest units (token decimals). */
  amount: string;
};

export type JupiterExecuteRequest = {
  signedTransaction: string;
  requestId: string;
  lastValidBlockHeight?: string;
  engine?: JupiterEngine;
};

export type JupiterExecuteResponse = {
  signature: string | null;
  txid: string | null;
  status: string | null;
  code: number | null;
  errorMessage: string | null;
};

export type PredictionOrderRequest = {
  ownerPubkey: string;
  marketId: string;
  isYes: boolean;
  isBuy: boolean;
  depositAmount: string;
  depositMint?: string;
};

export type PredictionOrderResponse = {
  transaction: string;
  blockhash: string | null;
  lastValidBlockHeight: number | null;
  orderPubkey: string | null;
  positionPubkey: string | null;
  contracts: string | null;
};

export type PredictionCloseRequest = {
  positionPubkey: string;
  ownerPubkey: string;
};

export type PredictionSubmitRequest = {
  signedTransaction: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
};

export type PredictionSubmitResponse = {
  signature: string | null;
  status: string | null;
  code: number | null;
  errorMessage: string | null;
};

export type JupiterTokenDetail = {
  id: string;
  /** See `Stock.buyVariantMint` — the mint a buy should route into instead. */
  buyVariantMint?: string | null;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  icon: string | null;
  holderCount: number | null;
  usdPrice: number | null;
  volume24h: number | null;
  priceChange24h: number | null;
  mcap?: number | null;
  fdv?: number | null;
  liquidity?: number | null;
  organicScore?: number | null;
  isVerified?: boolean | null;
  tags?: string[] | null;
  website?: string | null;
  twitter?: string | null;
  audit?: {
    topHoldersPercentage?: number | null;
    mintAuthorityDisabled?: boolean | null;
    freezeAuthorityDisabled?: boolean | null;
  } | null;
};

export type WalletBalanceToken = {
  mint: string | null;
  symbol: string | null;
  name: string | null;
  icon: string | null;
  balance: number;
  decimals: number | null;
  usdValue: number | null;
  priceChange24h: number | null;
};

export type WalletBalances = {
  tokens: WalletBalanceToken[];
};

export type PerpsPosition = {
  type: 'LEVERAGE';
  positionAddress: string | null;
  asset: string;
  imageUri: string | null;
  side: 'long' | 'short';
  leverage: number;
  collateral: number;
  pnl: number;
  size: number | null;
  sizeValue: number | null;
  entryPrice: number | null;
  markPrice: number | null;
  liquidationPrice: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
  value: number;
  change: number;
};

export type SolanaSendResponse = {
  signature: string;
  status: string | null;
};

/**
 * Did the transaction actually land on chain?
 *
 * `/api/solana/send` reports "confirmed" (committed), "processed" (in a block,
 * not yet committed), or "pending" (submitted, never observed). Only the last
 * one is not a landing — treating "processed" as a non-success made trades that
 * had already executed surface as failures whenever a slot ran slow.
 */
export function isLandedTxStatus(status: string | null): boolean {
  return status === 'confirmed' || status === 'processed';
}

const TRANSACTION_PENDING_MESSAGE =
  "Trade submitted and is still confirming. Don't retry yet—refresh your balance in a moment.";

export type CoinGeckoCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type CandleSource = 'coingecko' | 'jupiter-derived';

export type CoinGeckoCandlesResult = {
  candles: CoinGeckoCandle[];
  source: CandleSource;
};

export type SandwichDirection = 'up' | 'down' | 'mixed';
export type SandwichVenue = 'spot' | 'perp';
export type SandwichLegType = 'tokenized_stock' | 'prediction_market';

export type SandwichLegExecution = {
  execution: 'jupiter_swap' | 'phoenix_perp' | 'prediction_market' | null;
};

/**
 * `tokenized_asset` is the backend's newer, broader name for a mint-backed
 * instrument. The mobile execution and presentation contract still calls the
 * same thing `tokenized_stock`, so canonicalize at the API boundary. This also
 * keeps sandwiches created before and after the backend rename executable.
 */
function normalizeSandwichLegType(value: unknown): SandwichLegType | null {
  if (value === 'prediction_market') return 'prediction_market';
  if (value === 'tokenized_stock' || value === 'tokenized_asset') return 'tokenized_stock';
  return null;
}

export type SandwichSource = {
  id: string;
  input: string;
  sourceType: string;
  sourceUrl: string | null;
  authorHandle: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  user: {
    id: string;
    privyUserId: string | null;
    name: string | null;
    username: string | null;
    email: string | null;
    avatarUrl: string | null;
    walletAddress: string | null;
  } | null;
  publishedAt: string | null;
  quote: string | null;
  /** YouTube id, on `youtube` sources — the feed groups a video's markets by it. */
  videoId: string | null;
  /** 2–3 sentence synthesis of the episode, written once at analysis time. */
  editorialSummary: string | null;
  text: string;
  createdAt: string;
};

export type SandwichThesisWho = {
  label: string;
  kind: string;
  direction: string;
  rationale: string;
};

export type SandwichThesisWhy = {
  text: string;
  origin: 'source' | 'inference';
};

export type SandwichThesis = {
  id: string;
  sourceId: string;
  summary: string;
  quote: string;
  headlineQuote: string | null;
  horizon: string;
  direction: SandwichDirection;
  confidence: string;
  subjects: string[];
  catalysts: string[];
  who: SandwichThesisWho[];
  quotes: string[];
  why: SandwichThesisWhy[];
  /**
   * Where in the source video this call was made. The Thesis IS the podcast
   * moment, so this window is authoritative; `SandwichLeg.startMs` carries a
   * denormalized copy. Null for text- and X-sourced theses.
   */
  startMs: number | null;
  endMs: number | null;
  createdAt: string;
};

export type SandwichLeg = {
  id: string;
  order: number;
  type: SandwichLegType;
  venue: SandwichVenue;
  label: string;
  imageUrl: string | null;
  symbol: string | null;
  underlyingSymbol: string | null;
  mint: string | null;
  marketId: string | null;
  eventId: string | null;
  question: string | null;
  side: string;
  weightBps: number;
  priceUsd: number | null;
  currentPriceUsd: number | null;
  /**
   * On-chain USD price of this leg's mint.
   *
   * NOT interchangeable with `currentPriceUsd`, which is the listed SHARE price
   * for a tokenized equity — the right basis for PnL (entry is stamped the same
   * way) and the wrong one for valuing a swap, which pays out wrapper tokens
   * that trade 5-18% away from the share. Only ever use this to value a
   * venue-quoted quantity; null on prediction and perp legs, which have none.
   */
  onchainPriceUsd: number | null;
  pnlPct: number | null;
  volume24hUsd: number | null;
  holderCount: number | null;
  closeTime: string | null;
  reason: string;
  matchSummary: string | null;
  /**
   * Display-only reasoning generated at creation time: a short role label and
   * 1–2 sentences on the transmission path. Null on legs created before the
   * feature shipped, and on heuristically-injected legs — callers fall back to
   * `matchSummary ?? reason`.
   */
  legRole: string | null;
  legMechanism: string | null;
  /**
   * Opening leverage on a perp leg, when the server states it. Optional: legs
   * built on the client and older rows carry nothing here, and a spot leg
   * never does.
   */
  leverage?: number | null;
  /** Timestamp window of the podcast moment this leg came from (ms), if any. */
  startMs: number | null;
  endMs: number | null;
  execution: SandwichLegExecution;
};

export type SandwichComparisonRow = {
  id: string;
  type: SandwichLegType;
  label: string;
  symbol: string | null;
  marketId: string | null;
  role: string;
  side: string;
  thesisFit: number;
  liquidityFit: number;
  catalystFit: number;
  directness: string;
  selected: boolean;
  reason: string;
  rejectionReason: string | null;
};

export type SandwichDerivation = {
  explanation: string;
  segments: {
    quote: string;
    speaker: string;
    sourceUrl: string | null;
  }[];
  steps: {
    text: string;
    source: 'quote' | 'research' | 'inference';
  }[];
};

export type SandwichRouteEvidence = {
  classification: string;
  hypothesis: string;
  notSaying: string;
  subjects: { label: string; kind: string }[];
  searchQueries: {
    stocks: string[];
    predictionMarkets: string[];
  };
  directChecks: {
    subjectLabel: string;
    candidateLabel: string;
    type: SandwichLegType;
    executable: boolean;
    directness: string;
    reason: string;
  }[];
  expansion?: {
    shortDescription: string;
    thesisSummaryBullets: string[];
    coreDrivers: string[];
    productsServicesAssets: string[];
  };
  cashBuffer?: {
    type: 'cash';
    asset: 'USDC';
    weight: number;
    reason: string;
    matchSummary: string;
  } | null;
};

export type SandwichPnlBasis = 'spot' | 'underlying_move';

/**
 * The Bread user who BUILT a sandwich.
 *
 * Distinct from the source's author, who is an `SandwichOrigin`. The value a
 * builder adds is selection — picking one post out of thousands and mapping it
 * to markets — and the two roles never share a slot in the UI.
 */
export type SandwichBuilder = {
  id: string;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  /**
   * Compact track record for the badge beside the handle. Null when the read
   * failed — a badge is decoration and never blocks the feed.
   *
   * `visible` is the server's gate. Never render `hitRate` when it is false.
   */
  record: {
    visible: boolean;
    resolvedCount: number;
    requiredForRecord: number;
    hitRate: number | null;
  } | null;
};

/**
 * The author of a source a sandwich was built from. Gets a citation and a link
 * out — never a score, because Bread cannot see whether they traded their own
 * idea.
 */
export type SandwichOrigin = {
  handle: string | null;
  name: string | null;
  avatarUrl: string | null;
  url: string | null;
  platform: string;
  publishedAt: string | null;
  /** Source deleted upstream. The citation still renders, marked unavailable. */
  unavailable: boolean;
  /** Set once the origin joins Bread and claims their citations. */
  claimedBy: string | null;
};

/** The sandwich a remix was built from — enough for "remixed from @x". */
export type SandwichRemixParent = {
  sandwichId: string;
  name: string;
  builder: { id: string; username: string | null; name: string | null; avatarUrl: string | null } | null;
};

export type SandwichResearchCatalyst = {
  label: string;
  /** ISO date, or null when the source didn't give one. Never estimated. */
  date: string | null;
};

export type SandwichResearchCitation = { url: string; title: string | null };

export type SandwichResearch = {
  summary: string;
  mechanism: string;
  companies: string[];
  catalysts: SandwichResearchCatalyst[];
  falsifiers: string[];
  citations: SandwichResearchCitation[];
};

export type Sandwich = {
  id: string;
  /**
   * The CARD this market sits on — what likes, comments and shares belong to.
   *
   * A YouTube episode is N markets on ONE card, so this is the id every social
   * call must use: keying them to `id` is what made one heart tap write N rows
   * and fire N notifications. Null only on rows created before the Post backfill.
   * See stock-backend/docs/post-as-social-unit.md.
   */
  postId: string | null;
  sourceId: string;
  thesisId: string;
  name: string;
  direction: SandwichDirection;
  summary: string;
  horizon: string;
  confidence: string;
  status: string;
  venue: SandwichVenue;
  venueReason: string | null;
  totalWeightBps: number;
  pnlPct: number | null;
  pnlStatus: 'live' | 'partial' | 'unavailable';
  /**
   * What `pnlPct` measures. `spot` is the realizable return. `underlying_move`
   * (every perp sandwich, so every short) is the signed move in the underlying
   * with NO leverage and NO funding — the realized figure only exists once
   * there is a position, in /api/perp-sandwich-positions.
   */
  pnlBasis: SandwichPnlBasis;
  /**
   * The CARD's counts, not this market's — every market of an episode reports
   * the same numbers, because there is one set of them. Read them off any one
   * market; never sum or max them across a group.
   */
  likeCount: number;
  commentCount: number;
  viewerHasLiked: boolean;
  warnings: string[];
  routeEvidence: SandwichRouteEvidence;
  /**
   * Grounded market research the basket was built from. Null for every sandwich
   * created before research existed, and whenever the research pass failed —
   * render its absence, never a placeholder.
   */
  research: SandwichResearch | null;
  derivation: SandwichDerivation;
  comparison: SandwichComparisonRow[];
  createdAt: string;
  updatedAt: string;
  /** Who built this. Null on unowned/legacy rows — never fall back to `origins`. */
  builder: SandwichBuilder | null;
  /** The builder's own read, and the card's headline. Null for an own thesis. */
  commentary: string | null;
  /** Sources cited. Empty means own thesis — render no citation row. */
  origins: SandwichOrigin[];
  /** The Bread sandwich this one remixes. Null when it isn't a remix. */
  remixedFrom: SandwichRemixParent | null;
  source: SandwichSource;
  thesis: SandwichThesis;
  legs: SandwichLeg[];
};

export type SandwichComment = {
  id: string;
  sandwichId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  viewerCanDelete: boolean;
  author: {
    id: string;
    username: string | null;
    name: string | null;
    avatarUrl: string | null;
  };
};

export type SandwichCommentPage = {
  comments: SandwichComment[];
  nextCursor: string | null;
  totalCount: number;
};

export type SandwichBuyLeg =
  | {
      kind: 'swap';
      legId: string;
      label: string;
      symbol: string | null;
      mint: string;
      weightBps: number;
      inputAmount: string;
    }
  | {
      kind: 'prediction';
      legId: string;
      label: string;
      symbol: string | null;
      marketId: string;
      isYes: boolean;
      weightBps: number;
      inputAmount: string; // USDC native units (6 decimals)
    };

export type SandwichBuyPlan = {
  executableLegs: SandwichBuyLeg[];
  skippedLegs: {
    legId: string;
    label: string;
    reason: 'missing_market' | 'missing_mint' | 'zero_amount' | 'prediction_min_order';
  }[];
};

export type ApiErrorCode =
  | 'CONFIG_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'INVALID_JSON'
  | 'INVALID_RESPONSE'
  | 'TRANSACTION_PENDING'
  | 'ABORTED'
  | 'PODCAST_FAILED'
  | 'PODCAST_NO_CAPTIONS'
  | 'PODCAST_TEMPORARY_FAILURE'
  | 'PODCAST_RESOLUTION_FAILED';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  /**
   * The parsed error body, when the server sent one. Some failures are
   * structured refusals rather than transport errors — e.g. the execution
   * guard's 422, which carries a `code` the caller must act on instead of
   * silently degrading to another path.
   */
  readonly body?: unknown;

  constructor(code: ApiErrorCode, message: string, status?: number, body?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

const REQUEST_TIMEOUT_MS = 10000;
// The atomic-buy build is an optimization with a guaranteed two-tx fallback, so
// fail fast: if the build hasn't returned in this window, abandon it and run the
// fallback rather than stalling the user near the global 10s timeout.
const ATOMIC_BUY_TIMEOUT_MS = 6000;
// The preflight fans out a quote + a reverse quote per leg, so it needs more
// room than a single call — but it still gates the user's tap, so it is bounded
// well under the global timeout.
const PREFLIGHT_TIMEOUT_MS = 12000;
// The dialpad's live quote is decorative until it arrives and is superseded by
// the next keystroke anyway, so it gives up early rather than holding a stale
// spinner over the amount the user is still editing.
const QUOTE_PREVIEW_TIMEOUT_MS = 7000;
/**
 * Analyze runs a grounded web-search pass and then a reasoning expansion, and
 * the backend caps that pair at SANDWICH_ANALYZE_BUDGET_MS (120s by default).
 * This must sit ABOVE that budget: at 45s the app was aborting long theses
 * mid-pipeline and reporting a timeout for work the server went on to finish
 * and persist. If the connection still dies, `resumeAnalysis` below picks the
 * finished theses back up instead of paying for the whole pipeline again.
 */
const SANDWICH_ANALYZE_TIMEOUT_MS = 150000;
const SANDWICH_ANALYZE_RESUME_TIMEOUT_MS = 60000;
const SANDWICH_ANALYZE_RESUME_INTERVAL_MS = 3000;
/**
 * Cheap build-shaped writes: committing an edited draft, creating a manual
 * sandwich, and the moment builds — which reuse legs the analysis already
 * resolved and priced rather than re-running discovery.
 */
const SANDWICH_BUILD_TIMEOUT_MS = 90000;
/**
 * The thesis build, which DOES run discovery: an expansion (and a grounded
 * research pass when analyze's brief is missing) followed by catalog resolution
 * and pricing. The backend caps that at SANDWICH_BUILD_BUDGET_MS (150s by
 * default); like the analyze timeout, this has to sit above it. At 90s the app
 * was aborting long theses mid-pipeline — the server's expansion ceiling alone
 * is 120s.
 */
const SANDWICH_THESIS_BUILD_TIMEOUT_MS = 180000;
/**
 * The fused analyze + build call. The backend caps it at
 * SANDWICH_COMPOSE_BUDGET_MS (200s by default) and this sits above that, same
 * contract as the two timeouts it replaces on the happy path.
 *
 * It is NOT the sum of those two: compose is one round trip over an already
 * warm pipeline, and the build phase no longer re-runs the expansion.
 */
const SANDWICH_COMPOSE_TIMEOUT_MS = 230000;
/**
 * When the composer's label moves from "Researching…" to "Building…" during a
 * fused call. Tracks SANDWICH_COMPOSE_BUDGET_MS * COMPOSE_ANALYZE_SHARE on the
 * backend (200s * 0.6). An estimate of the phase handover, not a report of it.
 */
const COMPOSE_BUILD_STAGE_HINT_MS = 120000;

/**
 * The backend authenticates every user-scoped request with the Privy access
 * token. `requestJson` is a plain function (not a hook), so a provider — wired
 * once at the root via `setAuthTokenProvider` — supplies the current token.
 * Returns null when logged out; in that case no Authorization header is sent.
 */
let authTokenProvider: (() => Promise<string | null>) | null = null;

export function setAuthTokenProvider(provider: (() => Promise<string | null>) | null): void {
  authTokenProvider = provider;
}

/**
 * The token provider can refresh over the network, so it needs its own ceiling.
 *
 * Privy's `getAccessToken()` silently refreshes an expired session, which means
 * an unreachable or slow auth endpoint stalls it for as long as it likes. A
 * request is still far better off going out unauthenticated (public reads like
 * the sandwich feed work fine without a token — only `viewerHasLiked` degrades)
 * than not going out at all.
 */
const AUTH_TOKEN_TIMEOUT_MS = 4000;

async function buildAuthHeaders(): Promise<Record<string, string>> {
  if (!authTokenProvider) return {};
  try {
    const token = await Promise.race([
      authTokenProvider(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AUTH_TOKEN_TIMEOUT_MS)),
    ]);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * The same `Authorization` header this module sends, for the few clients that
 * live outside it — currently `phoenix-api.ts`, which talks to a different venue
 * but authenticates as the same user.
 *
 * Exported so there is exactly one token provider in the app. A second client
 * registering its own would drift out of sync at the moment that matters most:
 * right after a token refresh.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  return buildAuthHeaders();
}

function logSandwichStage(stage: string, details: Record<string, unknown> = {}) {
  console.log(`[sandwich] ${stage}`, details);
}

function getApiBaseUrl(): string {
  const value = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

  if (!value) {
    throw new ApiError(
      'CONFIG_ERROR',
      'EXPO_PUBLIC_API_URL is not set. Please configure it in your environment.',
    );
  }

  return value.replace(/\/$/, '');
}

function isStockType(value: string): value is StockType {
  return value === 'xstock' || value === 'ondo' || value === 'prestock' || value === 'token';
}

// Different backend sources (tokens.xyz curated list vs the DB+Jupiter
// fallback) label the logo under different keys, so check all of them.
const STOCK_ICON_KEYS = ['icon', 'logoURI', 'logoUri', 'logo', 'image', 'imageUrl', 'image_url'];

function pickStockIcon(record: Record<string, unknown>): string | null {
  // Prefer a raster logo (rendered by <Image>), but keep an SVG as a last
  // resort — <AssetLogo> renders SVGs via react-native-svg, so an SVG-only
  // logo now shows the real image instead of a letter avatar. Non-https URLs
  // are ignored. Scans all known logo keys since backend sources differ.
  let svgFallback: string | null = null;
  for (const key of STOCK_ICON_KEYS) {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const url = value.trim();
    if (!/^https:\/\//i.test(url)) continue;
    if (/\.svg(\?.*)?$/i.test(url)) {
      if (!svgFallback) svgFallback = url;
      continue;
    }
    return url; // raster wins immediately
  }
  return svgFallback;
}

function normalizeStock(item: Record<string, unknown>): Stock {
  const type = typeof item.type === 'string' ? item.type : '';
  if (!isStockType(type)) {
    throw new ApiError('INVALID_RESPONSE', `Unsupported stock type received: ${String(item.type)}`);
  }

  // Read every field defensively: the two backend sources differ in field
  // names, null-vs-undefined, and occasionally string-encoded numbers. Parsing
  // tolerantly (instead of requiring an exact `number`) keeps the icon + price
  // detail consistent regardless of which source served the row.
  const rawName = String(item.name ?? '');
  const cleanedName = rawName
    .replace(/\bprestocks?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return {
    id: String(item.id ?? ''),
    assetId:
      typeof item.assetId === 'string' && item.assetId.trim()
        ? item.assetId.trim()
        : undefined,
    symbol: String(item.symbol ?? ''),
    name: cleanedName || rawName,
    category: typeof item.category === 'string' ? item.category : undefined,
    type,
    holderCount: toNumber(item.holderCount),
    icon: pickStockIcon(item),
    usdPrice: toNumber(item.usdPrice),
    priceChange1h: toNumber(item.priceChange1h),
    priceChange24h: toNumber(item.priceChange24h),
    volume24h: toNumber(item.volume24h),
    mcap: toNullableNumber(item.mcap),
    buyVariantMint:
      typeof item.buyVariantMint === 'string' && item.buyVariantMint.trim()
        ? item.buyVariantMint.trim()
        : null,
  };
}

function isStockApiRecord(value: unknown): value is StockApiRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  // Only the identity fields are required. Optional fields (icon, prices,
  // volume) vary by source and must NOT disqualify a row — otherwise a stock
  // with a missing/undefined icon gets dropped from the list entirely, which
  // is why stocks intermittently vanished. normalizeStock fills the rest in
  // defensively.
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.symbol === 'string' &&
    candidate.symbol.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.type === 'string' &&
    isStockType(candidate.type)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function nestedString(record: Record<string, unknown>, key: string, nestedKey: string): string | null {
  const nested = record[key];
  return isRecord(nested) ? stringValue(nested[nestedKey]) : null;
}

function linkedAccounts(user: Record<string, unknown>): Record<string, unknown>[] {
  const accounts = Array.isArray(user.linkedAccounts)
    ? user.linkedAccounts
    : Array.isArray(user.linked_accounts)
      ? user.linked_accounts
      : [];
  return accounts.filter(isRecord);
}

function isEmbeddedSolanaWallet(account: Record<string, unknown>) {
  const clientType = stringValue(account.walletClientType) ?? stringValue(account.wallet_client_type);
  const chainType = stringValue(account.chainType) ?? stringValue(account.chain_type);
  return account.type === 'wallet' && clientType === 'privy' && chainType === 'solana' && Boolean(stringValue(account.address));
}

function isTwitterAccount(account: Record<string, unknown>) {
  const type = stringValue(account.type)?.toLowerCase() ?? '';
  const provider = stringValue(account.provider)?.toLowerCase() ?? '';
  return type.includes('twitter') || type.includes('x_oauth') || provider.includes('twitter') || provider === 'x';
}

export function appUserPayloadFromPrivyUser(user: unknown): AppUserPayload | null {
  if (!isRecord(user)) return null;

  const privyUserId = stringValue(user.id) ?? stringValue(user.userId) ?? stringValue(user.did);
  if (!privyUserId) return null;

  const accounts = linkedAccounts(user);
  const emailAccount = accounts.find((account) => stringValue(account.type)?.includes('email') || stringValue(account.email));
  // Prefer the Privy embedded Solana wallet: it is the one Bread trades from.
  // A user who signed in with Seed Vault / Phantom over MWA also has that
  // EXTERNAL wallet linked (and as `user.wallet`), which must never become
  // their Bread wallet address.
  const embeddedSolanaAccount = accounts.find(isEmbeddedSolanaWallet);
  const walletAccount =
    embeddedSolanaAccount ??
    accounts.find((account) => stringValue(account.address) || stringValue(account.walletAddress));
  const twitterAccount = accounts.find(isTwitterAccount);
  const socialAccount = twitterAccount ?? accounts.find((account) => stringValue(account.name) || stringValue(account.username));
  const twitterUsername =
    stringValue(twitterAccount?.username) ??
    stringValue(twitterAccount?.screenName) ??
    stringValue(twitterAccount?.screen_name) ??
    stringValue(twitterAccount?.name);
  const twitterAvatarUrl =
    stringValue(twitterAccount?.profilePictureUrl) ??
    stringValue(twitterAccount?.profile_picture_url) ??
    stringValue(twitterAccount?.profileImageUrl) ??
    stringValue(twitterAccount?.profile_image_url) ??
    stringValue(twitterAccount?.avatarUrl) ??
    stringValue(twitterAccount?.picture);

  return {
    privyUserId,
    email:
      nestedString(user, 'email', 'address') ??
      stringValue(user.email) ??
      stringValue(emailAccount?.email) ??
      nestedString(emailAccount ?? {}, 'email', 'address'),
    walletAddress:
      stringValue(embeddedSolanaAccount?.address) ??
      nestedString(user, 'wallet', 'address') ??
      stringValue(user.walletAddress) ??
      stringValue(walletAccount?.address) ??
      stringValue(walletAccount?.walletAddress),
    name:
      (twitterUsername ? `@${twitterUsername.replace(/^@/, '')}` : null) ??
      stringValue(socialAccount?.name) ??
      stringValue(socialAccount?.username) ??
      stringValue(user.name),
    avatarUrl:
      twitterAvatarUrl ??
      stringValue(socialAccount?.profilePictureUrl) ??
      stringValue(socialAccount?.profile_picture_url) ??
      stringValue(socialAccount?.avatarUrl) ??
      stringValue(user.avatarUrl) ??
      stringValue(user.picture),
  };
}

const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/** A user-facing message for an HTTP status, never the raw upstream text. */
function friendlyStatusMessage(status: number): string {
  if (status === 429) return "You're going a bit fast. Please wait a moment and try again.";
  if (status === 401 || status === 403) return "You're not authorized to do that.";
  if (status === 404) return 'That could not be found.';
  if (status === 408 || status === 504) return 'The request timed out. Please try again.';
  if (status >= 500) return 'Something went wrong on our end. Please try again.';
  return GENERIC_ERROR_MESSAGE;
}

/**
 * True when a message is a raw HTTP/axios/network error string that should never
 * be shown to a user (e.g. "Request failed with status code 429" forwarded from
 * an upstream API, or a low-level socket error).
 */
function looksLikeRawHttpError(message: string): boolean {
  return (
    /status code\s*\d+/i.test(message) ||
    /^request failed/i.test(message) ||
    /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network ?error|fetch failed)\b/i.test(
      message,
    ) ||
    /\b(internal server error|bad gateway|service unavailable|gateway timeout|too many requests)\b/i.test(
      message,
    )
  );
}

/** Pull a status code out of a raw HTTP error string, if present. */
function statusFromRawMessage(message: string): number | null {
  const match = message.match(/status code\s*(\d+)/i) ?? message.match(/\b(\d{3})\b/);
  if (!match) return null;
  const code = Number(match[1]);
  return code >= 100 && code <= 599 ? code : null;
}

function parseErrorMessage(body: unknown, status: number): string {
  // Rate limits are always shown as a friendly notice, never the raw upstream
  // "Request failed with status code 429" text.
  if (status === 429) return friendlyStatusMessage(429);

  if (isRecord(body)) {
    const message =
      (typeof body.errorMessage === 'string' && body.errorMessage) ||
      (typeof body.error === 'string' && body.error) ||
      (typeof body.message === 'string' && body.message) ||
      null;

    // Surface a human message, but never leak a raw HTTP/axios error string the
    // backend forwarded from an upstream call.
    if (message && !looksLikeRawHttpError(message)) {
      return message;
    }
  }

  return friendlyStatusMessage(status);
}

/**
 * Convert any thrown error into a safe, user-facing message. Strips raw
 * HTTP/axios/network strings (e.g. status-code text) and maps them to friendly
 * copy. Use this anywhere an error is shown in the UI (toasts, inline messages).
 */
export function humanizeErrorMessage(error: unknown, fallback = GENERIC_ERROR_MESSAGE): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return friendlyStatusMessage(429);
    if (error.message && !looksLikeRawHttpError(error.message)) return error.message;
    return error.status ? friendlyStatusMessage(error.status) : fallback;
  }

  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  if (!raw) return fallback;
  if (looksLikeRawHttpError(raw)) {
    const code = statusFromRawMessage(raw);
    return code ? friendlyStatusMessage(code) : fallback;
  }
  return raw;
}

/**
 * Turn a raw trade-failure reason into clear user copy for the cases users hit
 * most and understand least — chiefly Ondo stocks being unavailable outside
 * their 24/5 secondary-market window. The backend/Jupiter phrasings vary ("No routes found",
 * "Ondo tokens are only available via JupiterZ. Trading is not available outside
 * of market hours", "Quote not available from market maker"), so match on intent
 * rather than exact text. Returns null when the reason isn't one we can improve,
 * so callers keep whatever specific message they already have.
 */
export function describeTradeUnavailable(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const r = reason.toLowerCase();

  if (r.includes('market hours') || r.includes('outside of market') || r.includes('market is closed')) {
    return ONDO_TRADE_UNAVAILABLE_MESSAGE;
  }
  if (r.includes('minimum trade size') || r.includes('minimum order')) {
    return 'One of these assets has a higher minimum trade size. Try a larger amount.';
  }
  // JupiterZ/RFQ wording identifies Ondo's maker path — but identifying the
  // VENUE is not the same as knowing its market is shut, and only the branch
  // above knows that (the maker says so in words). Ondo runs 24/5, so a miss
  // at 3 AM on a Friday is a maker gap, not a schedule, and this used to hand
  // that user a window they were already inside.
  //
  // It is also the loosest match here: `rfq` catches any diagnostic mentioning
  // the route ("RFQ-only route"), and `ondo` catches the mints themselves,
  // which are vanity addresses ENDING in "ondo" — so a price rejection quoting
  // a mint inherited a market-hours explanation it had nothing to do with.
  if (
    r.includes('ondo') ||
    r.includes('only available via jupiterz') ||
    r.includes('rfq')
  ) {
    return "This asset's market makers aren't quoting right now. No cash was spent — try again in a moment.";
  }
  if (
    r.includes('no route') ||
    r.includes('routes found') ||
    r.includes('quote not available')
  ) {
    return "Some assets in this basket can't be traded right now. The market may be closed—try again later.";
  }
  return null;
}

type JsonRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  params?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  timeoutMessage?: string;
  /**
   * Caller-owned cancellation, in addition to the timeout below. Used by
   * keystroke-driven requests (the dialpad's live quote) so a superseded call
   * stops occupying a connection instead of racing the one that replaced it.
   */
  signal?: AbortSignal;
};

async function requestJson<T>(path: string, options: JsonRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';

  // Demo mode (shoot builds only) answers the routes a filmed sequence touches
  // and hands everything else straight back. `isDemoMode()` is a compile-time
  // constant, so a normal build never loads the fixture module at all — and
  // this sits above the fetch, which is what guarantees a take cannot reach the
  // network, a wallet, or a chain. See lib/demo/demo-config.ts.
  if (isDemoMode()) {
    const { resolveDemoRequest, DEMO_PASSTHROUGH } = await import('./demo/demo-api');
    const demo = await resolveDemoRequest({ method, path, params: options.params, body: options.body });
    if (demo !== DEMO_PASSTHROUGH) return demo as T;
  }

  const baseUrl = getApiBaseUrl();
  const url = new URL(`${baseUrl}${path}`);

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, value);
    }
  }

  // Resolve the token BEFORE arming the abort timer. Started the other way
  // round, a slow token refresh burned the request's entire budget on a promise
  // `controller.abort()` cannot cancel — then `fetch` was handed an
  // already-aborted signal, threw instantly, and surfaced as
  // "Loading sandwiches took too long. Pull to refresh to try again."
  // The server had never been asked. `buildAuthHeaders` has its own ceiling and
  // resolves to {} rather than rejecting, so this cannot hang the request.
  const authHeaders = await buildAuthHeaders();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  // React Native's AbortSignal has no `any()`, so the caller's signal is
  // forwarded by hand. Already-aborted is handled too, since the caller may
  // have cancelled during the token refresh above.
  const abortFromCaller = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', abortFromCaller);
  }

  try {
    const response = await fetch(url.toString(), {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...authHeaders,
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method !== 'GET' ? { body: JSON.stringify(options.body ?? {}) } : {}),
    });

    const responseText = await response.text();
    let parsed: unknown;

    try {
      parsed = responseText ? (JSON.parse(responseText) as unknown) : null;
    } catch {
      throw new ApiError('INVALID_JSON', 'Could not parse API response as JSON.');
    }

    if (!response.ok) {
      throw new ApiError(
        'HTTP_ERROR',
        parseErrorMessage(parsed as ApiErrorBody, response.status),
        response.status,
        parsed,
      );
    }

    // The other half of demo mode: a handful of routes are answered by the
    // server and then ADDED to (the pinned feed card). Same compile-time gate
    // as above, so a normal build never loads the module.
    if (isDemoMode()) {
      const { decorateDemoResponse } = await import('./demo/demo-api');
      return decorateDemoResponse({ method, path, params: options.params, body: options.body }, parsed) as T;
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('TIMEOUT', options.timeoutMessage ?? 'The request timed out. Please try again.');
    }

    throw new ApiError(
      'NETWORK_ERROR',
      'Network request failed. Check API URL, server reachability, or CORS settings.',
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function getTopHolderStocks(params: ListStocksParams = {}): Promise<Stock[]> {
  const query: Record<string, string> = {
    sortBy: 'volume',
    limit: String(params.limit ?? 100),
  };

  // Free-text search hits the server-side tokens.xyz search (full catalog)
  // rather than filtering the curated top list locally.
  if (params.q?.trim()) {
    query.q = params.q.trim();
  }

  if (typeof params.offset === 'number') {
    query.offset = String(params.offset);
  }

  if (params.type) {
    query.type = params.type;
  }

  if (params.category && params.category !== 'all') {
    query.category = params.category;
  }

  // Uses /api/tokens/stocks which tries Tokens API curated list first
  // (always-fresh prices, volume, icons), then falls back to DB + Jupiter.
  const payload = await requestJson<unknown[]>('/api/tokens/stocks', {
    params: {
      ...query,
    },
  });

  if (!Array.isArray(payload)) {
    throw new ApiError('INVALID_RESPONSE', 'Expected /api/tokens/stocks response to be an array.');
  }

  let normalized = payload.filter(isStockApiRecord).map(normalizeStock);

  if (normalized.length === 0 && payload.length > 0) {
    // Tokens API returns slightly different shapes — try a lenient parse
    normalized = payload
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        id: String(item.id ?? ''),
        assetId:
          typeof item.assetId === 'string' && item.assetId.trim()
            ? item.assetId.trim()
            : undefined,
        symbol: String(item.symbol ?? ''),
        name: String(item.name ?? ''),
        category: typeof item.category === 'string' ? item.category : undefined,
        type: isStockType(String(item.type ?? '')) ? (String(item.type) as StockType) : 'xstock',
        holderCount: toNumber(item.holderCount),
        icon: pickStockIcon(item),
        usdPrice: toNumber(item.usdPrice),
        priceChange1h: toNumber(item.priceChange1h),
        priceChange24h: toNumber(item.priceChange24h),
        volume24h: toNumber(item.volume24h),
      }))
      .filter((s) => s.id && s.symbol);
  }

  // tokens.xyz (returned by /api/tokens/stocks) is the sole price/change feed
  // for Home — the same source the dashboard uses. We deliberately do NOT call
  // Jupiter here: its shared rate-limit bucket is reserved for buy/sell
  // execution. Mints tokens.xyz can't price (e.g. some prestocks) stay null.
  return normalized.sort((a, b) => {
    const vd = (b.volume24h ?? -1) - (a.volume24h ?? -1);
    if (vd !== 0) return vd;
    return (b.holderCount ?? -1) - (a.holderCount ?? -1);
  });
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeThesisWho(value: unknown): SandwichThesisWho[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      label: typeof item.label === 'string' ? item.label : '',
      kind: typeof item.kind === 'string' ? item.kind : 'prose',
      direction: typeof item.direction === 'string' ? item.direction : 'watch',
      rationale: typeof item.rationale === 'string' ? item.rationale : '',
    }))
    .filter((item) => item.label.length > 0);
}

function normalizeThesisWhy(value: unknown): SandwichThesisWhy[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      text: typeof item.text === 'string' ? item.text : '',
      origin: item.origin === 'source' ? ('source' as const) : ('inference' as const),
    }))
    .filter((item) => item.text.length > 0);
}

function normalizeSandwichDirection(value: unknown): SandwichDirection {
  return value === 'down' || value === 'mixed' ? value : 'up';
}

function normalizeSandwichSource(value: unknown): SandwichSource | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id : null;
  const input = typeof value.input === 'string' ? value.input : null;
  const sourceType = typeof value.sourceType === 'string' ? value.sourceType : null;
  const text = typeof value.text === 'string' ? value.text : null;
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : null;

  if (!id || !input || !sourceType || !text || !createdAt) {
    return null;
  }

  const user = isRecord(value.user) && typeof value.user.id === 'string'
    ? {
        id: value.user.id,
        privyUserId: typeof value.user.privyUserId === 'string' ? value.user.privyUserId : null,
        name: typeof value.user.name === 'string' ? value.user.name : null,
        username: typeof value.user.username === 'string' ? value.user.username : null,
        email: typeof value.user.email === 'string' ? value.user.email : null,
        avatarUrl: typeof value.user.avatarUrl === 'string' ? value.user.avatarUrl : null,
        walletAddress: typeof value.user.walletAddress === 'string' ? value.user.walletAddress : null,
      }
    : null;

  return {
    id,
    input,
    sourceType,
    sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : null,
    authorHandle: typeof value.authorHandle === 'string' ? value.authorHandle : null,
    authorName: typeof value.authorName === 'string' ? value.authorName : null,
    authorAvatarUrl: typeof value.authorAvatarUrl === 'string' ? value.authorAvatarUrl : null,
    user,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null,
    quote: typeof value.quote === 'string' ? value.quote : null,
    videoId: typeof value.videoId === 'string' ? value.videoId : null,
    editorialSummary: typeof value.editorialSummary === 'string' ? value.editorialSummary : null,
    text,
    createdAt,
  };
}

function normalizeSandwichThesis(value: unknown): SandwichThesis | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id : null;
  const sourceId = typeof value.sourceId === 'string' ? value.sourceId : null;
  const summary = typeof value.summary === 'string' ? value.summary : null;
  const quote = typeof value.quote === 'string' ? value.quote : null;
  const horizon = typeof value.horizon === 'string' ? value.horizon : null;
  const confidence = typeof value.confidence === 'string' ? value.confidence : null;
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : null;

  if (!id || !sourceId || !summary || !quote || !horizon || !confidence || !createdAt) {
    return null;
  }

  return {
    id,
    sourceId,
    summary,
    quote,
    headlineQuote: typeof value.headlineQuote === 'string' && value.headlineQuote ? value.headlineQuote : null,
    horizon,
    direction: normalizeSandwichDirection(value.direction),
    confidence,
    subjects: normalizeStringArray(value.subjects),
    catalysts: normalizeStringArray(value.catalysts),
    who: normalizeThesisWho(value.who),
    quotes: normalizeStringArray(value.quotes),
    why: normalizeThesisWhy(value.why),
    // Deliberately NOT part of the required-field guard above: a thesis from
    // text or an X post legitimately has no timestamp.
    startMs: toNullableNumber(value.startMs),
    endMs: toNullableNumber(value.endMs),
    createdAt,
  };
}

function normalizeSandwichLeg(value: unknown): SandwichLeg | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = normalizeSandwichLegType(value.type);
  const label = typeof value.label === 'string' ? value.label : null;
  const side = typeof value.side === 'string' ? value.side : null;
  const weightBps = typeof value.weightBps === 'number' ? value.weightBps : null;

  if (!type || !label || !side || weightBps === null) {
    return null;
  }

  // Draft (preview) legs aren't persisted yet, so they may arrive without an
  // id or reason; derive fallbacks instead of dropping the leg — an executable
  // leg only truly needs type/label/side/weight (+ mint/marketId).
  const mint = typeof value.mint === 'string' && value.mint ? value.mint : null;
  const marketId = typeof value.marketId === 'string' && value.marketId ? value.marketId : null;
  const order = typeof value.order === 'number' ? value.order : 0;
  const id = (typeof value.id === 'string' && value.id) || mint || marketId || `draft-leg-${order}`;
  const reason =
    (typeof value.reason === 'string' && value.reason) ||
    (typeof value.matchSummary === 'string' && value.matchSummary) ||
    label;

  return {
    id,
    order,
    type,
    venue: value.venue === 'perp' ? 'perp' : 'spot',
    leverage: value.venue === 'perp' ? toNullableNumber(value.leverage) : null,
    label,
    imageUrl: typeof value.imageUrl === 'string' && value.imageUrl ? value.imageUrl : null,
    symbol: typeof value.symbol === 'string' ? value.symbol : null,
    underlyingSymbol: typeof value.underlyingSymbol === 'string' ? value.underlyingSymbol : null,
    mint: typeof value.mint === 'string' ? value.mint : null,
    marketId: typeof value.marketId === 'string' ? value.marketId : null,
    eventId: typeof value.eventId === 'string' ? value.eventId : null,
    question: typeof value.question === 'string' ? value.question : null,
    side,
    weightBps,
    priceUsd: toNullableNumber(value.priceUsd),
    currentPriceUsd: toNullableNumber(value.currentPriceUsd),
    onchainPriceUsd: toNullableNumber(value.onchainPriceUsd),
    pnlPct: toNullableNumber(value.pnlPct),
    volume24hUsd: toNullableNumber(value.volume24hUsd),
    holderCount: toNullableNumber(value.holderCount),
    closeTime: typeof value.closeTime === 'string' ? value.closeTime : null,
    reason,
    matchSummary: typeof value.matchSummary === 'string' && value.matchSummary ? value.matchSummary : null,
    legRole: typeof value.legRole === 'string' && value.legRole ? value.legRole : null,
    legMechanism:
      typeof value.legMechanism === 'string' && value.legMechanism ? value.legMechanism : null,
    startMs: toNullableNumber(value.startMs),
    endMs: toNullableNumber(value.endMs),
    execution: normalizeSandwichLegExecution(value.raw),
  };
}

function normalizeSandwichLegExecution(value: unknown): SandwichLegExecution {
  if (!isRecord(value)) {
    return { execution: null };
  }

  const execution = typeof value.execution === 'string' ? value.execution : null;
  return {
    execution:
      execution === 'jupiter_swap' ||
      execution === 'phoenix_perp' ||
      execution === 'prediction_market'
        ? execution
        : null,
  };
}

function normalizeSandwichComparisonRow(value: unknown): SandwichComparisonRow | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id : null;
  const type = normalizeSandwichLegType(value.type);
  const label = typeof value.label === 'string' ? value.label : null;
  const side = typeof value.side === 'string' ? value.side : null;
  const role = typeof value.role === 'string' ? value.role : null;
  const reason = typeof value.reason === 'string' ? value.reason : null;

  if (!id || !type || !label || !side || !role || !reason) {
    return null;
  }

  return {
    id,
    type,
    label,
    symbol: typeof value.symbol === 'string' && value.symbol ? value.symbol : null,
    marketId: typeof value.marketId === 'string' && value.marketId ? value.marketId : null,
    role,
    side,
    thesisFit: toNumber(value.thesisFit) ?? 0,
    liquidityFit: toNumber(value.liquidityFit) ?? 0,
    catalystFit: toNumber(value.catalystFit) ?? 0,
    directness: typeof value.directness === 'string' ? value.directness : 'derived',
    selected: value.selected === true,
    reason,
    rejectionReason: typeof value.rejectionReason === 'string' && value.rejectionReason ? value.rejectionReason : null,
  };
}

/**
 * Rehydrate the research brief. Returns null — not an empty object — for the
 * `{}` default and for anything carrying neither a summary nor a company, so a
 * legacy row renders as "no research" rather than as an empty research card.
 */
export function normalizeSandwichResearch(value: unknown): SandwichResearch | null {
  if (!isRecord(value)) return null;

  const strings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];

  const summary = typeof value.summary === 'string' ? value.summary : '';
  const companies = strings(value.companies);
  if (!summary && companies.length === 0) return null;

  return {
    summary,
    mechanism: typeof value.mechanism === 'string' ? value.mechanism : '',
    companies,
    catalysts: Array.isArray(value.catalysts)
      ? value.catalysts
          .filter(isRecord)
          .map((catalyst) => ({
            label: typeof catalyst.label === 'string' ? catalyst.label : '',
            date: typeof catalyst.date === 'string' ? catalyst.date : null,
          }))
          .filter((catalyst) => catalyst.label.length > 0)
      : [],
    falsifiers: strings(value.falsifiers),
    citations: Array.isArray(value.citations)
      ? value.citations
          .filter(isRecord)
          .map((citation) => ({
            url: typeof citation.url === 'string' ? citation.url : '',
            title: typeof citation.title === 'string' ? citation.title : null,
          }))
          .filter((citation) => citation.url.length > 0)
      : [],
  };
}

function normalizeSandwichDerivation(value: unknown): SandwichDerivation {
  const fallback: SandwichDerivation = {
    explanation: '',
    segments: [],
    steps: [],
  };

  if (!isRecord(value)) {
    return fallback;
  }

  const toStepSource = (source: unknown): 'quote' | 'research' | 'inference' => {
    if (source === 'quote' || source === 'research' || source === 'inference') {
      return source;
    }

    return 'inference';
  };

  const segments = Array.isArray(value.segments)
    ? value.segments.filter(isRecord).map((segment) => ({
        quote: typeof segment.quote === 'string' ? segment.quote : '',
        speaker: typeof segment.speaker === 'string' ? segment.speaker : 'user',
        sourceUrl: typeof segment.sourceUrl === 'string' && segment.sourceUrl ? segment.sourceUrl : null,
      })).filter((segment) => segment.quote.length > 0)
    : [];
  const steps = Array.isArray(value.steps)
    ? value.steps.filter(isRecord).map((step) => ({
        text: typeof step.text === 'string' ? step.text : '',
        source: toStepSource(step.source),
      })).filter((step) => step.text.length > 0)
    : [];

  return {
    explanation: typeof value.explanation === 'string' ? value.explanation : '',
    segments,
    steps,
  };
}

function normalizeSandwichRouteEvidence(value: unknown): SandwichRouteEvidence {
  if (!isRecord(value)) {
    return {
      classification: 'implied_theme',
      hypothesis: '',
      notSaying: '',
      subjects: [],
      searchQueries: { stocks: [], predictionMarkets: [] },
      directChecks: [],
    };
  }

  const searchQueries = isRecord(value.searchQueries) ? value.searchQueries : {};
  const expansion = isRecord(value.expansion) ? value.expansion : null;
  const cashBuffer = isRecord(value.cashBuffer) ? value.cashBuffer : null;

  return {
    classification: typeof value.classification === 'string' ? value.classification : 'implied_theme',
    hypothesis: typeof value.hypothesis === 'string' ? value.hypothesis : '',
    notSaying: typeof value.notSaying === 'string' ? value.notSaying : '',
    subjects: Array.isArray(value.subjects)
      ? value.subjects.filter(isRecord).map((subject) => ({
          label: typeof subject.label === 'string' ? subject.label : '',
          kind: typeof subject.kind === 'string' ? subject.kind : 'macro',
        })).filter((subject) => subject.label.length > 0)
      : [],
    searchQueries: {
      stocks: normalizeStringArray(searchQueries.stocks),
      predictionMarkets: normalizeStringArray(searchQueries.predictionMarkets),
    },
    directChecks: Array.isArray(value.directChecks)
      ? value.directChecks.filter(isRecord).map((check) => ({
          subjectLabel: typeof check.subjectLabel === 'string' ? check.subjectLabel : '',
          candidateLabel: typeof check.candidateLabel === 'string' ? check.candidateLabel : '',
          type: normalizeSandwichLegType(check.type) ?? 'tokenized_stock',
          executable: check.executable === true,
          directness: typeof check.directness === 'string' ? check.directness : 'derived',
          reason: typeof check.reason === 'string' ? check.reason : '',
        })).filter((check) => check.candidateLabel.length > 0)
      : [],
    expansion: expansion
      ? {
          shortDescription: typeof expansion.shortDescription === 'string' ? expansion.shortDescription : '',
          thesisSummaryBullets: normalizeStringArray(expansion.thesisSummaryBullets),
          coreDrivers: normalizeStringArray(expansion.coreDrivers),
          productsServicesAssets: normalizeStringArray(expansion.productsServicesAssets),
        }
      : undefined,
    cashBuffer:
      cashBuffer && cashBuffer.type === 'cash'
        ? {
            type: 'cash',
            asset: 'USDC',
            weight: toNumber(cashBuffer.weight) ?? 0,
            reason: typeof cashBuffer.reason === 'string' ? cashBuffer.reason : '',
            matchSummary: typeof cashBuffer.matchSummary === 'string' ? cashBuffer.matchSummary : '',
          }
        : null,
  };
}

function normalizeSandwichBuilder(value: unknown): SandwichBuilder | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : null;
  if (!id) return null;
  const record = isRecord(value.record) ? value.record : null;
  return {
    id,
    username: typeof value.username === 'string' ? value.username : null,
    name: typeof value.name === 'string' ? value.name : null,
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
    record: record
      ? {
          visible: record.visible === true,
          resolvedCount: toNumber(record.resolvedCount) ?? 0,
          requiredForRecord: toNumber(record.requiredForRecord) ?? 10,
          hitRate: toNullableNumber(record.hitRate),
        }
      : null,
  };
}

function normalizeSandwichOrigin(value: unknown): SandwichOrigin | null {
  if (!isRecord(value)) return null;
  const handle = typeof value.handle === 'string' ? value.handle : null;
  const url = typeof value.url === 'string' ? value.url : null;
  // Nothing to attribute without at least one of these — an origin with neither
  // would render as a citation to nobody.
  if (!handle && !url) return null;
  return {
    handle,
    name: typeof value.name === 'string' ? value.name : null,
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
    url,
    platform: typeof value.platform === 'string' ? value.platform : 'link',
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null,
    unavailable: value.unavailable === true,
    claimedBy: typeof value.claimedBy === 'string' ? value.claimedBy : null,
  };
}

function normalizeSandwichRemixParent(value: unknown): SandwichRemixParent | null {
  if (!isRecord(value)) return null;
  const sandwichId = typeof value.sandwichId === 'string' ? value.sandwichId : null;
  if (!sandwichId) return null;
  const builder = isRecord(value.builder) && typeof value.builder.id === 'string' ? value.builder : null;
  return {
    sandwichId,
    name: typeof value.name === 'string' ? value.name : '',
    builder: builder
      ? {
          id: builder.id as string,
          username: typeof builder.username === 'string' ? builder.username : null,
          name: typeof builder.name === 'string' ? builder.name : null,
          avatarUrl: typeof builder.avatarUrl === 'string' ? builder.avatarUrl : null,
        }
      : null,
  };
}

function normalizeSandwich(value: unknown): Sandwich | null {
  if (!isRecord(value)) {
    return null;
  }

  const source = normalizeSandwichSource(value.source);
  const thesis = normalizeSandwichThesis(value.thesis);
  const legs = Array.isArray(value.legs)
    ? value.legs.map(normalizeSandwichLeg).filter((leg): leg is SandwichLeg => leg !== null)
    : [];
  const comparison = Array.isArray(value.comparison)
    ? value.comparison
        .map(normalizeSandwichComparisonRow)
        .filter((row): row is SandwichComparisonRow => row !== null)
    : [];
  const id = typeof value.id === 'string' ? value.id : null;
  const sourceId = typeof value.sourceId === 'string' ? value.sourceId : null;
  const thesisId = typeof value.thesisId === 'string' ? value.thesisId : null;
  const name = typeof value.name === 'string' ? value.name : null;
  const summary = typeof value.summary === 'string' ? value.summary : null;
  const horizon = typeof value.horizon === 'string' ? value.horizon : null;
  const confidence = typeof value.confidence === 'string' ? value.confidence : null;
  const status = typeof value.status === 'string' ? value.status : null;
  const totalWeightBps = typeof value.totalWeightBps === 'number' ? value.totalWeightBps : null;
  const pnlStatus =
    value.pnlStatus === 'live' || value.pnlStatus === 'partial' || value.pnlStatus === 'unavailable'
      ? value.pnlStatus
      : 'unavailable';
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : null;
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null;

  if (
    !id ||
    !sourceId ||
    !thesisId ||
    !name ||
    !summary ||
    !horizon ||
    !confidence ||
    !status ||
    totalWeightBps === null ||
    !createdAt ||
    !updatedAt ||
    !source ||
    !thesis
  ) {
    return null;
  }

  return {
    id,
    postId: typeof value.postId === 'string' ? value.postId : null,
    sourceId,
    thesisId,
    name,
    direction: normalizeSandwichDirection(value.direction),
    summary,
    horizon,
    confidence,
    status,
    venue: value.venue === 'perp' ? 'perp' : 'spot',
    venueReason: typeof value.venueReason === 'string' ? value.venueReason : null,
    totalWeightBps,
    pnlPct: toNullableNumber(value.pnlPct),
    pnlStatus,
    // Defaults to 'spot' so a payload cached before this field shipped is not
    // mislabelled as an unlevered estimate.
    pnlBasis: value.pnlBasis === 'underlying_move' ? 'underlying_move' : 'spot',
    likeCount: toNumber(value.likeCount) ?? 0,
    commentCount: toNumber(value.commentCount) ?? 0,
    viewerHasLiked: value.viewerHasLiked === true,
    warnings: normalizeStringArray(value.warnings),
    routeEvidence: normalizeSandwichRouteEvidence(value.routeEvidence),
    research: normalizeSandwichResearch(value.research),
    derivation: normalizeSandwichDerivation(value.derivation),
    comparison,
    createdAt,
    updatedAt,
    builder: normalizeSandwichBuilder(value.builder),
    commentary: typeof value.commentary === 'string' ? value.commentary : null,
    // Absent on payloads cached before attribution shipped. An empty list means
    // "no citation", which is also the correct rendering for an own thesis.
    origins: Array.isArray(value.origins)
      ? value.origins
          .map(normalizeSandwichOrigin)
          .filter((origin): origin is SandwichOrigin => origin !== null)
      : [],
    remixedFrom: normalizeSandwichRemixParent(value.remixedFrom),
    source,
    thesis,
    legs,
  };
}

type SyncUserResponse = {
  user: {
    onboardingCompletedAt: string | null;
    username: string | null;
    isAdmin: boolean;
  };
};

export async function syncAppUser(user: AppUserPayload | null): Promise<SyncUserResponse | null> {
  if (!user) return null;
  return requestJson<SyncUserResponse>('/api/users/sync', {
    method: 'POST',
    body: { user },
  });
}

/**
 * Walk the Privy linked-accounts array and pull out the user's X identity if
 * they've linked one. `subject` is the immutable numeric id (what the backend
 * indexes on for claim lookups); `username` is the mutable handle (denormalized
 * for display only).
 */
export function getXIdentityFromLinkedAccounts(
  linkedAccounts: ReadonlyArray<{ type: string }> | undefined | null,
): { xUserId: string; xHandle: string | null } | null {
  if (!linkedAccounts) return null;
  for (const account of linkedAccounts) {
    if (account.type !== 'twitter_oauth') continue;
    const record = account as Record<string, unknown>;
    const xUserId = typeof record.subject === 'string' ? record.subject : null;
    if (!xUserId) continue;
    const username = record.username;
    const xHandle =
      typeof username === 'string' && username.length > 0
        ? username.replace(/^@+/, '')
        : null;
    return { xUserId, xHandle };
  }
  return null;
}

export type ClaimXSummonsResponse = {
  userId: string;
  xUserId: string;
  claimedSandwichIds: string[];
  claimedCount: number;
};

/**
 * Tells the backend to transfer any unclaimed X-summoned sandwiches attributed
 * to this X account over to the caller. Idempotent — returns claimedCount=0 on
 * subsequent calls. Used after Privy returns a user with a linked X account.
 */
export async function claimXSummonedSandwiches(args: {
  privyUserId: string;
  xUserId: string;
  xHandle: string | null;
}): Promise<ClaimXSummonsResponse> {
  return requestJson<ClaimXSummonsResponse>('/api/x/claim', {
    method: 'POST',
    body: args,
  });
}

export async function checkUsername(username: string): Promise<{ available: boolean }> {
  return requestJson<{ available: boolean }>(`/api/users/check-username?username=${encodeURIComponent(username)}`);
}

export async function updateUserProfile(
  privyUserId: string,
  updates: { username?: string; avatarUrl?: string; bio?: string },
): Promise<void> {
  await requestJson<unknown>('/api/users/profile', {
    method: 'PATCH',
    body: { privyUserId, ...updates },
  });
}

export async function completeOnboarding(privyUserId: string): Promise<void> {
  await requestJson<unknown>('/api/users/complete-onboarding', {
    method: 'POST',
    body: { privyUserId },
  });
}

/**
 * Upload a local image file to the server and return a permanent URL.
 * The backend stores the image in Cloudflare R2 and updates the user's avatarUrl.
 */
export async function uploadAvatar(privyUserId: string, imageUri: string): Promise<string> {
  const baseUrl = getApiBaseUrl();

  // Determine the MIME type from the URI extension
  const extension = imageUri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mimeType =
    extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';

  // Build the multipart form
  const formData = new FormData();
  formData.append('privyUserId', privyUserId);
  formData.append('image', {
    uri: imageUri,
    type: mimeType,
    name: `avatar.${extension}`,
  } as unknown as Blob);

  const authHeaders = await buildAuthHeaders();
  const response = await fetch(`${baseUrl}/api/users/avatar`, {
    method: 'POST',
    body: formData,
    // Let fetch set the Content-Type with boundary automatically; only attach auth.
    headers: authHeaders,
  });

  const responseText = await response.text();
  let parsed: unknown;

  try {
    parsed = responseText ? (JSON.parse(responseText) as unknown) : null;
  } catch {
    throw new ApiError('INVALID_JSON', 'Could not parse avatar upload response.');
  }

  if (!response.ok) {
    throw new ApiError(
      'HTTP_ERROR',
      parseErrorMessage(parsed as ApiErrorBody, response.status),
      response.status,
    );
  }

  const result = parsed as Record<string, unknown>;
  if (typeof result?.avatarUrl !== 'string') {
    throw new ApiError('INVALID_RESPONSE', 'Avatar upload did not return a URL.');
  }

  return result.avatarUrl;
}

/**
 * SandwichDraft is the in-flight, pre-confirm shape returned by the AI build
 * step or used as the seed for a manual-edit flow. It mirrors Sandwich but
 * carries `status === 'draft'` and a synthetic `id` (e.g. `preview-...`) when
 * unpersisted, and is committed via `commitSandwichDraft` /
 * `createManualSandwich`.
 */
export type SandwichDraft = Sandwich;

/**
 * Warning the backend adds when the source was only the free preview of a
 * paywalled article. Must match PAYWALLED_ARTICLE_WARNING in stock-backend's
 * lib/server/article.ts — the composer preview keys its banner off it.
 */
export const PAYWALLED_ARTICLE_WARNING = 'Built from the free preview of a paywalled article.';

export type ManualSandwichInput = {
  name: string;
  summary: string;
  horizon?: string | null;
  direction?: SandwichDirection | null;
  confidence?: string | null;
  thesisText?: string | null;
  warnings?: string[];
  legs: ManualSandwichLegInput[];
  /** Explicitly keeps a bullish manual selection on Phoenix instead of spot. */
  executionVenue?: SandwichVenue | null;
  /** The builder's own read — the headline of the published card. */
  commentary?: string | null;
  /** Id of the sandwich this one remixes. */
  remixOf?: string | null;
  /** The daily question this answers, when the composer was opened from one. */
  promptId?: string | null;
};

export type ManualSandwichLegInput = {
  type: 'tokenized_stock' | 'prediction_market';
  label: string;
  symbol?: string | null;
  underlyingSymbol?: string | null;
  mint?: string | null;
  marketId?: string | null;
  eventId?: string | null;
  question?: string | null;
  side: string;
  weightBps: number;
  priceUsd?: number | null;
  volume24hUsd?: number | null;
  holderCount?: number | null;
  closeTime?: string | null;
  reason?: string | null;
  matchSummary?: string | null;
  imageUrl?: string | null;
};

export type PredictionMarketSearchHit = {
  marketId: string;
  eventId: string | null;
  title: string;
  question: string;
  imageUrl: string | null;
  /** The parent event's artwork — distinct from the outcome market's image. */
  eventImageUrl: string | null;
  yesPriceUsd: number | null;
  noPriceUsd: number | null;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  endDate: string | null;
};

/**
 * POST the analyze step, and if the connection gives out, poll for the result
 * instead of failing.
 *
 * The backend persists its theses before it responds, so an analyze request the
 * app lost — timeout, backgrounded app, flaky cell handoff — has usually still
 * produced the answer. Long theses are where this bites: they spend the longest
 * in the grounded research pass, which is exactly when the socket is most likely
 * to die. Re-POSTing would restart the whole pipeline; the GET is a database
 * read that returns whatever landed.
 */
async function analyzeSourceWithResume(
  sourceId: string,
  onStage?: (stage: string) => void,
): Promise<unknown> {
  const path = `/api/sandwich/sources/${encodeURIComponent(sourceId)}/analyze`;
  try {
    return await requestJson<unknown>(path, {
      method: 'POST',
      timeoutMs: SANDWICH_ANALYZE_TIMEOUT_MS,
      timeoutMessage: 'Analyzing the thesis took too long. Please try again.',
    });
  } catch (error) {
    const recoverable =
      error instanceof ApiError && (error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR');
    if (!recoverable) throw error;

    logSandwichStage('analysis:resuming', { sourceId, code: (error as ApiError).code });
    onStage?.('Still researching…');

    const startedAt = Date.now();
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, SANDWICH_ANALYZE_RESUME_INTERVAL_MS));
      let payload: unknown = null;
      try {
        payload = await requestJson<unknown>(path, { method: 'GET', timeoutMs: 15000 });
      } catch {
        // A failed poll is not a failed analysis — keep waiting out the window.
      }
      const theses = isRecord(payload) && Array.isArray(payload.theses) ? payload.theses : [];
      if (theses.length > 0) {
        logSandwichStage('analysis:resumed', { sourceId, elapsedMs: Date.now() - startedAt });
        return payload;
      }
      if (Date.now() - startedAt > SANDWICH_ANALYZE_RESUME_TIMEOUT_MS) throw error;
    }
  }
}

/**
 * The fused analyze + build call. Returns null when this source should go down
 * the two-step path instead; throws when the pipeline itself refused.
 *
 * The distinction matters. A lost request (timeout, cell handoff) is a delivery
 * failure over work the server persisted, so retrying it as two steps is both
 * correct and cheap — analyze short-circuits on the theses that already landed
 * and the build reads back the cached expansion. A 4xx refusal is a verdict:
 * "no verified xStock was found for this thesis" will be just as true the
 * second time, and re-running it would burn another two minutes to show the
 * user the same message. Those propagate.
 */
async function composeSandwichFromSource(
  sourceId: string,
  user: AppUserPayload | null,
  onStage?: (stage: string) => void,
): Promise<SandwichDraft | null> {
  const composeStartedAt = Date.now();
  // Fusing the two calls cost the composer its stage labels: it used to name
  // the phase by knowing which request was in flight, and now there is only
  // one. This timer is an ESTIMATE of the handover, not an observation of it —
  // it fires at the analyze share of the server's budget, which is where the
  // build phase actually starts in the common case. Nothing branches on it.
  // (Reading the real stages means subscribing to the basket event stream the
  // pipeline already emits; that is a bigger change than this one.)
  const stageTimer = setTimeout(() => onStage?.('Building your sandwich…'), COMPOSE_BUILD_STAGE_HINT_MS);
  try {
    const payload = await requestJson<unknown>(
      `/api/sandwich/sources/${encodeURIComponent(sourceId)}/compose`,
      {
        method: 'POST',
        body: { user },
        timeoutMs: SANDWICH_COMPOSE_TIMEOUT_MS,
        timeoutMessage: 'Building the Sandwich took too long. Please try again.',
      },
    );
    clearTimeout(stageTimer);
    const draft = isRecord(payload) ? normalizeSandwich(payload.sandwich) : null;
    if (draft) {
      logSandwichStage('compose:completed', {
        sourceId,
        sandwichId: draft.id,
        legCount: draft.legs.length,
        elapsedMs: Date.now() - composeStartedAt,
      });
      return draft;
    }
    // A 200 we cannot read is not a refusal — fall through and rebuild.
    logSandwichStage('compose:unusable_payload', { sourceId });
    return null;
  } catch (error) {
    clearTimeout(stageTimer);
    const apiError = error instanceof ApiError ? error : null;
    const code = isRecord(apiError?.body) && typeof apiError.body.code === 'string' ? apiError.body.code : null;

    // YouTube sources are analyzed as moments the user picks from, so compose
    // declines them by design.
    if (apiError?.status === 400 && code === 'not_composable') return null;

    const recoverable =
      apiError?.code === 'TIMEOUT' ||
      apiError?.code === 'NETWORK_ERROR' ||
      // A 5xx may have died anywhere; analyze's persisted output (if any) makes
      // the two-step retry the cheap way to find out.
      (typeof apiError?.status === 'number' && apiError.status >= 500);
    if (!recoverable) throw error;

    logSandwichStage('compose:falling_back', {
      sourceId,
      code: apiError?.code ?? null,
      status: apiError?.status ?? null,
      elapsedMs: Date.now() - composeStartedAt,
    });
    return null;
  }
}

/**
 * Run the source → analyze → build pipeline and return an *unpersisted*
 * sandwich draft. The caller should let the user edit and then call
 * `commitSandwichDraft` to actually publish it.
 */
export async function createSandwichFromInput(
  input: string,
  user: AppUserPayload | null = null,
  /**
   * Called as each request starts, so the composer can show what the pipeline
   * is doing. The analyze step now runs a live web search before planning, so
   * the wait is long enough that naming the stage matters.
   */
  onStage?: (stage: string) => void,
): Promise<SandwichDraft> {
  if (!input.trim()) {
    throw new ApiError('INVALID_RESPONSE', 'Enter a thesis or X post URL.');
  }

  const startedAt = Date.now();
  logSandwichStage('create:start', { inputLength: input.trim().length });

  try {
    onStage?.('Reading your thesis…');
    const sourceStartedAt = Date.now();
    const sourcePayload = await requestJson<unknown>('/api/sandwich/sources', {
      method: 'POST',
      body: { input, user },
    });

    if (!isRecord(sourcePayload) || !isRecord(sourcePayload.source) || typeof sourcePayload.source.id !== 'string') {
      throw new ApiError('INVALID_RESPONSE', 'Source response was missing an id.');
    }

    logSandwichStage('source:created', {
      sourceId: sourcePayload.source.id,
      elapsedMs: Date.now() - sourceStartedAt,
    });

    // Paywalled article: only its free preview was readable, so say that
    // during the wait instead of implying the whole piece was analyzed.
    const researchStage =
      sourcePayload.paywalled === true
        ? 'Paywalled post — working from the free preview…'
        : 'Researching the market…';
    onStage?.(researchStage);

    // One call does analyze + build. The split between them was never a
    // checkpoint for typed text or an X post — we always built immediately —
    // so it only bought an extra round trip. `null` means compose declined the
    // source (a YouTube URL, which fans out into moments instead) or the
    // request was lost; either way the two-step path below is the answer.
    const composed = await composeSandwichFromSource(sourcePayload.source.id, user, onStage);
    if (composed) {
      logSandwichStage('create:completed', {
        sandwichId: composed.id,
        composed: true,
        totalElapsedMs: Date.now() - startedAt,
      });
      return composed;
    }

    // Compose declined or was lost. Its stage hint may have already advanced
    // the label to "Building…", so put it back before the two-step path starts
    // over at research.
    onStage?.(researchStage);
    const analysisStartedAt = Date.now();
    const analysisPayload = await analyzeSourceWithResume(sourcePayload.source.id, onStage);

    const thesisRows = isRecord(analysisPayload) && Array.isArray(analysisPayload.theses) ? analysisPayload.theses : [];
    const firstThesis = thesisRows.find((row) => isRecord(row) && typeof row.id === 'string') as
      | Record<string, unknown>
      | undefined;

    logSandwichStage('analysis:completed', {
      sourceId: sourcePayload.source.id,
      thesisCount: thesisRows.length,
      firstThesisId: typeof firstThesis?.id === 'string' ? firstThesis.id : null,
      elapsedMs: Date.now() - analysisStartedAt,
    });

    if (!firstThesis || typeof firstThesis.id !== 'string') {
      throw new ApiError('INVALID_RESPONSE', 'Analysis did not return a thesis.');
    }

    onStage?.('Building your sandwich…');
    const buildStartedAt = Date.now();
    const buildPayload = await requestJson<unknown>(
      `/api/sandwich/theses/${encodeURIComponent(firstThesis.id)}/build`,
      {
        method: 'POST',
        body: { user },
        timeoutMs: SANDWICH_THESIS_BUILD_TIMEOUT_MS,
        timeoutMessage: 'Building the Sandwich took too long. Please try again.',
      },
    );

    const draft = isRecord(buildPayload) ? normalizeSandwich(buildPayload.sandwich) : null;
    logSandwichStage('build:completed', {
      thesisId: firstThesis.id,
      sandwichId: draft?.id ?? null,
      legCount: draft?.legs.length ?? null,
      elapsedMs: Date.now() - buildStartedAt,
    });

    if (!draft) {
      throw new ApiError('INVALID_RESPONSE', 'Build response did not include a valid Sandwich.');
    }

    logSandwichStage('create:completed', {
      sandwichId: draft.id,
      totalElapsedMs: Date.now() - startedAt,
    });
    return draft;
  } catch (error) {
    logSandwichStage('create:failed', {
      code: error instanceof ApiError ? error.code : null,
      status: error instanceof ApiError ? error.status ?? null : null,
      message: error instanceof Error ? error.message : 'Unknown error',
      totalElapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
}

// ─── Podcast → alpha → Sandwich ─────────────────────────────────────────────

const YOUTUBE_URL_RE =
  /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

export function isYouTubeUrl(input: string): boolean {
  return YOUTUBE_URL_RE.test(input.trim());
}

/** The 11-char video id from any YouTube URL form, or null. */
export function youTubeVideoId(input: string): string | null {
  return input.trim().match(YOUTUBE_URL_RE)?.[1] ?? null;
}

export function youTubeWatchUrl(videoId: string, startMs?: number | null): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  return startMs && startMs > 0 ? `${base}&t=${Math.floor(startMs / 1000)}s` : base;
}

/**
 * The episode behind a source, when there is one.
 *
 * `videoId` is the authoritative field, but rows created before it shipped only
 * carry the URL — so the link is parsed as a fallback rather than treating those
 * sandwiches as if they came from nowhere.
 */
export function sourceYouTubeVideoId(source: SandwichSource | null | undefined): string | null {
  if (!source || source.sourceType !== 'youtube') return null;
  if (source.videoId) return source.videoId;
  const link = source.sourceUrl ?? source.input ?? '';
  const match =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(
      link,
    );
  return match?.[1] ?? null;
}

export type PodcastSourceStatus = {
  id: string;
  status: 'pending' | 'extracting' | 'resolving' | 'ready' | 'failed' | string;
  momentCount: number | null;
  videoId: string | null;
  durationMs: number | null;
  sourceUrl: string | null;
  title: string | null;
  channelName: string | null;
  channelHandle: string | null;
  channelAvatarUrl: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  /** 2-3 sentence synthesis of the episode, shown under the title. */
  editorialSummary: string | null;
  /** Why a `failed` source failed, when the backend can say. */
  statusReason:
    | 'no_captions'
    | 'no_actionable_moments'
    | 'no_actionable_buys'
    | 'rate_limited'
    | 'analysis_timeout'
    | 'resolution_failed'
    | 'analysis_failed'
    | 'trigger_failed'
    | null;
};

export type PodcastMomentEntity = { label: string; kind: string; ticker: string | null };

/** A tradeable instrument a moment resolved to, priced against the entry
 *  snapshotted when the call was made. */
export type PodcastMomentLeg = {
  mint: string;
  symbol: string;
  underlyingSymbol: string | null;
  label: string;
  iconUrl: string | null;
  provider: string;
  side: string;
  weightBps: number;
  entryPriceUsd: number | null;
  entryAt: string | null;
  entryBasis: 'source_timestamp' | 'analysis_time' | null;
  reason: string;
  exposureType: string;
  resolutionSource: 'grounded_primary' | 'verified_relationship' | null;
  currentPriceUsd: number | null;
  pnlPct: number | null;
};

export type PodcastMomentLegStatus =
  | 'resolved'
  | 'no_instrument'
  | 'no_perp_route'
  | 'entry_price_unverified'
  | 'direction_unsupported'
  /** Legacy: written before shorts could route to Phoenix perps. */
  | 'short_unavailable';

/** One quoted passage behind a call, separately playable. */
export type PodcastMomentSegment = {
  quote: string;
  speaker: string | null;
  startMs: number;
  endMs: number;
};

/** One link in the causal chain shown behind "show reasoning". */
export type PodcastMomentReasoningStep = {
  text: string;
  /** Index into `segments`, when this step follows from a specific passage. */
  segmentIndex: number | null;
};

/** An opposing call on the same ticker, cited by the counter view. */
export type PodcastMomentCounterCall = {
  handle: string | null;
  thesisId: string | null;
  summary: string;
};

export type PodcastMoment = {
  id: string;
  startMs: number | null;
  endMs: number | null;
  headline: string | null;
  summary: string;
  quote: string;
  direction: string;
  conviction: string | null;
  assetClass: string | null;
  entities: PodcastMomentEntity[];
  // "Since call" pricing for the primary ticker; any field may be null and the
  // UI hides what it doesn't have.
  ticker: string | null;
  callPrice: number | null;
  callPriceAt: string | null;
  callPriceBasis: 'source_timestamp' | 'analysis_time' | null;
  currentPrice: number | null;
  dayChangePct: number | null;
  /** Instruments this moment resolved to. Empty when nothing tradeable matched
   *  — `legStatus` says why. */
  legs: PodcastMomentLeg[];
  legStatus: PodcastMomentLegStatus | null;
  /** Where this executes: spot for a long call, Phoenix perp for a short one. */
  venue: 'spot' | 'perp';
  /**
   * Whether the moment is executable. `unrouted` moments are still returned and
   * still shown — with `unroutedReason` saying which gate turned them down, but
   * no buy CTA. Hiding them made episodes look empty when in fact every idea had
   * been considered and specifically declined.
   */
  routeStatus: 'routed' | 'unrouted';
  unroutedReason: string | null;
  /** 'idea' | 'position' | 'pick' — what kind of call this is. */
  bucket: string | null;
  /** First time this ticker has been called across every source. */
  firstMention: boolean;
  speakerName: string | null;
  speakerHandle: string | null;
  speakerVerified: boolean;
  tickerContext: string | null;
  timestampGrounded: boolean;
  segments: PodcastMomentSegment[];
  reasoningSteps: PodcastMomentReasoningStep[];
  counterNote: string | null;
  counterCalls: PodcastMomentCounterCall[];
  peakPct: number | null;
  peakAt: string | null;
};

function normalizePodcastSource(value: unknown): PodcastSourceStatus | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const statusReasons = new Set([
    'no_captions',
    'no_actionable_moments',
    'no_actionable_buys',
    'rate_limited',
    'analysis_timeout',
    'resolution_failed',
    'analysis_failed',
    'trigger_failed',
  ]);
  return {
    id: value.id,
    status: typeof value.status === 'string' ? value.status : 'pending',
    statusReason:
      typeof value.statusReason === 'string' && statusReasons.has(value.statusReason)
        ? (value.statusReason as PodcastSourceStatus['statusReason'])
        : null,
    momentCount: toNullableNumber(value.momentCount),
    videoId: typeof value.videoId === 'string' ? value.videoId : null,
    durationMs: toNullableNumber(value.durationMs),
    sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : null,
    title: typeof value.title === 'string' ? value.title : null,
    channelName: typeof value.channelName === 'string' ? value.channelName : null,
    channelHandle: typeof value.channelHandle === 'string' ? value.channelHandle : null,
    channelAvatarUrl: typeof value.channelAvatarUrl === 'string' ? value.channelAvatarUrl : null,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null,
    editorialSummary: typeof value.editorialSummary === 'string' ? value.editorialSummary : null,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
  };
}

function normalizePodcastMomentLeg(value: unknown): PodcastMomentLeg | null {
  if (!isRecord(value) || typeof value.mint !== 'string' || typeof value.symbol !== 'string') return null;
  return {
    mint: value.mint,
    symbol: value.symbol,
    underlyingSymbol: typeof value.underlyingSymbol === 'string' ? value.underlyingSymbol : null,
    label: typeof value.label === 'string' ? value.label : value.symbol,
    iconUrl: typeof value.iconUrl === 'string' ? value.iconUrl : null,
    provider: typeof value.provider === 'string' ? value.provider : 'xstock',
    side: typeof value.side === 'string' ? value.side : 'long',
    weightBps: toNullableNumber(value.weightBps) ?? 0,
    entryPriceUsd: toNullableNumber(value.entryPriceUsd),
    entryAt: typeof value.entryAt === 'string' ? value.entryAt : null,
    entryBasis:
      value.entryBasis === 'source_timestamp'
        ? 'source_timestamp'
        : typeof value.entryAt === 'string'
          ? 'analysis_time'
          : null,
    reason: typeof value.reason === 'string' ? value.reason : '',
    exposureType: typeof value.exposureType === 'string' ? value.exposureType : 'derived',
    resolutionSource:
      value.resolutionSource === 'grounded_primary' || value.resolutionSource === 'verified_relationship'
        ? value.resolutionSource
        : null,
    currentPriceUsd: toNullableNumber(value.currentPriceUsd),
    pnlPct: toNullableNumber(value.pnlPct),
  };
}

function normalizePodcastMoment(value: unknown): PodcastMoment | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const entities = Array.isArray(value.entities)
    ? value.entities.flatMap((e): PodcastMomentEntity[] => {
        if (!isRecord(e) || typeof e.label !== 'string') return [];
        return [
          {
            label: e.label,
            kind: typeof e.kind === 'string' ? e.kind : 'company',
            ticker: typeof e.ticker === 'string' ? e.ticker : null,
          },
        ];
      })
    : [];
  return {
    id: value.id,
    startMs: toNullableNumber(value.startMs),
    endMs: toNullableNumber(value.endMs),
    headline: typeof value.headline === 'string' ? value.headline : null,
    summary: typeof value.summary === 'string' ? value.summary : '',
    quote: typeof value.quote === 'string' ? value.quote : '',
    direction: typeof value.direction === 'string' ? value.direction : 'up',
    conviction: typeof value.conviction === 'string' ? value.conviction : null,
    assetClass: typeof value.assetClass === 'string' ? value.assetClass : null,
    entities,
    ticker: typeof value.ticker === 'string' ? value.ticker : null,
    callPrice: toNullableNumber(value.callPrice),
    callPriceAt: typeof value.callPriceAt === 'string' ? value.callPriceAt : null,
    callPriceBasis: value.callPriceBasis === 'source_timestamp' ? 'source_timestamp' : value.callPriceAt ? 'analysis_time' : null,
    currentPrice: toNullableNumber(value.currentPrice),
    dayChangePct: toNullableNumber(value.dayChangePct),
    legs: Array.isArray(value.legs)
      ? value.legs.flatMap((leg) => {
          const normalized = normalizePodcastMomentLeg(leg);
          return normalized ? [normalized] : [];
        })
      : [],
    legStatus: LEG_STATUSES.has(value.legStatus as string)
      ? (value.legStatus as PodcastMomentLegStatus)
      : null,
    venue: value.venue === 'perp' ? 'perp' : 'spot',
    // Older backends don't send routeStatus at all. Defaulting to 'routed' keeps
    // their moments buyable — every moment they published was executable by
    // construction, since unrouted ones weren't persisted.
    routeStatus: value.routeStatus === 'unrouted' ? 'unrouted' : 'routed',
    unroutedReason: typeof value.unroutedReason === 'string' ? value.unroutedReason : null,
    bucket: typeof value.bucket === 'string' ? value.bucket : null,
    firstMention: value.firstMention === true,
    speakerName: typeof value.speakerName === 'string' ? value.speakerName : null,
    speakerHandle: typeof value.speakerHandle === 'string' ? value.speakerHandle : null,
    speakerVerified: value.speakerVerified === true,
    tickerContext: typeof value.tickerContext === 'string' ? value.tickerContext : null,
    timestampGrounded: value.timestampGrounded === true,
    segments: Array.isArray(value.segments)
      ? value.segments.flatMap((raw): PodcastMomentSegment[] => {
          if (!isRecord(raw) || typeof raw.quote !== 'string' || !raw.quote) return [];
          return [
            {
              quote: raw.quote,
              speaker: typeof raw.speaker === 'string' && raw.speaker ? raw.speaker : null,
              startMs: toNullableNumber(raw.startMs) ?? 0,
              endMs: toNullableNumber(raw.endMs) ?? 0,
            },
          ];
        })
      : [],
    reasoningSteps: Array.isArray(value.reasoningSteps)
      ? value.reasoningSteps.flatMap((raw): PodcastMomentReasoningStep[] => {
          if (!isRecord(raw) || typeof raw.text !== 'string' || !raw.text) return [];
          const index = toNullableNumber(raw.segmentIndex);
          return [{ text: raw.text, segmentIndex: index != null && index >= 0 ? index : null }];
        })
      : [],
    counterNote: typeof value.counterNote === 'string' ? value.counterNote : null,
    counterCalls: Array.isArray(value.counterCalls)
      ? value.counterCalls.flatMap((raw): PodcastMomentCounterCall[] => {
          if (!isRecord(raw) || typeof raw.summary !== 'string' || !raw.summary) return [];
          return [
            {
              summary: raw.summary,
              handle: typeof raw.handle === 'string' ? raw.handle : null,
              thesisId: typeof raw.thesisId === 'string' ? raw.thesisId : null,
            },
          ];
        })
      : [],
    peakPct: toNullableNumber(value.peakPct),
    peakAt: typeof value.peakAt === 'string' ? value.peakAt : null,
  };
}

const LEG_STATUSES = new Set<string>([
  'resolved',
  'no_instrument',
  'no_perp_route',
  'entry_price_unverified',
  'direction_unsupported',
  'short_unavailable',
]);

/** Create a podcast source. Returns the source id + initial status; the backend
 *  analyzes the transcript in the background.
 *
 *  `transcript` is captions the CALLER fetched on-device (see
 *  `lib/youtube-captions`). YouTube refuses captions to the server's datacenter
 *  IP. Passing none is non-fatal — the backend still attempts its own fetch,
 *  but it will fail explicitly rather than fabricating a title-derived card. */
export async function createPodcastSource(
  url: string,
  user: AppUserPayload | null = null,
  transcript?: Array<{ text: string; offset: number; duration: number }> | null,
  /** Skip the backend's analyze-once cache and re-analyze the video fresh. */
  force = false,
): Promise<PodcastSourceStatus> {
  const payload = await requestJson<unknown>('/api/sandwich/sources', {
    method: 'POST',
    body: { input: url, user, ...(transcript?.length ? { transcript } : {}), ...(force ? { force } : {}) },
  });
  const source = isRecord(payload) ? normalizePodcastSource(payload.source) : null;
  if (!source) throw new ApiError('INVALID_RESPONSE', 'Source response was missing an id.');
  return source;
}

export async function getPodcastSourceStatus(
  sourceId: string,
  signal?: AbortSignal,
): Promise<PodcastSourceStatus> {
  const payload = await requestJson<unknown>(`/api/sandwich/sources/${encodeURIComponent(sourceId)}`, {
    method: 'GET',
    signal,
  });
  const source = isRecord(payload) ? normalizePodcastSource(payload.source) : null;
  if (!source) throw new ApiError('INVALID_RESPONSE', 'Source status was missing.');
  return source;
}

export async function getPodcastMoments(
  sourceId: string,
  signal?: AbortSignal,
): Promise<{ source: PodcastSourceStatus | null; moments: PodcastMoment[] }> {
  const payload = await requestJson<unknown>(
    `/api/sandwich/sources/${encodeURIComponent(sourceId)}/moments`,
    { method: 'GET', signal },
  );
  const source = isRecord(payload) ? normalizePodcastSource(payload.source) : null;
  const moments =
    isRecord(payload) && Array.isArray(payload.moments)
      ? payload.moments.flatMap((m): PodcastMoment[] => {
          const normalized = normalizePodcastMoment(m);
          if (!normalized) return [];
          // `routeStatus` is re-derived from the payload rather than trusted: a
          // card gets a buy CTA only if its own legs support one. See
          // isTradableMoment.
          const routeStatus = isTradableMoment(normalized) ? 'routed' : 'unrouted';
          return [normalized.routeStatus === routeStatus ? normalized : { ...normalized, routeStatus }];
        })
      : [];
  return { source, moments };
}

/**
 * Whether a moment's own payload supports opening a position.
 *
 * Deliberately re-derived on device rather than read off `routeStatus`: every
 * leg must carry a mint, an entry basis, and a side that agrees with the call's
 * direction. A short whose legs came back long is an inverted resolution, and it
 * must not reach a buy button no matter what the server labelled it.
 */
function isTradableMoment(moment: PodcastMoment): boolean {
  if (moment.assetClass !== 'stock') return false;
  if (moment.direction !== 'up' && moment.direction !== 'down') return false;
  if (moment.legStatus !== 'resolved' || moment.legs.length === 0) return false;
  const expectedSide = moment.direction === 'down' ? 'short' : 'long';
  return moment.legs.every(
    (leg) => leg.side === expectedSide && leg.entryPriceUsd != null && Boolean(leg.entryAt) && Boolean(leg.mint),
  );
}

/**
 * Poll a podcast source until it is `ready` (or `failed`/timeout), returning the
 * extracted moments. `onProgress` surfaces interim status for the UI.
 */
/**
 * Why a `failed` source failed, as something the user can act on.
 *
 * Shared by every waiter so the sentence cannot drift between them — and
 * deliberately mirrored by `podcastFailureBody` on the backend, which says the
 * same thing in a push when nobody was watching.
 */
export function podcastFailureToError(status: PodcastSourceStatus): ApiError {
  // Be specific when we know why: "no captions" is actionable (pick another
  // video), a generic failure message is not.
  if (status.statusReason === 'no_captions') {
    return new ApiError(
      'PODCAST_NO_CAPTIONS',
      "This video has no captions, so it can't be analyzed. Try one with subtitles.",
    );
  }
  if (status.statusReason === 'rate_limited' || status.statusReason === 'analysis_timeout') {
    return new ApiError('PODCAST_TEMPORARY_FAILURE', 'Podcast analysis is temporarily busy. Please retry this link.');
  }
  if (status.statusReason === 'resolution_failed') {
    return new ApiError('PODCAST_RESOLUTION_FAILED', 'We found the discussion but could not map it to tradeable stocks. Please retry.');
  }
  if (status.statusReason === 'trigger_failed') {
    return new ApiError('PODCAST_TEMPORARY_FAILURE', 'Podcast analysis could not start. Please retry this link.');
  }
  return new ApiError('PODCAST_FAILED', 'We could not analyze this podcast. Please retry this link.');
}

/**
 * Turn ONE timestamped moment into its own Sandwich. The backend already
 * resolved and priced the moment's legs during analysis, so this persists
 * immediately instead of re-running discovery.
 */
export async function buildSandwichFromMoment(
  sourceId: string,
  momentId: string,
  user: AppUserPayload | null = null,
  executionVenue: 'spot' | 'perp' | null = null,
): Promise<SandwichDraft> {
  const payload = await requestJson<unknown>(
    `/api/sandwich/sources/${encodeURIComponent(sourceId)}/moments/${encodeURIComponent(momentId)}/build`,
    {
      method: 'POST',
      body: { user, ...(executionVenue ? { executionVenue } : {}) },
      timeoutMs: SANDWICH_BUILD_TIMEOUT_MS,
      timeoutMessage: 'Building the Sandwich took too long. Please try again.',
    },
  );
  const sandwich = isRecord(payload) ? normalizeSandwich(payload.sandwich) : null;
  if (!sandwich) throw new ApiError('INVALID_RESPONSE', 'Build response did not include a valid Sandwich.');
  return sandwich;
}

export type BuiltMomentSandwich = { momentId: string; sandwich: SandwichDraft };
export type MomentBuildFailure = { momentId: string; reason: string; code: string };

/**
 * Build EVERY tradeable moment in an episode into its own Sandwich.
 *
 * An episode is a list of independent calls, so there is nothing for the viewer
 * to pick: each routed timestamp becomes its own market in one round trip.
 * Moments already built come back with their existing Sandwich, and moments
 * that could not be built come back in `failures` — a partial run is a normal
 * result here, not an error.
 */
export async function buildAllMomentSandwiches(
  sourceId: string,
  user: AppUserPayload | null = null,
): Promise<{ sandwiches: BuiltMomentSandwich[]; failures: MomentBuildFailure[] }> {
  const payload = await requestJson<unknown>(
    `/api/sandwich/sources/${encodeURIComponent(sourceId)}/build-all`,
    {
      method: 'POST',
      body: { user },
      // One request builds N markets, so it needs materially longer than a
      // single-moment build before the client gives up on it.
      timeoutMs: SANDWICH_BUILD_TIMEOUT_MS * 3,
      timeoutMessage: 'Building this episode took too long. Please try again.',
    },
  );
  if (!isRecord(payload)) {
    throw new ApiError('INVALID_RESPONSE', 'Build response was not readable.');
  }
  const sandwiches: BuiltMomentSandwich[] = [];
  for (const entry of Array.isArray(payload.sandwiches) ? payload.sandwiches : []) {
    if (!isRecord(entry) || typeof entry.momentId !== 'string') continue;
    const sandwich = normalizeSandwich(entry.sandwich);
    if (sandwich) sandwiches.push({ momentId: entry.momentId, sandwich });
  }
  const failures: MomentBuildFailure[] = [];
  for (const entry of Array.isArray(payload.failures) ? payload.failures : []) {
    if (!isRecord(entry) || typeof entry.momentId !== 'string') continue;
    failures.push({
      momentId: entry.momentId,
      reason: typeof entry.reason === 'string' ? entry.reason : 'This call could not be built.',
      code: typeof entry.code === 'string' ? entry.code : 'build_failed',
    });
  }
  return { sandwiches, failures };
}

/** Build a Sandwich (draft preview by default) from selected podcast moments. */
export async function buildSandwichFromMoments(
  sourceId: string,
  momentIds: string[],
  user: AppUserPayload | null = null,
): Promise<SandwichDraft> {
  const payload = await requestJson<unknown>(
    `/api/sandwich/sources/${encodeURIComponent(sourceId)}/build-from-moments`,
    {
      method: 'POST',
      body: { momentIds, user },
      timeoutMs: SANDWICH_BUILD_TIMEOUT_MS,
      timeoutMessage: 'Building the Sandwich took too long. Please try again.',
    },
  );
  const draft = isRecord(payload) ? normalizeSandwich(payload.sandwich) : null;
  if (!draft) throw new ApiError('INVALID_RESPONSE', 'Build response did not include a valid Sandwich.');
  return draft;
}

export type CommitSandwichInput = {
  name: string;
  summary: string;
  horizon?: string | null;
  direction?: SandwichDirection | null;
  confidence?: string | null;
  warnings?: string[];
  legs: ManualSandwichLegInput[];
  /** Explicitly keeps a bullish edited draft on Phoenix instead of spot. */
  executionVenue?: SandwichVenue | null;
  /**
   * The builder's own read, in their words — the headline of the feed card.
   * Optional: an own-thesis sandwich with no commentary falls back to the
   * thesis summary rather than rendering an empty headline.
   */
  commentary?: string | null;
  /** The daily question this answers, when the composer was opened from one. */
  promptId?: string | null;
};

/** Server enforces the same cap — see the commit route. */
export const MAX_COMMENTARY_LENGTH = 560;

/**
 * Legs a bearish Sandwich may carry.
 *
 * Spot xStocks are long-only, so a short routes to a Phoenix perp — and a perp
 * entry is one all-or-nothing transaction, so it is capped at a single leg.
 * Mirrors `MAX_PERP_SANDWICH_LEGS` in the backend's
 * `lib/server/basket/venue.ts`, which rejects anything larger at commit with
 * `too_many_perp_legs`.
 */
export const MAX_PERP_SANDWICH_LEGS = 1;

/**
 * The hand-written daily question that opens the composer ("What's the trade
 * on today's CPI print?"). One is live at a time.
 */
export type DailyPrompt = {
  id: string;
  question: string;
  context: string | null;
  startsAt: string;
  expiresAt: string;
  /** Published sandwiches that answer it. */
  answerCount: number;
};

function normalizeDailyPrompt(value: unknown): DailyPrompt | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : null;
  const question = typeof value.question === 'string' ? value.question.trim() : '';
  const expiresAt = typeof value.expiresAt === 'string' ? value.expiresAt : null;
  if (!id || !question || !expiresAt) return null;
  return {
    id,
    question,
    context: typeof value.context === 'string' && value.context.trim() ? value.context.trim() : null,
    startsAt: typeof value.startsAt === 'string' ? value.startsAt : expiresAt,
    expiresAt,
    answerCount: toNumber(value.answerCount) ?? 0,
  };
}

/**
 * Today's question, or null when there isn't one. Never throws: the feed card is
 * optional, and a failed read must look exactly like "no question today".
 */
export async function getCurrentPrompt(): Promise<DailyPrompt | null> {
  try {
    const payload = await requestJson<unknown>('/api/prompts/current', { timeoutMs: 8000 });
    return isRecord(payload) ? normalizeDailyPrompt(payload.prompt) : null;
  } catch {
    return null;
  }
}

/**
 * Persist a sandwich draft after the user has edited it. Requires the thesisId
 * returned in the draft (set by the AI build flow).
 */
export async function commitSandwichDraft(
  thesisId: string,
  input: CommitSandwichInput,
  user: AppUserPayload | null = null,
  anonymousId: string | null = null,
): Promise<Sandwich> {
  if (!thesisId) throw new ApiError('INVALID_RESPONSE', 'Missing thesis id for commit.');
  const payload = await requestJson<unknown>(
    `/api/sandwich/theses/${encodeURIComponent(thesisId)}/commit`,
    {
      method: 'POST',
      timeoutMs: SANDWICH_BUILD_TIMEOUT_MS,
      timeoutMessage: 'Confirming the Sandwich took too long. Please try again.',
      body: {
        user,
        anonymousId,
        draft: input,
      },
    },
  );
  const sandwich = isRecord(payload) ? normalizeSandwich(payload.sandwich) : null;
  if (!sandwich) {
    throw new ApiError('INVALID_RESPONSE', 'Commit did not return a valid Sandwich.');
  }
  return sandwich;
}

/**
 * Create a brand-new sandwich from a hand-built draft (no AI involvement).
 */
export async function createManualSandwich(
  input: ManualSandwichInput,
  user: AppUserPayload | null = null,
  anonymousId: string | null = null,
): Promise<Sandwich> {
  const payload = await requestJson<unknown>('/api/sandwiches', {
    method: 'POST',
    timeoutMs: SANDWICH_BUILD_TIMEOUT_MS,
    timeoutMessage: 'Creating the Sandwich took too long. Please try again.',
    body: {
      user,
      anonymousId,
      draft: input,
    },
  });
  const sandwich = isRecord(payload) ? normalizeSandwich(payload.sandwich) : null;
  if (!sandwich) {
    throw new ApiError('INVALID_RESPONSE', 'Create did not return a valid Sandwich.');
  }
  return sandwich;
}

export async function searchPredictionMarkets(
  query: string,
  limit = 10,
): Promise<PredictionMarketSearchHit[]> {
  const term = query.trim();
  // An empty term is allowed: the server browses the trending catalogue so the
  // picker can discover markets before the user types anything.
  //
  // The endpoint proxies Jupiter's prediction search server-side, which can be
  // slow on a cold function — give it well past the default 10s so a warm-up
  // request doesn't abort and silently yield zero markets.
  const payload = await requestJson<unknown>('/api/prediction-markets/search', {
    params: { q: term, limit: String(limit) },
    timeoutMs: 25000,
    timeoutMessage: 'Prediction market search timed out.',
  });
  if (!isRecord(payload) || !Array.isArray(payload.markets)) return [];
  return payload.markets
    .filter(isRecord)
    .map((row): PredictionMarketSearchHit | null => {
      const marketId = typeof row.marketId === 'string' ? row.marketId : null;
      const title = typeof row.title === 'string' ? row.title : null;
      const question = typeof row.question === 'string' ? row.question : title;
      if (!marketId || !question) return null;
      return {
        marketId,
        eventId: typeof row.eventId === 'string' ? row.eventId : null,
        title: title ?? question,
        question,
        imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : null,
        eventImageUrl: typeof row.eventImageUrl === 'string' ? row.eventImageUrl : null,
        yesPriceUsd: typeof row.yesPriceUsd === 'number' ? row.yesPriceUsd : null,
        noPriceUsd: typeof row.noPriceUsd === 'number' ? row.noPriceUsd : null,
        liquidityUsd: typeof row.liquidityUsd === 'number' ? row.liquidityUsd : null,
        volumeUsd: typeof row.volumeUsd === 'number' ? row.volumeUsd : null,
        endDate: typeof row.endDate === 'string' ? row.endDate : null,
      };
    })
    .filter((hit): hit is PredictionMarketSearchHit => hit !== null);
}

/** OHLC candle for a prediction market's YES/NO probability history. */
export type PredictionCandle = {
  /** Bucket start in ms since epoch. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Chart windows the prediction detail chart offers. */
export type PredictionChartWindow = '1D' | '1W' | '1M' | 'ALL';

// Maps each window to the Polymarket CLOB candle bucket (`type`, for our
// server-side aggregation) + the CLOB `interval` lookback token. We use
// `interval` rather than startTs/endTs because the CLOB rejects wide time
// ranges ("interval is too long"), which broke the 1M and ALL windows.
const PREDICTION_WINDOW_CONFIG: Record<
  PredictionChartWindow,
  { type: string; interval: string }
> = {
  '1D': { type: '1H', interval: '1d' },
  '1W': { type: '4H', interval: '1w' },
  '1M': { type: '1D', interval: '1m' },
  ALL: { type: '1D', interval: 'max' },
};

/**
 * Fetch a prediction market's price-history candles from Polymarket's CLOB via
 * our `/api/polymarket/candles` proxy. `marketId` is Jupiter's id (e.g.
 * `POLY-19234`); the proxy trims the `POLY-` prefix before hitting Polymarket.
 * `side` selects which outcome's probability line to chart (default YES).
 */
export async function getPredictionMarketCandles(
  marketId: string,
  side: 'yes' | 'no' = 'yes',
  window: PredictionChartWindow = '1W',
): Promise<PredictionCandle[]> {
  const id = marketId.trim();
  if (!id) return [];

  const cfg = PREDICTION_WINDOW_CONFIG[window] ?? PREDICTION_WINDOW_CONFIG['1W'];

  const payload = await requestJson<unknown>('/api/polymarket/candles', {
    params: {
      marketId: id,
      side,
      type: cfg.type,
      interval: cfg.interval,
    },
    timeoutMs: 20000,
  }).catch(() => null);

  if (!isRecord(payload) || !Array.isArray(payload.candles)) return [];

  return payload.candles
    .filter(isRecord)
    .map((row): PredictionCandle | null => {
      const timestamp = typeof row.timestamp === 'number' ? row.timestamp : null;
      const open = typeof row.open === 'number' ? row.open : null;
      const high = typeof row.high === 'number' ? row.high : null;
      const low = typeof row.low === 'number' ? row.low : null;
      const close = typeof row.close === 'number' ? row.close : null;
      if (timestamp === null || open === null || high === null || low === null || close === null) {
        return null;
      }
      return {
        timestamp,
        open,
        high,
        low,
        close,
        volume: typeof row.volume === 'number' ? row.volume : 0,
      };
    })
    .filter((c): c is PredictionCandle => c !== null);
}

export function getSandwichShareUrl(sandwichId: string): string {
  // Public, tappable https link (messengers only linkify http/https — never the
  // bread:// scheme). Points at the landing site's /s/[id] page, which renders a
  // rich preview and bounces into the app if it's installed. NOT the JSON API
  // endpoint (/api/sandwiches/{id}) — that just shows raw JSON in a browser.
  const baseUrl = (process.env.EXPO_PUBLIC_SHARE_BASE_URL ?? 'https://breadapp.fun').replace(/\/$/, '');
  return `${baseUrl}/s/${encodeURIComponent(sandwichId)}`;
}

type SandwichListCache = { data: Sandwich[]; cachedAt: number };
const sandwichListCache = new Map<string, SandwichListCache>();
const SANDWICH_LIST_TTL_MS = 30 * 1000;

export function getCachedSandwiches(
  limit = 20,
  user: AppUserPayload | null = null,
  anonymousId: string | null = null,
): Sandwich[] | null {
  // Responses include viewerHasLiked. Without a viewer-scoped key, caching a
  // response could briefly show the previous signed-in account's hearts.
  if (!anonymousId) return null;
  const key = `${limit}:${user?.privyUserId ?? ''}:${anonymousId ?? ''}`;
  const cached = sandwichListCache.get(key);
  if (cached && Date.now() - cached.cachedAt < SANDWICH_LIST_TTL_MS) return cached.data;
  return null;
}

export type SandwichPage = {
  sandwiches: Sandwich[];
  /** Pass back as `cursor` for the next page; null when the feed is exhausted. */
  nextCursor: string | null;
};

/**
 * One page of the feed.
 *
 * The feed collapses every market of a podcast episode into a single card, so
 * a page of 20 rows can render as three cards. Callers page until they have
 * enough CARDS, which is why the cursor is exposed rather than just a limit.
 */
export async function getSandwichPage(
  limit = 20,
  cursor: string | null = null,
  user: AppUserPayload | null = null,
  anonymousId: string | null = null,
): Promise<SandwichPage> {
  const payload = await requestJson<unknown>('/api/sandwiches', {
    params: {
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
      ...(user ? { privyUserId: user.privyUserId } : {}),
      // The authenticated token is the source of truth for viewerHasLiked.
      // Keep sending this installation id so the backend can claim likes made
      // by older builds that stored them against the device.
      ...(anonymousId ? { anonymousId } : {}),
    },
    timeoutMs: 20000,
    timeoutMessage: 'Loading sandwiches took too long. Pull to refresh to try again.',
  });

  const rows = isRecord(payload) && Array.isArray(payload.sandwiches) ? payload.sandwiches : [];
  const sandwiches = rows
    .map(normalizeSandwich)
    .filter((sandwich): sandwich is Sandwich => sandwich !== null);
  const nextCursor =
    isRecord(payload) && typeof payload.nextCursor === 'string' && payload.nextCursor
      ? payload.nextCursor
      : null;

  // Only the first page is cached — it is the one the feed paints from cold.
  if (anonymousId && !cursor) {
    const key = `${limit}:${user?.privyUserId ?? ''}:${anonymousId ?? ''}`;
    sandwichListCache.set(key, { data: sandwiches, cachedAt: Date.now() });
  }
  return { sandwiches, nextCursor };
}

export async function getSandwiches(
  limit = 20,
  user: AppUserPayload | null = null,
  anonymousId: string | null = null,
): Promise<Sandwich[]> {
  const { sandwiches } = await getSandwichPage(limit, null, user, anonymousId);
  return sandwiches;
}

// ── The feed, in CARDS ──────────────────────────────────────────────────────
//
// `/api/posts` pages over the Post table, so one row is one card. The sandwich
// feed above pages over MARKETS while the client counts cards, which is why it
// had to keep requesting pages until it had enough: an episode's markets
// collapse into a single card, so a page of 20 rows could render as three.
//
// It also stops the client inferring the grouping. `buildFeedItems` grouped by
// `sourceId` and hoped that matched what the server considered one card; here
// the server states it. `getSandwichPage` stays for the paths that genuinely
// want markets (deep links, a source's markets).

/** One feed card, exactly as `SerializedPost` puts it on the wire. */
export type SandwichPost = {
  id: string;
  /**
   * Rendering hint only — "episode" | "thesis" | "curated" | "take". Never a
   * branch in the social path; a take is a Post like any other and its likes,
   * comments and paging go through the same routes.
   */
  kind: string;
  sourceId: string | null;
  title: string;
  coverUrl: string | null;
  originHandle: string | null;
  marketCount: number;
  publishedAt: string | null;
  createdAt: string;
  /** The markets on this card, oldest-first. Length 1 for a plain thesis. */
  sandwiches: Sandwich[];
  likeCount: number;
  commentCount: number;
  viewerHasLiked: boolean;
  /** Set only on `kind: "take"` — the holder thesis and its verified stamp. */
  take?: PositionTake | null;
};

export type PostPage = {
  posts: SandwichPost[];
  /** Pass back as `cursor` for the next page; null when the feed is exhausted. */
  nextCursor: string | null;
};

function normalizePost(value: unknown): SandwichPost | null {
  if (!isRecord(value)) return null;

  const id = typeof value.id === 'string' ? value.id : null;
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : null;
  if (!id || !createdAt) return null;

  // Likes and comments belong to the card, so `/api/posts` reports them ONCE on
  // the post rather than repeating them on every market. Everything downstream
  // — `cardSocial`, the detail screen, `setCardLike` — reads them off a market,
  // because that is how `/api/sandwiches` shipped them. Grafting them back on
  // keeps those readers working unchanged instead of forking every one of them.
  const social: CardSocial = {
    likeCount: typeof value.likeCount === 'number' ? value.likeCount : 0,
    commentCount: typeof value.commentCount === 'number' ? value.commentCount : 0,
    viewerHasLiked: value.viewerHasLiked === true,
  };

  const sandwiches = (Array.isArray(value.sandwiches) ? value.sandwiches : [])
    .map(normalizeSandwich)
    .filter((sandwich): sandwich is Sandwich => sandwich !== null)
    .map((sandwich) => ({ ...sandwich, ...social, postId: sandwich.postId ?? id }));

  // A card with no markets is a pipeline artifact, not a post — the server
  // filters these out too, and rendering one would be an empty row.
  if (sandwiches.length === 0) return null;

  return {
    id,
    kind: typeof value.kind === 'string' ? value.kind : 'thesis',
    sourceId: typeof value.sourceId === 'string' ? value.sourceId : null,
    title: typeof value.title === 'string' ? value.title : '',
    coverUrl: typeof value.coverUrl === 'string' ? value.coverUrl : null,
    originHandle: typeof value.originHandle === 'string' ? value.originHandle : null,
    marketCount:
      typeof value.marketCount === 'number' ? value.marketCount : sandwiches.length,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null,
    createdAt,
    sandwiches,
    take: normalizePositionTake(value.take),
    ...social,
  };
}

type PostListCache = { data: SandwichPost[]; cachedAt: number };
const postListCache = new Map<string, PostListCache>();

function postCacheKey(
  limit: number,
  user: AppUserPayload | null,
  anonymousId: string | null,
): string {
  return `${limit}:${user?.privyUserId ?? ''}:${anonymousId ?? ''}`;
}

export function getCachedPosts(
  limit = 20,
  user: AppUserPayload | null = null,
  anonymousId: string | null = null,
): SandwichPost[] | null {
  // Same rule as the sandwich cache: responses carry viewerHasLiked, so a key
  // that isn't viewer-scoped could flash the previous account's hearts.
  if (!anonymousId) return null;
  const cached = postListCache.get(postCacheKey(limit, user, anonymousId));
  if (cached && Date.now() - cached.cachedAt < SANDWICH_LIST_TTL_MS) return cached.data;
  return null;
}

/**
 * One page of the feed, in cards.
 *
 * Unlike `getSandwichPage`, `limit` here means what the caller expects it to:
 * the reply holds up to `limit` CARDS, so there is no "page until we have
 * enough" loop to get wrong.
 */
export async function getPostPage(
  limit = 20,
  cursor: string | null = null,
  user: AppUserPayload | null = null,
  anonymousId: string | null = null,
): Promise<PostPage> {
  const payload = await requestJson<unknown>('/api/posts', {
    params: {
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
      ...(user ? { privyUserId: user.privyUserId } : {}),
      // Still sent so the backend can claim likes older builds stored against
      // the device, exactly as the sandwich feed does.
      ...(anonymousId ? { anonymousId } : {}),
    },
    timeoutMs: 20000,
    timeoutMessage: 'Loading sandwiches took too long. Pull to refresh to try again.',
  });

  const rows = isRecord(payload) && Array.isArray(payload.posts) ? payload.posts : [];
  const posts = rows
    .map(normalizePost)
    .filter((post): post is SandwichPost => post !== null);
  const nextCursor =
    isRecord(payload) && typeof payload.nextCursor === 'string' && payload.nextCursor
      ? payload.nextCursor
      : null;

  // Only the first page is cached — it is the one the feed paints from cold.
  if (anonymousId && !cursor) {
    postListCache.set(postCacheKey(limit, user, anonymousId), {
      data: posts,
      cachedAt: Date.now(),
    });
  }
  return { posts, nextCursor };
}

/** Cards Home's Trending section shows, and the pool the server ranks them from. */
export const TRENDING_TAKE = 6;
const TRENDING_POOL = 40;

/**
 * Home's Trending cards, ranked on the server.
 *
 * `rank=trending` asks the backend to rank its first 40 cards and return only
 * the top six, instead of shipping all 40 (~1.3MB) for the phone to rank. A
 * backend that predates the param simply returns the 40, and Home still ranks
 * and slices them itself, so either side can deploy first.
 *
 * `rows` is the raw response, for the on-disk copy in lib/trending-disk-cache
 * (stored raw and normalized on read, so a client-side shape change never
 * reads a stale serialization).
 */
export async function getTrendingPostsPayload(
  anonymousId: string,
): Promise<{ posts: SandwichPost[]; rows: unknown[] }> {
  const payload = await requestJson<unknown>('/api/posts', {
    params: {
      limit: String(TRENDING_POOL),
      rank: 'trending',
      take: String(TRENDING_TAKE),
      anonymousId,
    },
    timeoutMs: 20000,
    timeoutMessage: 'Loading sandwiches took too long. Pull to refresh to try again.',
  });
  const rows = isRecord(payload) && Array.isArray(payload.posts) ? payload.posts : [];
  return { posts: normalizePosts(rows), rows };
}

/** Raw `/api/posts` rows → cards, dropping any that do not normalize. */
export function normalizePosts(rows: unknown[]): SandwichPost[] {
  return rows.map(normalizePost).filter((post): post is SandwichPost => post !== null);
}

export async function getPosts(
  limit = 20,
  user: AppUserPayload | null = null,
  anonymousId: string | null = null,
): Promise<SandwichPost[]> {
  const { posts } = await getPostPage(limit, null, user, anonymousId);
  return posts;
}

/**
 * Every market built from one source, oldest first — i.e. an episode in the
 * order its calls were made.
 *
 * Used when the podcast episode screen is entered cold (a share link, or the
 * in-memory group was lost) and has to rebuild what the feed would normally
 * have handed it. Returns an empty array rather than throwing so the screen can
 * fall back to its empty state.
 */
export async function getSandwichesBySource(
  sourceId: string,
  anonymousId: string | null = null,
): Promise<Sandwich[]> {
  if (!sourceId.trim()) return [];
  try {
    const payload = await requestJson<unknown>('/api/sandwiches', {
      params: {
        sourceId: sourceId.trim(),
        limit: '50',
        ...(anonymousId ? { anonymousId } : {}),
      },
    });
    const rows = isRecord(payload) && Array.isArray(payload.sandwiches) ? payload.sandwiches : [];
    return rows.map(normalizeSandwich).filter((s): s is Sandwich => s !== null);
  } catch {
    return [];
  }
}

/**
 * Fetch a single sandwich by id via `/api/sandwiches/{id}`. Returns null when
 * the sandwich no longer exists (e.g. a bookmarked sandwich was deleted) so the
 * Saved screen can quietly skip it. Pass the viewer's anonymous id so
 * `viewerHasLiked` comes back correct.
 */
export async function getSandwichById(
  id: string,
  anonymousId: string | null = null,
): Promise<Sandwich | null> {
  if (!id.trim()) return null;
  try {
    const payload = await requestJson<unknown>(`/api/sandwiches/${encodeURIComponent(id.trim())}`, {
      params: anonymousId ? { anonymousId } : undefined,
    });
    return isRecord(payload) ? normalizeSandwich(payload.sandwich) : null;
  } catch {
    return null;
  }
}

// ─── Admin: create curated entry + upload cover image ─────────────────────

export async function createCuratedEntry(
  sandwichId: string,
  title: string | null,
  subtitle: string | null,
  sortOrder = 0,
): Promise<{ id: string }> {
  const payload = await requestJson<unknown>('/api/admin/curated-sandwiches', {
    method: 'POST',
    body: { sandwichId, title, subtitle, sortOrder },
  });
  // The admin create/pin route returns the bare curated row (no nested
  // `sandwich`), so we just need its id — don't run it through
  // normalizeCuratedSandwich (which requires the full sandwich and would
  // otherwise null-out a successful 201 and surface a false "failed" error).
  const entry = isRecord(payload) ? (payload as Record<string, unknown>).curatedSandwich : null;
  const id = isRecord(entry) && typeof entry.id === 'string' ? entry.id : null;
  if (!id) throw new ApiError('INVALID_RESPONSE', 'Failed to create curated entry.');
  return { id };
}

export async function uploadCuratedCoverImageMobile(
  curatedId: string,
  imageUri: string,
): Promise<void> {
  const baseUrl = getApiBaseUrl();
  const ext = imageUri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const formData = new FormData();
  formData.append('image', { uri: imageUri, type: mimeType, name: `cover.${ext}` } as unknown as Blob);
  const authHeaders = await buildAuthHeaders();
  const res = await fetch(`${baseUrl}/api/admin/curated-sandwiches/${curatedId}/cover-image`, {
    method: 'POST',
    headers: authHeaders,
    body: formData,
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError('HTTP_ERROR', typeof json.error === 'string' ? json.error : `HTTP ${res.status}`, res.status);
  }
}

// ─── Curated Sandwiches ──────────────────────────────────────────────────────

export type CuratedSandwich = {
  id: string;
  sandwichId: string;
  coverImageUrl: string | null;
  title: string | null;
  subtitle: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  sandwich: Sandwich;
};

function normalizeCuratedSandwich(value: unknown): CuratedSandwich | null {
  if (!isRecord(value)) return null;
  const sandwich = normalizeSandwich(value.sandwich);
  if (!sandwich) return null;
  const id = typeof value.id === 'string' ? value.id : null;
  const sandwichId = typeof value.sandwichId === 'string' ? value.sandwichId : null;
  if (!id || !sandwichId) return null;
  return {
    id,
    sandwichId,
    coverImageUrl: typeof value.coverImageUrl === 'string' ? value.coverImageUrl : null,
    title: typeof value.title === 'string' ? value.title : null,
    subtitle: typeof value.subtitle === 'string' ? value.subtitle : null,
    sortOrder: typeof value.sortOrder === 'number' ? value.sortOrder : 0,
    isActive: value.isActive === true,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    sandwich,
  };
}

type CuratedSandwichCache = { data: CuratedSandwich[]; cachedAt: number };
const curatedSandwichCache = new Map<string, CuratedSandwichCache>();
const CURATED_TTL_MS = 60 * 1000;

/**
 * Write a card's new social state into the feed caches.
 *
 * Without this a like is forgotten for as long as the 30s list cache lives: a
 * screen that remounts and reads the cache would show the heart snapping back.
 * It covers every market of the card, since the cached feed holds an episode as
 * N rows.
 */
function updateCachedCardSocial(postId: string, social: CardSocial, anonymousId: string): void {
  const apply = (item: Sandwich) => (item.postId === postId ? { ...item, ...social } : item);

  for (const [key, cached] of sandwichListCache) {
    if (!key.endsWith(`:${anonymousId}`)) continue;
    sandwichListCache.set(key, { ...cached, data: cached.data.map(apply) });
  }
  // The card feed's own cache. A card carries the counts twice — once on the
  // post, once grafted onto each market by `normalizePost` — so both have to
  // move or the heart and the number disagree on the next cold paint.
  for (const [key, cached] of postListCache) {
    if (!key.endsWith(`:${anonymousId}`)) continue;
    const data = cached.data.map((post) =>
      post.id === postId
        ? { ...post, ...social, sandwiches: post.sandwiches.map(apply) }
        : post,
    );
    postListCache.set(key, { ...cached, data });
  }
  const curated = curatedSandwichCache.get(anonymousId);
  if (curated) {
    const data = curated.data.map((item) =>
      item.sandwich.postId === postId ? { ...item, sandwich: apply(item.sandwich) } : item,
    );
    curatedSandwichCache.set(anonymousId, { ...curated, data });
  }
}

export function getCachedCuratedSandwiches(anonymousId: string | null = null): CuratedSandwich[] | null {
  if (!anonymousId) return null;
  const key = anonymousId ?? '';
  const cached = curatedSandwichCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CURATED_TTL_MS) return cached.data;
  return null;
}

export async function getCuratedSandwiches(anonymousId: string | null = null): Promise<CuratedSandwich[]> {
  const key = anonymousId ?? '';
  const payload = await requestJson<unknown>('/api/curated-sandwiches', {
    params: anonymousId ? { anonymousId } : {},
    timeoutMs: 15000,
    timeoutMessage: 'Loading featured sandwiches took too long.',
  });
  const rows = isRecord(payload) && Array.isArray(payload.curatedSandwiches) ? payload.curatedSandwiches : [];
  const result = rows.map(normalizeCuratedSandwich).filter((c): c is CuratedSandwich => c !== null);
  if (anonymousId) curatedSandwichCache.set(key, { data: result, cachedAt: Date.now() });
  return result;
}

/**
 * The social state of a CARD. One set of numbers per card, however many markets
 * it holds. See stock-backend/docs/post-as-social-unit.md.
 */
export type CardSocial = {
  likeCount: number;
  commentCount: number;
  viewerHasLiked: boolean;
};

function normalizeCardSocial(payload: unknown): CardSocial {
  const post = isRecord(payload) && isRecord(payload.post) ? payload.post : null;
  if (!post) throw new ApiError('INVALID_RESPONSE', 'Post response was invalid.');
  return {
    likeCount: toNumber(post.likeCount) ?? 0,
    commentCount: toNumber(post.commentCount) ?? 0,
    viewerHasLiked: post.viewerHasLiked === true,
  };
}

/**
 * Like a card. ONE request, whatever it holds.
 *
 * This replaces the per-market `likeSandwich` loop. That loop wrote one like row
 * per market and fired one notification per market, each deep-linking to a
 * different one — and, being N independent requests, left an episode
 * permanently half-liked whenever one of them failed.
 */
async function likeViaPost(
  postId: string,
  liked: boolean,
  anonymousId: string,
): Promise<CardSocial> {
  const social = normalizeCardSocial(
    await requestJson<unknown>(`/api/posts/${encodeURIComponent(postId)}/like`, {
      method: liked ? 'POST' : 'DELETE',
      body: { anonymousId },
    }),
  );
  updateCachedCardSocial(postId, social, anonymousId);
  return social;
}

/**
 * The pre-Post route, for a market whose card does not exist yet.
 *
 * `postId` is null only on rows created before the Post backfill
 * (stock-backend/scripts/backfillPosts.ts). Falling back keeps the heart working
 * on that content instead of silently doing nothing; the server answers with the
 * same shape either way.
 */
async function likeViaSandwich(
  sandwichId: string,
  liked: boolean,
  anonymousId: string,
): Promise<CardSocial> {
  const payload = await requestJson<unknown>(
    `/api/sandwiches/${encodeURIComponent(sandwichId)}/like`,
    { method: liked ? 'POST' : 'DELETE', body: { anonymousId } },
  );
  const sandwich = isRecord(payload) ? normalizeSandwich(payload.sandwich) : null;
  if (!sandwich) throw new ApiError('INVALID_RESPONSE', 'Like response was invalid.');
  return {
    likeCount: sandwich.likeCount,
    commentCount: sandwich.commentCount,
    viewerHasLiked: sandwich.viewerHasLiked,
  };
}

/**
 * Like or unlike the CARD a market sits on. ONE request, whatever it holds.
 *
 * This replaces the per-market like loop: that wrote one like row per market and
 * fired the author one notification per market, each deep-linking to a different
 * one, and — being N independent requests — left an episode permanently
 * half-liked whenever one of them failed.
 */
export async function setCardLike(
  sandwich: Pick<Sandwich, 'id' | 'postId'>,
  liked: boolean,
  anonymousId: string,
): Promise<CardSocial> {
  return sandwich.postId
    ? likeViaPost(sandwich.postId, liked, anonymousId)
    : likeViaSandwich(sandwich.id, liked, anonymousId);
}

function normalizeSandwichComment(value: unknown): SandwichComment | null {
  if (!isRecord(value) || !isRecord(value.author)) return null;
  const id = stringValue(value.id);
  const sandwichId = stringValue(value.sandwichId);
  const body = typeof value.body === 'string' ? value.body : null;
  const createdAt = stringValue(value.createdAt);
  const updatedAt = stringValue(value.updatedAt);
  const authorId = stringValue(value.author.id);
  if (!id || !sandwichId || body === null || !createdAt || !updatedAt || !authorId) return null;

  return {
    id,
    sandwichId,
    body,
    createdAt,
    updatedAt,
    viewerCanDelete: value.viewerCanDelete === true,
    author: {
      id: authorId,
      username: stringValue(value.author.username),
      name: stringValue(value.author.name),
      avatarUrl: stringValue(value.author.avatarUrl),
    },
  };
}

/**
 * Which thread a card's comments live on.
 *
 * The card's, wherever it has one — an episode has ONE thread, not one per
 * market. A market with no Post yet (a row created before the backfill) keeps
 * its own thread, so its existing comments stay reachable.
 */
export type CommentThread = { path: string; anchorId: string | null };

export function commentThreadFor(card: Pick<Sandwich, 'id' | 'postId'>): CommentThread {
  return card.postId
    ? { path: `/api/posts/${encodeURIComponent(card.postId)}/comments`, anchorId: card.id }
    : { path: `/api/sandwiches/${encodeURIComponent(card.id)}/comments`, anchorId: null };
}

export async function getThreadComments(
  thread: CommentThread,
  cursor: string | null = null,
  limit = 30,
): Promise<SandwichCommentPage> {
  const payload = await requestJson<unknown>(
    thread.path,
    {
      params: {
        limit: String(Math.max(1, Math.min(limit, 50))),
        ...(cursor ? { cursor } : {}),
      },
    },
  );
  const comments = isRecord(payload) && Array.isArray(payload.comments)
    ? payload.comments.map(normalizeSandwichComment).filter((row): row is SandwichComment => row !== null)
    : [];
  return {
    comments,
    nextCursor: isRecord(payload) ? stringValue(payload.nextCursor) : null,
    totalCount: isRecord(payload) ? toNumber(payload.totalCount) ?? comments.length : comments.length,
  };
}

/**
 * Post to the thread. The anchor names the market the reader had open, which is
 * display-only — the thread itself belongs to the card.
 */
export async function postThreadComment(
  thread: CommentThread,
  body: string,
): Promise<SandwichComment> {
  const payload = await requestJson<unknown>(
    thread.path,
    {
      method: 'POST',
      body: { body, ...(thread.anchorId ? { sandwichId: thread.anchorId } : {}) },
    },
  );
  const comment = isRecord(payload) ? normalizeSandwichComment(payload.comment) : null;
  if (!comment) throw new ApiError('INVALID_RESPONSE', 'Comment response was invalid.');
  return comment;
}

export async function deleteThreadComment(
  thread: CommentThread,
  commentId: string,
): Promise<void> {
  await requestJson<unknown>(`${thread.path}/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  });
}

export async function getStockBySymbol(symbol: string): Promise<Stock> {
  if (!symbol.trim()) {
    throw new ApiError('INVALID_RESPONSE', 'Stock symbol is required.');
  }

  const payload = await requestJson<unknown>(`/api/stocks/${encodeURIComponent(symbol.trim())}`);

  if (!isStockApiRecord(payload)) {
    throw new ApiError('INVALID_RESPONSE', 'Stock details response was missing required fields.');
  }

  return normalizeStock(payload);
}

/**
 * Fetch a single stock by its token mint (the only id the Saved list persists)
 * via `/api/stocks/by-mint/{mint}`. The backend resolves the mint to its
 * canonical asset so the card matches what the rest of the app shows.
 */
export async function getStockById(mint: string): Promise<Stock> {
  if (!mint.trim()) {
    throw new ApiError('INVALID_RESPONSE', 'Asset mint is required.');
  }

  const payload = await requestJson<unknown>(`/api/stocks/by-mint/${encodeURIComponent(mint.trim())}`);

  if (!isStockApiRecord(payload)) {
    throw new ApiError('INVALID_RESPONSE', 'Asset response was missing required fields.');
  }

  return normalizeStock(payload);
}

/**
 * Token detail for the trade panel (price/symbol/icon/decimals) sourced WITHOUT
 * Jupiter: price/symbol/icon from the tokens.xyz card (`/api/stocks/by-mint`,
 * the same feed the chart uses) and decimals from the on-chain mint (Helius via
 * `getMintDecimals`). Jupiter is NEVER hit here — its shared rate-limit bucket
 * is reserved exclusively for buy/sell execution. When tokens.xyz can't resolve
 * the mint (e.g. some prestock singletons) we degrade to on-chain decimals only
 * (the one must-be-accurate field for trade sizing) rather than searching
 * Jupiter; price/symbol just come through as null and the header price falls
 * back to the value the tapped card already carries.
 */
export async function getTokenTradeDetail(mint: string): Promise<JupiterTokenDetail | null> {
  const trimmed = mint.trim();
  if (!isValidMint(trimmed)) return null;

  // Decimals from Helius — fetched independently so a tokens.xyz resolve failure
  // never costs us the decimals (they drive trade sizing).
  const decimals = await getMintDecimals(trimmed);

  try {
    const stock = await getStockById(trimmed);
    return {
      id: trimmed,
      buyVariantMint: stock.buyVariantMint ?? null,
      name: stock.name ?? null,
      symbol: stock.symbol ?? null,
      decimals,
      icon: stock.icon ?? null,
      holderCount: stock.holderCount ?? null,
      usdPrice: stock.usdPrice ?? null,
      volume24h: stock.volume24h ?? null,
      priceChange24h: stock.priceChange24h ?? null,
      mcap: stock.mcap ?? null,
    };
  } catch {
    // tokens.xyz couldn't resolve this mint — return decimals-only detail. No
    // Jupiter fallback: that bucket stays reserved for buy/sell.
    return {
      id: trimmed,
      buyVariantMint: null,
      name: null,
      symbol: null,
      decimals,
      icon: null,
      holderCount: null,
      usdPrice: null,
      volume24h: null,
      priceChange24h: null,
      mcap: null,
    };
  }
}

/**
 * Resilient rehydration for a bookmarked asset, which persists only its mint.
 *
 * Tries the canonical tokens.xyz card first (`/api/stocks/by-mint`), then falls
 * back to Jupiter token metadata — the same lookup the asset detail sheet uses
 * — so prestock / singleton mints that fail tokens.xyz `/v1/assets/resolve`
 * still render in the Saved screen instead of silently disappearing. Returns
 * null only when the mint resolves nowhere (a genuinely delisted token).
 */
export async function getSavedStock(mint: string): Promise<Stock | null> {
  const trimmed = mint.trim();
  if (!trimmed) return null;

  try {
    return await getStockById(trimmed);
  } catch {
    // tokens.xyz couldn't resolve this mint — fall back to Jupiter below.
  }

  try {
    const detail = await searchJupiterToken(trimmed, trimmed);
    if (!detail || !detail.symbol) return null;
    return {
      id: detail.id,
      symbol: detail.symbol.toUpperCase(),
      name: detail.name ?? detail.symbol,
      category: undefined,
      type: 'token',
      holderCount: detail.holderCount,
      icon: detail.icon,
      usdPrice: detail.usdPrice,
      priceChange1h: null,
      priceChange24h: detail.priceChange24h,
      volume24h: detail.volume24h,
      mcap: detail.mcap ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a single stock by its tokens.xyz asset slug (e.g. "nvidia", "tesla",
 * "apple") via `/api/tokens/asset/{slug}` → Tokens API `/v1/assets/{slug}`.
 */
export async function getStockBySlug(slug: string): Promise<Stock> {
  if (!slug.trim()) {
    throw new ApiError('INVALID_RESPONSE', 'Asset slug is required.');
  }

  const payload = await requestJson<unknown>(`/api/tokens/asset/${encodeURIComponent(slug.trim())}`);

  if (!isStockApiRecord(payload)) {
    throw new ApiError('INVALID_RESPONSE', 'Asset response was missing required fields.');
  }

  return normalizeStock(payload);
}

function isValidMint(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 32;
}

function isDigits(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

const PREDICTION_MIN_ORDER_USDC_NATIVE = BigInt(5_000_000);
const SPOT_MIN_ORDER_USDC_NATIVE = BigInt(500_000);
const ONDO_MIN_ORDER_USDC_NATIVE = BigInt(3_000_000);

function spotMinimumForMint(mint: string | null): bigint {
  return mint && /ondo$/i.test(mint.trim())
    ? ONDO_MIN_ORDER_USDC_NATIVE
    : SPOT_MIN_ORDER_USDC_NATIVE;
}

/**
 * Smallest total USDC buy (native, 6-dp) that can fund every executable leg.
 * Prediction orders require $5; ordinary spot legs use the backend's $0.50 dust
 * floor; Ondo/RFQ equities use $3 because ~$1 slices commonly receive no maker
 * route. The allocator rebalances to these floors before any quote is requested.
 */
export function minSandwichBuyUsdcNative(sandwich: Sandwich): bigint | null {
  let minimum = 0n;
  for (const leg of sandwich.legs) {
    const weightBps = Math.max(0, Math.trunc(leg.weightBps));
    if (weightBps <= 0) continue;
    if (leg.type === 'prediction_market') {
      if (leg.marketId) minimum += PREDICTION_MIN_ORDER_USDC_NATIVE;
    } else if (isValidMint(leg.mint)) {
      minimum += spotMinimumForMint(leg.mint);
    }
  }
  return minimum > 0n ? minimum : null;
}

type SandwichBuyCandidate =
  | { leg: SandwichLeg; weightBps: number; kind: 'swap' }
  | { leg: SandwichLeg; weightBps: number; kind: 'prediction' };

/**
 * Allocate a sandwich buy across its legs. Prediction legs whose natural
 * weighted slice is below Jupiter's $5 per-order floor are raised to $5, and the
 * shortfall is pulled back out of the legs that have room to give — in
 * proportion to their slack — so nothing is silently dropped. If the total is so
 * small that even draining every other leg can't fund the prediction floors
 * (i.e. below the sandwich minimum), the un-fundable prediction legs are skipped
 * as a last resort. The returned amounts always sum to exactly `totalAmount`.
 */
function allocateSandwichAmounts(
  candidates: SandwichBuyCandidate[],
  totalAmount: bigint,
  totalWeight: bigint,
  skippedLegs: SandwichBuyPlan['skippedLegs'],
): { amounts: bigint[]; skippedIndices: Set<number> } {
  const n = candidates.length;
  const skippedIndices = new Set<number>();

  // Natural proportional shares; the last leg absorbs the rounding remainder so
  // the parts always sum back to exactly totalAmount.
  const naturals: bigint[] = new Array(n);
  let acc = 0n;
  for (let i = 0; i < n; i++) {
    naturals[i] =
      i === n - 1
        ? totalAmount - acc
        : (totalAmount * BigInt(candidates[i].weightBps)) / totalWeight;
    acc += naturals[i];
  }

  const isPrediction = (i: number) => candidates[i].kind === 'prediction';
  const floorFor = (i: number) =>
    isPrediction(i)
      ? PREDICTION_MIN_ORDER_USDC_NATIVE
      : spotMinimumForMint(candidates[i].leg.mint);

  // Extra under-funded legs need to reach their venue floor, and the slack all
  // other legs can give while staying above their own floor.
  let totalDeficit = 0n;
  let donorPool = 0n;
  for (let i = 0; i < n; i++) {
    const floor = floorFor(i);
    if (naturals[i] < floor) totalDeficit += floor - naturals[i];
    else donorPool += naturals[i] - floor;
  }

  const amounts = naturals.slice();
  if (totalDeficit === 0n) {
    return { amounts, skippedIndices }; // no prediction leg needs flooring
  }

  if (donorPool >= totalDeficit) {
    for (let i = 0; i < n; i++) {
      const floor = floorFor(i);
      if (naturals[i] < floor) amounts[i] = floor;
    }
    let drained = 0n;
    let maxDonor = -1;
    let maxDonorSlack = 0n;
    for (let i = 0; i < n; i++) {
      const floor = floorFor(i);
      const slack = naturals[i] - floor;
      const isDonor = naturals[i] >= floor && slack > 0n;
      if (!isDonor) continue;
      const cut = (totalDeficit * slack) / donorPool;
      amounts[i] = naturals[i] - cut;
      drained += cut;
      if (slack > maxDonorSlack) {
        maxDonorSlack = slack;
        maxDonor = i;
      }
    }
    // Integer division rounds each cut down, leaving a few units undrained; take
    // them from the largest donor (which has the room) to keep the sum exact.
    if (maxDonor >= 0) amounts[maxDonor] -= totalDeficit - drained;
    return { amounts, skippedIndices };
  }

  // Below the sandwich minimum the UI disables submission. Preserve the legacy
  // prediction fallback for callers that still construct a plan directly; spot
  // legs remain visible with their natural slices so the pad can show the whole
  // intended basket while displaying the minimum-total message.
  let remainingWeight = 0n;
  for (let i = 0; i < n; i++) {
    if (isPrediction(i) && naturals[i] < PREDICTION_MIN_ORDER_USDC_NATIVE) {
      skippedIndices.add(i);
      amounts[i] = 0n;
      skippedLegs.push({
        legId: candidates[i].leg.id,
        label: candidates[i].leg.label,
        reason: 'prediction_min_order',
      });
    } else {
      remainingWeight += BigInt(candidates[i].weightBps);
    }
  }
  if (remainingWeight > 0n) {
    let acc2 = 0n;
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (skippedIndices.has(i)) continue;
      amounts[i] = (totalAmount * BigInt(candidates[i].weightBps)) / remainingWeight;
      acc2 += amounts[i];
      last = i;
    }
    if (last >= 0) amounts[last] += totalAmount - acc2;
  }
  return { amounts, skippedIndices };
}

export function buildSandwichBuyPlan(sandwich: Sandwich, totalInputAmount: string): SandwichBuyPlan {
  if (!isDigits(totalInputAmount)) {
    return { executableLegs: [], skippedLegs: [] };
  }

  const totalAmount = BigInt(totalInputAmount);
  if (totalAmount <= 0n) {
    return { executableLegs: [], skippedLegs: [] };
  }

  const sortedLegs = [...sandwich.legs].sort((a, b) => a.order - b.order);
  const skippedLegs: SandwichBuyPlan['skippedLegs'] = [];
  const candidates: SandwichBuyCandidate[] = sortedLegs.flatMap((leg): SandwichBuyCandidate[] => {
    if (leg.type === 'prediction_market') {
      if (!leg.marketId) {
        skippedLegs.push({ legId: leg.id, label: leg.label, reason: 'missing_market' });
        return [];
      }
      const weightBps = Math.max(0, Math.trunc(leg.weightBps));
      if (weightBps <= 0) {
        skippedLegs.push({ legId: leg.id, label: leg.label, reason: 'zero_amount' });
        return [];
      }
      return [{ leg, weightBps, kind: 'prediction' as const }];
    }

    if (!isValidMint(leg.mint)) {
      skippedLegs.push({ legId: leg.id, label: leg.label, reason: 'missing_mint' });
      return [];
    }

    const weightBps = Math.max(0, Math.trunc(leg.weightBps));
    if (weightBps <= 0) {
      skippedLegs.push({ legId: leg.id, label: leg.label, reason: 'zero_amount' });
      return [];
    }

    return [{ leg, weightBps, kind: 'swap' as const }];
  });

  const totalWeight = candidates.reduce((sum, candidate) => sum + BigInt(candidate.weightBps), 0n);
  if (totalWeight <= 0n) {
    return { executableLegs: [], skippedLegs };
  }

  const { amounts, skippedIndices } = allocateSandwichAmounts(
    candidates,
    totalAmount,
    totalWeight,
    skippedLegs,
  );

  const executableLegs = candidates
    .map((candidate, index): SandwichBuyLeg | null => {
      if (skippedIndices.has(index)) return null; // recorded in allocateSandwichAmounts
      const amount = amounts[index];
      if (amount <= 0n) {
        skippedLegs.push({ legId: candidate.leg.id, label: candidate.leg.label, reason: 'zero_amount' });
        return null;
      }

      if (candidate.kind === 'prediction') {
        const sideRaw = (candidate.leg.side ?? 'YES').toUpperCase();
        const isYes = sideRaw !== 'NO';
        return {
          kind: 'prediction',
          legId: candidate.leg.id,
          label: candidate.leg.label,
          symbol: candidate.leg.symbol,
          marketId: candidate.leg.marketId!,
          isYes,
          weightBps: candidate.weightBps,
          inputAmount: amount.toString(),
        };
      }

      return {
        kind: 'swap',
        legId: candidate.leg.id,
        label: candidate.leg.label,
        symbol: candidate.leg.symbol,
        mint: candidate.leg.mint!,
        weightBps: candidate.weightBps,
        inputAmount: amount.toString(),
      };
    })
    .filter((leg): leg is SandwichBuyLeg => leg !== null);

  return { executableLegs, skippedLegs };
}

export type PerpSandwichMarginSlice = {
  legId: string;
  label: string;
  /** Phoenix keys perps by the underlying (AAPL), not the wrapper (AAPLx). */
  symbol: string;
  imageUrl: string | null;
  side: 'long' | 'short';
  weightBps: number;
  marginUsd: number;
};

/**
 * Per-leg margin split for a perp Sandwich — display only; the server splits the
 * margin itself when it builds the order.
 *
 * This is a *transcription* of `allocateUsdByWeight`
 * (stock-backend/lib/server/phoenix/trade.ts), not a reimplementation, and the
 * details matter:
 *
 * - Plain IEEE doubles with `Math.floor(x * 1e6) / 1e6`, deliberately NOT the
 *   bigint micro-USDC arithmetic `allocateSandwichAmounts` uses above. Matching
 *   the server's representation is the whole point; switching to bigint
 *   reintroduces the sub-cent disagreement this exists to prevent.
 * - The LAST leg absorbs the remainder, and "last" is by `order` — the executor
 *   loads legs `orderBy: { order: 'asc' }` (basket/execute/perp-sandwich.ts) and
 *   feeds them to the allocator in that order, so a different sort silently
 *   moves the remainder onto a different ticker.
 *
 * No prediction-market floor applies: a perp Sandwich is homogeneous perp legs
 * only (the executor rejects anything else with `venue_mismatch`).
 */
export function buildPerpSandwichMarginPlan(
  sandwich: Sandwich,
  marginUsd: number,
): PerpSandwichMarginSlice[] {
  if (!Number.isFinite(marginUsd) || marginUsd <= 0) return [];

  const legs = [...sandwich.legs].sort((a, b) => a.order - b.order);
  const totalWeight = legs.reduce((sum, leg) => sum + leg.weightBps, 0);
  if (legs.length === 0 || totalWeight <= 0) return [];

  let remaining = marginUsd;
  return legs.map((leg, index) => {
    const amount =
      index === legs.length - 1
        ? remaining
        : Math.floor(((marginUsd * leg.weightBps) / totalWeight) * 1_000_000) / 1_000_000;
    remaining -= amount;
    return {
      legId: leg.id,
      label: leg.label,
      symbol: leg.underlyingSymbol ?? leg.symbol ?? leg.label,
      imageUrl: leg.imageUrl,
      side: leg.side === 'short' ? ('short' as const) : ('long' as const),
      weightBps: leg.weightBps,
      marginUsd: amount,
    };
  });
}

function assertJupiterQuoteResponse(payload: unknown): JupiterQuoteResponse {
  if (!isRecord(payload) || !isDigits(payload.outAmount)) {
    throw new ApiError('INVALID_RESPONSE', 'Quote response did not include a valid outAmount.');
  }

  return {
    outAmount: payload.outAmount,
  };
}

function assertJupiterOrderResponse(payload: unknown): JupiterOrderResponse {
  if (!isRecord(payload)) {
    throw new ApiError('INVALID_RESPONSE', 'Order response was not an object.');
  }

  const transaction = payload.transaction;
  const requestId = payload.requestId;
  const lastValidBlockHeight = payload.lastValidBlockHeight;

  if (typeof transaction !== 'string' || !transaction) {
    throw new ApiError('INVALID_RESPONSE', 'Order response was missing transaction.');
  }

  if (typeof requestId !== 'string' || !requestId) {
    throw new ApiError('INVALID_RESPONSE', 'Order response was missing requestId.');
  }

  return {
    transaction,
    requestId,
    lastValidBlockHeight:
      typeof lastValidBlockHeight === 'string'
        ? lastValidBlockHeight
        : typeof lastValidBlockHeight === 'number'
          ? String(lastValidBlockHeight)
          : null,
    // Backend tags the engine; default to 'swap' for older responses.
    engine: payload.engine === 'ultra' ? 'ultra' : 'swap',
  };
}

function assertJupiterExecuteResponse(payload: unknown): JupiterExecuteResponse {
  if (!isRecord(payload)) {
    throw new ApiError('INVALID_RESPONSE', 'Execute response was not an object.');
  }

  return {
    signature: typeof payload.signature === 'string' ? payload.signature : null,
    txid: typeof payload.txid === 'string' ? payload.txid : null,
    status: typeof payload.status === 'string' ? payload.status : null,
    code: typeof payload.code === 'number' ? payload.code : null,
    errorMessage:
      typeof payload.errorMessage === 'string'
        ? payload.errorMessage
        : typeof payload.error === 'string'
          ? payload.error
          : null,
  };
}

export async function getJupiterQuote(request: JupiterQuoteRequest): Promise<JupiterQuoteResponse> {
  if (!isValidMint(request.inputMint) || !isValidMint(request.outputMint) || !isDigits(request.amount)) {
    throw new ApiError('INVALID_RESPONSE', 'Quote request contained invalid input/output mint or amount.');
  }

  const payload = await requestJson<unknown>('/api/jupiter/quote', {
    method: 'POST',
    body: request,
  });

  return assertJupiterQuoteResponse(payload);
}

/**
 * Recognise the execution guard's structured refusal (HTTP 422 with
 * `rejected: true`) inside a thrown ApiError, so it can be returned as a
 * decision rather than swallowed as a generic build failure.
 */
function readExecutionRejection(error: unknown): AtomicBuyResponse | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const body = error.body;
  if (!isRecord(body) || body.rejected !== true) return null;
  return {
    transaction: null,
    fallback: false,
    rejected: true,
    rejectionReason: typeof body.error === 'string' ? body.error : error.message,
  };
}

export type PreflightLeg = {
  mint: string;
  /** USDC to spend on this leg, in smallest units (6 decimals). */
  amount: string;
  label?: string;
};

export type PreflightLegResult = {
  mint: string;
  /**
   * The mint the verdict is actually about, once the server has applied the
   * xStock/Backpack preference. Differs from `mint` when the leg was re-pinned
   * off a thin wrapper. Informational only — the buy re-pins the same way, so
   * nothing here needs to be threaded back into the trade.
   */
  tradedMint: string;
  ok: boolean;
  /** 'unroutable' | an execution-guard code | null when ok. */
  code: string | null;
  reason: string | null;
  roundTripBps: number | null;
  executedPriceUsd: number | null;
};

export type PreflightResult = { ok: boolean; legs: PreflightLegResult[] };

/**
 * Read-only pre-trade check for spot legs: can each route, and are its terms
 * sane? Nothing is signed or submitted, so this is safe to call speculatively.
 *
 * Replaces the old quote-only probe, which answered "does this route?" and
 * therefore waved through a $4 AMD buy priced at $749/share against an empty
 * order book.
 */
export async function preflightTradeLegs(
  legs: PreflightLeg[],
  taker?: string,
): Promise<PreflightResult> {
  const payload = await requestJson<unknown>('/api/trade/preflight', {
    method: 'POST',
    body: { taker, legs },
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
    timeoutMessage: 'Pre-trade check timed out.',
  });

  if (!isRecord(payload) || !Array.isArray(payload.legs)) {
    throw new ApiError('INVALID_RESPONSE', 'Preflight response was malformed.');
  }

  const results: PreflightLegResult[] = payload.legs.map((row) => {
    const r = isRecord(row) ? row : {};
    return {
      mint: typeof r.mint === 'string' ? r.mint : '',
      // Older backends do not send it; the mint asked about is then the mint traded.
      tradedMint:
        typeof r.tradedMint === 'string'
          ? r.tradedMint
          : typeof r.mint === 'string'
            ? r.mint
            : '',
      ok: r.ok === true,
      code: typeof r.code === 'string' ? r.code : null,
      reason: typeof r.reason === 'string' ? r.reason : null,
      roundTripBps: typeof r.roundTripBps === 'number' ? r.roundTripBps : null,
      executedPriceUsd: typeof r.executedPriceUsd === 'number' ? r.executedPriceUsd : null,
    };
  });

  return { ok: results.every((r) => r.ok), legs: results };
}

export type TradeQuoteUnavailableCode =
  | 'market_closed'
  | 'min_trade_size'
  | 'unroutable'
  | 'unsafe_price'
  | 'invalid_request';

export type TradeQuotePreview = {
  ok: boolean;
  side: 'buy' | 'sell';
  mint: string;
  /** Which Jupiter venue answered: on-chain routes, or JupiterZ RFQ makers. */
  venue: 'metis' | 'ultra' | null;
  /** Input in display units — USDC on a buy, tokens on a sell. */
  spent: number | null;
  /** Output at the quoted route price, in display units. */
  expectedReceived: number | null;
  /** Least the swap accepts before reverting on-chain, in display units. */
  minReceived: number | null;
  /** Effective USD per token for this fill, spread and fees included. */
  pricePerTokenUsd: number | null;
  slippageBps: number | null;
  priceImpactPct: number | null;
  maxSlippagePct: number | null;
  /** RFQ fills are fixed maker prices — no slippage band exists to show. */
  firmQuote: boolean;
  unavailable: { code: TradeQuoteUnavailableCode; message: string; reason: string } | null;
  /** Null when the asset isn't tied to the US equity session. */
  marketOpen: boolean | null;
};

const UNAVAILABLE_CODES: TradeQuoteUnavailableCode[] = [
  'market_closed',
  'min_trade_size',
  'unroutable',
  'unsafe_price',
  'invalid_request',
];

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Live pre-tap terms for one spot leg — what the user receives, the on-chain
 * floor, and (when nothing will fill) copy explaining why.
 *
 * `amount` is raw base units of whatever is being SPENT: micro-USDC on a buy,
 * token base units on a sell. Read-only: safe to call on every amount change,
 * subject to the caller debouncing it.
 */
function parseQuotePreview(payload: unknown, fallbackMint: string): TradeQuotePreview {
  if (!isRecord(payload)) {
    throw new ApiError('INVALID_RESPONSE', 'Quote preview response was malformed.');
  }

  const rawUnavailable = isRecord(payload.unavailable) ? payload.unavailable : null;
  const code = rawUnavailable?.code;

  return {
    ok: payload.ok === true,
    side: payload.side === 'sell' ? 'sell' : 'buy',
    mint: typeof payload.mint === 'string' ? payload.mint : fallbackMint,
    venue: payload.venue === 'metis' || payload.venue === 'ultra' ? payload.venue : null,
    spent: numberOrNull(payload.spent),
    expectedReceived: numberOrNull(payload.expectedReceived),
    minReceived: numberOrNull(payload.minReceived),
    pricePerTokenUsd: numberOrNull(payload.pricePerTokenUsd),
    slippageBps: numberOrNull(payload.slippageBps),
    priceImpactPct: numberOrNull(payload.priceImpactPct),
    maxSlippagePct: numberOrNull(payload.maxSlippagePct),
    firmQuote: payload.firmQuote === true,
    unavailable: rawUnavailable
      ? {
          code: UNAVAILABLE_CODES.includes(code as TradeQuoteUnavailableCode)
            ? (code as TradeQuoteUnavailableCode)
            : 'unroutable',
          message:
            typeof rawUnavailable.message === 'string' && rawUnavailable.message
              ? rawUnavailable.message
              : 'This trade is unavailable right now.',
          reason: typeof rawUnavailable.reason === 'string' ? rawUnavailable.reason : '',
        }
      : null,
    marketOpen: typeof payload.marketOpen === 'boolean' ? payload.marketOpen : null,
  };
}

export async function getTradeQuotePreview(request: {
  side: 'buy' | 'sell';
  mint: string;
  amount: string;
  taker?: string;
  signal?: AbortSignal;
}): Promise<TradeQuotePreview> {
  if (!isValidMint(request.mint) || !isDigits(request.amount)) {
    throw new ApiError('INVALID_RESPONSE', 'Quote preview request had an invalid mint or amount.');
  }

  const payload = await requestJson<unknown>('/api/trade/quote-preview', {
    method: 'POST',
    body: {
      side: request.side,
      mint: request.mint,
      amount: request.amount,
      taker: request.taker,
    },
    timeoutMs: QUOTE_PREVIEW_TIMEOUT_MS,
    timeoutMessage: 'Quote timed out.',
    signal: request.signal,
  });

  return parseQuotePreview(payload, request.mint);
}

/**
 * Live venue terms for EVERY leg of a basket, in one request.
 *
 * One call from the phone still fans out across Jupiter venues on the server.
 * Sandwich previews also run the price guard's reverse quote so a thin leg is
 * refused before the swipe; the server pacer keeps that fan-out inside the
 * shared Jupiter bucket.
 *
 * Three things make it affordable now, and none of them are optional:
 *  - `lib/server/jupiter-rate-limit.ts` paces the server's fan-out to 8 rps, so
 *    the legs spread over ~2s instead of bursting past the ceiling;
 *  - `useBasketQuotePreview` debounces, aborts superseded requests, and caches,
 *    so a typed "125" is one basket quote rather than three; and
 *  - that hook refuses to quote while a buy is warming or executing, so the
 *    preview can never take slots from the guard protecting the actual trade.
 *
 * Legs come back in request order, one entry each.
 */
export async function getBasketQuotePreview(request: {
  side: 'buy' | 'sell';
  legs: { mint: string; amount: string; label?: string }[];
  taker?: string;
  signal?: AbortSignal;
}): Promise<TradeQuotePreview[]> {
  if (request.legs.length === 0) return [];
  for (const leg of request.legs) {
    if (!isValidMint(leg.mint) || !isDigits(leg.amount)) {
      throw new ApiError('INVALID_RESPONSE', 'Basket quote request had an invalid mint or amount.');
    }
  }

  const payload = await requestJson<unknown>('/api/trade/quote-preview', {
    method: 'POST',
    body: {
      side: request.side,
      legs: request.legs.map((leg) => ({
        mint: leg.mint,
        amount: leg.amount,
        label: leg.label,
      })),
      taker: request.taker,
      // A sandwich is where waiting until after the swipe is most expensive:
      // every thin leg otherwise runs through build + preflight + fallback.
      checkSafety: true,
    },
    // Scales with leg count: the server paces its fan-out, so an eight-leg
    // basket legitimately takes longer than the single-leg dialpad's budget.
    timeoutMs: QUOTE_PREVIEW_TIMEOUT_MS + request.legs.length * 2500,
    timeoutMessage: 'Basket quote timed out.',
    signal: request.signal,
  });

  const rows = isRecord(payload) && Array.isArray(payload.legs) ? payload.legs : null;
  if (!rows) throw new ApiError('INVALID_RESPONSE', 'Basket quote response was malformed.');

  return rows.map((row, index) => parseQuotePreview(row, request.legs[index]?.mint ?? ''));
}

/**
 * Build an atomic buy transaction: unwind only the USDC shortfall from the earn
 * vault AND swap USDC → outputMint in ONE gasless transaction. The backend
 * returns `{ transaction: null, fallback: true }` for RFQ-only tokens (no Metis
 * route) or when the composed tx exceeds the size limit — callers then run the
 * existing two-tx flow (ensureLiquidUsdc → createJupiterOrder → execute).
 */
export async function createAtomicBuyTransaction(
  request: AtomicBuyRequest,
): Promise<AtomicBuyResponse> {
  if (!isValidMint(request.taker) || !isValidMint(request.outputMint) || !isDigits(request.amountInUsdc)) {
    throw new ApiError('INVALID_RESPONSE', 'Atomic buy request contained invalid fields.');
  }

  // The atomic build is an *optimization*, not the only way to buy: on any
  // failure (timeout, network blip, backend 500) we want to degrade to the
  // two-tx flow, never hard-fail the buy. So give it a dedicated fail-fast
  // timeout (shorter than the global 10s) and convert thrown errors into a
  // fallback signal. The caller (stock-trade-panel) then runs the two-tx path.
  let payload: unknown;
  try {
    payload = await requestJson<unknown>('/api/jupiter/atomic-buy', {
      method: 'POST',
      body: request,
      timeoutMs: ATOMIC_BUY_TIMEOUT_MS,
      timeoutMessage: 'Atomic buy build timed out.',
    });
  } catch (error) {
    // A guard refusal is a decision, not a transport failure — it must survive
    // this catch, or the caller degrades to order/execute and buys anyway.
    const rejection = readExecutionRejection(error);
    if (rejection) return rejection;
    // Don't surface anything else to the user — it's an internal optimization
    // miss. Log for visibility and tell the caller to use the two-tx fallback.
    console.warn('[atomic-buy] build failed, falling back to two-tx flow', error);
    return { transaction: null, fallback: true };
  }

  if (!isRecord(payload)) {
    return { transaction: null, fallback: true };
  }
  const transaction = typeof payload.transaction === 'string' ? payload.transaction : null;
  // Treat anything without a usable transaction as a fallback signal so a
  // malformed/empty response degrades to the safe two-tx path rather than throws.
  const fallback = payload.fallback === true || transaction === null;
  return { transaction: fallback ? null : transaction, fallback };
}

export async function createAtomicSellTransaction(
  request: AtomicSellRequest,
): Promise<AtomicBuyResponse> {
  if (!isValidMint(request.taker) || !isValidMint(request.inputMint) || !isDigits(request.amount)) {
    throw new ApiError('INVALID_RESPONSE', 'Atomic sell request contained invalid fields.');
  }

  // Like the atomic buy, this is an optimization with a guaranteed order/execute
  // fallback: on any failure (timeout, network, 500) degrade rather than throw.
  let payload: unknown;
  try {
    payload = await requestJson<unknown>('/api/jupiter/atomic-sell', {
      method: 'POST',
      body: request,
      timeoutMs: ATOMIC_BUY_TIMEOUT_MS,
      timeoutMessage: 'Atomic sell build timed out.',
    });
  } catch (error) {
    const rejection = readExecutionRejection(error);
    if (rejection) return rejection;
    console.warn('[atomic-sell] build failed, falling back to order/execute', error);
    return { transaction: null, fallback: true };
  }

  if (!isRecord(payload)) {
    return { transaction: null, fallback: true };
  }
  const transaction = typeof payload.transaction === 'string' ? payload.transaction : null;
  const fallback = payload.fallback === true || transaction === null;
  return { transaction: fallback ? null : transaction, fallback };
}

export async function createJupiterOrder(request: JupiterOrderRequest): Promise<JupiterOrderResponse> {
  if (
    !isValidMint(request.inputMint) ||
    !isValidMint(request.outputMint) ||
    !isDigits(request.amount) ||
    !isValidMint(request.taker)
  ) {
    throw new ApiError('INVALID_RESPONSE', 'Order request contained invalid fields.');
  }

  const payload = await requestJson<unknown>('/api/jupiter/order', {
    method: 'POST',
    body: request,
  });

  return assertJupiterOrderResponse(payload);
}

export async function executeJupiterOrder(
  request: JupiterExecuteRequest,
): Promise<JupiterExecuteResponse> {
  if (!request.signedTransaction || !request.requestId) {
    throw new ApiError('INVALID_RESPONSE', 'Execute request contained invalid fields.');
  }

  const payload = await requestJson<unknown>('/api/jupiter/execute', {
    method: 'POST',
    body: request,
  });

  return assertJupiterExecuteResponse(payload);
}

function assertPredictionOrderResponse(payload: unknown): PredictionOrderResponse {
  if (!isRecord(payload) || typeof payload.transaction !== 'string') {
    throw new ApiError('INVALID_RESPONSE', 'Prediction order response missing transaction.');
  }
  const txMeta = isRecord(payload.txMeta) ? payload.txMeta : null;
  const order = isRecord(payload.order) ? payload.order : null;
  return {
    transaction: payload.transaction,
    blockhash:
      typeof txMeta?.blockhash === 'string'
        ? txMeta.blockhash
        : typeof payload.blockhash === 'string'
          ? payload.blockhash
          : null,
    lastValidBlockHeight:
      typeof txMeta?.lastValidBlockHeight === 'number'
        ? txMeta.lastValidBlockHeight
        : typeof payload.lastValidBlockHeight === 'number'
          ? payload.lastValidBlockHeight
          : null,
    orderPubkey: typeof order?.orderPubkey === 'string' ? order.orderPubkey : null,
    positionPubkey: typeof order?.positionPubkey === 'string' ? order.positionPubkey : null,
    contracts:
      typeof order?.contracts === 'string'
        ? order.contracts
        : typeof order?.contracts === 'number'
          ? String(order.contracts)
          : null,
  };
}

export async function createPredictionOrder(
  request: PredictionOrderRequest,
): Promise<PredictionOrderResponse> {
  if (!request.ownerPubkey || !request.marketId || !request.depositAmount) {
    throw new ApiError('INVALID_RESPONSE', 'Prediction order request contained invalid fields.');
  }
  const payload = await requestJson<unknown>('/api/jupiter/prediction/order', {
    method: 'POST',
    body: request,
  });
  return assertPredictionOrderResponse(payload);
}

export async function closePredictionPosition(
  request: PredictionCloseRequest,
): Promise<PredictionOrderResponse> {
  if (!request.positionPubkey || !request.ownerPubkey) {
    throw new ApiError('INVALID_RESPONSE', 'Close request contained invalid fields.');
  }
  const payload = await requestJson<unknown>('/api/jupiter/prediction/close', {
    method: 'POST',
    body: request,
  });
  return assertPredictionOrderResponse(payload);
}

export async function submitPredictionTransaction(
  request: PredictionSubmitRequest,
): Promise<PredictionSubmitResponse> {
  if (!request.signedTransaction) {
    throw new ApiError('INVALID_RESPONSE', 'Submit request missing signedTransaction.');
  }
  const payload = await requestJson<unknown>('/api/jupiter/prediction/submit', {
    method: 'POST',
    body: request,
  });
  if (!isRecord(payload)) {
    throw new ApiError('INVALID_RESPONSE', 'Submit response was not an object.');
  }
  return {
    signature: typeof payload.signature === 'string' ? payload.signature : null,
    status: typeof payload.status === 'string' ? payload.status : null,
    code: typeof payload.code === 'number' ? payload.code : null,
    errorMessage:
      typeof payload.error === 'string'
        ? payload.error
        : typeof payload.errorMessage === 'string'
          ? payload.errorMessage
          : null,
  };
}

export async function fetchPredictionPositions(
  ownerPubkey: string,
  marketId?: string,
): Promise<unknown> {
  const params = new URLSearchParams({ ownerPubkey });
  if (marketId) params.set('marketId', marketId);
  return requestJson<unknown>(`/api/jupiter/prediction/positions?${params.toString()}`);
}

type JupiterTokenSearchPayload = {
  token?: {
    id?: unknown;
    name?: unknown;
    symbol?: unknown;
    decimals?: unknown;
    icon?: unknown;
    holderCount?: unknown;
    usdPrice?: unknown;
    stats24h?: {
      volumeChange?: unknown;
      priceChange?: unknown;
      volume?: unknown;
      buyVolume?: unknown;
      sellVolume?: unknown;
    } | null;
    mcap?: unknown;
    fdv?: unknown;
    liquidity?: unknown;
    organicScore?: unknown;
    isVerified?: unknown;
    tags?: unknown;
    website?: unknown;
    twitter?: unknown;
    audit?: unknown;
  } | null;
};

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

// Kept literal (this module deliberately has no imports); mirrors
// SOLANA_WRAPPED_SOL_MINT in @/lib/trading. The wallet-balances route already
// reports native lamports under this mint, so there's no pseudo-mint to rewrite.
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

function mergeWalletTokenMetadata(token: WalletBalanceToken, detail: JupiterTokenDetail | null): WalletBalanceToken {
  if (!detail) {
    return token;
  }

  return {
    ...token,
    mint: token.mint ?? detail.id,
    symbol: token.symbol ?? detail.symbol,
    name: token.name ?? detail.name,
    icon: token.icon ?? detail.icon,
    decimals: token.decimals ?? (typeof detail.decimals === 'number' ? detail.decimals : null),
    usdValue: token.usdValue ?? (detail.usdPrice !== null ? token.balance * detail.usdPrice : null),
    priceChange24h: token.priceChange24h ?? detail.priceChange24h,
  };
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function extractArrayPayload(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

/**
 * Exact on-chain raw balance (smallest units) for owner+mint, from the RPC.
 * Native SOL's Helius pseudo-mint resolves to system-account lamports; SPL
 * mints resolve to token-account units. Use this to clamp sell amounts because
 * the float-based wallet feed can slightly overshoot the transferable balance.
 */
export async function getOnchainTokenBalance(
  owner: string,
  mint: string,
): Promise<{ amount: string; decimals: number }> {
  const normalizedOwner = owner.trim();
  const normalizedMint = mint.trim();
  if (!normalizedOwner || !isValidMint(normalizedMint)) {
    throw new ApiError('INVALID_RESPONSE', 'Owner and mint are required.');
  }

  const payload = await requestJson<unknown>('/api/solana/token-balance', {
    params: { owner: normalizedOwner, mint: normalizedMint },
  });

  if (isRecord(payload) && typeof payload.amount === 'string' && /^\d+$/.test(payload.amount)) {
    return {
      amount: payload.amount,
      decimals: typeof payload.decimals === 'number' ? payload.decimals : 0,
    };
  }

  throw new ApiError('INVALID_RESPONSE', 'Invalid on-chain token balance response.');
}

// Decimals are immutable per mint, so cache resolved values for the session.
const mintDecimalsCache = new Map<string, number>();

/**
 * Authoritative on-chain decimals for a mint, used when token metadata omits
 * them (some prestock mints don't resolve in Jupiter). Reads the mint account,
 * so it works whether or not the wallet holds the token. Returns null only when
 * the lookup genuinely fails.
 */
export async function getMintDecimals(mint: string): Promise<number | null> {
  const normalized = mint.trim();
  if (!isValidMint(normalized)) return null;

  const cached = mintDecimalsCache.get(normalized);
  if (cached !== undefined) return cached;

  try {
    const payload = await requestJson<unknown>('/api/solana/mint-info', {
      params: { mint: normalized },
    });
    if (isRecord(payload) && typeof payload.decimals === 'number') {
      mintDecimalsCache.set(normalized, payload.decimals);
      return payload.decimals;
    }
  } catch {
    // fall through to null — caller decides how to degrade
  }
  return null;
}

// Short-lived cache for the wallet-balance price/metadata enrichment. The wallet
// refreshes repeatedly around a trade (optimistic → post-confirm → indexed poll),
// and each refresh used to fire a fresh `/api/jupiter/prices` call. Jupiter
// shares ONE rate-limit bucket across all endpoints on a 60s sliding window, so
// that drip keeps the bucket near its ceiling and starves the trade-critical
// atomic-buy `/swap/v2/build` call (observed: build 429 → slow two-tx fallback).
// Collapsing the burst to one call per mint-set per TTL keeps headroom for the
// build. Prices going ~12s stale in a balance list is harmless (the detail
// screen prices itself); metadata is effectively static.
const JUPITER_PRICES_TTL_MS = 12_000;
const jupiterPricesCache = new Map<string, { payload: unknown; ts: number }>();

async function getCachedJupiterPrices(mints: string[]): Promise<unknown> {
  // Key on the mint set (order-independent) so unrelated wallets/sets don't
  // collide and a reordered list still hits.
  const key = [...mints].sort().join(',');
  const cached = jupiterPricesCache.get(key);
  if (cached && Date.now() - cached.ts < JUPITER_PRICES_TTL_MS) {
    return cached.payload;
  }
  const payload = await requestJson<unknown>('/api/jupiter/prices', {
    params: { mints: mints.join(',') },
  });
  jupiterPricesCache.set(key, { payload, ts: Date.now() });
  // Bound the map so a long session with many distinct wallets can't grow it
  // unboundedly; drop the oldest entry when it gets large.
  if (jupiterPricesCache.size > 32) {
    const oldest = jupiterPricesCache.keys().next().value;
    if (oldest !== undefined) jupiterPricesCache.delete(oldest);
  }
  return payload;
}

/**
 * A row from `/api/solana/wallet-balances` — exact on-chain integers.
 * Metadata (symbol/name/icon) and price are layered on below; the chain doesn't
 * carry them.
 */
function normalizeOnchainBalanceRow(row: unknown): WalletBalanceToken | null {
  if (!isRecord(row)) return null;
  const mint = typeof row.mint === 'string' && row.mint.trim() ? row.mint.trim() : null;
  if (!mint) return null;

  const balance = toNumber(row.uiAmount);
  if (balance === null || !(balance > 0)) return null;

  const rawDecimals = toNumber(row.decimals);
  const isSol = mint === WRAPPED_SOL_MINT;

  return {
    mint,
    // SOL has no token-list entry under the wrapped mint in every feed, and it
    // is the one asset we can always name ourselves.
    symbol: isSol ? 'SOL' : null,
    name: isSol ? 'Solana' : null,
    icon: null,
    balance,
    decimals:
      rawDecimals !== null && Number.isInteger(rawDecimals) && rawDecimals >= 0
        ? rawDecimals
        : null,
    usdValue: null,
    priceChange24h: null,
  };
}

/**
 * The wallet's balances — read from the chain, priced by Jupiter.
 *
 * Balances come from `/api/solana/wallet-balances` (direct RPC token-account
 * reads), NOT from the Helius wallet indexer. The indexer reported float
 * amounts and lagged the chain, so users saw positions they'd already sold and
 * cash that didn't match their wallet. Quantities here cannot disagree with the
 * chain; only the *pricing* layer is best-effort, and a missing price leaves
 * `usdValue: null` rather than inventing a number.
 *
 * Throws on any malformed/failed read so callers keep their last-good figures —
 * an empty wallet is a successful response with an empty list, which is a very
 * different thing from "we couldn't tell".
 */
export async function getWalletBalances(
  walletAddress: string,
  options?: {
    /**
     * Called with the rows once the bulk price/metadata pass has landed —
     * everything the holdings list needs to render. The per-token metadata
     * backfill below it is one HTTP call per unnamed token and is pure polish,
     * so callers can paint on this and update again when the promise resolves.
     */
    onPartial?: (tokens: WalletBalanceToken[]) => void;
  },
): Promise<WalletBalances> {
  const normalizedAddress = walletAddress.trim();
  if (!normalizedAddress) {
    throw new ApiError('INVALID_RESPONSE', 'Wallet address is required.');
  }

  // `priced=1` asks the server to attach prices + metadata in the same
  // response. It can only price what the chain read found, so doing it here
  // meant a second round trip before the first row could render.
  const payload = await requestJson<unknown>('/api/solana/wallet-balances', {
    params: { owner: normalizedAddress, priced: '1' },
  });

  // A malformed/error-shaped payload (RPC hiccup) must NOT be treated as an
  // empty wallet — that would silently zero the user's cash.
  if (!isRecord(payload) || !Array.isArray(payload.balances)) {
    throw new ApiError('INVALID_RESPONSE', 'Unexpected wallet balance response.');
  }

  const tokens = payload.balances
    .map(normalizeOnchainBalanceRow)
    .filter((token): token is WalletBalanceToken => token !== null);

  const mints = tokens
    .map((token) => token.mint)
    .filter((mint): mint is string => typeof mint === 'string' && mint.length > 0);

  if (mints.length === 0) {
    return { tokens };
  }

  const withBulkMetadata = await (async (): Promise<WalletBalanceToken[]> => {
    try {
      // Prefer prices the balance response already carried; only fall back to
      // the standalone endpoint when the server didn't attach them (older
      // deployment, or its price lookup failed).
      const metadataPayload =
        payload.priced === true ? payload : await getCachedJupiterPrices(mints.slice(0, 100));
      const metadata: Record<string, unknown> =
        isRecord(metadataPayload) && isRecord(metadataPayload.meta) ? metadataPayload.meta : {};
      const prices: Record<string, unknown> =
        isRecord(metadataPayload) && isRecord(metadataPayload.prices) ? metadataPayload.prices : {};

      return tokens.map((token) => {
        const rawTokenMeta = token.mint ? metadata[token.mint] : null;
        const tokenMeta = isRecord(rawTokenMeta) ? rawTokenMeta : null;
        const price = token.mint ? toNumber(prices[token.mint]) : null;

        return {
          ...token,
          symbol: token.symbol ?? (tokenMeta ? firstString(tokenMeta, ['symbol']) : null),
          name: token.name ?? (tokenMeta ? firstString(tokenMeta, ['name']) : null),
          icon: token.icon ?? (tokenMeta ? firstString(tokenMeta, ['icon']) : null),
          usdValue: price !== null ? token.balance * price : null,
        };
      });
    } catch {
      // Pricing is best-effort; the quantities above are already authoritative.
      return tokens;
    }
  })();

  // Per-token fallback for anything the bulk call couldn't name or price. The
  // chain gives no metadata at all, so this matters more than it did under the
  // indexer: a row with no symbol isn't tappable in the holdings list, and a
  // row with no price is filtered out as dust.
  const needsBackfill = withBulkMetadata.some(
    (token) => token.mint && !(token.symbol && token.icon && token.usdValue !== null),
  );

  // Nothing to backfill — the bulk pass already produced the final rows, so
  // don't make the caller render the same list twice.
  if (!needsBackfill) return { tokens: withBulkMetadata };

  options?.onPartial?.(withBulkMetadata);

  const enrichedTokens = await Promise.all(
    withBulkMetadata.map(async (token) => {
      if (!token.mint || (token.symbol && token.icon && token.usdValue !== null)) {
        return token;
      }
      try {
        return mergeWalletTokenMetadata(token, await searchJupiterToken(token.mint, token.mint));
      } catch {
        return token;
      }
    }),
  );

  return { tokens: enrichedTokens };
}

// ── On-chain transfer history ─────────────────────────────────────────────────

export type HeliusTokenTransfer = {
  fromUserAccount: string;
  toUserAccount: string;
  fromTokenAccount: string;
  toTokenAccount: string;
  tokenAmount: number;
  mint: string;
  decimals?: number;
};

export type HeliusTransferRecord = {
  signature: string;
  timestamp: number;
  type?: string;
  source?: string;
  tokenTransfers?: HeliusTokenTransfer[];
  transactionError?: unknown;
};

export type HeliusTransfersPayload = {
  transfers: HeliusTransferRecord[];
  cursor?: string;
};

function normalizeHeliusTokenTransfer(raw: unknown): HeliusTokenTransfer | null {
  if (!isRecord(raw)) return null;
  const fromUser = typeof raw.fromUserAccount === 'string' ? raw.fromUserAccount : '';
  const toUser = typeof raw.toUserAccount === 'string' ? raw.toUserAccount : '';
  const mint = typeof raw.mint === 'string' ? raw.mint : '';
  const amount = toNumber(raw.tokenAmount);
  if (!mint || amount === null) return null;
  return {
    fromUserAccount: fromUser,
    toUserAccount: toUser,
    fromTokenAccount: typeof raw.fromTokenAccount === 'string' ? raw.fromTokenAccount : '',
    toTokenAccount: typeof raw.toTokenAccount === 'string' ? raw.toTokenAccount : '',
    tokenAmount: amount,
    mint,
    decimals: typeof raw.decimals === 'number' ? raw.decimals : undefined,
  };
}

function normalizeHeliusTransferRecord(raw: unknown): HeliusTransferRecord | null {
  if (!isRecord(raw)) return null;
  const sig = typeof raw.signature === 'string' ? raw.signature : '';
  const ts = toNumber(raw.timestamp);
  if (!sig || ts === null) return null;
  const tokenTransfers = Array.isArray(raw.tokenTransfers)
    ? (raw.tokenTransfers as unknown[]).map(normalizeHeliusTokenTransfer).filter((t): t is HeliusTokenTransfer => t !== null)
    : [];
  return {
    signature: sig,
    timestamp: ts,
    type: typeof raw.type === 'string' ? raw.type : undefined,
    source: typeof raw.source === 'string' ? raw.source : undefined,
    tokenTransfers,
    transactionError: raw.transactionError ?? null,
  };
}

export async function getWalletTransfers(
  walletAddress: string,
  limit = 100,
): Promise<HeliusTransfersPayload> {
  const normalizedAddress = walletAddress.trim();
  if (!normalizedAddress) return { transfers: [] };

  const payload = await requestJson<unknown>(
    `/api/helius/wallet/${encodeURIComponent(normalizedAddress)}/transfers`,
    { params: { limit: String(limit) }, timeoutMs: 15000 },
  );

  if (!isRecord(payload) || !Array.isArray(payload.transfers)) {
    return { transfers: [] };
  }

  const transfers = (payload.transfers as unknown[])
    .map(normalizeHeliusTransferRecord)
    .filter((t): t is HeliusTransferRecord => t !== null);

  return {
    transfers,
    cursor: typeof payload.cursor === 'string' ? payload.cursor : undefined,
  };
}

/**
 * Server-derived weighted-average cost basis per mint for a wallet (app buy/sell
 * USD notionals joined to on-chain swap quantities). This is the authoritative
 * source of unrealized PnL on the Holdings tab — the old client-side on-chain
 * derivation could never parse the flat `/transfers` feed, so it silently
 * returned nothing. Returns `{ mint: { qty, avgPriceUsd } }`; empty on failure.
 */
export type WalletCostBasisRow = {
  qty: number;
  avgPriceUsd: number;
  /** Excludes Sandwich legs. Undefined when the server did not send the split. */
  standaloneQty?: number;
  standaloneAvgPriceUsd?: number;
};

export async function getWalletCostBasis(walletAddress: string): Promise<{
  ledger: Record<string, WalletCostBasisRow>;
  /**
   * Whether the wallet ever bought SOL. Server-derived and NOT inferable here:
   * a wallet collects ~0.002 SOL of routing rent per swap, and the on-chain
   * ledger reports that hop as a receive, so a local guess reads as "owns SOL"
   * for users who never bought any.
   */
  solTraded: boolean;
}> {
  const normalizedAddress = walletAddress.trim();
  const empty = { ledger: {}, solTraded: false };
  if (!normalizedAddress) return empty;

  try {
    await settlePendingTradeRecords();
    const payload = await requestJson<unknown>(
      `/api/helius/wallet/${encodeURIComponent(normalizedAddress)}/cost-basis`,
      { timeoutMs: 20000 },
    );
    if (!isRecord(payload) || !isRecord(payload.ledger)) return empty;
    const ledger: Record<string, WalletCostBasisRow> = {};
    for (const [mint, raw] of Object.entries(payload.ledger)) {
      if (!isRecord(raw)) continue;
      const qty = toNullableNumber(raw.qty);
      const avgPriceUsd = toNullableNumber(raw.avgPriceUsd);
      if (qty === null || avgPriceUsd === null || qty <= 0 || avgPriceUsd <= 0) continue;
      const standaloneQty = toNullableNumber(raw.standaloneQty);
      const standaloneAvgPriceUsd = toNullableNumber(raw.standaloneAvgPriceUsd);
      ledger[mint] = {
        qty,
        avgPriceUsd,
        ...(standaloneQty !== null && standaloneQty >= 0
          ? { standaloneQty, standaloneAvgPriceUsd: standaloneAvgPriceUsd ?? 0 }
          : {}),
      };
    }
    return { ledger, solTraded: payload.solTraded === true };
  } catch {
    return empty;
  }
}

/**
 * Build an unsigned, gasless USDC transfer transaction for a withdrawal to an
 * external Solana address. `amount` is in USDC smallest units (6 decimals). The
 * returned tx is signed by the embedded wallet and submitted via
 * `sendSignedSolanaTransaction`, where the integrator payer co-signs the fee.
 */
export async function createUsdcTransferTransaction(request: {
  sender: string;
  recipient: string;
  amount: string;
}): Promise<{ transaction: string }> {
  if (!isValidMint(request.sender) || !isValidMint(request.recipient) || !isDigits(request.amount)) {
    throw new ApiError('INVALID_RESPONSE', 'Withdrawal request contained invalid fields.');
  }

  const payload = await requestJson<unknown>('/api/solana/usdc-transfer', {
    method: 'POST',
    body: request,
  });

  if (!isRecord(payload) || typeof payload.transaction !== 'string' || !payload.transaction) {
    throw new ApiError('INVALID_RESPONSE', 'Withdrawal response was missing transaction.');
  }

  return { transaction: payload.transaction };
}

export type RelayDepositAddressRequest = {
  /** Solana wallet that receives the bridged USDC. */
  recipient: string;
  /** Refund address on the origin chain (the embedded EVM wallet). */
  refundTo: string;
  originChainId: number;
  originCurrency: string;
  /** Origin-token smallest units. */
  amount: string;
};

export type RelayDepositAddressResponse = {
  depositAddress: string;
  requestId: string;
  amountInFormatted: string | null;
  amountOutFormatted: string | null;
  feeUsd: string | null;
  timeEstimateSec: number | null;
};

export async function createRelayDepositAddress(
  request: RelayDepositAddressRequest,
): Promise<RelayDepositAddressResponse> {
  const payload = await requestJson<unknown>('/api/relay/deposit-address', {
    method: 'POST',
    body: request,
  });

  if (
    !isRecord(payload) ||
    typeof payload.depositAddress !== 'string' ||
    typeof payload.requestId !== 'string'
  ) {
    throw new ApiError('INVALID_RESPONSE', 'Deposit address response was malformed.');
  }

  return {
    depositAddress: payload.depositAddress,
    requestId: payload.requestId,
    amountInFormatted: typeof payload.amountInFormatted === 'string' ? payload.amountInFormatted : null,
    amountOutFormatted: typeof payload.amountOutFormatted === 'string' ? payload.amountOutFormatted : null,
    feeUsd: typeof payload.feeUsd === 'string' ? payload.feeUsd : null,
    timeEstimateSec: typeof payload.timeEstimateSec === 'number' ? payload.timeEstimateSec : null,
  };
}

export async function getRelayDepositStatus(depositAddress: string): Promise<{ status: string }> {
  const payload = await requestJson<unknown>('/api/relay/status', {
    params: { depositAddress },
  });
  return { status: isRecord(payload) && typeof payload.status === 'string' ? payload.status : 'unknown' };
}

/** A deposit recorded server-side from Privy's `wallet.funds_deposited` webhook. */
export type WalletDepositRecord = {
  id: string;
  asset: string;
  amount: string;
  txHash: string | null;
  createdAt: string;
};

/**
 * Deposits the backend has seen land in `wallet` (newest first), sourced from
 * Privy's deposit webhook. Used to confirm a cross-chain deposit actually
 * arrived in the user's Solana wallet.
 */
export async function getWalletDeposits(
  wallet: string,
  asset?: string,
): Promise<WalletDepositRecord[]> {
  const payload = await requestJson<unknown>('/api/privy/deposits', {
    params: asset ? { wallet, asset } : { wallet },
  });
  if (!isRecord(payload) || !Array.isArray(payload.deposits)) return [];
  return payload.deposits.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return [];
    return [
      {
        id: entry.id,
        asset: typeof entry.asset === 'string' ? entry.asset : '',
        amount: typeof entry.amount === 'string' ? entry.amount : '0',
        txHash: typeof entry.txHash === 'string' ? entry.txHash : null,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
      },
    ];
  });
}

/** A wallet money movement (deposit or withdrawal) from the history endpoint. */
export type WalletTransactionKind = 'deposit' | 'withdrawal' | 'buy' | 'sell';

export type WalletTransactionRecord = {
  id: string;
  direction: WalletTransactionKind;
  asset: string;
  amount: string;
  txHash: string | null;
  createdAt: string;
  /** For buy/sell rows: the traded stock's symbol and logo, when available. */
  symbol: string | null;
  logoUrl: string | null;
};

/**
 * The authenticated user's wallet money-movement history (deposits and
 * withdrawals), newest first. The wallet is derived server-side from the Privy
 * token, so no wallet argument is needed. Optionally filter by direction.
 */
export async function getWalletTransactions(
  options: { direction?: 'deposit' | 'withdrawal'; asset?: string; limit?: number } = {},
): Promise<WalletTransactionRecord[]> {
  const params: Record<string, string> = {};
  if (options.direction) params.direction = options.direction;
  if (options.asset) params.asset = options.asset;
  if (options.limit) params.limit = String(options.limit);

  await settlePendingTradeRecords();
  const payload = await requestJson<unknown>('/api/privy/transactions', {
    params: Object.keys(params).length ? params : undefined,
  });
  if (!isRecord(payload) || !Array.isArray(payload.transactions)) return [];
  return payload.transactions.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return [];
    const direction: WalletTransactionKind =
      entry.direction === 'withdrawal' || entry.direction === 'buy' || entry.direction === 'sell'
        ? entry.direction
        : 'deposit';
    return [
      {
        id: entry.id,
        direction,
        asset: typeof entry.asset === 'string' ? entry.asset : '',
        amount: typeof entry.amount === 'string' ? entry.amount : '0',
        txHash: typeof entry.txHash === 'string' ? entry.txHash : null,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
        symbol: typeof entry.symbol === 'string' ? entry.symbol : null,
        logoUrl: typeof entry.logoUrl === 'string' ? entry.logoUrl : null,
      } as WalletTransactionRecord,
    ];
  });
}

/**
 * Records a cash movement the app performed, so Activity is correctly labelled
 * regardless of Privy's webhook config. `amount` is in the asset's smallest
 * units. `direction: "internal"` registers an earn vault movement that's hidden
 * from Activity but suppresses Privy's opposite-direction webhook for that tx.
 * Best-effort — callers should not block the user flow on it.
 */
/**
 * Trade records posted but not yet acknowledged by the server.
 *
 * Callers fire `recordWalletTransaction` without awaiting it so a landed trade
 * reaches its success screen immediately. The readers derived from those rows
 * (closed positions, activity, cost basis) settle this set first instead, so
 * opening the Closed tab right after a sell still sees that sell.
 */
const pendingTradeRecords = new Set<Promise<void>>();

/** Readers wait at most this long — a stuck write must not hang a screen. */
const PENDING_TRADE_RECORD_WAIT_MS = 8_000;

async function settlePendingTradeRecords(): Promise<void> {
  if (pendingTradeRecords.size === 0) return;
  await Promise.race([
    Promise.allSettled([...pendingTradeRecords]),
    new Promise((resolve) => setTimeout(resolve, PENDING_TRADE_RECORD_WAIT_MS)),
  ]);
}

export function recordWalletTransaction(input: {
  direction: 'withdrawal' | 'buy' | 'sell' | 'internal';
  amount: string;
  txHash: string;
  asset?: string;
  symbol?: string;
  logoUrl?: string;
}): Promise<void> {
  const write = postWalletTransaction(input);
  pendingTradeRecords.add(write);
  const forget = () => {
    pendingTradeRecords.delete(write);
  };
  write.then(forget, forget);
  return write;
}

async function postWalletTransaction(input: Parameters<typeof recordWalletTransaction>[0]): Promise<void> {
  if (!input.txHash.trim()) return;
  const body = {
    direction: input.direction,
    amount: input.amount,
    txHash: input.txHash,
    ...(input.asset ? { asset: input.asset } : {}),
    ...(input.symbol ? { symbol: input.symbol } : {}),
    ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
  };

  // Retried once, and loudly.
  //
  // This row is the ONLY record that a single-asset trade happened: cost basis,
  // realized PnL and the closed-positions list are all derived from it, and the
  // trade itself has already settled on chain by the time we get here — so a
  // lost write is unrecoverable, not merely delayed. Every call site wraps this
  // in `.catch(() => {})` because it must never break a completed trade, which
  // also means a failure leaves no trace anywhere unless it is logged here.
  try {
    await requestJson<unknown>('/api/privy/transactions', { method: 'POST', body });
  } catch (first) {
    try {
      await requestJson<unknown>('/api/privy/transactions', { method: 'POST', body });
    } catch (second) {
      console.warn('[trade-record] failed to record trade — PnL for it will read as unknown', {
        txHash: input.txHash,
        direction: input.direction,
        asset: input.asset,
        firstError: first instanceof Error ? first.message : String(first),
        secondError: second instanceof Error ? second.message : String(second),
      });
      throw second;
    }
  }
}

/** The kinds of entity a user can bookmark. */
export type SavedItemType = 'sandwich' | 'stock';

/** A bookmarked item belonging to the authenticated user. */
export type SavedItemRecord = {
  id: string;
  itemType: SavedItemType;
  itemId: string;
  createdAt: string;
};

function normalizeSavedItem(entry: unknown): SavedItemRecord | null {
  if (!isRecord(entry) || typeof entry.id !== 'string') return null;
  const itemType = entry.itemType === 'stock' ? 'stock' : entry.itemType === 'sandwich' ? 'sandwich' : null;
  if (!itemType || typeof entry.itemId !== 'string') return null;
  return {
    id: entry.id,
    itemType,
    itemId: entry.itemId,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
  };
}

/** Lists the authenticated user's saved items (newest first), optionally by type. */
export async function getSavedItems(type?: SavedItemType): Promise<SavedItemRecord[]> {
  const payload = await requestJson<unknown>('/api/saved', {
    params: type ? { type } : undefined,
  });
  if (!isRecord(payload) || !Array.isArray(payload.saved)) return [];
  return payload.saved.flatMap((entry) => {
    const record = normalizeSavedItem(entry);
    return record ? [record] : [];
  });
}

/** Bookmarks an item. Idempotent server-side. */
export async function saveItem(itemType: SavedItemType, itemId: string): Promise<SavedItemRecord | null> {
  const payload = await requestJson<unknown>('/api/saved', {
    method: 'POST',
    body: { itemType, itemId },
  });
  return isRecord(payload) ? normalizeSavedItem(payload.saved) : null;
}

/** Removes a bookmark. Returns true if a row was actually removed. */
export async function unsaveItem(itemType: SavedItemType, itemId: string): Promise<boolean> {
  const payload = await requestJson<unknown>('/api/saved', {
    method: 'DELETE',
    body: { itemType, itemId },
  });
  return isRecord(payload) && payload.removed === true;
}

function normalizePerpsPosition(value: unknown): PerpsPosition | null {
  if (!isRecord(value)) return null;
  const asset = typeof value.asset === 'string' && value.asset.trim()
    ? value.asset.trim()
    : null;
  if (!asset) return null;
  const collateral = toNumber(value.collateral) ?? 0;
  const pnl = toNumber(value.pnl) ?? 0;
  const leverage = toNumber(value.leverage) ?? 1;
  const side = value.side === 'short' ? 'short' : 'long';
  return {
    type: 'LEVERAGE',
    positionAddress: typeof value.positionAddress === 'string' ? value.positionAddress : null,
    asset,
    imageUri: typeof value.imageUri === 'string' ? value.imageUri : null,
    side,
    leverage,
    collateral,
    pnl,
    size: toNumber(value.size),
    sizeValue: toNumber(value.sizeValue),
    entryPrice: toNumber(value.entryPrice),
    markPrice: toNumber(value.markPrice),
    liquidationPrice: toNumber(value.liquidationPrice),
    takeProfit: toNumber(value.takeProfit),
    stopLoss: toNumber(value.stopLoss),
    value: toNumber(value.value) ?? collateral + pnl,
    change: toNumber(value.change) ?? (collateral > 0 ? (pnl / collateral) * 100 : 0),
  };
}

export async function getPerpsPositions(walletAddress: string): Promise<PerpsPosition[]> {
  const normalizedAddress = walletAddress.trim();
  if (!isValidMint(normalizedAddress)) {
    throw new ApiError('INVALID_RESPONSE', 'Wallet address is required.');
  }
  const payload = await requestJson<unknown>(
    `/api/jupiter/perps/positions/${encodeURIComponent(normalizedAddress)}`,
  );
  const rows = extractArrayPayload(payload, ['positions', 'data']);
  return rows
    .map(normalizePerpsPosition)
    .filter((position): position is PerpsPosition => position !== null);
}

export async function sendSignedSolanaTransaction(
  signedTransaction: string,
  options?: {
    lastValidBlockHeight?: number | string | null;
    skipSimulation?: boolean;
    fastConfirm?: boolean;
    requireConfirmed?: boolean;
  },
): Promise<SolanaSendResponse> {
  if (!signedTransaction.trim()) {
    throw new ApiError('INVALID_RESPONSE', 'Signed transaction is required.');
  }

  const submit = async (fastConfirm: boolean): Promise<SolanaSendResponse> => {
    const payload = await requestJson<unknown>('/api/solana/send', {
      method: 'POST',
      body: {
        // A confirmation retry deliberately resubmits these exact signed bytes.
        // Solana deduplicates by signature, so this can help propagation but can
        // never execute the trade twice or ask the wallet to sign again.
        signedTransaction,
        ...(options?.lastValidBlockHeight ? { lastValidBlockHeight: options.lastValidBlockHeight } : {}),
        ...(options?.skipSimulation ? { skipSimulation: true } : {}),
        ...(fastConfirm ? { fastConfirm: true } : {}),
      },
      // The backend submits AND waits for on-chain confirmation before responding,
      // which routinely exceeds the 10s default — especially across two sequential
      // sends (e.g. an Earn unwind followed by a withdrawal transfer). Give the
      // confirmation room so the call doesn't abort on a transaction that lands.
      timeoutMs: 60000,
      timeoutMessage: 'Confirming the transaction on Solana took too long. It may still complete — check your balance before retrying.',
    });

    if (!isRecord(payload) || typeof payload.signature !== 'string' || !payload.signature) {
      throw new ApiError('INVALID_RESPONSE', 'Send response was missing signature.');
    }

    return {
      signature: payload.signature,
      status: typeof payload.status === 'string' ? payload.status : null,
    };
  };

  let result = await submit(options?.fastConfirm === true);

  // fastConfirm is intentionally impatient. During a slow slot it can return
  // `pending` even though the RPC accepted the transaction, which used to make
  // a healthy buy look failed immediately. Keep the fast happy path, then use
  // the normal confirmation window on the SAME signed transaction when needed.
  // Resubmitting identical bytes is idempotent on Solana (same signature), so
  // this improves confirmation without creating a duplicate-buy risk.
  if (
    options?.requireConfirmed &&
    options.fastConfirm &&
    (result.status === 'pending' || result.status === null)
  ) {
    try {
      result = await submit(false);
    } catch {
      // The first request already proved that an RPC accepted the transaction.
      // A timeout/network error during the confirmation pass is ambiguous, not
      // a safe-to-retry failure, so retain the known signature for callers.
      throw new ApiError('TRANSACTION_PENDING', TRANSACTION_PENDING_MESSAGE, undefined, result);
    }
  }

  // "processed" means the transaction is in a block — it landed, it just isn't
  // committed yet. That is a real success and the caller reconciles final state
  // in the background, so holding the UI for "confirmed" only costs a slot.
  // "pending" is the one that must not read as success: it means we never saw
  // the transaction on chain at all.
  if (options?.requireConfirmed && !isLandedTxStatus(result.status)) {
    throw new ApiError(
      'TRANSACTION_PENDING',
      TRANSACTION_PENDING_MESSAGE,
      undefined,
      result,
    );
  }

  return result;
}

export async function searchJupiterToken(
  query: string,
  exactMint?: string,
): Promise<JupiterTokenDetail | null> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new ApiError('INVALID_RESPONSE', 'Token search query is required.');
  }

  const payload = await requestJson<JupiterTokenSearchPayload>('/api/jupiter/token-search', {
    params: {
      query: normalizedQuery,
      ...(exactMint ? { exactMint } : {}),
    },
  });

  const token = payload?.token;

  if (!token || !isRecord(token) || typeof token.id !== 'string' || !token.id) {
    return null;
  }

  const stats24h = isRecord(token.stats24h) ? token.stats24h : null;

  return {
    id: token.id,
    name: typeof token.name === 'string' ? token.name : null,
    symbol: typeof token.symbol === 'string' ? token.symbol : null,
    decimals: toNullableNumber(token.decimals),
    icon: typeof token.icon === 'string' ? token.icon : null,
    holderCount: toNullableNumber(token.holderCount),
    usdPrice: toNullableNumber(token.usdPrice),
    volume24h:
      toNullableNumber(stats24h?.volume) ??
      ((toNullableNumber(stats24h?.buyVolume) ?? 0) + (toNullableNumber(stats24h?.sellVolume) ?? 0) || null),
    priceChange24h: toNullableNumber(stats24h?.priceChange),
    mcap: toNullableNumber(token.mcap),
    fdv: toNullableNumber(token.fdv),
    liquidity: toNullableNumber(token.liquidity),
    organicScore: toNullableNumber(token.organicScore),
    isVerified: typeof token.isVerified === 'boolean' ? token.isVerified : null,
    tags: Array.isArray(token.tags) ? token.tags.filter((t): t is string => typeof t === 'string') : null,
    website: typeof token.website === 'string' ? token.website : null,
    twitter: typeof token.twitter === 'string' ? token.twitter : null,
    audit: isRecord(token.audit) ? {
      topHoldersPercentage: toNullableNumber(token.audit.topHoldersPercentage),
      mintAuthorityDisabled: typeof token.audit.mintAuthorityDisabled === 'boolean' ? token.audit.mintAuthorityDisabled : null,
      freezeAuthorityDisabled: typeof token.audit.freezeAuthorityDisabled === 'boolean' ? token.audit.freezeAuthorityDisabled : null,
    } : null,
  };
}

type CoinGeckoCandlesResponse = {
  candles?: CoinGeckoCandle[];
  source?: unknown;
};

function isCoinGeckoCandle(value: unknown): value is CoinGeckoCandle {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.timestamp === 'number' &&
    typeof value.open === 'number' &&
    typeof value.high === 'number' &&
    typeof value.low === 'number' &&
    typeof value.close === 'number'
  );
}

export type CrossmintOrder = {
  orderId: string;
  clientSecret: string;
};

export async function linkCrossmintWallet(params: {
  email: string;
  walletAddress: string;
}): Promise<void> {
  await requestJson<unknown>('/api/crossmint/link-wallet', {
    method: 'POST',
    body: params,
  });
}

export async function createCrossmintOrder(params: {
  walletAddress: string;
  amount: string;
  receiptEmail: string;
  paymentMethod?: string;
}): Promise<CrossmintOrder> {
  const response = await requestJson<{ order: { orderId: string }; clientSecret: string }>(
    '/api/crossmint/create-order',
    {
      method: 'POST',
      body: params,
    },
  );

  return {
    orderId: response.order.orderId,
    clientSecret: response.clientSecret,
  };
}

export async function getCoinGeckoCandles(
  mint: string,
  days: 1 | 7 | 30 | 90 | 180,
): Promise<CoinGeckoCandlesResult> {
  if (!mint.trim()) {
    throw new ApiError('INVALID_RESPONSE', 'Token mint is required for candle data.');
  }

  const payload = await requestJson<CoinGeckoCandlesResponse>('/api/coingecko/candles', {
    params: {
      mint: mint.trim(),
      days: String(days),
    },
  });

  if (!Array.isArray(payload.candles)) {
    throw new ApiError('INVALID_RESPONSE', 'Candles response was missing a candles array.');
  }

  const candles = payload.candles.filter(isCoinGeckoCandle);

  if (candles.length !== payload.candles.length) {
    throw new ApiError('INVALID_RESPONSE', 'Some candlestick rows were invalid.');
  }

  return {
    candles,
    source: payload.source === 'jupiter-derived' ? 'jupiter-derived' : 'coingecko',
  };
}

/* ── Social ── */

export type FollowedBy = {
  count: number;
  /** Up to two display names of mutual followers, for "followed by alice +3". */
  sample: string[];
};

export type SocialUser = {
  id: string;
  privyUserId: string;
  name: string | null;
  username: string | null;
  xHandle: string | null;
  avatarUrl: string | null;
  bio: string | null;
  walletAddress: string | null;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  /** Account creation time. Present on profile endpoints for the joined date. */
  createdAt?: string;
  /** Number of trades (basket runs). Present on the profile endpoint only. */
  tradeCount?: number;
  /** Mutual-follow social proof. Present on the profile endpoint only. */
  followedBy?: FollowedBy;
  /**
   * §8.4: whether this account's takes carry their size band. Present on the
   * profile endpoint only, and only ever acted on for the viewer's own account.
   */
  showPositionSize?: boolean;
};

export type FollowEntry = SocialUser & {
  followedAt: string;
};

export type PaginatedFollowResult = {
  entries: FollowEntry[];
  nextCursor: string | null;
};

function normalizeSocialUser(value: unknown): SocialUser | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : null;
  const privyUserId = typeof value.privyUserId === 'string' ? value.privyUserId : null;
  if (!id || !privyUserId) return null;

  return {
    id,
    privyUserId,
    name: typeof value.name === 'string' && value.name ? value.name : null,
    username: typeof value.username === 'string' && value.username ? value.username : null,
    xHandle: typeof value.xHandle === 'string' && value.xHandle ? value.xHandle : null,
    avatarUrl: typeof value.avatarUrl === 'string' && value.avatarUrl ? value.avatarUrl : null,
    bio: typeof value.bio === 'string' && value.bio ? value.bio : null,
    // Defaults to true, matching the column: a missing field on an older
    // backend must not read as "this user hid their size".
    showPositionSize: value.showPositionSize !== false,
    walletAddress: typeof value.walletAddress === 'string' && value.walletAddress ? value.walletAddress : null,
    followerCount: typeof value.followerCount === 'number' ? value.followerCount : 0,
    followingCount: typeof value.followingCount === 'number' ? value.followingCount : 0,
    isFollowing: value.isFollowing === true,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    tradeCount: typeof value.tradeCount === 'number' ? value.tradeCount : undefined,
    followedBy: isRecord(value.followedBy)
      ? {
          count: typeof value.followedBy.count === 'number' ? value.followedBy.count : 0,
          sample: Array.isArray(value.followedBy.sample)
            ? value.followedBy.sample.filter((s): s is string => typeof s === 'string')
            : [],
        }
      : undefined,
  };
}

function normalizeFollowEntry(value: unknown): FollowEntry | null {
  const user = normalizeSocialUser(value);
  if (!user || !isRecord(value)) return null;
  return {
    ...user,
    followedAt: typeof value.followedAt === 'string' ? value.followedAt : new Date(0).toISOString(),
  };
}

export async function getUserProfile(
  privyUserId: string,
  viewerPrivyUserId?: string | null,
): Promise<SocialUser | null> {
  const params: Record<string, string> = {};
  if (viewerPrivyUserId) params.viewerPrivyUserId = viewerPrivyUserId;

  try {
    const payload = await requestJson<unknown>(
      `/api/users/${encodeURIComponent(privyUserId)}`,
      { params },
    );
    return normalizeSocialUser(payload);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * A builder's track record: receipts, not a score.
 *
 * `visible` is the server's decision, not the client's — below the resolved
 * threshold the numbers come back null and the UI shows "building record — 4/10"
 * instead. Do not compute a hit rate locally to fill the gap; the gate exists
 * because a 1-for-1 100% record makes the whole system look unserious.
 */
export type TrackRecordEntry = {
  sandwichId: string;
  venue: string;
  status: 'closed' | 'liquidated';
  entryAt: string;
  resolvedAt: string | null;
  resolutionReason: string | null;
  returnNet: number | null;
  /** Market context over the same window. Display only — never subtracted. */
  referenceAsset: string | null;
  referenceReturn: number | null;
  /** Shown beside the return, never folded into it. */
  leverageByLeg: Record<string, number>;
};

export type TrackRecordOpenPosition = {
  sandwichId: string;
  venue: string;
  entryAt: string;
  entryAmountUsd: number | null;
  leverageByLeg: Record<string, number>;
};

export type TrackRecord = {
  visible: boolean;
  resolvedCount: number;
  requiredForRecord: number;
  hitRate: number | null;
  medianReturn: number | null;
  /** Never mixed into the resolved figures. */
  openCount: number;
  open: TrackRecordOpenPosition[];
  entries: TrackRecordEntry[];
};

function normalizeTrackRecord(value: unknown): TrackRecord | null {
  if (!isRecord(value)) return null;
  const resolvedCount = toNumber(value.resolvedCount);
  if (resolvedCount === null) return null;
  return {
    visible: value.visible === true,
    resolvedCount,
    requiredForRecord: toNumber(value.requiredForRecord) ?? 10,
    hitRate: toNullableNumber(value.hitRate),
    medianReturn: toNullableNumber(value.medianReturn),
    openCount: toNumber(value.openCount) ?? 0,
    open: Array.isArray(value.open)
      ? value.open.flatMap((row) =>
          isRecord(row) && typeof row.sandwichId === 'string'
            ? [
                {
                  sandwichId: row.sandwichId,
                  venue: typeof row.venue === 'string' ? row.venue : 'spot',
                  entryAt: typeof row.entryAt === 'string' ? row.entryAt : '',
                  entryAmountUsd: toNullableNumber(row.entryAmountUsd),
                  leverageByLeg: isRecord(row.leverageByLeg)
                    ? (row.leverageByLeg as Record<string, number>)
                    : {},
                },
              ]
            : [],
        )
      : [],
    entries: Array.isArray(value.entries)
      ? value.entries.flatMap((row) =>
          isRecord(row) && typeof row.sandwichId === 'string'
            ? [
                {
                  sandwichId: row.sandwichId,
                  venue: typeof row.venue === 'string' ? row.venue : 'spot',
                  status: row.status === 'liquidated' ? ('liquidated' as const) : ('closed' as const),
                  entryAt: typeof row.entryAt === 'string' ? row.entryAt : '',
                  resolvedAt: typeof row.resolvedAt === 'string' ? row.resolvedAt : null,
                  resolutionReason:
                    typeof row.resolutionReason === 'string' ? row.resolutionReason : null,
                  returnNet: toNullableNumber(row.returnNet),
                  referenceAsset:
                    typeof row.referenceAsset === 'string' ? row.referenceAsset : null,
                  referenceReturn: toNullableNumber(row.referenceReturn),
                  leverageByLeg: isRecord(row.leverageByLeg)
                    ? (row.leverageByLeg as Record<string, number>)
                    : {},
                },
              ]
            : [],
        )
      : [],
  };
}

export async function getUserTrackRecord(privyUserId: string): Promise<TrackRecord | null> {
  try {
    const payload = await requestJson<unknown>(
      `/api/users/${encodeURIComponent(privyUserId)}/track-record`,
    );
    return isRecord(payload) ? normalizeTrackRecord(payload.trackRecord) : null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function followUser(
  actor: AppUserPayload,
  followingPrivyUserId: string,
): Promise<void> {
  await requestJson<unknown>('/api/users/follows', {
    method: 'POST',
    body: { user: actor, followingPrivyUserId },
  });
}

export async function unfollowUser(
  actor: AppUserPayload,
  followingPrivyUserId: string,
): Promise<void> {
  await requestJson<unknown>('/api/users/follows', {
    method: 'DELETE',
    body: { user: actor, followingPrivyUserId },
  });
}

export async function getFollowers(
  privyUserId: string,
  viewerPrivyUserId?: string | null,
  limit = 20,
  cursor?: string | null,
): Promise<PaginatedFollowResult> {
  const params: Record<string, string> = { limit: String(limit) };
  if (viewerPrivyUserId) params.viewerPrivyUserId = viewerPrivyUserId;
  if (cursor) params.cursor = cursor;

  const payload = await requestJson<unknown>(
    `/api/users/${encodeURIComponent(privyUserId)}/followers`,
    { params },
  );

  if (!isRecord(payload)) return { entries: [], nextCursor: null };
  const entries = Array.isArray(payload.followers)
    ? payload.followers.map(normalizeFollowEntry).filter((e): e is FollowEntry => e !== null)
    : [];
  return {
    entries,
    nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : null,
  };
}

export async function getFollowing(
  privyUserId: string,
  viewerPrivyUserId?: string | null,
  limit = 20,
  cursor?: string | null,
): Promise<PaginatedFollowResult> {
  const params: Record<string, string> = { limit: String(limit) };
  if (viewerPrivyUserId) params.viewerPrivyUserId = viewerPrivyUserId;
  if (cursor) params.cursor = cursor;

  const payload = await requestJson<unknown>(
    `/api/users/${encodeURIComponent(privyUserId)}/following`,
    { params },
  );

  if (!isRecord(payload)) return { entries: [], nextCursor: null };
  const entries = Array.isArray(payload.following)
    ? payload.following.map(normalizeFollowEntry).filter((e): e is FollowEntry => e !== null)
    : [];
  return {
    entries,
    nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : null,
  };
}

export async function searchUsers(
  query: string,
  viewerPrivyUserId?: string | null,
  limit = 20,
): Promise<SocialUser[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const params: Record<string, string> = { q, limit: String(limit) };
  if (viewerPrivyUserId) params.privyUserId = viewerPrivyUserId;

  const payload = await requestJson<unknown>('/api/users/search', { params });
  if (!isRecord(payload) || !Array.isArray(payload.users)) return [];
  return payload.users.map(normalizeSocialUser).filter((u): u is SocialUser => u !== null);
}

/**
 * Users by Privy id, in the order asked for.
 *
 * Backs the search screen's Recents carousel, which persists ids on the device
 * and reads the bodies fresh — a follower count and a follow state both drift
 * while a row sits in local storage. Ids that no longer resolve come back
 * missing rather than as an error, so a deleted account quietly leaves the list.
 */
export async function getUsersByIds(
  privyUserIds: string[],
  viewerPrivyUserId?: string | null,
): Promise<SocialUser[]> {
  const ids = privyUserIds.filter(Boolean);
  if (ids.length === 0) return [];

  const params: Record<string, string> = { ids: ids.join(',') };
  if (viewerPrivyUserId) params.privyUserId = viewerPrivyUserId;

  const payload = await requestJson<unknown>('/api/users/by-ids', { params });
  if (!isRecord(payload) || !Array.isArray(payload.users)) return [];
  return payload.users.map(normalizeSocialUser).filter((u): u is SocialUser => u !== null);
}

export type ProfitableUser = {
  id: string;
  privyUserId: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  portfolioValueUsd: number;
  pnlUsd: number;
  pnlPct: number;
  asOf: string;
};

function normalizeProfitableUser(value: unknown): ProfitableUser | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const privyUserId = stringValue(value.privyUserId);
  const portfolioValueUsd = toNullableNumber(value.portfolioValueUsd);
  const pnlUsd = toNullableNumber(value.pnlUsd);
  const pnlPct = toNullableNumber(value.pnlPct);
  const asOf = stringValue(value.asOf);
  if (
    !id ||
    !privyUserId ||
    portfolioValueUsd === null ||
    pnlUsd === null ||
    pnlPct === null ||
    !asOf
  ) {
    return null;
  }
  return {
    id,
    privyUserId,
    name: stringValue(value.name),
    username: stringValue(value.username),
    avatarUrl: stringValue(value.avatarUrl),
    portfolioValueUsd,
    pnlUsd,
    pnlPct,
    asOf,
  };
}

/** Active Bread users with a positive today return, ranked by P&L percentage. */
export async function getProfitableUsers(limit = 8): Promise<ProfitableUser[]> {
  const payload = await requestJson<unknown>('/api/users/leaderboard', {
    params: { limit: String(limit) },
  });
  if (!isRecord(payload) || !Array.isArray(payload.users)) return [];
  return payload.users
    .map(normalizeProfitableUser)
    .filter((user): user is ProfitableUser => user !== null);
}

/* ── Portfolio ── */

export type PublicSandwichLeg = {
  legId: string;
  mint: string;
  symbol: string | null;
  label: string;
  imageUrl: string | null;
  weightBps: number;
  inputAmount: string | null;
  investedUsd: number | null;
  /** Token base units this buy received. Absent from older backends. */
  outputAmount?: string | null;
};

export type PublicSandwichPosition = {
  id: string;
  sandwichId: string;
  name: string;
  summary: string;
  investedUsd: number | null;
  updatedAt: string;
  legs: PublicSandwichLeg[];
};

export type PortfolioHistoryPoint = { t: number; valueUsd: number };

export type PortfolioRange = '24H' | '7d' | '30d';

export type PortfolioHistory = {
  points: PortfolioHistoryPoint[];
  changePct: number | null;
};

/** A profile's combined realized and live unrealized P&L. */
export type PnlHistory = {
  points: PortfolioHistoryPoint[];
  realizedUsd: number;
  unrealizedUsd: number;
  changeUsd: number;
  /**
   * The capital the P&L was earned on — cost of the trades closed in the range
   * plus what is still open. The percentage is `changeUsd / basisUsd`. Null when
   * nothing was at stake, or from an older backend.
   */
  basisUsd?: number | null;
};

/**
 * Portfolio USD value over time for a user, reconstructed server-side from
 * on-chain holdings (Helius) priced via tokens.xyz. `range` selects 24H
 * (hourly) or 7d (daily). The most recent point is the live value.
 */
export async function getUserPortfolioHistory(
  privyUserId: string,
  range: PortfolioRange = '7d',
): Promise<PortfolioHistory> {
  try {
    const payload = await requestJson<unknown>(
      `/api/users/${encodeURIComponent(privyUserId)}/portfolio/history`,
      { params: { range } },
    );
    if (!isRecord(payload) || !Array.isArray(payload.points)) {
      return { points: [], changePct: null };
    }
    const points = payload.points
      .filter(isRecord)
      .map((p): PortfolioHistoryPoint | null => {
        const t = toNullableNumber(p.t);
        const valueUsd = toNullableNumber(p.valueUsd);
        if (t === null || valueUsd === null) return null;
        return { t, valueUsd };
      })
      .filter((p): p is PortfolioHistoryPoint => p !== null);
    return { points, changePct: toNullableNumber(payload.changePct) };
  } catch {
    return { points: [], changePct: null };
  }
}

export async function getUserPnlHistory(
  privyUserId: string,
  range: PortfolioRange = '7d',
): Promise<PnlHistory> {
  try {
    const payload = await requestJson<unknown>(
      `/api/users/${encodeURIComponent(privyUserId)}/pnl/history`,
      { params: { range } },
    );
    if (!isRecord(payload) || !Array.isArray(payload.points)) {
      return { points: [], realizedUsd: 0, unrealizedUsd: 0, changeUsd: 0 };
    }
    const points = payload.points
      .filter(isRecord)
      .map((point): PortfolioHistoryPoint | null => {
        const t = toNullableNumber(point.t);
        const valueUsd = toNullableNumber(point.valueUsd);
        return t === null || valueUsd === null ? null : { t, valueUsd };
      })
      .filter((point): point is PortfolioHistoryPoint => point !== null);
    return {
      points,
      realizedUsd: toNullableNumber(payload.realizedUsd) ?? 0,
      unrealizedUsd: toNullableNumber(payload.unrealizedUsd) ?? 0,
      changeUsd: toNullableNumber(payload.changeUsd) ?? 0,
      basisUsd: (() => {
        const basis = toNullableNumber(payload.basisUsd);
        return basis !== null && basis > 0 ? basis : null;
      })(),
    };
  } catch {
    return { points: [], realizedUsd: 0, unrealizedUsd: 0, changeUsd: 0 };
  }
}

/**
 * The distinct stocks a user holds, enriched with live market price + 24h
 * change. Derived from their Sandwich legs (how stocks are bought on Bread),
 * deduped by mint. Falls back to the leg's static data if a live lookup fails,
 * so a row always renders.
 */
export async function getUserHeldStocks(positions: PublicSandwichPosition[]): Promise<Stock[]> {
  const seen = new Set<string>();
  const entries: PublicSandwichLeg[] = [];
  for (const pos of positions) {
    for (const leg of pos.legs) {
      if (leg.mint && !seen.has(leg.mint)) {
        seen.add(leg.mint);
        entries.push(leg);
      }
    }
  }

  const results = await Promise.allSettled(entries.map((leg) => getStockById(leg.mint)));
  return results.map((result, i): Stock => {
    if (result.status === 'fulfilled') return result.value;
    const leg = entries[i];
    return {
      id: leg.mint,
      symbol: leg.symbol ?? leg.label,
      name: leg.label || (leg.symbol ?? leg.mint),
      type: 'xstock',
      holderCount: null,
      icon: leg.imageUrl,
      usdPrice: null,
      priceChange1h: null,
      priceChange24h: null,
      volume24h: null,
    };
  });
}

/**
 * A single on-chain holding for the profile Holdings tab: the enriched stock
 * card (name/symbol/icon/live price) plus how many units the user holds and the
 * USD value of that position.
 */
export type EnrichedHolding = {
  stock: Stock;
  /**
   * The mint this balance is held in. Kept beside `stock` because `stock.id` is
   * the tokens.xyz asset id, which is NOT the mint for every row — and the mint
   * is what a Sandwich leg is matched on.
   */
  mint: string;
  units: number;
  valueUsd: number | null;
  /** Effective per-unit price backing `valueUsd` (on-chain, so `units × this ≈ valueUsd`). */
  pricePerUnit: number | null;
  /** Cost basis of the held units, derived on-chain from swap history. */
  costUsd: number | null;
  /** Unrealized PnL in USD (`valueUsd − costUsd`); null when cost is unknown. */
  pnlUsd: number | null;
  /** Unrealized PnL as a percentage of cost; null when cost is unknown. */
  pnlPct: number | null;
  /** Compatibility marker emitted for SOL rows by the holdings service. */
  traded: boolean;
};

export type UserHoldings = {
  holdings: EnrichedHolding[];
  /** USD value of the asset holdings listed (includes SOL, excludes stablecoin cash). */
  totalValueUsd: number;
  /** Stablecoin cash held by the wallet — not listed, but part of portfolio value. */
  cashUsd: number;
};

type RawHolding = {
  mint: string;
  units: number;
  pricePerToken: number | null;
  valueUsd: number;
  costUsd: number | null;
  traded: boolean;
};

/**
 * Another user's actual on-chain holdings (units + USD value), sourced from
 * Helius wallet balances server-side and enriched here with the canonical
 * tokens.xyz card per mint. This is the source of truth for the Holdings tab —
 * unlike the synced sandwich-position table, it requires no client push and
 * captures every token a user holds.
 *
 * Per-row value prefers `units × live price` (the app's on-chain price, which
 * matches the chart) and falls back to the server-computed value.
 */
export async function getUserHoldings(privyUserId: string): Promise<UserHoldings> {
  let raw: RawHolding[] = [];
  let cashUsd = 0;
  try {
    const payload = await requestJson<unknown>(
      `/api/users/${encodeURIComponent(privyUserId)}/holdings`,
    );
    if (isRecord(payload)) {
      cashUsd = toNullableNumber(payload.cashUsd) ?? 0;
    }
    if (isRecord(payload) && Array.isArray(payload.holdings)) {
      raw = payload.holdings
        .filter(isRecord)
        .map((h): RawHolding | null => {
          const mint = typeof h.mint === 'string' ? h.mint : null;
          const units = toNullableNumber(h.units);
          if (!mint || units === null || units <= 0) return null;
          return {
            mint,
            units,
            pricePerToken: toNullableNumber(h.pricePerToken),
            valueUsd: toNullableNumber(h.valueUsd) ?? 0,
            costUsd: toNullableNumber(h.costUsd),
            traded: h.traded === true,
          };
        })
        .filter((h): h is RawHolding => h !== null);
    }
  } catch {
    return { holdings: [], totalValueUsd: 0, cashUsd: 0 };
  }

  const enriched = await Promise.allSettled(raw.map((h) => getStockById(h.mint)));
  const holdings: EnrichedHolding[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const result = enriched[i];
    const stock: Stock =
      result.status === 'fulfilled'
        ? result.value
        : {
            id: r.mint,
            symbol: r.mint.slice(0, 4),
            name: r.mint.slice(0, 4),
            type: 'xstock',
            holderCount: null,
            icon: null,
            usdPrice: r.pricePerToken,
            priceChange1h: null,
            priceChange24h: null,
            volume24h: null,
          };
    // Value = the server's ON-CHAIN valuation (units × Helius pricePerToken) —
    // the same number the wallet/explorer shows, so the row matches the user's
    // real balance exactly. The cost basis (server WalletDeposit USD ÷ on-chain
    // qty) is measured against that same on-chain price, so PnL is coherent:
    // a freshly-bought position that's up on-chain reads positive. We fall back
    // to the tokens.xyz card price only when the chain feed has no price for the
    // mint (e.g. some prestocks), so nothing goes unvalued.
    const valueUsd =
      r.valueUsd > 0
        ? r.valueUsd
        : stock.usdPrice != null
          ? r.units * stock.usdPrice
          : null;
    const costUsd = r.costUsd;
    const pnlUsd = valueUsd !== null && costUsd !== null ? valueUsd - costUsd : null;
    const pnlPct =
      pnlUsd !== null && costUsd !== null && costUsd > 0 ? (pnlUsd / costUsd) * 100 : null;
    // Per-unit price consistent with the value shown (value ÷ units), so the row
    // never reads "X units · $P" where X × P disagrees with the position value.
    const pricePerUnit =
      valueUsd !== null && r.units > 0
        ? valueUsd / r.units
        : r.pricePerToken ?? stock.usdPrice ?? null;
    holdings.push({
      stock,
      mint: r.mint,
      units: r.units,
      valueUsd,
      pricePerUnit,
      costUsd,
      pnlUsd,
      pnlPct,
      traded: r.traded,
    });
  }

  const totalValueUsd = holdings.reduce((sum, h) => sum + (h.valueUsd ?? 0), 0);
  return { holdings, totalValueUsd, cashUsd };
}

/**
 * One Bread user holding an asset, as shown on the stock detail sheet's
 * Holders tab: who they are plus how big their position is.
 */
export type AssetHolderUser = {
  privyUserId: string;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  /** Token units held. */
  units: number;
  /** USD value of those units; null when the mint has no price. */
  valueUsd: number | null;
  /** Weighted-average price paid, from the server's buy/sell ledger. */
  avgEntryUsd: number | null;
  /** Unrealized PnL on the units held, and the same move in percent. */
  pnlUsd: number | null;
  pnlPct: number | null;
};

export type AssetHolders = {
  /** Bread users holding the mint, biggest position first. */
  holders: AssetHolderUser[];
  /** Total holders found (may exceed `holders.length` when truncated). */
  holderCount: number;
  /** Combined USD held by Bread users. */
  totalValueUsd: number;
};

/**
 * Which Bread users are in this asset, and for how much. Sourced on-chain
 * server-side (every app wallet's balance for the mint), so it reflects real
 * positions rather than anything the client has to push up.
 */
export async function getAssetHolders(mint: string, limit = 50): Promise<AssetHolders> {
  try {
    const payload = await requestJson<unknown>('/api/stocks/holders', {
      params: { mint, limit: String(limit) },
    });
    if (!isRecord(payload) || !Array.isArray(payload.holders)) {
      return { holders: [], holderCount: 0, totalValueUsd: 0 };
    }
    const holders = payload.holders
      .filter(isRecord)
      .map((h): AssetHolderUser | null => {
        const privyUserId = typeof h.privyUserId === 'string' ? h.privyUserId : null;
        const units = toNullableNumber(h.units);
        if (!privyUserId || units === null || units <= 0) return null;
        return {
          privyUserId,
          username: typeof h.username === 'string' ? h.username : null,
          name: typeof h.name === 'string' ? h.name : null,
          avatarUrl: typeof h.avatarUrl === 'string' ? h.avatarUrl : null,
          units,
          valueUsd: toNullableNumber(h.valueUsd),
          avgEntryUsd: toNullableNumber(h.avgEntryUsd),
          pnlUsd: toNullableNumber(h.pnlUsd),
          pnlPct: toNullableNumber(h.pnlPct),
        };
      })
      .filter((h): h is AssetHolderUser => h !== null);
    return {
      holders,
      holderCount: toNullableNumber(payload.holderCount) ?? holders.length,
      totalValueUsd: toNullableNumber(payload.totalValueUsd) ?? 0,
    };
  } catch {
    return { holders: [], holderCount: 0, totalValueUsd: 0 };
  }
}

export type PerpHolderUser = {
  privyUserId: string;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  side: 'long' | 'short';
  /** Absolute base units. */
  size: number;
  entryPrice: number;
  /** Absolute notional at the current mark, USD. */
  positionValueUsd: number;
  pnlUsd: number;
  pnlPct: number | null;
};

export type PerpHolders = {
  holders: PerpHolderUser[];
  holderCount: number;
  longCount: number;
  shortCount: number;
};

/**
 * Bread users with an open standalone perp on this Phoenix market. Perp-only:
 * spot holders of the same underlying are `getAssetHolders`.
 */
export async function getPerpHolders(symbol: string, limit = 50): Promise<PerpHolders> {
  const empty: PerpHolders = { holders: [], holderCount: 0, longCount: 0, shortCount: 0 };
  try {
    const payload = await requestJson<unknown>(
      `/api/phoenix/holders/${encodeURIComponent(symbol)}`,
      { params: { limit: String(limit) } },
    );
    if (!isRecord(payload) || !Array.isArray(payload.holders)) return empty;
    const holders = payload.holders
      .filter(isRecord)
      .map((h): PerpHolderUser | null => {
        const privyUserId = typeof h.privyUserId === 'string' ? h.privyUserId : null;
        const size = toNullableNumber(h.size);
        const side = h.side === 'long' || h.side === 'short' ? h.side : null;
        if (!privyUserId || !side || size === null || size <= 0) return null;
        return {
          privyUserId,
          username: typeof h.username === 'string' ? h.username : null,
          name: typeof h.name === 'string' ? h.name : null,
          avatarUrl: typeof h.avatarUrl === 'string' ? h.avatarUrl : null,
          side,
          size,
          entryPrice: toNullableNumber(h.entryPrice) ?? 0,
          positionValueUsd: toNullableNumber(h.positionValueUsd) ?? 0,
          pnlUsd: toNullableNumber(h.pnlUsd) ?? 0,
          pnlPct: toNullableNumber(h.pnlPct),
        };
      })
      .filter((h): h is PerpHolderUser => h !== null);
    return {
      holders,
      holderCount: toNullableNumber(payload.holderCount) ?? holders.length,
      longCount: toNullableNumber(payload.longCount) ?? 0,
      shortCount: toNullableNumber(payload.shortCount) ?? 0,
    };
  } catch {
    return empty;
  }
}

/** Parse the `{ [key]: [...] }` array of public sandwich positions from a response. */
function parsePublicSandwichPositions(payload: unknown, key: string): PublicSandwichPosition[] {
  if (!isRecord(payload) || !Array.isArray(payload[key])) return [];
  return (payload[key] as unknown[])
    .filter(isRecord)
    .map((pos): PublicSandwichPosition | null => {
      const id = typeof pos.id === 'string' ? pos.id : null;
      const sandwichId = typeof pos.sandwichId === 'string' ? pos.sandwichId : null;
      const name = typeof pos.name === 'string' ? pos.name : null;
      if (!id || !sandwichId || !name) return null;
      return {
        id,
        sandwichId,
        name,
        summary: typeof pos.summary === 'string' ? pos.summary : '',
        investedUsd: toNullableNumber(pos.investedUsd),
        updatedAt: typeof pos.updatedAt === 'string' ? pos.updatedAt : new Date(0).toISOString(),
        legs: Array.isArray(pos.legs)
          ? (pos.legs as unknown[]).filter(isRecord).map((leg): PublicSandwichLeg => ({
              legId: typeof leg.legId === 'string' ? leg.legId : '',
              mint: typeof leg.mint === 'string' ? leg.mint : '',
              symbol: typeof leg.symbol === 'string' ? leg.symbol : null,
              label: typeof leg.label === 'string' ? leg.label : '',
              imageUrl: typeof leg.imageUrl === 'string' ? leg.imageUrl : null,
              weightBps: typeof leg.weightBps === 'number' ? leg.weightBps : 0,
              inputAmount: typeof leg.inputAmount === 'string' ? leg.inputAmount : null,
              investedUsd: toNullableNumber(leg.investedUsd),
              outputAmount:
                typeof leg.outputAmount === 'string' && /^\d+$/.test(leg.outputAmount)
                  ? leg.outputAmount
                  : null,
            })).filter((leg) => leg.legId && leg.mint)
          : [],
      };
    })
    .filter((pos): pos is PublicSandwichPosition => pos !== null);
}

export async function getUserPortfolio(privyUserId: string): Promise<PublicSandwichPosition[]> {
  const payload = await requestJson<unknown>(
    `/api/users/${encodeURIComponent(privyUserId)}/portfolio`,
  );
  return parsePublicSandwichPositions(payload, 'positions');
}

/** Sandwiches the user *created* (authored), newest first. */
export async function getUserCreatedSandwiches(privyUserId: string): Promise<PublicSandwichPosition[]> {
  try {
    const payload = await requestJson<unknown>(
      `/api/users/${encodeURIComponent(privyUserId)}/sandwiches`,
    );
    return parsePublicSandwichPositions(payload, 'sandwiches');
  } catch {
    return [];
  }
}

/* ── Birdeye OHLCV ── */

export type StockPerformance = {
  oneWeek: number | null;
  oneMonth: number | null;
  threeMonth: number | null;
  sixMonth: number | null;
  oneYear: number | null;
};

export async function getStockPerformance(mint: string): Promise<StockPerformance> {
  if (!isValidMint(mint)) {
    throw new ApiError('INVALID_RESPONSE', 'Invalid mint for performance lookup.');
  }
  // Uses /api/tokens/performance which tries Tokens API first, Birdeye fallback.
  const payload = await requestJson<unknown>(
    `/api/tokens/performance?mint=${encodeURIComponent(mint)}`,
  );
  if (!isRecord(payload)) {
    throw new ApiError('INVALID_RESPONSE', 'Performance response malformed.');
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    oneWeek: num(payload.oneWeek),
    oneMonth: num(payload.oneMonth),
    threeMonth: num(payload.threeMonth),
    sixMonth: num(payload.sixMonth),
    oneYear: num(payload.oneYear),
  };
}

/* ── Real underlying-equity reference data (Finnhub, by ticker) ── */

export type EquityInfo = {
  ticker: string;
  name: string | null;
  exchange: string | null;
  industry: string | null;
  currency: string | null;
  marketCap: number | null;
  peRatio: number | null;
  weekHigh52: number | null;
  weekLow52: number | null;
};

// Real underlying-equity info (market cap, trailing P/E, industry, 52-week high/low) keyed by
// the cleaned ticker — NOT the on-chain tokenized wrapper. All-time high stays
// sourced from the tokens.xyz profile (getAssetDetail). Returns null when the
// provider has no data or isn't configured, so the section just hides.
export async function getEquityInfo(ticker: string): Promise<EquityInfo | null> {
  const clean = (ticker ?? '').trim().toUpperCase();
  if (!clean) return null;
  try {
    const payload = await requestJson<unknown>(
      `/api/equities/${encodeURIComponent(clean)}`,
    );
    if (!isRecord(payload)) return null;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const s = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
    return {
      ticker: s(payload.ticker) ?? clean,
      name: s(payload.name),
      exchange: s(payload.exchange),
      industry: s(payload.industry),
      currency: s(payload.currency),
      marketCap: num(payload.marketCap),
      peRatio: num(payload.peRatio),
      weekHigh52: num(payload.weekHigh52),
      weekLow52: num(payload.weekLow52),
    };
  } catch {
    return null;
  }
}

/* ── Asset detail (profile + risk + description) ── */

export type AssetStats = {
  price: number | null;
  liquidity: number | null;
  volume24hUSD: number | null;
  volume30dUSD: number | null;
  marketCap: number | null;
  fdv: number | null;
  priceChange24hPercent: number | null;
  priceChange1hPercent: number | null;
  totalSupply: number | null;
  circulatingSupply: number | null;
};

export type AssetProfile = {
  marketCap: number | null;
  fdv: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  price: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  allTimeHigh: number | null;
  allTimeHighDate: string | null;
  description: string | null;
  links: {
    website: string | null;
    twitter: string | null;
    telegram: string | null;
  };
};

export type AssetRiskComponent = {
  key: string;
  score: number | null;
  /** "safe" | "warning" | "info" | "danger" */
  status: string | null;
  hasData: boolean;
};

export type AssetRisk = {
  score: number | null;
  grade: string | null;
  label: string | null;
  tone: string | null;
  components: AssetRiskComponent[];
};

export type AssetDetail = {
  assetId: string;
  name: string | null;
  symbol: string | null;
  category: string | null;
  imageUrl: string | null;
  primaryMint: string | null;
  description: string | null;
  stats: AssetStats | null;
  profile: AssetProfile | null;
  risk: AssetRisk | null;
};

const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v : null;

function parseAssetStats(v: unknown): AssetStats | null {
  if (!isRecord(v)) return null;
  return {
    price: numOrNull(v.price),
    liquidity: numOrNull(v.liquidity),
    volume24hUSD: numOrNull(v.volume24hUSD),
    volume30dUSD: numOrNull(v.volume30dUSD),
    marketCap: numOrNull(v.marketCap),
    fdv: numOrNull(v.fdv),
    priceChange24hPercent: numOrNull(v.priceChange24hPercent),
    priceChange1hPercent: numOrNull(v.priceChange1hPercent),
    totalSupply: numOrNull(v.totalSupply),
    circulatingSupply: numOrNull(v.circulatingSupply),
  };
}

function parseAssetProfile(v: unknown): AssetProfile | null {
  if (!isRecord(v)) return null;
  const links = isRecord(v.links) ? v.links : {};
  return {
    marketCap: numOrNull(v.marketCap),
    fdv: numOrNull(v.fdv),
    circulatingSupply: numOrNull(v.circulatingSupply),
    totalSupply: numOrNull(v.totalSupply),
    price: numOrNull(v.price),
    priceChange24h: numOrNull(v.priceChange24h),
    volume24h: numOrNull(v.volume24h),
    allTimeHigh: numOrNull(v.allTimeHigh),
    allTimeHighDate: strOrNull(v.allTimeHighDate),
    description: strOrNull(v.description),
    links: {
      website: strOrNull(links.website),
      twitter: strOrNull(links.twitter),
      telegram: strOrNull(links.telegram),
    },
  };
}

function parseAssetRisk(v: unknown): AssetRisk | null {
  if (!isRecord(v)) return null;
  const rawComponents = Array.isArray(v.components) ? v.components : [];
  const components: AssetRiskComponent[] = rawComponents
    .filter(isRecord)
    .map((c) => ({
      key: strOrNull(c.key) ?? '',
      score: numOrNull(c.score),
      status: strOrNull(c.status),
      hasData: c.hasData === true,
    }))
    .filter((c) => c.key);
  return {
    score: numOrNull(v.score),
    grade: strOrNull(v.grade),
    label: strOrNull(v.label),
    tone: strOrNull(v.tone),
    components,
  };
}

/**
 * Fetch the full asset detail (header stats, profile, risk, description) for the
 * detail sheet. `assetIdOrMint` may be a tokens.xyz slug ("nvidia") or a Solana
 * mint. Returns null when the asset can't be resolved.
 *
 * This is the single source of truth for the detail sheet's About panel — only
 * the chart (OHLCV) is fetched separately.
 */
export async function getAssetDetail(assetIdOrMint: string): Promise<AssetDetail | null> {
  const id = assetIdOrMint.trim();
  if (!id) return null;
  try {
    const payload = await requestJson<unknown>(
      `/api/tokens/asset-detail/${encodeURIComponent(id)}`,
    );
    if (!isRecord(payload) || typeof payload.assetId !== 'string') return null;
    return {
      assetId: payload.assetId,
      name: strOrNull(payload.name),
      symbol: strOrNull(payload.symbol),
      category: strOrNull(payload.category),
      imageUrl: strOrNull(payload.imageUrl),
      primaryMint: strOrNull(payload.primaryMint),
      description: strOrNull(payload.description),
      stats: parseAssetStats(payload.stats),
      profile: parseAssetProfile(payload.profile),
      risk: parseAssetRisk(payload.risk),
    };
  } catch {
    return null;
  }
}

export type BirdeyeOhlcvTimeframe = '1m' | '5m' | '1H' | '4H' | '1D';

export type BirdeyeOhlcvItem = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BirdeyeOhlcvResult = {
  items: BirdeyeOhlcvItem[];
  timeframe: BirdeyeOhlcvTimeframe;
};

/**
 * Aggregate an ascending OHLCV series down to at most `maxPoints` candles while
 * preserving the FULL time range. Buckets `bucketSize` consecutive candles into
 * one (open = first, close = last, high = max, low = min, volume = sum), and
 * returns the input unchanged when it already fits.
 *
 * Charts cap how many candles they render and used to `.slice(-N)` the tail —
 * which silently dropped the older part of long windows (e.g. 1Y daily ≈ 340
 * candles rendered as only the last ~100 days), and made the window % change
 * measure from the wrong start. Downsampling keeps the true start → end span.
 */
export function downsampleOhlcv(
  items: BirdeyeOhlcvItem[],
  maxPoints: number,
): BirdeyeOhlcvItem[] {
  if (maxPoints <= 0 || items.length <= maxPoints) return items;

  const bucketSize = Math.ceil(items.length / maxPoints);
  const out: BirdeyeOhlcvItem[] = [];
  for (let i = 0; i < items.length; i += bucketSize) {
    const bucket = items.slice(i, i + bucketSize);
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const candle of bucket) {
      if (candle.high > high) high = candle.high;
      if (candle.low < low) low = candle.low;
      volume += candle.volume;
    }
    out.push({
      timestamp: bucket[0].timestamp,
      open: bucket[0].open,
      high,
      low,
      close: bucket[bucket.length - 1].close,
      volume,
    });
  }
  return out;
}

export type PolymarketCandlesResult = {
  candles: BirdeyeOhlcvItem[];
  market: {
    marketId: string;
    polymarketId: string;
    tokenId: string;
    conditionId: string | null;
    side: string;
  };
};

const CHART_CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = { data: T; cachedAt: number };
const birdeyeCache = new Map<string, CacheEntry<BirdeyeOhlcvResult>>();
const polymarketCache = new Map<string, CacheEntry<PolymarketCandlesResult>>();

export async function getBirdeyeOhlcv(
  mint: string,
  timeframe: BirdeyeOhlcvTimeframe,
  timeFrom?: number,
  options?: { bypassCache?: boolean; timeTo?: number },
): Promise<BirdeyeOhlcvResult> {
  if (!mint.trim()) {
    throw new ApiError('INVALID_RESPONSE', 'Token mint is required for OHLCV data.');
  }

  const cacheKey = `${mint.trim()}:${timeframe}:${timeFrom ?? ''}:${options?.timeTo ?? ''}`;
  const cached = birdeyeCache.get(cacheKey);
  if (!options?.bypassCache && cached && Date.now() - cached.cachedAt < CHART_CACHE_TTL_MS) {
    return cached.data;
  }

  // Uses /api/tokens/ohlcv which tries Tokens API (canonical stock data)
  // first, then falls back to Birdeye automatically.
  const payload = await requestJson<{
    success?: boolean;
    data?: {
      items?: {
        o: number;
        h: number;
        l: number;
        c: number;
        v: number;
        unixTime: number;
      }[];
    };
  }>('/api/tokens/ohlcv', {
    params: {
      address: mint.trim(),
      type: timeframe,
      ...(timeFrom !== undefined ? { time_from: String(timeFrom) } : {}),
      ...(options?.timeTo !== undefined ? { time_to: String(options.timeTo) } : {}),
    },
  });

  const rawItems = payload?.data?.items;

  // Return an empty result rather than throwing — lets the chart UI show its
  // "No data" empty state instead of the harsher "Chart unavailable" error.
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    const empty: BirdeyeOhlcvResult = { items: [], timeframe };
    birdeyeCache.set(cacheKey, { data: empty, cachedAt: Date.now() });
    return empty;
  }

  const items: BirdeyeOhlcvItem[] = rawItems
    .filter(
      (item) =>
        typeof item.o === 'number' &&
        typeof item.h === 'number' &&
        typeof item.l === 'number' &&
        typeof item.c === 'number' &&
        typeof item.v === 'number' &&
        typeof item.unixTime === 'number',
    )
    .map((item) => ({
      timestamp: item.unixTime * 1000,
      open: item.o,
      high: item.h,
      low: item.l,
      close: item.c,
      volume: item.v,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const result: BirdeyeOhlcvResult = { items, timeframe };
  birdeyeCache.set(cacheKey, { data: result, cachedAt: Date.now() });
  return result;
}

export async function getPolymarketCandles(
  marketId: string,
  side: string,
  timeframe: BirdeyeOhlcvTimeframe,
  timeFrom: number,
): Promise<PolymarketCandlesResult> {
  if (!marketId.trim()) {
    throw new ApiError('INVALID_RESPONSE', 'Prediction market id is required for candle data.');
  }

  const cacheKey = `${marketId.trim()}:${side.trim().toLowerCase() || 'yes'}:${timeframe}:${timeFrom}`;
  const cached = polymarketCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CHART_CACHE_TTL_MS) {
    return cached.data;
  }

  const payload = await requestJson<unknown>('/api/polymarket/candles', {
    params: {
      marketId: marketId.trim(),
      side: side.trim().toLowerCase() || 'yes',
      type: timeframe,
      time_from: String(timeFrom),
    },
  });

  if (!isRecord(payload) || !Array.isArray(payload.candles) || !isRecord(payload.market)) {
    throw new ApiError('INVALID_RESPONSE', 'Polymarket candles response was malformed.');
  }

  const candles: BirdeyeOhlcvItem[] = payload.candles
    .filter(isRecord)
    .map((candle): BirdeyeOhlcvItem | null => {
      const timestamp = toNumber(candle.timestamp);
      const open = toNumber(candle.open);
      const high = toNumber(candle.high);
      const low = toNumber(candle.low);
      const close = toNumber(candle.close);
      const volume = toNumber(candle.volume) ?? 0;

      if (
        timestamp === null ||
        open === null ||
        high === null ||
        low === null ||
        close === null
      ) {
        return null;
      }

      return { timestamp, open, high, low, close, volume };
    })
    .filter((candle): candle is BirdeyeOhlcvItem => candle !== null);

  if (candles.length === 0) {
    throw new ApiError('INVALID_RESPONSE', 'Polymarket returned no candle data for this market.');
  }

  const result: PolymarketCandlesResult = {
    candles,
    market: {
      marketId: typeof payload.market.marketId === 'string' ? payload.market.marketId : marketId,
      polymarketId: typeof payload.market.polymarketId === 'string' ? payload.market.polymarketId : '',
      tokenId: typeof payload.market.tokenId === 'string' ? payload.market.tokenId : '',
      conditionId: typeof payload.market.conditionId === 'string' ? payload.market.conditionId : null,
      side: typeof payload.market.side === 'string' ? payload.market.side : side,
    },
  };
  polymarketCache.set(cacheKey, { data: result, cachedAt: Date.now() });
  return result;
}

export type TokenContentItem = {
  contentId: string;
  content: string;
  contentType: string;
  postedAt: string;
};

export type TokenContent = {
  mint: string;
  contents: TokenContentItem[];
  newsSummary: { summaryShort: string; summaryFull: string; updatedAt: string } | null;
  tokenSummary: { summaryShort: string; summaryFull: string; updatedAt: string } | null;
};

export type NewsItem = {
  title: string;
  url: string;
  imageUrl: string | null;
  author: string | null;
  sourceName: string | null;
  postedAt: string | null;
  /** 'coingecko' for news articles, 'x' for @tokens posts. */
  feedSource: string | null;
  /**
   * Raw CoinGecko coin ids the feed tagged on this story (e.g. "chainlink").
   * These do NOT map 1:1 to this app's tradeable catalog and contain noise, so
   * they're only used as candidate search terms — see {@link deriveNewsSearchTerms}.
   */
  relatedCoinIds: string[];
};

function normalizeNewsItem(value: unknown): NewsItem | null {
  if (!isRecord(value)) return null;
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  if (!title || !url) return null;
  const relatedCoinIds = Array.isArray(value.related_coin_ids)
    ? value.related_coin_ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
  return {
    title,
    url,
    imageUrl: typeof value.image === 'string' && value.image.trim() ? value.image.trim() : null,
    author: typeof value.author === 'string' && value.author.trim() ? value.author.trim() : null,
    sourceName:
      typeof value.source_name === 'string' && value.source_name.trim()
        ? value.source_name.trim()
        : null,
    postedAt: typeof value.posted_at === 'string' ? value.posted_at : null,
    feedSource: typeof value.feed_source === 'string' ? value.feed_source : null,
    relatedCoinIds,
  };
}

/**
 * Fetch the tokens.xyz news feed for an asset (token mode) via the backend
 * proxy `/api/tokens/news`. Pass the stock's symbol + name to scope the feed;
 * returns [] on any failure so the News tab degrades gracefully.
 */
export async function getTokenNews(params: {
  symbol?: string | null;
  name?: string | null;
  assetId?: string | null;
  coinId?: string | null;
  limit?: number;
}): Promise<NewsItem[]> {
  const query: Record<string, string> = {};
  if (params.symbol?.trim()) query.symbol = params.symbol.trim();
  if (params.name?.trim()) query.name = params.name.trim();
  if (params.assetId?.trim()) query.assetId = params.assetId.trim();
  if (params.coinId?.trim()) query.coinId = params.coinId.trim();
  if (params.limit) query.limit = String(params.limit);

  try {
    const payload = await requestJson<unknown>('/api/tokens/news', { params: query });
    const items = isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
    return items.map(normalizeNewsItem).filter((n): n is NewsItem => n !== null);
  } catch {
    return [];
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Common words pulled out of headlines / coin ids that aren't useful search
// terms and would otherwise produce irrelevant catalog hits.
const NEWS_TERM_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'will', 'have', 'has', 'are', 'was',
  'were', 'token', 'tokens', 'coin', 'coins', 'crypto', 'could', 'would', 'should', 'about',
  'into', 'over', 'after', 'before', 'amid', 'says', 'new', 'price', 'market', 'markets',
  'update', 'launch', 'launches', 'report', 'reports', 'news', 'usd', 'its', 'their', 'here',
  'there', 'what', 'when', 'where', 'global', 'banks', 'bank', 'first', 'world', 'union',
]);

/**
 * Derive a small set of high-signal search terms from a news item so we can look
 * up *tradeable* assets related to the story. tokens.xyz `related_coin_ids` are
 * CoinGecko ids (e.g. "chainlink", plus noise like "h" / "could" / "2026-token")
 * that don't map to this app's catalog, so we combine the cleaner ones with
 * $TICKERS and capitalized proper nouns pulled from the headline.
 */
export function deriveNewsSearchTerms(item: NewsItem): string[] {
  const terms = new Set<string>();
  const title = item.title ?? '';

  // $TICKER mentions ($BTC, $NVDA…).
  for (const m of title.matchAll(/\$([A-Za-z]{1,6})\b/g)) {
    terms.add(m[1].toLowerCase());
  }

  // Capitalized proper-noun runs ("Chainlink", "JPMorgan", "Global Banks").
  for (const m of title.matchAll(/\b([A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]+){0,2})\b/g)) {
    const phrase = m[1].trim();
    const first = phrase.split(/\s+/)[0].toLowerCase();
    if (!NEWS_TERM_STOPWORDS.has(first)) terms.add(phrase.toLowerCase());
  }

  // Cleaner related_coin_ids: strip trailing "-<n>" suffixes, drop short/numeric junk.
  for (const raw of item.relatedCoinIds) {
    const id = raw.toLowerCase().replace(/-\d+$/, '').replace(/-/g, ' ').trim();
    if (id.length < 4 || /\d/.test(id) || NEWS_TERM_STOPWORDS.has(id)) continue;
    terms.add(id);
  }

  return Array.from(terms).slice(0, 5);
}

/**
 * Fetch tradeable assets from this app's catalog that are related to a news item.
 * Runs the derived headline terms through the tokens.xyz catalog search and keeps
 * only assets whose symbol or a significant word of their name actually appears
 * in the headline — so an unrelated search hit doesn't leak in. Returns [] when
 * nothing matches (the News modal then just shows the article link).
 */
export async function getRelatedStocksForNews(
  item: NewsItem,
  options: { limit?: number } = {},
): Promise<Stock[]> {
  const terms = deriveNewsSearchTerms(item);
  if (terms.length === 0) return [];

  const haystack = (item.title ?? '').toLowerCase();
  const limit = options.limit ?? 6;

  const results = await Promise.all(
    terms.map((q) => getTopHolderStocks({ q, limit: 5 }).catch(() => [] as Stock[])),
  );

  const byId = new Map<string, Stock>();
  for (const list of results) {
    for (const stock of list) {
      if (byId.has(stock.id)) continue;
      const symbol = stock.symbol?.toLowerCase() ?? '';
      const nameWords = (stock.name ?? '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !NEWS_TERM_STOPWORDS.has(w));
      const symbolHit =
        symbol.length >= 2 && new RegExp(`\\b${escapeRegExp(symbol)}\\b`).test(haystack);
      const nameHit = nameWords.some((w) => haystack.includes(w));
      if (symbolHit || nameHit) byId.set(stock.id, stock);
    }
  }

  return Array.from(byId.values()).slice(0, limit);
}

export type TweetOembedData = {
  authorName: string;
  authorHandle: string;
  avatarUrl: string;
  text: string;
  date: string;
  url: string;
  postedAt: string;
};

const X_STATUS_URL_RE = /(?:https?:\/\/)?(?:www\.|mobile\.|m\.)?(?:twitter|x)\.com\/[^\s<>"']+/gi;

function normalizeTweetStatusUrl(rawUrl: string): string | null {
  const candidate = rawUrl.trim().replace(/[),.;!?]+$/g, '');
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;

  try {
    const url = new URL(withProtocol);
    const host = url.hostname.toLowerCase().replace(/^(www|mobile|m)\./, '');
    if (host !== 'x.com' && host !== 'twitter.com') return null;

    const statusMatch =
      url.pathname.match(/^\/([^/]+)\/status(?:es)?\/(\d+)/i) ??
      url.pathname.match(/^\/i\/web\/status\/(\d+)/i);
    if (!statusMatch) return null;

    const handle = statusMatch.length > 2 ? statusMatch[1] : null;
    const id = statusMatch.length > 2 ? statusMatch[2] : statusMatch[1];
    return handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`;
  } catch {
    return null;
  }
}

export function getTweetStatusUrl(input: string | null | undefined): string | null {
  if (!input) return null;

  const exact = normalizeTweetStatusUrl(input);
  if (exact) return exact;

  const matches = input.match(X_STATUS_URL_RE);
  if (!matches) return null;

  for (const match of matches) {
    const normalized = normalizeTweetStatusUrl(match);
    if (normalized) return normalized;
  }

  return null;
}

function decodeTweetHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ');
}

function parseTweetHtml(html: string): { text: string; date: string } {
  const pMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  let text = '';
  if (pMatch) {
    text = decodeTweetHtml(pMatch[1]
      .replace(/<a[^>]*href="https?:\/\/(t\.co|pic\.twitter\.com)[^"]*"[^>]*>[^<]*<\/a>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
  }
  const aMatches = [...html.matchAll(/<a[^>]*>([^<]+)<\/a>/g)];
  const date = aMatches.length > 0 ? decodeTweetHtml(aMatches[aMatches.length - 1][1] ?? '').trim() : '';
  return { text, date };
}

export async function getTweetOembed(tweetUrl: string, postedAt = ''): Promise<TweetOembedData | null> {
  try {
    const statusUrl = getTweetStatusUrl(tweetUrl) ?? tweetUrl;
    const res = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(statusUrl)}&omit_script=true&dnt=true`,
    );
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    const authorName = typeof data.author_name === 'string' ? data.author_name : '';
    const authorUrl = typeof data.author_url === 'string' ? data.author_url : '';
    const rawHandle = authorUrl.split('/').filter(Boolean).pop() ?? '';
    const authorHandle = rawHandle ? `@${rawHandle}` : '';
    const avatarUrl = rawHandle ? `https://unavatar.io/twitter/${rawHandle}` : '';
    const html = typeof data.html === 'string' ? data.html : '';
    const title = typeof data.title === 'string' ? decodeTweetHtml(data.title).trim() : '';
    const { text, date } = parseTweetHtml(html);
    return { authorName, authorHandle, avatarUrl, text: text || title, date, url: statusUrl, postedAt };
  } catch {
    return null;
  }
}

export async function getTokenContent(mint: string): Promise<TokenContent | null> {
  const results = await getTokenContents([mint]);
  return results[0] ?? null;
}

// Token content (tweets / news summaries) is near-static, but the detail screen
// re-fetches it on every sheet open — each call hits Jupiter's `tokens/v2/content`
// endpoint, which shares the same rate-limit bucket as the trade-critical swap
// build. Cache per mint-set for 5 minutes so reopening a stock doesn't burn that
// budget. Keeps Jupiter headroom for buy/sell execution.
const TOKEN_CONTENT_TTL_MS = 5 * 60_000;
const tokenContentCache = new Map<string, { value: TokenContent[]; ts: number }>();

export async function getTokenContents(mints: string[]): Promise<TokenContent[]> {
  if (mints.length === 0) return [];

  const cacheKey = [...mints].sort().join(',');
  const cached = tokenContentCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TOKEN_CONTENT_TTL_MS) {
    return cached.value;
  }

  try {
    const payload = await requestJson<{ data?: unknown[] }>('/api/jupiter/content', {
      method: 'POST',
      body: { mints },
    });
    const rows = payload?.data;
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const toSummary = (val: unknown) => {
      if (!isRecord(val)) return null;
      const short = typeof val.summaryShort === 'string' ? val.summaryShort : '';
      const full = typeof val.summaryFull === 'string' ? val.summaryFull : '';
      const updatedAt = typeof val.updatedAt === 'string' ? val.updatedAt : '';
      return short || full ? { summaryShort: short, summaryFull: full, updatedAt } : null;
    };

    const result = rows.filter(isRecord).map((row, i) => {
      const contents: TokenContentItem[] = Array.isArray(row.contents)
        ? (row.contents as unknown[]).filter(isRecord).map((c) => ({
            contentId: typeof c.contentId === 'string' ? c.contentId : '',
            content: typeof c.content === 'string' ? c.content : '',
            contentType: typeof c.contentType === 'string' ? c.contentType : '',
            postedAt: typeof c.postedAt === 'string' ? c.postedAt : '',
          })).filter((c) => c.content)
        : [];
      return {
        mint: typeof row.mint === 'string' ? row.mint : (mints[i] ?? ''),
        contents,
        newsSummary: toSummary(row.newsSummary),
        tokenSummary: toSummary(row.tokenSummary),
      };
    });
    tokenContentCache.set(cacheKey, { value: result, ts: Date.now() });
    if (tokenContentCache.size > 64) {
      const oldest = tokenContentCache.keys().next().value;
      if (oldest !== undefined) tokenContentCache.delete(oldest);
    }
    return result;
  } catch {
    return [];
  }
}

// ── Like → Sandwich → Buy: X connection + auto-buy config (Parts 2/3) ────────

export type XConnectionStatus = {
  connected: boolean;
  xHandle: string | null;
  likesSubscribed: boolean;
};

export async function getXConnection(): Promise<XConnectionStatus> {
  return requestJson<XConnectionStatus>('/api/x/connect');
}

/**
 * Start the X OAuth 2.0 + PKCE authorize flow for like-tracking. `like.create`
 * is a private Activity event, so X delivers it only for users who granted
 * Bread the `like.read` scope through OAuth 2.0 — a dedicated grant, separate
 * from Privy login. Returns the URL to open in a browser; X redirects back to
 * `callbackUrl` with `code` + `state`.
 */
export async function startXOauth2(): Promise<{ authorizeUrl: string; callbackUrl: string }> {
  return requestJson('/api/x/oauth2/start', { method: 'POST', timeoutMs: 30_000 });
}

/** Finish the flow: exchange the code and create the like subscription. */
export async function completeXOauth2(args: {
  code: string;
  state: string;
}): Promise<{ connected: boolean; xHandle: string | null; likesSubscribed: boolean; subscriptionError?: string | null }> {
  return requestJson('/api/x/oauth2/complete', { method: 'POST', body: args, timeoutMs: 30_000 });
}

export async function disconnectX(): Promise<void> {
  await requestJson('/api/x/connect', { method: 'DELETE' });
}

/**
 * Pull the linked X account's following list (`GET /2/users/:id/following`,
 * needs the `follows.read` scope on the OAuth 2.0 grant) so the server can
 * auto-follow anyone already on Bread and weight the feed toward the creators
 * the user already reads on X.
 */
export async function syncXFollowing(): Promise<{ imported: number; matchedOnBread: number }> {
  return requestJson('/api/x/following/sync', { method: 'POST', timeoutMs: 60_000 });
}

export type AutoBuyMode = 'confirm' | 'auto';

export type AutoBuyConfig = {
  enabled: boolean;
  amountUsdc: number;
  perTradeCapUsdc: number;
  dailyCapUsdc: number;
  slippageBps: number;
  mode: AutoBuyMode;
  autoCreate: boolean;
  autoBuy: boolean;
  minConfidence: number;
  delegationStatus: 'none' | 'active' | 'revoked';
  delegatedWallet: string | null;
};

export async function getAutoBuyConfig(): Promise<AutoBuyConfig> {
  return requestJson<AutoBuyConfig>('/api/auto-buy/config');
}

export async function updateAutoBuyConfig(
  updates: Partial<Omit<AutoBuyConfig, 'delegationStatus' | 'delegatedWallet'>>,
): Promise<AutoBuyConfig> {
  return requestJson<AutoBuyConfig>('/api/auto-buy/config', { method: 'PATCH', body: updates });
}

/** Record the Privy delegation server-side AFTER delegateWallet succeeds in-app. */
export async function registerAutoBuyDelegation(): Promise<{ delegationStatus: string }> {
  return requestJson('/api/auto-buy/delegation', { method: 'POST', timeoutMs: 30_000 });
}

export async function revokeAutoBuyDelegation(): Promise<{ delegationStatus: string }> {
  return requestJson('/api/auto-buy/delegation', { method: 'DELETE' });
}

export type PendingLikeBuy = {
  likeEventId: string;
  tweetId: string;
  receivedAt: string;
  sandwich: {
    id: string;
    name: string;
    summary: string;
    legs: { label: string; symbol: string | null; weightBps: number }[];
  } | null;
};

export async function getPendingLikeBuys(): Promise<PendingLikeBuy[]> {
  const result = await requestJson<{ pending: PendingLikeBuy[] }>('/api/auto-buy/pending');
  return result.pending ?? [];
}

export async function dismissPendingLikeBuy(likeEventId: string): Promise<void> {
  await requestJson('/api/auto-buy/pending', { method: 'DELETE', body: { likeEventId } });
}

export async function registerExpoPushToken(
  token: string,
  platform: string,
): Promise<void> {
  await requestJson('/api/notifications/push-token', {
    method: 'POST',
    body: {
      token,
      platform,
      // The server can't know the user's timezone, and without it quiet hours
      // are skipped entirely rather than applied against a guess.
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
    },
  });
}

// ── Notification inbox ─────────────────────────────────────────────────────

export type NotificationCategory = 'social' | 'money' | 'market' | 'product';

export type AppNotification = {
  id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  actor: {
    id: string;
    username: string | null;
    name: string | null;
    avatarUrl: string | null;
    privyUserId: string;
  } | null;
  actorCount: number;
  entityType: string | null;
  entityId: string | null;
  /** Where tapping this notification goes. Unknown routes fall back to the inbox. */
  target: { route: string; params: Record<string, string> };
  /**
   * Structured facts behind the copy (ticker, amount, move, origin). Null on
   * rows written before the social-copy rollout; see
   * docs/notification-copy-spec.md §3.
   */
  meta?: NotificationMeta | null;
  read: boolean;
  createdAt: string;
};

export type NotificationMeta = {
  legCount?: number;
  topLeg?: { ticker: string; pct: number } | null;
  hook?: string | null;
  symbol?: string;
  relevanceScore?: number;
  takeId?: string;
  signal?: 'adding' | 'holding' | 'trimming' | null;
  stamp?: { pct: number; ageDays: number; closed: boolean };
  ticker?: string;
  tickers?: string[];
  amountUsd?: number;
  pct?: number;
  direction?: 'long' | 'short' | 'buy' | 'sell';
  venue?: 'spot' | 'perp';
  origin?: { name: string | null; handle: string | null; platform: string } | null;
  sandwichName?: string;
  catalyst?: string | null;
  groupedActorCount?: number;
};

export type NotificationPage = {
  notifications: AppNotification[];
  nextCursor: string | null;
  unreadCount: number;
};

export async function getNotifications(options?: {
  cursor?: string | null;
  limit?: number;
  category?: NotificationCategory | null;
  unreadOnly?: boolean;
}): Promise<NotificationPage> {
  const params: Record<string, string> = {};
  if (options?.cursor) params.cursor = options.cursor;
  if (options?.limit) params.limit = String(options.limit);
  if (options?.category) params.category = options.category;
  if (options?.unreadOnly) params.unread = '1';
  return requestJson<NotificationPage>('/api/notifications', { params });
}

/**
 * Marks rows read (`ids` or `all`), or — with neither — marks everything seen,
 * which clears the badge without claiming the user read anything.
 */
export async function markNotificationsRead(input?: {
  ids?: string[];
  all?: boolean;
}): Promise<{ updated: number; unreadCount: number }> {
  return requestJson('/api/notifications/read', {
    method: 'POST',
    body: input ?? {},
  });
}

/** Band widths offered for position P&L alerts. Mirrors the server's list. */
export const POSITION_ALERT_STEPS = [5, 10, 20, 25, 50] as const;

export type NotificationPreferences = {
  socialTrades: boolean;
  marketMoves: boolean;
  marketPulse: boolean;
  marketPulseBudget: number;
  pushEnabled: boolean;
  social: boolean;
  money: boolean;
  market: boolean;
  product: boolean;
  /** "Your sandwich is up 10%" alerts, and the band width that drives them. */
  positionAlerts: boolean;
  positionAlertStepPct: number;
  quietHoursEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  timezoneOffsetMinutes: number | null;
};

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const result = await requestJson<{ preferences: NotificationPreferences }>(
    '/api/notifications/preferences',
  );
  return { ...result.preferences, socialTrades: result.preferences.socialTrades ?? true, marketMoves: result.preferences.marketMoves ?? true, marketPulse: result.preferences.marketPulse ?? true, marketPulseBudget: result.preferences.marketPulseBudget ?? 3 };
}

export async function updateNotificationPreferences(
  updates: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const result = await requestJson<{ preferences: NotificationPreferences }>(
    '/api/notifications/preferences',
    { method: 'PATCH', body: updates },
  );
  return { ...result.preferences, socialTrades: result.preferences.socialTrades ?? true, marketMoves: result.preferences.marketMoves ?? true, marketPulse: result.preferences.marketPulse ?? true, marketPulseBudget: result.preferences.marketPulseBudget ?? 3 };
}

export async function unregisterExpoPushToken(token: string): Promise<void> {
  await requestJson('/api/notifications/push-token', {
    method: 'DELETE',
    body: { token },
  });
}

/** Pre-trade slippage for one leg, as computed by the backend. */
export type LegSlippage = {
  legId: string;
  symbol: string | null;
  mint: string;
  amountUsdc: number;
  /** Tokens expected at the quoted route price, already in display units. */
  expectedReceived: number | null;
  /** Least tokens the swap accepts before it reverts on-chain. */
  minReceived: number | null;
  slippageBps: number | null;
  priceImpactPct: number | null;
  /** Worst-case shortfall vs expected, as a percentage. */
  maxSlippagePct: number | null;
  /** RFQ legs are firm maker quotes with no slippage band. */
  firmQuote: boolean;
};

export type BasketSlippage = {
  legs: LegSlippage[];
  totalUsdc: number;
  /** Worst case across the basket, weighted by each leg's share of the spend. */
  worstCaseSlippagePct: number | null;
  maxPriceImpactPct: number | null;
  unpricedLegs: number;
};

export type BasketBuyStart =
  | {
      status: 'needs_signature';
      basketRunId: string;
      transactions: string[];
      legs: {
        legId: string;
        symbol: string | null;
        mint: string;
        amountUsdc: string;
        weightBps: number;
        /** Token base units quoted for this entry. Kept so a position can be
         * valued from the buyer's own entry rather than the sandwich's age. */
        quotedOutRaw?: string | null;
        decimals?: number | null;
        route?: 'rpc' | 'ultra' | 'perp' | null;
      }[];
      /** Spot buys only; perps price through Phoenix and use `preview`. */
      slippage?: BasketSlippage | null;
      preview?: PerpSandwichBuyPreview | PerpSandwichSetupPreview;
      action?: 'setup' | 'open' | 'sell' | 'close';
      atomic?: boolean;
      /**
       * Set on the perp path, where the app submits the transaction itself and
       * needs a bound on how long it can still land.
       */
      lastValidBlockHeight?: number;
    }
  | { status: 'failed'; basketRunId: string | null; code: string; reason: string };

export type PerpSandwichBuyPreview = {
  pdaIndex: number;
  marginUsd: number;
  notionalUsd: number;
  leverage: number;
  stopLossPct: number;
  cashMovedUsd: number;
  estimatedTakerFeeUsd: number;
  /** Null on the entry path — the backend no longer estimates it there. */
  estimatedFundingUsd: number | null;
  fundingHorizonDays: number;
  legs: {
    legId: string;
    symbol: string;
    side: 'long' | 'short';
    weightBps: number;
    marginUsd: number;
    notionalUsd: number;
    markPrice: number;
    stopLossPrice: number;
    liquidationPrice: number;
    maxLeverageForSize: number;
  }[];
};

export type PerpSandwichSetupPreview = {
  setupRequired: true;
  pdaIndex: number;
};

/** Withdraw every currently-free dollar of perps collateral back to wallet USDC. */
export async function buildPhoenixWithdrawAll(): Promise<{
  transaction: string;
  lastValidBlockHeight?: number;
  amountUsd: number;
}> {
  return requestJson('/api/phoenix/collateral/withdraw/build', {
    method: 'POST',
    // The server sizes it from its own read. After a close the free balance is
    // only settled once the reduce-only fill has cleared PnL and fees, so a
    // figure computed here would be racing that settlement.
    body: { all: true },
    timeoutMs: 30_000,
  });
}

/** Confirm-mode basket buy: returns unsigned bundle txs for the wallet to sign. */
export async function startSandwichBasketBuy(
  sandwichId: string,
  amountUsdc: number,
  likeEventId?: string,
  opts?: {
    /**
     * A keypad pre-build fired before any tap. The server refuses it with
     * `code: 'busy'` (HTTP 200) when Jupiter's shared bucket is queueing, so a
     * speculative build never takes capacity from a real trade.
     */
    speculative?: boolean;
  },
): Promise<BasketBuyStart> {
  return requestJson(`/api/sandwiches/${encodeURIComponent(sandwichId)}/buy`, {
    method: 'POST',
    body: { amountUsdc, likeEventId, ...(opts?.speculative ? { speculative: true } : {}) },
    timeoutMs: 30_000,
  });
}

/** Confirm-mode Phoenix buy. Venue is intentionally absent; the server derives it. */
export async function startPerpSandwichBuy(
  sandwichId: string,
  marginUsdc: number,
  leverage: number,
  stopLossPct: number,
): Promise<BasketBuyStart> {
  return requestJson(`/api/sandwiches/${encodeURIComponent(sandwichId)}/buy`, {
    method: 'POST',
    body: { marginUsdc, leverage, stopLossPct },
    timeoutMs: 30_000,
  });
}

/**
 * Prepare a proportional exit from a spot sandwich.
 *
 * One request for the whole basket: the server quotes every leg concurrently
 * and packs them into as few transactions as they fit, so the app signs once
 * instead of walking the legs one at a time. `fractionBps` applies to the
 * wallet's on-chain balance of each leg, capped at what the position bought, so
 * 10000 is a full exit.
 *
 * Rejects with `ApiError` status 409 when the wallet holds nothing but a
 * rounding remainder of the position: it was already sold some other way. The
 * server closes the record before answering, so callers treat that as a
 * completed exit — see `isAlreadyExitedError`.
 */
export async function startSandwichSell(
  sandwichId: string,
  fractionBps: number,
): Promise<BasketBuyStart> {
  return requestJson(`/api/sandwiches/${encodeURIComponent(sandwichId)}/sell`, {
    method: 'POST',
    body: { fractionBps },
    timeoutMs: 30_000,
  });
}

/**
 * Did the sell fail because there was nothing left to sell?
 *
 * Not an error the user can act on: the position is gone and the server has
 * just reconciled the record to say so. Surfacing it as a red failure would ask
 * them to retry a sale that cannot and should not happen — and retrying it is
 * what used to sell the remainder and record a tenth of a cent as the exit.
 */
export function isAlreadyExitedError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    (error.body as { code?: unknown } | null)?.code === 'position_already_exited'
  );
}

export type PerpSandwichPosition = {
  id: string;
  venue: 'perp';
  status: string;
  pdaIndex: number;
  accountMode: 'legacy_pda' | 'isolated_pool';
  actionableStatus: 'close' | 'move_collateral' | 'none';
  marginUsdc: number | null;
  leverage: number | null;
  stopLossPct: number | null;
  pnlAfterFundingUsd: number;
  unrealizedPnlUsd: number;
  unsettledFundingUsd: number;
  withdrawableUsd: number | null;
  effectiveCollateralUsd: number | null;
  collateralBalanceUsd: number | null;
  /** Set when the live Phoenix read failed, so every figure here is a fallback. */
  readError: string | null;
  sandwich: {
    id: string;
    name: string;
    horizon: string;
    venue: string;
    /** Short headline for the moment behind this position — the row's title. */
    headline: string | null;
    speakerName: string | null;
    source: {
      sourceType: string;
      url: string | null;
      videoId: string | null;
      authorHandle: string | null;
      authorName: string | null;
      /** Offset into the episode. Only ever set for podcast sources. */
      startMs: number | null;
    };
  };
  legs: {
    symbol: string;
    side: string;
    subaccountIndex: number | null;
    weightBps: number;
    /** Tokenized mint of the underlying, for the asset logo. */
    mint: string | null;
    /** Tokenized symbol (AAPLx) beside Phoenix's underlying (AAPL). */
    tokenSymbol: string | null;
    /** Where in the episode this leg's argument was made. */
    startMs: number | null;
    marginUsdc: number | null;
    notionalUsd: number | null;
    positionSize: number;
    entryPrice: number | null;
    markPrice: number | null;
    stopLossPrice: number | null;
    liquidationPrice: number | null;
    unrealizedPnlUsd: number;
    unsettledFundingUsd: number;
    accumulatedFundingUsd: number;
    pnlAfterFundingUsd: number;
  }[];
};

/** What a closed position was, so the app can group and label it. */
export type ClosedPositionKind =
  | 'sandwich_spot'
  | 'sandwich_perp'
  | 'phoenix_perp'
  | 'token';

/** Every close of this same token, perp market, or sandwich venue. */
export type ClosedPositionLifetime = {
  closeCount: number;
  knownPnlCount: number;
  latestCloseId: string;
  /** False means the dollar total covers only `knownPnlCount` closes. */
  complete: boolean;
  costUsd: number | null;
  proceedsUsd: number | null;
  realizedPnlUsd: number | null;
  /** Capital-weighted fraction; null unless every close and basis is known. */
  realizedPnlPct: number | null;
};

/**
 * A settled position, whatever venue it was taken on.
 *
 * Every money field is nullable and a null means UNKNOWN, not zero: a basis the
 * server could not recover, or an outcome that was never captured. Rendering a
 * null as $0.00 would claim the user broke even, which is a specific and wrong
 * thing to say — show a dash.
 */
export type ClosedPosition = {
  kind: ClosedPositionKind;
  id: string;
  title: string;
  subtitle: string | null;
  logoUri: string | null;
  symbols: string[];
  mint: string | null;
  sandwichId: string | null;
  openedAt: string | null;
  closedAt: string;
  costUsd: number | null;
  proceedsUsd: number | null;
  realizedPnlUsd: number | null;
  /** Fraction, not percent: 0.4 is +40%. */
  realizedPnlPct: number | null;
  reason: string | null;
  /** Shown beside the return, never multiplied into it. */
  leverage: number | null;
  /** Absent when talking to a backend that predates lifetime aggregation. */
  lifetime?: ClosedPositionLifetime | null;
  /**
   * Present for sandwich rows only. Carries what the open Holdings card draws —
   * the cited account, the builder, the moment, the leg artwork — so a closed
   * sandwich renders as the same card rather than a stripped-down line.
   */
  sandwich: ClosedSandwichMeta | null;
};

export type ClosedSandwichMeta = {
  headline: string | null;
  /** The thesis as the feed card words it. Absent from older servers. */
  thesisText: string | null;
  speakerName: string | null;
  summary: string;
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  videoId: string | null;
  startMs: number | null;
  endMs: number | null;
  authorHandle: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  builderName: string | null;
  builderUsername: string | null;
  builderAvatarUrl: string | null;
  legIcons: (string | null)[];
};

export type ClosedPositionsPage = {
  positions: ClosedPosition[];
  nextCursor: string | null;
  summary: {
    totalRealizedUsd: number | null;
    closedCount: number;
    /** Null until there are enough results for a rate to mean anything. */
    winRate: number | null;
    requiredForWinRate: number;
  };
};

export type PositionFill = {
  id: string;
  side: 'entry' | 'exit';
  occurredAt: string;
  amountUsd: number | null;
  quantity: number | null;
  priceUsd: number | null;
};

export type PositionChartLeg = {
  id: string;
  type: 'tokenized_stock' | 'prediction_market' | 'perp';
  mint: string | null;
  marketId: string | null;
  symbol: string | null;
  label: string;
  side: string | null;
  weightBps: number;
};

export type PositionDetail = Omit<ClosedPosition, 'closedAt'> & {
  state: 'open' | 'closed';
  closedAt: string | null;
  fills: PositionFill[];
  avgEntryPriceUsd: number | null;
  avgExitPriceUsd: number | null;
  chart: {
    openedAt: string | null;
    closedAt: string | null;
    legs: PositionChartLeg[];
  };
};

const CLOSED_POSITION_KINDS: ClosedPositionKind[] = [
  'sandwich_spot',
  'sandwich_perp',
  'phoenix_perp',
  'token',
];

function normalizeClosedPosition(value: unknown): ClosedPosition | null {
  if (!isRecord(value)) return null;
  const kind = CLOSED_POSITION_KINDS.find((candidate) => candidate === value.kind);
  if (!kind) return null;
  if (typeof value.id !== 'string' || typeof value.closedAt !== 'string') return null;
  return {
    kind,
    id: value.id,
    title: typeof value.title === 'string' ? value.title : value.id,
    subtitle: typeof value.subtitle === 'string' ? value.subtitle : null,
    logoUri: typeof value.logoUri === 'string' ? value.logoUri : null,
    symbols: Array.isArray(value.symbols)
      ? value.symbols.filter((entry): entry is string => typeof entry === 'string')
      : [],
    mint: typeof value.mint === 'string' ? value.mint : null,
    sandwichId: typeof value.sandwichId === 'string' ? value.sandwichId : null,
    openedAt: typeof value.openedAt === 'string' ? value.openedAt : null,
    closedAt: value.closedAt,
    costUsd: toNullableNumber(value.costUsd),
    proceedsUsd: toNullableNumber(value.proceedsUsd),
    realizedPnlUsd: toNullableNumber(value.realizedPnlUsd),
    realizedPnlPct: toNullableNumber(value.realizedPnlPct),
    reason: typeof value.reason === 'string' ? value.reason : null,
    leverage: toNullableNumber(value.leverage),
    lifetime: normalizeClosedPositionLifetime(value.lifetime),
    sandwich: normalizeClosedSandwichMeta(value.sandwich),
  };
}

function normalizeClosedPositionLifetime(value: unknown): ClosedPositionLifetime | null {
  if (!isRecord(value)) return null;
  const closeCount = toNumber(value.closeCount);
  const knownPnlCount = toNumber(value.knownPnlCount);
  if (
    closeCount === null ||
    knownPnlCount === null ||
    typeof value.latestCloseId !== 'string'
  ) return null;
  return {
    closeCount,
    knownPnlCount,
    latestCloseId: value.latestCloseId,
    complete: value.complete === true,
    costUsd: toNullableNumber(value.costUsd),
    proceedsUsd: toNullableNumber(value.proceedsUsd),
    realizedPnlUsd: toNullableNumber(value.realizedPnlUsd),
    realizedPnlPct: toNullableNumber(value.realizedPnlPct),
  };
}

function normalizeClosedSandwichMeta(value: unknown): ClosedSandwichMeta | null {
  if (!isRecord(value)) return null;
  const str = (key: string): string | null =>
    typeof value[key] === 'string' ? (value[key] as string) : null;
  return {
    headline: str('headline'),
    thesisText: str('thesisText'),
    speakerName: str('speakerName'),
    summary: str('summary') ?? '',
    sourceId: str('sourceId'),
    sourceType: str('sourceType'),
    sourceUrl: str('sourceUrl'),
    videoId: str('videoId'),
    startMs: toNullableNumber(value.startMs),
    endMs: toNullableNumber(value.endMs),
    authorHandle: str('authorHandle'),
    authorName: str('authorName'),
    authorAvatarUrl: str('authorAvatarUrl'),
    builderName: str('builderName'),
    builderUsername: str('builderUsername'),
    builderAvatarUrl: str('builderAvatarUrl'),
    legIcons: Array.isArray(value.legIcons)
      ? value.legIcons.map((icon) => (typeof icon === 'string' ? icon : null))
      : [],
  };
}

function normalizePositionFill(value: unknown): PositionFill | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.occurredAt !== 'string') {
    return null;
  }
  const side = value.side === 'exit' ? 'exit' : value.side === 'entry' ? 'entry' : null;
  if (!side) return null;
  return {
    id: value.id,
    side,
    occurredAt: value.occurredAt,
    amountUsd: toNullableNumber(value.amountUsd),
    quantity: toNullableNumber(value.quantity),
    priceUsd: toNullableNumber(value.priceUsd),
  };
}

function normalizePositionChartLeg(value: unknown): PositionChartLeg | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string') {
    return null;
  }
  const type =
    value.type === 'perp'
      ? 'perp'
      : normalizeSandwichLegType(value.type);
  if (!type) return null;
  return {
    id: value.id,
    type,
    mint: typeof value.mint === 'string' ? value.mint : null,
    marketId: typeof value.marketId === 'string' ? value.marketId : null,
    symbol: typeof value.symbol === 'string' ? value.symbol : null,
    label: value.label,
    side: typeof value.side === 'string' ? value.side : null,
    weightBps: toNumber(value.weightBps) ?? 0,
  };
}

export function normalizePositionDetail(value: unknown): PositionDetail | null {
  if (!isRecord(value)) return null;
  const closed = normalizeClosedPosition({
    ...value,
    closedAt:
      typeof value.closedAt === 'string'
        ? value.closedAt
        : typeof value.openedAt === 'string'
          ? value.openedAt
          : '',
  });
  if (!closed || !isRecord(value.chart)) return null;
  return {
    ...closed,
    state: value.state === 'open' ? 'open' : 'closed',
    closedAt: typeof value.closedAt === 'string' ? value.closedAt : null,
    fills: Array.isArray(value.fills)
      ? value.fills
          .map(normalizePositionFill)
          .filter((fill): fill is PositionFill => fill !== null)
          .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      : [],
    avgEntryPriceUsd: toNullableNumber(value.avgEntryPriceUsd),
    avgExitPriceUsd: toNullableNumber(value.avgExitPriceUsd),
    chart: {
      openedAt: typeof value.chart.openedAt === 'string' ? value.chart.openedAt : null,
      closedAt: typeof value.chart.closedAt === 'string' ? value.chart.closedAt : null,
      legs: Array.isArray(value.chart.legs)
        ? value.chart.legs
            .map(normalizePositionChartLeg)
            .filter((leg): leg is PositionChartLeg => leg !== null)
        : [],
    },
  };
}

/**
 * One page of the user's closed history, newest first.
 *
 * Paged by CARD: a sandwich collapses many legs into one row, so a page is
 * counted in rows the user sees rather than in positions the server stored.
 */
export async function getClosedPositions(options?: {
  limit?: number;
  cursor?: string | null;
  /**
   * Narrow to one asset's own trades (its token round trips and standalone
   * perps; never a Sandwich). Filtered server-side so the asset's history is
   * not cut off by the page limit of the whole list.
   */
  asset?: { mint?: string | null; symbol?: string | null } | null;
}): Promise<ClosedPositionsPage> {
  await settlePendingTradeRecords();
  const payload = await requestJson<unknown>('/api/holdings/closed', {
    params: {
      ...(options?.limit ? { limit: String(options.limit) } : {}),
      ...(options?.cursor ? { cursor: options.cursor } : {}),
      ...(options?.asset?.mint ? { mint: options.asset.mint } : {}),
      ...(options?.asset?.symbol ? { symbol: options.asset.symbol } : {}),
    },
  });
  return parseClosedPositionsPage(payload);
}

/** One page of settled positions, from either the private or the public route. */
function parseClosedPositionsPage(payload: unknown): ClosedPositionsPage {
  const positions = isRecord(payload) && Array.isArray(payload.positions)
    ? payload.positions
        .map(normalizeClosedPosition)
        .filter((row): row is ClosedPosition => row !== null)
    : [];
  const summary = isRecord(payload) && isRecord(payload.summary) ? payload.summary : null;
  return {
    positions,
    nextCursor:
      isRecord(payload) && typeof payload.nextCursor === 'string' ? payload.nextCursor : null,
    summary: {
      totalRealizedUsd: toNullableNumber(summary?.totalRealizedUsd),
      closedCount:
        typeof summary?.closedCount === 'number' ? summary.closedCount : positions.length,
      winRate: toNullableNumber(summary?.winRate),
      requiredForWinRate:
        typeof summary?.requiredForWinRate === 'number' ? summary.requiredForWinRate : 10,
    },
  };
}

/**
 * A Sandwich position somebody else still has on.
 *
 * The own profile derives this on the device from the wallet's balances; that
 * is impossible for another user, so the server marks it. `valueUsd` is null
 * when a leg could not be priced — unknown, never zero.
 */
export type PublicSandwichHolding = {
  id: string;
  sandwichId: string;
  venue: string;
  title: string;
  subtitle: string | null;
  logoUri: string | null;
  symbols: string[];
  /**
   * The mints this position holds, so the Holdings list can show each balance
   * once. A leg is listed under its Sandwich, never also as a loose token row.
   * Empty from a backend that predates the field, and for perp baskets.
   */
  legMints: string[];
  openedAt: string;
  costUsd: number | null;
  valueUsd: number | null;
  unrealizedPnlUsd: number | null;
  /** Fraction, not percent: 0.4 is +40%. */
  unrealizedPnlPct: number | null;
  leverage: number | null;
  sandwich: ClosedSandwichMeta | null;
};

function normalizePublicSandwichHolding(value: unknown): PublicSandwichHolding | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  if (typeof value.sandwichId !== 'string' || typeof value.openedAt !== 'string') return null;
  return {
    id: value.id,
    sandwichId: value.sandwichId,
    venue: typeof value.venue === 'string' ? value.venue : 'spot',
    title: typeof value.title === 'string' && value.title.trim() ? value.title : 'Sandwich',
    subtitle: typeof value.subtitle === 'string' ? value.subtitle : null,
    logoUri: typeof value.logoUri === 'string' ? value.logoUri : null,
    symbols: Array.isArray(value.symbols)
      ? value.symbols.filter((symbol): symbol is string => typeof symbol === 'string')
      : [],
    legMints: Array.isArray(value.legMints)
      ? value.legMints.filter((mint): mint is string => typeof mint === 'string')
      : [],
    openedAt: value.openedAt,
    costUsd: toNullableNumber(value.costUsd),
    valueUsd: toNullableNumber(value.valueUsd),
    unrealizedPnlUsd: toNullableNumber(value.unrealizedPnlUsd),
    unrealizedPnlPct: toNullableNumber(value.unrealizedPnlPct),
    leverage: toNullableNumber(value.leverage),
    sandwich: normalizeClosedSandwichMeta(value.sandwich),
  };
}

/** The Sandwiches another user still holds. */
export async function getUserSandwichPositions(
  privyUserId: string,
): Promise<PublicSandwichHolding[]> {
  const payload = await requestJson<unknown>(
    `/api/users/${encodeURIComponent(privyUserId)}/positions`,
    { params: { state: 'open' } },
  );
  if (!isRecord(payload) || !Array.isArray(payload.positions)) return [];
  return payload.positions
    .map(normalizePublicSandwichHolding)
    .filter((row): row is PublicSandwichHolding => row !== null);
}

/** Another user's settled history — sandwiches, perps and token round trips. */
export async function getUserClosedPositions(
  privyUserId: string,
  options?: { limit?: number; cursor?: string | null },
): Promise<ClosedPositionsPage> {
  const payload = await requestJson<unknown>(
    `/api/users/${encodeURIComponent(privyUserId)}/positions`,
    {
      params: {
        state: 'closed',
        ...(options?.limit ? { limit: String(options.limit) } : {}),
        ...(options?.cursor ? { cursor: options.cursor } : {}),
      },
    },
  );
  return parseClosedPositionsPage(payload);
}

export async function getClosedPositionDetail(position: Pick<ClosedPosition, 'kind' | 'id'>) {
  const payload = await requestJson<unknown>('/api/holdings/position-detail', {
    params: { kind: position.kind, id: position.id },
  });
  const detail = isRecord(payload) ? normalizePositionDetail(payload.detail) : null;
  if (!detail) throw new ApiError('INVALID_RESPONSE', 'Position detail was unavailable.');
  return detail;
}

export async function getOpenSandwichPositionDetail(sandwichId: string) {
  const payload = await requestJson<unknown>('/api/holdings/position-detail', {
    params: { state: 'open', sandwichId },
  });
  const detail = isRecord(payload) ? normalizePositionDetail(payload.detail) : null;
  if (!detail) throw new ApiError('INVALID_RESPONSE', 'Position detail was unavailable.');
  return detail;
}

export async function getPerpSandwichPositions(): Promise<PerpSandwichPosition[]> {
  const result = await requestJson<{ positions: PerpSandwichPosition[] }>(
    '/api/perp-sandwich-positions',
  );
  return result.positions ?? [];
}

/**
 * Podcast provenance for a sandwich the user holds.
 *
 * Holdings already groups a spot sandwich's legs into one row and hides the
 * loose token rows. What that row could not show is where the position came
 * from — it rendered the generated basket name with no timestamp and opened a
 * generic detail sheet, even when the position came from one moment of an
 * episode. This is the missing half, keyed by sandwich id.
 *
 * The `source` block is deliberately identical to PerpSandwichPosition's, so
 * spot and perp rows can render provenance the same way.
 */
export type SandwichProvenance = {
  sandwichId: string;
  /**
   * What the episode screen recovers itself from — every market of an episode
   * shares it. Routing on this rather than on `postId` keeps the feature
   * independent of the Post backfill.
   */
  sourceId: string;
  /** The card, once one exists. Carried for sharing; routing does not use it. */
  postId: string | null;
  postKind: string | null;
  /** Short headline for the moment behind this position — the row's title. */
  headline: string | null;
  speakerName: string | null;
  source: {
    sourceType: string;
    url: string | null;
    videoId: string | null;
    authorHandle: string | null;
    authorName: string | null;
    /** Offset into the episode. Only ever set for podcast sources. */
    startMs: number | null;
    endMs: number | null;
  };
};

/** Keyed by sandwichId, for merging into the rows Holdings already builds. */
export async function getHeldSandwichProvenance(): Promise<Record<string, SandwichProvenance>> {
  const result = await requestJson<{ provenance: SandwichProvenance[] }>(
    '/api/users/portfolio/sandwich-holdings',
  );
  const rows = result.provenance ?? [];
  return Object.fromEntries(rows.map((row) => [row.sandwichId, row]));
}

export async function startPerpSandwichClose(positionId: string): Promise<BasketBuyStart> {
  return requestJson(`/api/perp-sandwich-positions/${encodeURIComponent(positionId)}/close`, {
    method: 'POST',
    timeoutMs: 30_000,
  });
}

export async function startPerpSandwichWithdrawAll(positionId: string): Promise<BasketBuyStart> {
  return requestJson(`/api/perp-sandwich-positions/${encodeURIComponent(positionId)}/withdraw`, {
    method: 'POST',
    timeoutMs: 30_000,
  });
}

export type BasketBuySubmitResult =
  | { status: 'confirmed'; basketRunId: string; bundleId: string; signatures: string[] }
  /**
   * Some legs landed and some did not — a settled, terminal outcome, NOT an
   * error. Legs are independent swaps, so the user holds `landedLegIds` and was
   * never charged for the rest. Callers must surface the shortfall and must
   * never retry the run, which would buy or sell the landed legs twice.
   */
  | {
      status: 'partial';
      basketRunId: string;
      signatures: string[];
      landedLegIds: string[];
      failedLegIds: string[];
    }
  | { status: 'failed'; basketRunId: string | null; code: string; reason: string };

export async function submitSignedBasketBuy(
  basketRunId: string,
  signedTransactions: string[],
): Promise<BasketBuySubmitResult> {
  return requestJson(`/api/basket-runs/${encodeURIComponent(basketRunId)}/submit`, {
    method: 'POST',
    body: { signedTransactions },
    timeoutMs: 45_000,
  });
}

export type PerpSettleResult =
  | { status: 'confirmed'; basketRunId: string; signatures: string[] }
  | { status: 'settle_pending'; basketRunId: string; signature: string }
  | { status: 'failed'; basketRunId: string | null; code: string; reason: string };

/**
 * Tell the backend how a perp transaction the APP submitted turned out.
 *
 * Perp transactions come back from the build already signed by Bread's payer,
 * so they no longer travel through `/submit` — that route's job is the payer
 * co-signature that only spot baskets need, and routing perps through it put a
 * second HTTP round trip plus a server-held confirmation wait between the user's
 * approval and their fill.
 *
 * This is bookkeeping, not submission: it takes no transaction and no signature
 * (the server recomputes the signature from the bytes it issued), it is
 * idempotent, and a call that never arrives is recovered by the backend's
 * reconciler. Callers must therefore never block the success UI on it.
 */
export async function settlePerpSandwichRun(basketRunId: string): Promise<PerpSettleResult> {
  return requestJson(`/api/basket-runs/${encodeURIComponent(basketRunId)}/settle`, {
    method: 'POST',
    timeoutMs: 20_000,
  });
}

/**
 * A dead token account: one this wallet owns, holding no tokens, and untouched
 * long enough that it is not simply resting between trades. Each one holds
 * ~0.00204 SOL of rent that closing returns.
 */
export type ReclaimableAccount = {
  address: string;
  mint: string;
  programId: string;
  lamports: number;
  idleDays: number | null;
};

export type ReclaimableRent = {
  accounts: ReclaimableAccount[];
  totalLamports: number;
  /** Empty accounts held back because the wallet is still cycling that token. */
  skippedActive: number;
};

export type RentReclaimBuild = {
  transactions: string[];
  accounts: ReclaimableAccount[];
  totalLamports: number;
  lastValidBlockHeight: number;
};

/** What the signed-in wallet could reclaim by closing its dead token accounts. */
export async function getReclaimableRent(): Promise<ReclaimableRent> {
  return requestJson<ReclaimableRent>('/api/wallet/rent', { timeoutMs: 30_000 });
}

/**
 * Unsigned close transactions for the wallet's dead accounts.
 *
 * The wallet is derived server-side from the access token, never passed in —
 * this closes accounts and moves lamports.
 */
export async function buildRentReclaim(): Promise<RentReclaimBuild> {
  return requestJson<RentReclaimBuild>('/api/wallet/rent', {
    method: 'POST',
    timeoutMs: 30_000,
  });
}

// ── Position takes ──────────────────────────────────────────────────────────
//
// A take is what a holder writes WHILE HOLDING — "why I'm in", "still in after
// the dip", "adding here" — attached to the position so the post carries a
// live, verified P&L stamp. See stock-backend docs/notification-copy-spec.md §8.
//
// The take IS a Post, so likes, comments and the feed need nothing new: these
// calls only cover writing one and reading the lists the Post routes cannot.

export type TakeSignal = 'adding' | 'holding' | 'trimming';

/**
 * What the reader is shown beside the text. `closed` flips once the position
 * settles and the take keeps rendering with the realized number — which is how
 * a taker builds a visible record without Bread scoring anyone.
 */
export type TakeStamp = { pct: number; ageDays: number; closed: boolean; closedPct: number | null };

/**
 * Which position a take is attached to. Exactly one shape per take, and the
 * server re-verifies it on write: a take cannot claim a position the author
 * does not hold, or one that is already closed.
 */
export type PositionRef =
  | { kind: 'sandwich'; id: string }
  | { kind: 'perp'; id: string }
  | { kind: 'phoenix'; key: string }
  /**
   * Input-only. Holdings are derived on-device from on-chain balances, so the
   * app never learns the server's position-row id — it sends the basket it is
   * looking at and the server resolves the caller's own open position for it.
   */
  | { kind: 'sandwichId'; id: string };

export type PositionTake = {
  id: string;
  postId: string;
  sandwichId: string;
  body: string;
  signal: TakeSignal | null;
  attachmentUrl: string | null;
  attachmentKind: string | null;
  /**
   * A band, never a number — "$100–1K", or "hidden" when the author turned size
   * off. Direction, return and holding age are always shown; without them a take
   * is just a tweet.
   */
  sizeBand: string;
  stamp: TakeStamp;
  edited: boolean;
  createdAt: string;
  author: { id: string; username: string | null; name: string | null; avatarUrl: string | null };
  holderAgeDays: number;
};

export const MAX_TAKE_LENGTH = 500;

function normalizeTakeStamp(value: unknown): TakeStamp {
  if (!isRecord(value)) return { pct: 0, ageDays: 0, closed: false, closedPct: null };
  return {
    pct: toNumber(value.pct) ?? 0,
    ageDays: toNumber(value.ageDays) ?? 0,
    closed: value.closed === true,
    closedPct: toNumber(value.closedPct),
  };
}

export function normalizePositionTake(value: unknown): PositionTake | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : null;
  const body = typeof value.body === 'string' ? value.body : null;
  if (!id || !body) return null;
  const author = isRecord(value.author) ? value.author : {};
  const signal = value.signal;
  return {
    id,
    postId: typeof value.postId === 'string' ? value.postId : '',
    sandwichId: typeof value.sandwichId === 'string' ? value.sandwichId : '',
    body,
    signal: signal === 'adding' || signal === 'holding' || signal === 'trimming' ? signal : null,
    attachmentUrl: typeof value.attachmentUrl === 'string' ? value.attachmentUrl : null,
    attachmentKind: typeof value.attachmentKind === 'string' ? value.attachmentKind : null,
    sizeBand: typeof value.sizeBand === 'string' ? value.sizeBand : 'unknown',
    stamp: normalizeTakeStamp(value.stamp),
    edited: value.edited === true,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    author: {
      id: typeof author.id === 'string' ? author.id : '',
      username: typeof author.username === 'string' ? author.username : null,
      name: typeof author.name === 'string' ? author.name : null,
      avatarUrl: typeof author.avatarUrl === 'string' ? author.avatarUrl : null,
    },
    holderAgeDays: toNumber(value.holderAgeDays) ?? 0,
  };
}

/** The refusal reasons the composer has to say something specific about. */
export type CreateTakeError =
  | { reason: 'not_open' }
  | { reason: 'not_found' }
  | { reason: 'cooldown'; retryAfterMs: number }
  | { reason: 'other'; message: string };

export type CreateTakeResult =
  | { ok: true; take: { id: string; postId: string; sandwichId: string; stamp: TakeStamp } }
  | ({ ok: false } & CreateTakeError);

/**
 * Write a take. Every refusal is a real product state the composer renders
 * rather than a generic failure: the position closed under them, or they
 * already wrote one this hour.
 */
export async function createPositionTake(input: {
  positionRef: PositionRef;
  body: string;
  signal?: TakeSignal | null;
  attachmentUrl?: string | null;
}): Promise<CreateTakeResult> {
  try {
    const payload = await requestJson<unknown>('/api/position-takes', {
      method: 'POST',
      body: {
        positionRef: input.positionRef,
        body: input.body,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.attachmentUrl ? { attachmentUrl: input.attachmentUrl } : {}),
      },
    });
    const take = isRecord(payload) && isRecord(payload.take) ? payload.take : null;
    if (!take || typeof take.id !== 'string') return { ok: false, reason: 'other', message: 'Could not post that.' };
    return {
      ok: true,
      take: {
        id: take.id,
        postId: typeof take.postId === 'string' ? take.postId : '',
        sandwichId: typeof take.sandwichId === 'string' ? take.sandwichId : '',
        stamp: normalizeTakeStamp(take.stamp),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not post that.';
    if (message.includes('not_open')) return { ok: false, reason: 'not_open' };
    if (message.includes('not_found')) return { ok: false, reason: 'not_found' };
    if (message.includes('cooldown')) {
      const retry = Number(message.match(/"retryAfterMs":\s*(\d+)/)?.[1] ?? 0);
      return { ok: false, reason: 'cooldown', retryAfterMs: Number.isFinite(retry) ? retry : 0 };
    }
    return { ok: false, reason: 'other', message };
  }
}

export async function editPositionTake(
  id: string,
  patch: { body?: string; signal?: TakeSignal | null; attachmentUrl?: string | null },
): Promise<PositionTake | null> {
  const payload = await requestJson<unknown>(`/api/position-takes/${id}`, { method: 'PATCH', body: patch });
  return isRecord(payload) ? normalizePositionTake(payload.take) : null;
}

export async function deletePositionTake(id: string): Promise<boolean> {
  try {
    await requestJson<unknown>(`/api/position-takes/${id}`, { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}

function readTakes(payload: unknown): { takes: PositionTake[]; nextCursor: string | null } {
  if (!isRecord(payload) || !Array.isArray(payload.takes)) return { takes: [], nextCursor: null };
  return {
    takes: payload.takes.flatMap((entry) => {
      const take = normalizePositionTake(entry);
      return take ? [take] : [];
    }),
    nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : null,
  };
}

/** The detail screen's Takes section, oldest holders first. */
export async function getSandwichTakes(
  sandwichId: string,
  cursor?: string | null,
): Promise<{ takes: PositionTake[]; nextCursor: string | null }> {
  return readTakes(
    await requestJson<unknown>(`/api/sandwiches/${sandwichId}/takes`, {
      params: cursor ? { cursor } : undefined,
    }).catch(() => null),
  );
}

export async function getUserTakes(
  privyUserId: string,
  cursor?: string | null,
): Promise<{ takes: PositionTake[]; nextCursor: string | null }> {
  return readTakes(
    await requestJson<unknown>(`/api/users/${privyUserId}/takes`, {
      params: cursor ? { cursor } : undefined,
    }).catch(() => null),
  );
}

/** The holding card's "Update thesis · n" row, and the thread behind it. */
export async function getPositionTakes(ref: PositionRef): Promise<PositionTake[]> {
  const payload = await requestJson<unknown>('/api/positions/takes', {
    params: { kind: ref.kind, id: ref.kind === 'phoenix' ? ref.key : ref.id },
  }).catch(() => null);
  return readTakes(payload).takes;
}

/** §8.4: whether this account's takes carry their size band. */
export async function setShowPositionSize(showPositionSize: boolean): Promise<boolean> {
  const payload = await requestJson<unknown>('/api/users/profile', {
    method: 'PATCH',
    body: { showPositionSize },
  }).catch(() => null);
  return isRecord(payload) ? payload.showPositionSize !== false : false;
}
