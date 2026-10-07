import { describe, expect, it } from 'vitest';

import type { HyperliquidMarket } from './hyperliquid-api';
import {
  applyHyperliquidAssetCtx,
  deepestHyperliquidMarkets,
  hyperliquidPerpOnlyStock,
  isPerpOnlyStock,
  upsertHyperliquidCandle,
  hyperliquidCoinFromPerpSymbol,
  isHyperliquidPerpSymbol,
  toPerpMarket,
  toPerpMarketDetail,
} from './hyperliquid-perp-market';
import { normalizePhoenixAssetSymbol } from './phoenix-symbol';

function market(overrides: Partial<HyperliquidMarket>): HyperliquidMarket {
  return {
    coin: 'xyz:NVDA',
    dex: 'xyz',
    symbol: 'NVDA',
    assetId: 110002,
    szDecimals: 3,
    maxLeverage: 10,
    markPx: 240,
    midPx: 240,
    oraclePx: 240,
    dayNtlVlm: 50_000_000,
    openInterestUsd: 1_000_000,
    prevDayPx: 200,
    funding: 0.00001,
    ...overrides,
  };
}

describe('Hyperliquid markets as perps', () => {
  it('round-trips the HL: symbol without losing the coin’s case', () => {
    const perp = toPerpMarket(market({}));
    expect(perp.symbol).toBe('HL:xyz:NVDA');
    expect(isHyperliquidPerpSymbol(perp.symbol)).toBe(true);
    expect(hyperliquidCoinFromPerpSymbol(perp.symbol)).toBe('xyz:NVDA');
    expect(isHyperliquidPerpSymbol('NVDA')).toBe(false);
  });

  it('normalizes to the plain ticker, so spot matching and logos work', () => {
    expect(normalizePhoenixAssetSymbol('HL:xyz:NVDA')).toBe('NVDA');
    expect(normalizePhoenixAssetSymbol('HL:BTC')).toBe('BTC');
    // Untouched for everything that isn't Hyperliquid.
    expect(normalizePhoenixAssetSymbol('AAPLx')).toBe('AAPL');
  });

  it('reports the day’s change and hourly funding the way the screen reads them', () => {
    const detail = toPerpMarketDetail(market({}));
    expect(detail.change24h?.changePercent).toBeCloseTo(20);
    expect(detail.stats?.currentFundingRatePercentage).toBeCloseTo(0.001);
    expect(detail.stats?.eightHourFundingRatePercentage).toBeCloseTo(0.008);
  });

  it('keeps one row per ticker, the busiest book, busiest first', () => {
    const rows = deepestHyperliquidMarkets([
      market({ coin: 'km:NVDA', dex: 'km', dayNtlVlm: 1_000 }),
      market({}),
      market({ coin: 'BTC', dex: '', symbol: 'BTC', dayNtlVlm: 2_000_000_000 }),
    ]);
    expect(rows.map((row) => row.coin)).toEqual(['BTC', 'xyz:NVDA']);
  });

  it('folds a streamed price update into the market detail', () => {
    const detail = toPerpMarketDetail(market({}));
    const next = applyHyperliquidAssetCtx(detail, { markPx: '250', prevDayPx: '200', funding: '0.00002' });
    expect(next.markPrice).toBe(250);
    expect(next.change24h?.changePercent).toBeCloseTo(25);
    expect(next.stats?.currentFundingRatePercentage).toBeCloseTo(0.002);
    // A message without a field keeps the old value rather than blanking it.
    expect(applyHyperliquidAssetCtx(detail, {}).markPrice).toBe(240);
  });

  it('replaces the forming candle, appends a new one, and ignores stale ones', () => {
    const bar = (time: number, close: number) => ({ time, close });
    const toBar = (update: { t: number; c: string }) => bar(update.t, Number(update.c));
    const series = [bar(1, 10), bar(2, 11)];
    const update = (t: number, c: string) => ({ t, o: c, h: c, l: c, c, v: '1', n: 1 });
    expect(upsertHyperliquidCandle(series, update(2, '12'), toBar)).toEqual([bar(1, 10), bar(2, 12)]);
    expect(upsertHyperliquidCandle(series, update(3, '13'), toBar)).toEqual([bar(2, 11), bar(3, 13)]);
    expect(upsertHyperliquidCandle(series, update(1, '9'), toBar)).toBe(series);
  });

  it('marks perp-only stand-in assets so the screen hides the spot side', () => {
    const stock = hyperliquidPerpOnlyStock(market({}));
    expect(stock.id).toBe('hyperliquid:xyz:NVDA');
    expect(isPerpOnlyStock(stock)).toBe(true);
    expect(isPerpOnlyStock({ id: 'So11111111111111111111111111111111111111112' })).toBe(false);
  });
});
