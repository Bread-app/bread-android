import type { BirdeyeOhlcvItem, BirdeyeOhlcvTimeframe } from '@/lib/api';
import { legSign } from '@/lib/sandwich-pnl';

/**
 * The pure curve math behind `SandwichBasketChart`, kept out of the component
 * so it can be tested without an RN runtime. Nothing here touches the network,
 * the theme, or a hook — it turns candles into an index series and reconciles
 * that series with the server's headline PnL.
 */

export type SandwichBasketChartLeg = {
  id?: string;
  legId?: string;
  type?: 'tokenized_stock' | 'prediction_market' | 'perp';
  mint: string | null;
  marketId?: string | null;
  symbol?: string | null;
  label: string;
  side?: string | null;
  weightBps: number;
  priceUsd?: number | null;
  currentPriceUsd?: number | null;
  pnlPct?: number | null;
};

export type BasketPoint = {
  timestamp: number;
  index: number;
  returnPct: number;
};

export type LoadedLeg = {
  leg: SandwichBasketChartLeg;
  items: BirdeyeOhlcvItem[];
};

export const MAX_POINTS = 100;

export const TIMEFRAME_MS: Record<BirdeyeOhlcvTimeframe, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '1H': 60 * 60 * 1000,
  '4H': 4 * 60 * 60 * 1000,
  '1D': 24 * 60 * 60 * 1000,
};

export function clipCandlesAt<T extends { timestamp: number }>(
  candles: readonly T[],
  endSeconds: number | null,
): T[] {
  return endSeconds === null
    ? [...candles]
    : candles.filter((candle) => candle.timestamp <= endSeconds * 1000);
}

export function pointKey(timestamp: number, bucketMs: number): number {
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

export function buildBasketPoints(loadedLegs: LoadedLeg[], timeframe: BirdeyeOhlcvTimeframe): BasketPoint[] {
  const weightedLegs = loadedLegs.filter((loaded) => loaded.leg.weightBps > 0);

  const bucketMs = TIMEFRAME_MS[timeframe];
  const series = weightedLegs.map((loaded) => {
    const byBucket = new Map<number, number>();
    const items = loaded.items
      .filter((item) => Number.isFinite(item.close) && item.close > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const item of items) {
      byBucket.set(pointKey(item.timestamp, bucketMs), item.close);
    }

    // A leg with no usable candles has no series to blend. It used to fall
    // through to `ratio = 1` at every bucket — i.e. silently drawn as FLAT —
    // which let a heavily-losing leg vanish from the curve while still counting
    // in the headline PnL (a prediction leg whose CLOB history failed to load
    // showed the basket green against a red number). Instead, fall back to the
    // leg's known end-to-end return and ramp it across the window, so its real
    // contribution is represented; if even that is unknown, drop the leg and
    // renormalize (below) rather than pretend it went nowhere.
    const hasSeries = items.length > 0;
    const fallbackReturnPct =
      typeof loaded.leg.pnlPct === 'number' && Number.isFinite(loaded.leg.pnlPct)
        ? loaded.leg.pnlPct
        : null;

    return {
      leg: loaded.leg,
      byBucket,
      hasSeries,
      fallbackReturnPct,
      // Candles are the raw price of the underlying, which moves AGAINST a
      // short. `fallbackReturnPct` needs no sign — it reads `leg.pnlPct`, which
      // the server already signed; signing it again would double-invert.
      sign: legSign(loaded.leg),
      base: items[0]?.open && items[0].open > 0 ? items[0].open : items[0]?.close ?? null,
    };
  }).filter((entry) => entry.hasSeries || entry.fallbackReturnPct !== null);

  const totalWeight = series.reduce((sum, entry) => sum + Math.max(0, entry.leg.weightBps), 0);
  if (totalWeight <= 0) return [];

  const buckets = [...new Set(series.flatMap((entry) => [...entry.byBucket.keys()]))]
    .sort((a, b) => a - b);

  if (buckets.length < 2) return [];

  const lastCloseByIndex = new Map<number, number>();
  return buckets.map((timestamp, bucketIndex) => {
    // Where we are across the window, for ramping series-less legs.
    const progress = buckets.length > 1 ? bucketIndex / (buckets.length - 1) : 1;

    const index = series.reduce((sum, entry, entryIndex) => {
      let ratio: number;
      if (entry.hasSeries) {
        const close = entry.byBucket.get(timestamp);
        if (close) lastCloseByIndex.set(entryIndex, close);
        const current = close ?? lastCloseByIndex.get(entryIndex) ?? null;
        const base = entry.base;
        const raw = current && base && base > 0 ? current / base : 1;
        // Sign the RETURN, not the ratio. `1 / raw` is the wrong model — it
        // would turn a 50% drop into +100% instead of the +50% a short actually
        // makes — and it would disagree with the server, which multiplies the
        // percentage by -1.
        ratio = 1 + (raw - 1) * entry.sign;
      } else {
        ratio = 1 + ((entry.fallbackReturnPct ?? 0) / 100) * progress;
      }
      return sum + ratio * (Math.max(0, entry.leg.weightBps) / totalWeight);
    }, 0) * 100;

    return {
      timestamp,
      index,
      returnPct: index - 100,
    };
  }).slice(-MAX_POINTS);
}

export function buildPredictionPoints(candles: BirdeyeOhlcvItem[]): BasketPoint[] {
  const usable = candles.filter((candle) => Number.isFinite(candle.close) && candle.close > 0);
  const base = usable[0]?.open ?? usable[0]?.close ?? null;

  if (!base || base <= 0) return [];

  return usable.map((candle) => {
    const index = (candle.close / base) * 100;

    return {
      timestamp: candle.timestamp,
      index,
      returnPct: index - 100,
    };
  });
}

export function synthesizeFallbackPoints(
  createdAtSeconds: number,
  targetReturnPct: number | null | undefined,
  timeframe: BirdeyeOhlcvTimeframe,
  endedAtSeconds?: number | null,
): BasketPoint[] {
  const target = typeof targetReturnPct === 'number' && Number.isFinite(targetReturnPct) ? targetReturnPct : 0;
  const bucketMs = TIMEFRAME_MS[timeframe];
  const startMs = createdAtSeconds * 1000;
  // Ensure at least one full bucket of visible span so the line is never a single point
  const requestedEnd = endedAtSeconds == null ? Date.now() : endedAtSeconds * 1000;
  const endMs = Math.max(requestedEnd, startMs + bucketMs * 2);
  const span = endMs - startMs;
  const rawCount = Math.floor(span / bucketMs) + 1;
  const count = Math.max(2, Math.min(MAX_POINTS, rawCount));
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => {
    const progress = i / (count - 1);
    const returnPct = target * progress;
    return {
      timestamp: Math.floor(startMs + step * i),
      index: 100 + returnPct,
      returnPct,
    };
  });
}

export function anchorLatestReturn(points: BasketPoint[], targetReturnPct: number | null | undefined): BasketPoint[] {
  if (points.length === 0 || typeof targetReturnPct !== 'number' || !Number.isFinite(targetReturnPct)) {
    return points;
  }

  const latestReturn = points[points.length - 1].returnPct;
  // Rescale only when the basket already agrees with the target's DIRECTION.
  // A scale derived from opposite signs is negative, which mirrors the whole
  // curve about the baseline — every rally rendered as a selloff and vice
  // versa. In that case (and when the basket is ~flat, where the scale would
  // explode) fall back to the additive correction below, which preserves the
  // shape and only tilts it onto the target.
  //
  // Before `buildBasketPoints` signed short legs, a short sandwich ALWAYS
  // disagreed and always took the additive path — which lands the endpoint on
  // the right number while leaving the shape inverted, so a rally in the
  // shorted stock was drawn as the sandwich gaining. Signing the curve is what
  // makes agreement the normal case and puts this branch back in play.
  if (Math.abs(latestReturn) > 0.0001 && Math.sign(latestReturn) === Math.sign(targetReturnPct)) {
    const scale = targetReturnPct / latestReturn;
    return points.map((point) => {
      const returnPct = point.returnPct * scale;
      return {
        ...point,
        index: 100 + returnPct,
        returnPct,
      };
    });
  }

  // Ramp the gap between the basket's endpoint and the target across the
  // window: the curve keeps its own shape (and its ups and downs stay ups and
  // downs) while still starting at 0 and landing exactly on the target.
  const drift = targetReturnPct - latestReturn;
  return points.map((point, index) => {
    const progress = points.length > 1 ? index / (points.length - 1) : 1;
    const returnPct = point.returnPct + drift * progress;
    return {
      ...point,
      index: 100 + returnPct,
      returnPct,
    };
  });
}
