import type { HyperliquidSide } from '@/lib/hyperliquid-api';

/** Hyperliquid's taker fee (base tier) plus Bread's 0.1% builder fee, on notional. */
export const HYPERLIQUID_FEE_RATE = 0.00045 + 0.001;
/** Hyperliquid refuses orders under $10 of exposure. */
export const HYPERLIQUID_MIN_NOTIONAL_USD = 10;

/**
 * Where an isolated Hyperliquid position at `leverage` gets liquidated: when
 * the loss eats the margin down to maintenance. Hyperliquid's maintenance rate
 * is half the initial rate at the market's max leverage, i.e. 1 / (2 × max).
 * An estimate for the ticket — fees and funding move it slightly.
 */
export function hyperliquidLiquidationPrice(input: {
  side: HyperliquidSide;
  entryPrice: number | null;
  leverage: number;
  maxLeverage: number;
}): number | null {
  const { side, entryPrice, leverage, maxLeverage } = input;
  if (!entryPrice || entryPrice <= 0 || leverage < 1 || maxLeverage < 1) return null;
  const maintenance = 1 / (2 * maxLeverage);
  const buffer = 1 / leverage - maintenance;
  if (buffer <= 0) return null;
  return side === 'long' ? entryPrice * (1 - buffer) : entryPrice * (1 + buffer);
}
