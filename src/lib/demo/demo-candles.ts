/**
 * Synthetic price history for the demo instruments.
 *
 * Charts are the one thing a flat fixture cannot fake: a straight line reads as
 * a mock instantly. These are seeded random walks — same mint, same candles,
 * every take — with per-asset volatility and a drift that lands the series on
 * the return its leg claims. The basket chart then anchors the blended curve
 * onto the Sandwich's headline number exactly as it does with real candles, so
 * the shape is genuine noise and the endpoint is the scripted figure.
 */

import { DEMO_ASSET_BY_MINT, DEMO_SANDWICH_CREATED_AT_MS } from './demo-data';

const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1H': 60 * 60_000,
  '4H': 4 * 60 * 60_000,
  '1D': 24 * 60 * 60_000,
};

/** Deterministic per-mint seed, so a chart never redraws differently mid-take. */
function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller, so the walk has real tails instead of a uniform shimmer. */
function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export type DemoCandle = { o: number; h: number; l: number; c: number; v: number; unixTime: number };

/**
 * Candles for one mint over `[timeFromSeconds, now]` at the given timeframe.
 * An unknown mint gets a generic $100 series rather than nothing, so a tapped
 * row never lands on an empty chart.
 */
export function demoCandles(
  mint: string,
  timeframe: string,
  timeFromSeconds?: number,
): DemoCandle[] {
  const stepMs = TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS['1H'];
  const now = Date.now();
  const defaultStart = now - DEMO_SANDWICH_CREATED_AT_MS;
  const startMs = timeFromSeconds ? timeFromSeconds * 1000 : defaultStart;
  const span = Math.max(stepMs * 8, now - startMs);
  // Capped: the chart aggregates to 100 points anyway, and a 1m timeframe over
  // six weeks would otherwise be sixty thousand candles of pure JSON.
  const count = Math.max(12, Math.min(420, Math.floor(span / stepMs) + 1));
  const step = span / (count - 1);

  const info = DEMO_ASSET_BY_MINT[mint];
  const open = info?.entryPriceUsd ?? 100;
  const close = info?.currentPriceUsd ?? 118;
  const rand = mulberry32(seedFrom(mint));

  // Split the total move across the window in log space, then let the noise
  // wander around it. Volatility scales with the step so a 1D chart is not
  // drawn as jagged as a 5m one.
  const drift = Math.log(close / open) / (count - 1);
  const sigma = 0.016 * Math.sqrt(stepMs / TIMEFRAME_MS['1H']);

  const closes: number[] = [];
  let logPrice = Math.log(open);
  for (let i = 0; i < count; i += 1) {
    logPrice += drift + gaussian(rand) * sigma;
    closes.push(Math.exp(logPrice));
  }

  // Pin the ends: the walk must start at the entry price and finish at the
  // current one, or the leg's own numbers and its chart disagree on screen.
  const drawnEnd = closes[closes.length - 1];
  const correction = Math.log(close / drawnEnd);
  for (let i = 0; i < count; i += 1) {
    closes[i] = closes[i] * Math.exp((correction * i) / (count - 1));
  }

  return closes.map((c, i) => {
    const o = i === 0 ? open : closes[i - 1];
    const wick = Math.abs(c) * sigma * (0.6 + rand());
    return {
      unixTime: Math.floor((startMs + step * i) / 1000),
      o: Number(o.toFixed(4)),
      c: Number(c.toFixed(4)),
      h: Number((Math.max(o, c) + wick).toFixed(4)),
      l: Number(Math.max(0.01, Math.min(o, c) - wick).toFixed(4)),
      v: Math.round(180_000 + rand() * 900_000),
    };
  });
}
