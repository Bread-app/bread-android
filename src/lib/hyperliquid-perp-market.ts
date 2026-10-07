import type { Stock } from '@/lib/api';
import type { HyperliquidMarket } from '@/lib/hyperliquid-api';
import type { PhoenixMarket, PhoenixMarketDetail } from '@/lib/phoenix-api';
import { HYPERLIQUID_FEE_RATE } from '@/lib/hyperliquid-risk';

/**
 * Hyperliquid markets ride the app's existing perps screen, which is written
 * against Phoenix's market shape. A Hyperliquid market is presented in that
 * shape under a distinct symbol — `HL:` + Hyperliquid's coin (`HL:xyz:NVDA`,
 * `HL:BTC`) — and the data calls that symbol reaches (market, candles, prices)
 * are routed to Hyperliquid in phoenix-api. `HL:BTC` never collides with
 * Phoenix's own `BTC`.
 */
export const HYPERLIQUID_SYMBOL_PREFIX = 'HL:';

export function hyperliquidPerpSymbol(coin: string): string {
  return `${HYPERLIQUID_SYMBOL_PREFIX}${coin}`;
}

export function isHyperliquidPerpSymbol(symbol: string | null | undefined): boolean {
  return !!symbol && symbol.toUpperCase().startsWith(HYPERLIQUID_SYMBOL_PREFIX);
}

/** `HL:xyz:NVDA` → `xyz:NVDA`. Hyperliquid's coin names are case-sensitive. */
export function hyperliquidCoinFromPerpSymbol(symbol: string): string {
  return symbol.slice(HYPERLIQUID_SYMBOL_PREFIX.length);
}

/** Hyperliquid's own artwork for a coin, an SVG (draw with SvgUri, not Image). */
export function hyperliquidCoinLogoUri(coin: string): string {
  return `https://app.hyperliquid.xyz/coins/${encodeURIComponent(coin).replace('%3A', ':')}.svg`;
}

export function hyperliquidChangePercent(market: HyperliquidMarket): number | null {
  return market.prevDayPx > 0 ? (market.markPx / market.prevDayPx - 1) * 100 : null;
}

export function toPerpMarket(market: HyperliquidMarket): PhoenixMarket {
  // Hyperliquid's maintenance rate is half the initial rate at the market's max.
  const maintenanceMarginBps = 10_000 / (2 * Math.max(1, market.maxLeverage));
  return {
    symbol: hyperliquidPerpSymbol(market.coin),
    name: market.symbol,
    // HIP-3 DEXes list stocks, indices and commodities; the main DEX is crypto.
    category: market.dex === '' ? 'crypto' : 'equity',
    // Hyperliquid's art is SVG, which the screen's <Image> logos can't draw;
    // they fall back to the asset's own artwork by ticker.
    logoUri: null,
    iconUri: null,
    displayColor: null,
    marketStatus: 'active',
    isolatedOnly: true,
    takerFee: HYPERLIQUID_FEE_RATE,
    makerFee: 0,
    tickSize: 0,
    baseLotsDecimals: market.szDecimals,
    leverageTiers: [{ maxLeverage: market.maxLeverage, maxSizeBaseLots: Number.MAX_SAFE_INTEGER }],
    maxLeverage: market.maxLeverage,
    maintenanceMarginBps,
    fundingIntervalSeconds: 3600,
    fundingPeriodSeconds: 3600,
    marketPubkey: '',
    assetId: market.assetId,
    session: null,
  };
}

export function toPerpMarketDetail(market: HyperliquidMarket): PhoenixMarketDetail {
  const changePercent = hyperliquidChangePercent(market);
  const fundingPercent = market.funding * 100;
  return {
    market: toPerpMarket(market),
    markPrice: market.markPx,
    change24h:
      changePercent === null
        ? null
        : { changeUsd: market.markPx - market.prevDayPx, changePercent },
    funding: [{ timestamp: Date.now(), fundingRatePercentage: fundingPercent }],
    stats: {
      timestampMs: Date.now(),
      markPrice: market.markPx,
      oraclePrice: market.oraclePx,
      previousDayMarkPrice: market.prevDayPx,
      openInterestBase: market.markPx > 0 ? market.openInterestUsd / market.markPx : 0,
      volume24hUsd: market.dayNtlVlm,
      volume24hBase: market.markPx > 0 ? market.dayNtlVlm / market.markPx : 0,
      currentFundingRatePercentage: fundingPercent,
      // Hyperliquid funds hourly.
      eightHourFundingRatePercentage: fundingPercent * 8,
      annualizedFundingRatePercentage: fundingPercent * 24 * 365,
    },
  };
}

/**
 * One row per ticker, most-traded first: the same stock trades on several
 * Hyperliquid DEXes, and the busiest book is the one an order routes to.
 */
export function deepestHyperliquidMarkets(markets: HyperliquidMarket[]): HyperliquidMarket[] {
  const best = new Map<string, HyperliquidMarket>();
  for (const market of markets) {
    const key = market.symbol.toUpperCase();
    const current = best.get(key);
    if (!current || market.dayNtlVlm > current.dayNtlVlm) best.set(key, market);
  }
  return [...best.values()].sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
}

function num(value: unknown): number | null {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Fold one streamed `activeAssetCtx` into the screen's market detail: mark,
 * 24h change, funding and the stats rows. Anything the message lacks keeps its
 * previous value rather than blanking.
 */
export function applyHyperliquidAssetCtx(
  detail: PhoenixMarketDetail,
  ctx: { markPx?: string; oraclePx?: string; prevDayPx?: string; funding?: string; openInterest?: string; dayNtlVlm?: string },
): PhoenixMarketDetail {
  const mark = num(ctx.markPx) ?? detail.markPrice;
  if (mark === null) return detail;
  const prevDay = num(ctx.prevDayPx) ?? detail.stats?.previousDayMarkPrice ?? null;
  const funding = num(ctx.funding);
  const fundingPercent = funding === null ? detail.stats?.currentFundingRatePercentage ?? 0 : funding * 100;
  const openInterestBase = num(ctx.openInterest) ?? detail.stats?.openInterestBase ?? 0;
  const volumeUsd = num(ctx.dayNtlVlm) ?? detail.stats?.volume24hUsd ?? 0;
  return {
    ...detail,
    markPrice: mark,
    change24h:
      prevDay && prevDay > 0
        ? { changeUsd: mark - prevDay, changePercent: (mark / prevDay - 1) * 100 }
        : detail.change24h,
    funding: funding === null ? detail.funding : [{ timestamp: Date.now(), fundingRatePercentage: fundingPercent }],
    stats: {
      timestampMs: Date.now(),
      markPrice: mark,
      oraclePrice: num(ctx.oraclePx) ?? detail.stats?.oraclePrice ?? mark,
      previousDayMarkPrice: prevDay ?? 0,
      openInterestBase,
      volume24hUsd: volumeUsd,
      volume24hBase: mark > 0 ? volumeUsd / mark : 0,
      currentFundingRatePercentage: fundingPercent,
      eightHourFundingRatePercentage: fundingPercent * 8,
      annualizedFundingRatePercentage: fundingPercent * 24 * 365,
    },
  };
}

type StreamCandle = { t: number; o: string; h: string; l: string; c: string; v: string; n: number };

/**
 * Merge one streamed candle into the series: the bar in progress is replaced,
 * a new bar is appended (dropping the oldest so the history stays the same
 * length), and anything older than the newest bar is ignored.
 */
export function upsertHyperliquidCandle<T extends { time: number }>(
  candles: T[],
  update: StreamCandle,
  toCandle: (update: StreamCandle) => T,
): T[] {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  if (update.t === last.time) return [...candles.slice(0, -1), toCandle(update)];
  if (update.t > last.time) return [...candles.slice(1), toCandle(update)];
  return candles;
}

/**
 * Perp-only markets have no spot asset, but the full-screen asset route is
 * keyed on one. These ids mark the stand-in record so the screen knows there is
 * nothing to switch to: no Spot/Perp toggle, no spot BUY.
 */
const PERP_ONLY_ID_PREFIXES = ['hyperliquid:', 'phoenix:'];

export function isPerpOnlyStock(stock: { id: string } | null | undefined): boolean {
  return !!stock && PERP_ONLY_ID_PREFIXES.some((prefix) => stock.id.startsWith(prefix));
}

/** The stand-in asset record for a Hyperliquid market opened from its own list. */
export function hyperliquidPerpOnlyStock(market: HyperliquidMarket): Stock {
  return {
    id: `hyperliquid:${market.coin}`,
    symbol: market.symbol,
    name: market.symbol,
    category: market.dex === '' ? 'crypto' : 'equity',
    type: 'token',
    holderCount: null,
    icon: null,
    usdPrice: market.markPx,
    priceChange1h: null,
    priceChange24h: hyperliquidChangePercent(market),
    volume24h: market.dayNtlVlm,
  };
}

/** The stand-in asset record for a Phoenix market with no spot twin (DOGE, SPY). */
export function phoenixPerpOnlyStock(market: PhoenixMarket, priceUsd: number | null): Stock {
  return {
    id: `phoenix:${market.symbol}`,
    symbol: market.symbol,
    name: market.name,
    category: market.category,
    type: 'token',
    holderCount: null,
    icon: market.iconUri ?? market.logoUri,
    usdPrice: priceUsd,
    priceChange1h: null,
    priceChange24h: null,
    volume24h: null,
  };
}
