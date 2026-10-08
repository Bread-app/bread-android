/**
 * Client for the Phoenix perps read-only endpoints (backend Phase 1).
 *
 * Kept separate from `api.ts` because Phoenix is an entirely different venue
 * with its own symbol namespace — nothing here is keyed by mint, and none of it
 * flows through the spot trading paths.
 */

import { getAuthHeaders } from '@/lib/api';
import { getHyperliquidCandles, listHyperliquidMarkets } from '@/lib/hyperliquid-api';
import {
  hyperliquidChangePercent,
  hyperliquidCoinFromPerpSymbol,
  isHyperliquidPerpSymbol,
  toPerpMarketDetail,
} from '@/lib/hyperliquid-perp-market';
import { isDemoMode } from '@/lib/demo/demo-config';
import {
  inferPhoenixPositionLeverage,
  loadPhoenixPositionLeverages,
  roundLeverage,
} from '@/lib/phoenix-position-leverage';

function getApiBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * A failed Phoenix request, carrying the backend's machine-readable code.
 *
 * The account endpoint distinguishes states the UI must render differently —
 * `no_wallet`, `phoenix_unavailable` — and matching on a formatted message would
 * break the first time one is reworded.
 */
export class PhoenixApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'PhoenixApiError';
    this.status = status;
    this.code = code;
  }
}

async function phoenixGet<T>(path: string, options: { auth?: boolean } = {}): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}/api/phoenix${path}`, {
    headers: {
      accept: 'application/json',
      ...(options.auth ? await getAuthHeaders() : {}),
    },
  });

  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const code =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : null;
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : code ?? `Phoenix request failed (${response.status})`;
    throw new PhoenixApiError(response.status, code, message);
  }

  return body as T;
}

async function phoenixPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}/api/phoenix${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(body ?? {}),
  });

  const responseBody = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const code =
      responseBody &&
      typeof responseBody === 'object' &&
      'error' in responseBody &&
      typeof responseBody.error === 'string'
        ? responseBody.error
        : null;
    const message =
      responseBody &&
      typeof responseBody === 'object' &&
      'message' in responseBody &&
      typeof responseBody.message === 'string'
        ? responseBody.message
        : code ?? `Phoenix request failed (${response.status})`;
    throw new PhoenixApiError(response.status, code, message);
  }

  return responseBody as T;
}

export type PhoenixMarketCategory = 'equity' | 'commodity' | 'crypto';

export type PhoenixLeverageTier = {
  maxLeverage: number;
  maxSizeBaseLots: number;
};

export type PhoenixPriceBand = { min: number; max: number };

export type PhoenixSession = {
  status: string | null;
  isAfterHours: boolean;
  isReopen: boolean;
  lastKnownIndexPrice: number | null;
  markPriceBand: PhoenixPriceBand | null;
  executionPriceBand: PhoenixPriceBand | null;
  lastIndexExpiryTimestamp: number | null;
};

export type PhoenixMarket = {
  symbol: string;
  name: string;
  category: PhoenixMarketCategory;
  logoUri: string | null;
  /**
   * tokens.xyz artwork for the underlying asset — the same image the spot side
   * shows, joined on by the backend. Prefer it over `logoUri`, which is
   * Phoenix's own SVG mark. See `perpLogoSources`.
   */
  iconUri?: string | null;
  displayColor: string | null;
  marketStatus: string;
  isolatedOnly: boolean;
  takerFee: number;
  makerFee: number;
  tickSize: number;
  baseLotsDecimals: number;
  leverageTiers: PhoenixLeverageTier[];
  maxLeverage: number;
  /** Phoenix maintenance threshold, in basis points of initial margin. */
  maintenanceMarginBps: number | null;
  fundingIntervalSeconds: number | null;
  fundingPeriodSeconds: number | null;
  marketPubkey: string;
  assetId: number;
  session: PhoenixSession | null;
};

// Re-exported so every existing call site keeps importing symbol matching from
// here; the implementations live in a dependency-free module so pure logic can
// use them without pulling in SecureStore and the auth layer.
export {
  findPhoenixMarketForAsset,
  normalizePhoenixAssetSymbol,
  phoenixKindForAssetCategory,
  phoenixMarketMatchesAsset,
} from '@/lib/phoenix-symbol';
export type { PhoenixAssetKind, PhoenixAssetRef } from '@/lib/phoenix-symbol';

export type PhoenixCandle = {
  /** Epoch milliseconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  markOpen: number;
  markHigh: number;
  markLow: number;
  markClose: number;
  volume: number;
  volumeQuote: number;
  tradeCount: number;
};

export type PhoenixFundingRate = {
  /** Epoch seconds. */
  timestamp: number;
  fundingRatePercentage: number;
};

export type PhoenixChange24h = {
  changeUsd: number;
  changePercent: number;
};

export type PhoenixTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

/** Matches the backend cap — requesting more is a 400. */
export const PHOENIX_MAX_PRICE_BATCH = 8;

const PHOENIX_MARKETS_CACHE_MS = 60_000;
let phoenixMarketsCache: { markets: PhoenixMarket[]; expiresAt: number } | null = null;
let phoenixMarketsInFlight: Promise<PhoenixMarket[]> | null = null;

export async function listPhoenixMarkets(): Promise<PhoenixMarket[]> {
  if (phoenixMarketsCache && phoenixMarketsCache.expiresAt > Date.now()) {
    return phoenixMarketsCache.markets;
  }
  if (phoenixMarketsInFlight) return phoenixMarketsInFlight;

  phoenixMarketsInFlight = phoenixGet<{ markets: PhoenixMarket[] }>('/markets')
    .then(({ markets }) => {
      phoenixMarketsCache = { markets, expiresAt: Date.now() + PHOENIX_MARKETS_CACHE_MS };
      return markets;
    })
    .finally(() => {
      phoenixMarketsInFlight = null;
    });
  return phoenixMarketsInFlight;
}

export type PhoenixMarketDetail = {
  market: PhoenixMarket;
  markPrice: number | null;
  change24h: PhoenixChange24h | null;
  funding: PhoenixFundingRate[];
  stats: PhoenixMarketStats | null;
};

export type PhoenixMarketStats = {
  timestampMs: number;
  markPrice: number;
  oraclePrice: number;
  previousDayMarkPrice: number;
  openInterestBase: number;
  volume24hUsd: number;
  volume24hBase: number;
  currentFundingRatePercentage: number;
  eightHourFundingRatePercentage: number;
  annualizedFundingRatePercentage: number;
};

export async function getPhoenixMarket(symbol: string): Promise<PhoenixMarketDetail> {
  // A Hyperliquid market presented through this screen — see hyperliquid-perp-market.
  if (isHyperliquidPerpSymbol(symbol)) {
    const coin = hyperliquidCoinFromPerpSymbol(symbol);
    const market = (await listHyperliquidMarkets()).find((entry) => entry.coin === coin);
    if (!market) throw new PhoenixApiError(404, 'market_not_found', `${coin} isn't listed on Hyperliquid.`);
    return toPerpMarketDetail(market);
  }
  return phoenixGet<PhoenixMarketDetail>(`/markets/${encodeURIComponent(symbol)}`);
}

export async function getPhoenixCandles(
  symbol: string,
  timeframe: PhoenixTimeframe,
  limit = 120,
): Promise<PhoenixCandle[]> {
  if (isHyperliquidPerpSymbol(symbol)) {
    return getHyperliquidCandles(hyperliquidCoinFromPerpSymbol(symbol), timeframe, limit);
  }
  const { candles } = await phoenixGet<{ candles: PhoenixCandle[] }>(
    `/candles/${encodeURIComponent(symbol)}?timeframe=${timeframe}&limit=${limit}`,
  );
  return candles;
}

export type PhoenixPriceBatch = {
  prices: Record<string, number | null>;
  /** Symbols the backend could not price — surfaced rather than shown as 0. */
  failed: string[];
  /** 24h change per symbol, `null` where the series was unavailable. */
  changes?: Record<string, PhoenixChange24h | null>;
};

/**
 * Mark prices for up to {@link PHOENIX_MAX_PRICE_BATCH} symbols.
 *
 * Phoenix has no bulk price endpoint and rate-limits at ~5 req/s, so the whole
 * board cannot be priced at once. Callers price what is on screen.
 */
export async function getPhoenixPrices(symbols: string[]): Promise<PhoenixPriceBatch> {
  // Hyperliquid symbols are priced from one catalog read; case is significant
  // in their coin names, so they're split off before the upper-casing below.
  const hyperliquid = symbols.filter(isHyperliquidPerpSymbol);
  if (hyperliquid.length > 0) {
    const markets = await listHyperliquidMarkets();
    const byCoin = new Map(markets.map((market) => [market.coin, market]));
    const prices: Record<string, number | null> = {};
    const changes: Record<string, PhoenixChange24h | null> = {};
    const failed: string[] = [];
    for (const symbol of hyperliquid) {
      const market = byCoin.get(hyperliquidCoinFromPerpSymbol(symbol));
      if (!market) {
        failed.push(symbol);
        continue;
      }
      prices[symbol] = market.markPx;
      const changePercent = hyperliquidChangePercent(market);
      changes[symbol] =
        changePercent === null ? null : { changeUsd: market.markPx - market.prevDayPx, changePercent };
    }
    const rest = symbols.filter((symbol) => !isHyperliquidPerpSymbol(symbol));
    if (rest.length === 0) return { prices, failed, changes };
    const phoenix = await getPhoenixPrices(rest);
    return {
      prices: { ...phoenix.prices, ...prices },
      failed: [...phoenix.failed, ...failed],
      changes: { ...(phoenix.changes ?? {}), ...changes },
    };
  }
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (unique.length === 0) return { prices: {}, failed: [] };

  const batch = unique.slice(0, PHOENIX_MAX_PRICE_BATCH);
  return phoenixGet<PhoenixPriceBatch>(`/prices?symbols=${batch.join(',')}`);
}

export type PhoenixPosition = {
  symbol: string;
  name?: string | null;
  logoUri?: string | null;
  /** tokens.xyz artwork joined on by the account route. See `perpLogoSources`. */
  iconUri?: string | null;
  /** Bread's selected order multiplier; Phoenix does not repeat it in trader views. */
  leverage?: number | null;
  /** User-entered margin tracked by Bread so Holdings can show margin + PnL. */
  marginUsd?: number | null;
  /**
   * Set when this is a STANDALONE position in its own isolated child. Its
   * margin and leverage then come straight from the child's on-chain
   * collateral, and close / auto-close must target this child. Absent for a
   * position on the cross account.
   */
  subaccountIndex?: number | null;
  /** Signed — negative is short. */
  positionSize: number;
  entryPrice: number;
  positionValue: number;
  unrealizedPnl: number;
  initialMargin: number;
  maintenanceMargin: number;
  liquidationPrice: number | null;
  unsettledFunding: number;
  accumulatedFunding: number;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
};

export type PhoenixSubaccount = {
  subaccountIndex: number;
  traderKey: string;
  /**
   * USD held as Phoenix collateral. **Not spendable cash** — it sits behind a
   * withdraw queue and part of it is locked as margin. Never add this to the
   * wallet balance in `wallet-store`.
   */
  collateralBalance: number;
  effectiveCollateral: number;
  effectiveCollateralForWithdrawals: number;
  portfolioValue: number;
  initialMargin: number;
  maintenanceMargin: number;
  cancelMargin: number;
  unrealizedPnl: number;
  discountedUnrealizedPnl: number;
  unsettledFundingOwed: number;
  accumulatedFunding: number;
  riskState: string | null;
  riskTier: string | null;
  positions: PhoenixPosition[];
  openOrderCount: number;
};

export type PhoenixAccountState = {
  /** False when the wallet has never registered a Phoenix trader. */
  registered: boolean;
  authority: string;
  pdaIndex: number;
  /** Derived locally by the backend — present even before registration. */
  traderPda: string;
  slot: number | null;
  cross: PhoenixSubaccount | null;
  subaccounts: PhoenixSubaccount[];
};

/**
 * Legacy Phoenix invite/referral association.
 *
 * `whitelisted: false` is not a registration gate. Phoenix's current
 * no-referral builder flow can register the default trader account regardless;
 * this metadata is retained only to show a code that was previously applied.
 */
export type PhoenixLegacyInviteStatus = {
  whitelisted: boolean;
  whitelistedAt: string | null;
  inviteCodeUsed: string | null;
};

export type PhoenixAccountResponse = {
  session: { status: string; accessExpiresAt: string } | null;
  legacyInvite: PhoenixLegacyInviteStatus;
  account: PhoenixAccountState;
  /**
   * Isolated children holding standalone perps (not Sandwich legs). Absent
   * from backends that predate isolated standalone perps.
   */
  standaloneSubaccountIndices?: number[];
};

/** The standalone isolated children in an account response. */
export function phoenixStandaloneChildren(response: PhoenixAccountResponse | null | undefined): PhoenixSubaccount[] {
  if (!response?.account.registered) return [];
  const indices = new Set(response.standaloneSubaccountIndices ?? []);
  return response.account.subaccounts.filter((subaccount) => indices.has(subaccount.subaccountIndex));
}

/**
 * Every standalone perp the user holds: cross-account positions (opened before
 * standalone perps went isolated) plus each standalone child's position. Perp
 * Sandwich legs are excluded — they render as their Sandwich.
 */
export function phoenixStandalonePositions(
  response: PhoenixAccountResponse | null | undefined,
): PhoenixPosition[] {
  if (!response?.account.registered) return [];
  return [
    ...(response.account.cross?.positions ?? []),
    ...phoenixStandaloneChildren(response).flatMap((subaccount) => subaccount.positions),
  ];
}

/**
 * What the standalone children are worth: open positions at collateral + PnL,
 * plus collateral an exchange-side exit left idle (it is swept back to the
 * perps balance by the next open or withdrawal).
 */
export function phoenixStandaloneChildrenValue(
  response: PhoenixAccountResponse | null | undefined,
): number {
  return phoenixStandaloneChildren(response).reduce(
    (sum, subaccount) => sum + Math.max(0, subaccount.portfolioValue),
    0,
  );
}

/**
 * The signed-in user's Phoenix account.
 *
 * Authenticated to Bread. Phoenix's account reads are public, so the backend
 * does not need to broker a Phoenix session. Safe to call before onboarding; an
 * unregistered wallet comes back with
 * `account.registered === false`.
 *
 * Reads only. Nothing here signs or moves funds.
 */
export async function getPhoenixAccount(): Promise<PhoenixAccountResponse> {
  // Demo mode (shoot builds only): the hero Sandwich's perp leg is served as an
  // already-open Phoenix position. Answered before the fetch AND before the
  // enrichment below, which would otherwise re-infer the leverage and margin
  // from a catalogue the demo instrument is not in. Compile-time gated, like
  // every other demo hook — see lib/demo/demo-config.ts.
  if (isDemoMode()) {
    const { demoPhoenixAccount } = await import('./demo/demo-portfolio');
    return demoPhoenixAccount();
  }

  const response = await phoenixGet<PhoenixAccountResponse>('/account', { auth: true });
  if (!response.account.registered) return response;

  try {
    // Trader views intentionally contain only position/risk fields. Join the
    // symbol-keyed positions to Phoenix's market catalogue so Holdings receives
    // Phoenix's current name and hashed CDN logo even when an older Bread
    // backend has not enriched `/account` yet.
    const [marketList, leverageLedger] = await Promise.all([
      listPhoenixMarkets().catch(() => []),
      loadPhoenixPositionLeverages(response.account.authority),
    ]);
    const markets = new Map(
      marketList.map((market) => [market.symbol.trim().toUpperCase(), market]),
    );
    const standalone = new Set(response.standaloneSubaccountIndices ?? []);
    const enrichSubaccount = (subaccount: PhoenixSubaccount): PhoenixSubaccount => ({
      ...subaccount,
      positions: subaccount.positions.map((position) => {
        const symbol = position.symbol.trim().toUpperCase();
        const market = markets.get(symbol);
        const identity = market
          ? { name: market.name, logoUri: market.logoUri, iconUri: market.iconUri ?? null }
          : {};
        if (standalone.has(subaccount.subaccountIndex)) {
          // An isolated child holds exactly this position's margin, so both
          // figures are read from chain — no device ledger, no inference.
          const notional = Math.abs(position.positionSize * position.entryPrice);
          const margin = subaccount.collateralBalance;
          return {
            ...position,
            ...identity,
            subaccountIndex: subaccount.subaccountIndex,
            marginUsd: margin > 0 ? margin : null,
            leverage: margin > 0 && notional > 0 ? roundLeverage(notional / margin) : null,
          };
        }
        const storedTrade = leverageLedger[symbol];
        const entryNotionalUsd = Math.abs(position.positionSize * position.entryPrice);
        const inferredLeverage =
          subaccount.positions.length === 1
            ? inferPhoenixPositionLeverage(
                entryNotionalUsd,
                subaccount.collateralBalance,
              )
            : null;
        const leverage = storedTrade?.leverage ?? inferredLeverage;
        return {
          ...position,
          ...identity,
          leverage,
          marginUsd:
            storedTrade?.marginUsd ??
            (leverage && entryNotionalUsd > 0 ? entryNotionalUsd / leverage : null),
        };
      }),
    });

    return {
      ...response,
      account: {
        ...response.account,
        cross: response.account.cross ? enrichSubaccount(response.account.cross) : null,
        subaccounts: response.account.subaccounts.map(enrichSubaccount),
      },
    };
  } catch {
    // Account/risk data is more important than decoration. Keep it visible and
    // let the holding component try its independent equity-logo fallbacks.
    return response;
  }
}

/**
 * Another user's open perp position, as published by
 * `/api/phoenix/positions/[privyUserId]`.
 *
 * Deliberately narrower than `PhoenixPosition`: the trades are public the way
 * holdings are, the account behind them is not. There is no collateral,
 * portfolio value, margin or withdrawable figure here and there should never be
 * one — see the route's docstring.
 */
export type PublicPerpPosition = {
  symbol: string;
  name: string | null;
  logoUri: string | null;
  iconUri?: string | null;
  /** Signed — negative is short. */
  positionSize: number;
  entryPrice: number;
  positionValue: number;
  unrealizedPnl: number;
  liquidationPrice: number | null;
};

export type PublicPerpPositionsResponse = {
  /** False when that user has no Phoenix account at all. */
  registered: boolean;
  positions: PublicPerpPosition[];
};

/**
 * The open perp positions of the user behind `privyUserId`.
 *
 * Unauthenticated: this is public profile data, and sending the viewer's token
 * would only invite the mistake of scoping the answer to them. Throws
 * `PhoenixApiError` on an upstream outage so a caller can tell "Phoenix is down"
 * from "no open positions" — rendering the second when it means the first is the
 * one failure mode this endpoint must not have.
 */
export async function getUserPerpPositions(
  privyUserId: string,
): Promise<PublicPerpPositionsResponse> {
  const id = privyUserId.trim();
  if (!id) return { registered: false, positions: [] };
  return phoenixGet<PublicPerpPositionsResponse>(
    `/positions/${encodeURIComponent(id)}`,
  );
}

export type PhoenixRegistrationResponse = {
  signature: string | null;
  traderPda: string;
  status: 'already_registered' | 'confirmed' | 'submitted';
};

/** Register the signed-in wallet's default Phoenix account without a referral. */
export async function registerPhoenixAccount(): Promise<PhoenixRegistrationResponse> {
  return phoenixPost<PhoenixRegistrationResponse>('/account/register');
}

export type PhoenixBuiltTransaction = {
  transaction: string;
  lastValidBlockHeight: number;
  gasless: true;
};

export type PhoenixDepositBuild = PhoenixBuiltTransaction & {
  amountUsd: number;
};

export async function buildPhoenixDeposit(amountUsd: string): Promise<PhoenixDepositBuild> {
  return phoenixPost<PhoenixDepositBuild>('/collateral/deposit/build', { amountUsd });
}

export type PhoenixWithdrawBuild = PhoenixBuiltTransaction & {
  amountUsd: number;
  /** Free collateral left on the perps account after this withdrawal. */
  remainingAvailableUsd: number;
};

/**
 * Move perps collateral back to wallet USDC.
 *
 * The withdrawable amount is capped server-side against free collateral —
 * margin behind an open position is not moveable, and the backend rejects an
 * attempt rather than trusting the client's arithmetic.
 */
export async function buildPhoenixWithdraw(amountUsd: string, options?: { all?: boolean }): Promise<PhoenixWithdrawBuild> {
  return phoenixPost<PhoenixWithdrawBuild>(
    '/collateral/withdraw/build',
    options?.all ? { all: true } : { amountUsd },
  );
}

export type PhoenixTradeSide = 'long' | 'short';

export type PhoenixOrderBuild = PhoenixBuiltTransaction & {
  preview: {
    symbol: string;
    side: PhoenixTradeSide;
    leverage: number;
    marginUsd: number;
    notionalUsd: number;
    markPrice: number;
    priceLimitUsd: number;
    estimatedBaseUnits: number;
    maxLeverageForSize: number;
    availableMarginUsd: number;
    cashMovedUsd: number;
    estimatedTakerFeeUsd: number;
    /** Auto-close levels attached to the entry, snapped to the tick grid. */
    takeProfitPrice: number | null;
    stopLossPrice: number | null;
  };
};

/**
 * Build one atomic transaction: use existing Phoenix collateral, move only any
 * USDC shortfall from cash, then place the market order — and, when auto-close
 * levels are supplied, the take-profit / stop-loss triggers that protect the
 * position it opens. One approval covers the lot.
 */
export async function buildPhoenixMarketOrder(input: {
  symbol: string;
  side: PhoenixTradeSide;
  marginUsd: string;
  leverage: number;
  autoFund?: boolean;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
}): Promise<PhoenixOrderBuild> {
  // Always isolated: the position gets its own child, so its margin and
  // leverage are on chain instead of guessed from the shared cross pool.
  return phoenixPost<PhoenixOrderBuild>('/orders/market/build', { ...input, isolated: true });
}

/**
 * Tell the server a perp open landed, so the trader's followers hear about it.
 * The server verifies the signature against Phoenix fills before announcing
 * anything. Fire-and-forget: it must never fail or delay an open that settled.
 */
export async function confirmPhoenixOpen(input: {
  signature: string;
  symbol: string;
  side: PhoenixTradeSide;
  marginUsd: number;
  leverage: number;
}): Promise<void> {
  await phoenixPost('/orders/market/confirm', input).catch(() => undefined);
}

export type PhoenixTpSlBuild = PhoenixBuiltTransaction & {
  preview: {
    symbol: string;
    side: PhoenixTradeSide;
    markPrice: number;
    entryPrice: number;
    positionSize: number;
    takeProfitPrice: number | null;
    stopLossPrice: number | null;
    clearedTakeProfit: boolean;
    clearedStopLoss: boolean;
    estimatedProfitUsd: number | null;
    estimatedLossUsd: number | null;
  };
};

/**
 * Set, change or clear auto-close on a position that is already open.
 *
 * `null` clears a leg; omitting the field leaves it as it is. The side and size
 * are read from the position server-side — this call never sends them.
 */
export async function buildPhoenixTpSl(input: {
  symbol: string;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  /**
   * Set when the level belongs to a perp Sandwich leg.
   *
   * A Sandwich leg lives in a leased isolated subaccount, not the parent cross
   * account, so without this the server looks in the wrong place and reports no
   * open position. The subaccount itself is resolved server-side from this id —
   * sending an index would let a caller aim instructions at any of their leases.
   */
  perpSandwichPositionId?: string;
  /** A standalone isolated position's child; the server checks it is yours. */
  subaccountIndex?: number;
}): Promise<PhoenixTpSlBuild> {
  return phoenixPost<PhoenixTpSlBuild>('/positions/tpsl/build', input);
}

export type PhoenixCloseBuild = PhoenixBuiltTransaction & {
  /**
   * The pending close record the server parked at build time. Phoenix keeps no
   * history of a closed position, so the outcome is captured here or nowhere —
   * pass this back to `confirmPhoenixClose` once the exit lands. Null when the
   * record could not be written, which loses the receipt but not the exit.
   */
  closeRecordId?: string | null;
  preview: {
    symbol: string;
    closingSide: PhoenixTradeSide;
    positionSize: number;
    markPrice: number;
    priceLimitUsd: number;
    estimatedBaseUnits: number;
    reduceOnly: true;
    /** Share of the position this order closes, after lot rounding. */
    closedFraction: number;
    /** Signed size left if the order fills completely. */
    remainingSize: number;
  };
};

/**
 * Build a reduce-only market order against the current Phoenix position.
 *
 * `fraction` is a share of the position (0.5 closes half); omit it to close the
 * whole thing. Only the share travels — the size is read from the account
 * server-side — so the number here can never enlarge the order.
 */
/**
 * Tell the server the close actually landed, so its parked outcome record
 * becomes a real one.
 *
 * Fire-and-forget by design: an unconfirmed record is swept away and the user
 * loses a row in their closed list, never money. It must never be able to fail
 * an exit that already settled on chain.
 */
export async function confirmPhoenixClose(
  closeRecordId: string,
  signature: string,
): Promise<void> {
  await phoenixPost('/positions/close/confirm', { closeRecordId, signature }).catch(
    () => undefined,
  );
}

export async function buildPhoenixClosePosition(
  symbol: string,
  fraction?: number,
  /** The standalone isolated child holding it; omit for a cross position. */
  subaccountIndex?: number | null,
): Promise<PhoenixCloseBuild> {
  return phoenixPost<PhoenixCloseBuild>('/positions/close/build', {
    symbol,
    ...(fraction !== undefined ? { fraction } : {}),
    ...(subaccountIndex ? { subaccountIndex } : {}),
  });
}
