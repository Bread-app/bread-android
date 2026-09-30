import { describe, expect, it } from 'vitest';

import {
  findPhoenixMarketForAsset,
  phoenixMarketMatchesAsset,
  phoenixOnlyMarkets,
} from './phoenix-symbol';

const AAPL = { symbol: 'AAPL', name: 'Apple', category: 'equity' };
const BTC = { symbol: 'BTC', name: 'Bitcoin', category: 'crypto' };
const SUI = { symbol: 'SUI', name: 'SUI', category: 'crypto' }; // Phoenix publishes no name
const CHIP_PERP = { symbol: 'CHIP', name: 'CHIP', category: 'crypto' };
const MET_PERP = { symbol: 'MET', name: 'Meteora', category: 'crypto' };
const GOLD = { symbol: 'GOLD', name: 'Gold', category: 'commodity' };

const BOARD = [AAPL, BTC, SUI, CHIP_PERP, MET_PERP, GOLD];

describe('equity matching', () => {
  it('matches a tokenized wrapper to its underlying perp', () => {
    expect(phoenixMarketMatchesAsset(AAPL, { symbol: 'AAPLx', category: 'equity' })).toBe(true);
    expect(phoenixMarketMatchesAsset(AAPL, { symbol: 'AAPLon', category: 'equity' })).toBe(true);
  });

  it('treats a bare ticker as an equity, so a leg cannot reach a crypto perp', () => {
    // `MET` is MetLife on tokens.xyz and Meteora on Phoenix.
    expect(phoenixMarketMatchesAsset(MET_PERP, 'MET')).toBe(false);
    expect(findPhoenixMarketForAsset(BOARD, { symbol: 'MET' })).toBeNull();
  });
});

describe('crypto matching', () => {
  it('pairs a crypto spot asset with its perp', () => {
    expect(findPhoenixMarketForAsset(BOARD, { symbol: 'BTC', name: 'Bitcoin', category: 'crypto' }))
      .toBe(BTC);
  });

  it('pairs a nameless Phoenix market with the asset named after its ticker', () => {
    expect(findPhoenixMarketForAsset(BOARD, { symbol: 'SUI', name: 'Sui', category: 'crypto' }))
      .toBe(SUI);
  });

  it('rejects a ticker collision between two different tokens', () => {
    // tokens.xyz CHIP is USD.AI; Phoenix CHIP is an unrelated token.
    expect(findPhoenixMarketForAsset(BOARD, { symbol: 'CHIP', name: 'USD.AI', category: 'crypto' }))
      .toBeNull();
  });

  it('does not strip wrapper suffixes off crypto tickers', () => {
    const suix = { symbol: 'SUIX', name: 'Sui', category: 'crypto' };
    expect(findPhoenixMarketForAsset(BOARD, suix)).toBeNull();
  });

  it('never routes a crypto asset onto an equity market, or vice versa', () => {
    expect(phoenixMarketMatchesAsset(AAPL, { symbol: 'AAPL', category: 'crypto' })).toBe(false);
    expect(phoenixMarketMatchesAsset(BTC, { symbol: 'BTC', category: 'equity' })).toBe(false);
  });

  it('never matches a commodity market', () => {
    expect(findPhoenixMarketForAsset(BOARD, { symbol: 'GOLD', name: 'Gold', category: 'commodity' }))
      .toBeNull();
  });
});

describe('phoenix-only markets', () => {
  const SPY = { symbol: 'SPY', name: 'S&P 500', category: 'equity' };
  const DOGE = { symbol: 'DOGE', name: 'Dogecoin', category: 'crypto' };
  const board = [...BOARD, SPY, DOGE];

  it('keeps the equity perps no tokenized wrapper backs', () => {
    const spot = [{ symbol: 'AAPLx', name: 'Apple', category: 'equity' }];
    expect(phoenixOnlyMarkets(board, spot, 'equity')).toEqual([SPY]);
  });

  it('keeps crypto perps without a spot twin, including ticker collisions', () => {
    const spot = [
      { symbol: 'BTC', name: 'Bitcoin', category: 'crypto' },
      { symbol: 'SUI', name: 'Sui', category: 'crypto' },
      { symbol: 'CHIP', name: 'USD.AI', category: 'crypto' },
    ];
    expect(phoenixOnlyMarkets(board, spot, 'crypto')).toEqual([CHIP_PERP, MET_PERP, DOGE]);
  });

  it('never lists a commodity under either class', () => {
    expect(phoenixOnlyMarkets(board, [], 'equity')).not.toContain(GOLD);
    expect(phoenixOnlyMarkets(board, [], 'crypto')).not.toContain(GOLD);
  });
});
