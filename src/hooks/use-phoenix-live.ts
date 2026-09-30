import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  getPhoenixCandles,
  getPhoenixMarket,
  getPhoenixPrices,
  listPhoenixMarkets,
  PHOENIX_MAX_PRICE_BATCH,
  type PhoenixCandle,
  type PhoenixChange24h,
  type PhoenixMarket,
  type PhoenixMarketDetail,
  type PhoenixTimeframe,
} from '@/lib/phoenix-api';

/**
 * Live Phoenix data for the app, by polling.
 *
 * Phoenix has **no bulk price endpoint** and rate-limits at ~5 req/s as a token
 * bucket, so a live board cannot be built by fanning out — pricing all 23
 * equities takes ~5s. The real fix is the WebSocket (one connection, all
 * markets), which is Phase 3. Until then these hooks poll, and the intervals are
 * chosen to line up with the backend's own cache TTLs so a poll that lands
 * early is served from memory instead of hitting Phoenix:
 *
 *   prices  5s   (backend PRICE_TTL_MS)
 *   candles 15s  (backend CANDLES_TTL_MS)
 *
 * Every hook stops polling when the app is backgrounded. Without that, a phone
 * in a pocket keeps draining the shared upstream budget on data nobody is
 * looking at.
 */

const PRICE_POLL_MS = 5_000;
const CANDLE_POLL_MS = 15_000;
/** Bars fetched per timeframe. The backend caps at 1000. */
const CANDLE_HISTORY = 400;
/** First retry delay after a failed poll; doubles up to the poll interval. */
const RETRY_BASE_MS = 1_500;
/** A 24h change barely moves minute to minute; deriving it more often is waste. */
const CHANGE_DERIVE_MS = 60_000;

/** True while the app is in the foreground. Polling is gated on it. */
function useIsForeground(): boolean {
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
    });
    return () => sub.remove();
  }, []);

  return foreground;
}

/**
 * Runs `tick` immediately and then every `intervalMs`, while `enabled`.
 *
 * Self-scheduling rather than `setInterval`: a slow request must not let a
 * second one stack up behind it, which under a rate limit turns one late
 * response into a queue of them.
 *
 * `tick` is held in a ref, so changing it does *not* restart the loop — that is
 * what keeps a re-render from firing an extra request. When the callback change
 * means something (it now asks for a different timeframe), pass that as `key`:
 * the loop restarts and fetches at once instead of leaving the screen empty
 * until the next interval.
 */
function usePoll(
  tick: () => Promise<void>,
  intervalMs: number,
  enabled: boolean,
  key?: string | number,
): () => void {
  const savedTick = useRef(tick);
  savedTick.current = tick;

  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const run = async () => {
      try {
        await savedTick.current();
        failures = 0;
      } catch {
        // Swallowed on purpose: a transient failure should leave the last good
        // value on screen and try again next tick, not blank the row.
        failures += 1;
      }
      if (cancelled) return;
      // Phoenix rate-limits at ~5 req/s across every caller, so a 429 here is
      // routine — and waiting a full interval on one makes a screen that has
      // nothing yet (a fresh timeframe) look broken for 15 seconds. Come back
      // quickly, then back off to the normal cadence.
      const delay =
        failures === 0
          ? intervalMs
          : Math.min(intervalMs, RETRY_BASE_MS * 2 ** (failures - 1));
      timer = setTimeout(() => void run(), delay);
    };

    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, intervalMs, nonce, key]);

  return refresh;
}

/**
 * The Phoenix equity market list, fetched once per app session.
 *
 * Metadata only — deliberately carries no prices (see `getPhoenixPrices`). The
 * list barely changes, so it is cached at module scope: search re-renders on
 * every keystroke and must not refetch 23 markets to filter them.
 */
let marketsCache: PhoenixMarket[] | null = null;
let marketsInFlight: Promise<PhoenixMarket[]> | null = null;
let marketsFetchedAt = 0;

/**
 * How long a market list missing its crypto artwork is served before the next
 * consumer refetches it.
 *
 * The backend joins tokens.xyz icons onto the markets from an index it builds
 * lazily, and a cold instance answers the first caller without them rather than
 * making it wait (see `lib/server/phoenix/icons.ts`). Since this cache lives for
 * the whole session, that one unlucky response would otherwise leave every
 * crypto perp on the letter placeholder until the app restarts. Treating it as
 * stale costs one request and fixes itself on the next screen.
 */
const ICONLESS_MARKETS_TTL_MS = 30_000;

/** True when the list has crypto markets and the icon join has not landed yet. */
function cryptoIconsPending(markets: PhoenixMarket[]): boolean {
  const crypto = markets.filter((market) => market.category === 'crypto');
  return crypto.length > 0 && crypto.every((market) => !market.iconUri);
}

export function usePhoenixMarkets(enabled = true): {
  markets: PhoenixMarket[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [markets, setMarkets] = useState<PhoenixMarket[]>(marketsCache ?? []);
  const [loading, setLoading] = useState(enabled && marketsCache === null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    marketsCache = null;
    setError(null);
    setLoading(true);
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // A warm cache still has to be adopted into state.
    //
    // This is the whole reason the venue toggle used to go missing: a consumer
    // that mounts while `enabled` is false — `stock-detail-sheet` does, its
    // `stock` is null until `open()` — reads an empty list at mount. By the time
    // it flips to enabled, another screen has usually filled `marketsCache`, and
    // the old early-return then skipped the fetch AND the state write, leaving
    // that consumer on `[]` for the rest of the session. No market matched the
    // asset, so `canToggleMarket` stayed false and the perp side was
    // unreachable — intermittently, depending on which screen loaded first.
    const stale =
      marketsCache !== null &&
      cryptoIconsPending(marketsCache) &&
      Date.now() - marketsFetchedAt > ICONLESS_MARKETS_TTL_MS;

    if (marketsCache !== null && !stale) {
      setMarkets(marketsCache);
      setLoading(false);
      return;
    }

    if (stale) {
      // Keep the rows on screen while the refetch runs — this is artwork
      // arriving late, not a load.
      setMarkets(marketsCache!);
      marketsCache = null;
    }

    let cancelled = false;
    setLoading(true);

    // Coalesce: several mounted consumers on one screen must not each fetch.
    marketsInFlight ??= listPhoenixMarkets().then((result) => {
      marketsCache = result;
      marketsFetchedAt = Date.now();
      marketsInFlight = null;
      return result;
    });

    marketsInFlight
      .then((result) => {
        if (!cancelled) setMarkets(result);
      })
      .catch((e: unknown) => {
        marketsInFlight = null;
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load perp markets');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, nonce]);

  return { markets, loading, error, refresh };
}

/**
 * Live mark prices for up to {@link PHOENIX_MAX_PRICE_BATCH} symbols.
 *
 * Prices only what the caller passes, which should be what is actually on
 * screen — the backend caps the batch at 8 and pricing the whole board would
 * cost ~5s and trip 429s.
 *
 * Last-good values are retained on a failed poll: a row that has shown a price
 * must never flip back to a dash because one request timed out.
 */
export type PhoenixLivePrices = {
  prices: Record<string, number | null>;
  /** 24h change per symbol, for list rows that show it next to the price. */
  changes: Record<string, PhoenixChange24h | null>;
};

export function usePhoenixLivePrices(
  symbols: string[],
  enabled = true,
): PhoenixLivePrices {
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [changes, setChanges] = useState<Record<string, PhoenixChange24h | null>>({});
  const foreground = useIsForeground();

  // A stable key so the poll restarts on a genuine symbol change, not on every
  // render that happens to build a new array.
  const key = symbols.slice(0, PHOENIX_MAX_PRICE_BATCH).join(',');

  // Symbols whose 24h change the batch endpoint did not carry. Older backends
  // return prices only, so the change is derived here from daily candles rather
  // than leaving the list showing a dash until the API catches up.
  const derivedRef = useRef<Record<string, number>>({});

  const tick = useCallback(async () => {
    if (!key) return;
    const { prices: next, changes: nextChanges } = await getPhoenixPrices(key.split(','));
    setPrices((current) => {
      const merged = { ...current };
      for (const [symbol, price] of Object.entries(next)) {
        // Keep the last good price rather than overwriting it with null.
        if (price !== null) merged[symbol] = price;
        else if (!(symbol in merged)) merged[symbol] = null;
      }
      return merged;
    });
    if (nextChanges) {
      setChanges((current) => {
        const merged = { ...current };
        for (const [symbol, change] of Object.entries(nextChanges)) {
          // Same rule as prices: a transient null must not blank a good value.
          if (change !== null) merged[symbol] = change;
          else if (!(symbol in merged)) merged[symbol] = null;
        }
        return merged;
      });
    }
  }, [key]);

  usePoll(tick, PRICE_POLL_MS, enabled && foreground && key.length > 0);

  // Fallback pass: one daily-candle pair per symbol the batch didn't cover, at
  // most once a minute each. A 24h change moves slowly enough that this is far
  // cheaper than it looks, and it stops as soon as the API supplies the field.
  const deriveChanges = useCallback(async () => {
    if (!key) return;
    const now = Date.now();
    const stale = key
      .split(',')
      .filter((symbol) => (derivedRef.current[symbol] ?? 0) < now - CHANGE_DERIVE_MS)
      .slice(0, PHOENIX_MAX_PRICE_BATCH);
    if (stale.length === 0) return;

    const results = await Promise.allSettled(
      stale.map(async (symbol) => {
        const candles = await getPhoenixCandles(symbol, '1d', 2);
        return { symbol, change: change24hFromCandles(candles) };
      }),
    );

    const derived: Record<string, PhoenixChange24h> = {};
    for (const result of results) {
      if (result.status !== 'fulfilled' || result.value.change === null) continue;
      derived[result.value.symbol] = result.value.change;
      derivedRef.current[result.value.symbol] = now;
    }
    if (Object.keys(derived).length === 0) return;

    // Never overwrite a value the API did supply — that one is authoritative.
    setChanges((current) => {
      const merged = { ...current };
      for (const [symbol, change] of Object.entries(derived)) {
        if (!merged[symbol]) merged[symbol] = change;
      }
      return merged;
    });
  }, [key]);

  usePoll(deriveChanges, CHANGE_DERIVE_MS, enabled && foreground && key.length > 0);

  return { prices, changes };
}

/**
 * Live mark prices for a list longer than one price batch.
 *
 * The backend caps a batch at {@link PHOENIX_MAX_PRICE_BATCH}, so a list of 20
 * perps would leave 12 rows on a skeleton forever. Instead the priced window
 * steps through the list one batch per poll: every row gets a first price
 * within a few seconds and refreshes every `pages × 5s`, while the upstream
 * cost stays exactly one batch per poll. A list that fits in one batch behaves
 * exactly like {@link usePhoenixLivePrices}.
 */
export function usePhoenixRotatingPrices(
  symbols: string[],
  enabled = true,
): PhoenixLivePrices {
  const listKey = symbols.join(',');
  const pages = Math.max(1, Math.ceil(symbols.length / PHOENIX_MAX_PRICE_BATCH));
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [listKey]);

  useEffect(() => {
    if (!enabled || pages <= 1) return;
    const timer = setInterval(() => setPage((value) => (value + 1) % pages), PRICE_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, pages, listKey]);

  const window = useMemo(() => {
    const start = (page % pages) * PHOENIX_MAX_PRICE_BATCH;
    return listKey ? listKey.split(',').slice(start, start + PHOENIX_MAX_PRICE_BATCH) : [];
  }, [listKey, page, pages]);

  // The underlying hook keeps every symbol's last good value across windows,
  // so rows priced on an earlier page keep their numbers.
  return usePhoenixLivePrices(window, enabled);
}

/** Two daily closes is all a 24h change is. */
function change24hFromCandles(candles: PhoenixCandle[]): PhoenixChange24h | null {
  if (candles.length < 2) return null;
  const [previous, current] = candles.slice(-2);
  if (!previous.markClose) return null;
  const changeUsd = current.markClose - previous.markClose;
  return { changeUsd, changePercent: (changeUsd / previous.markClose) * 100 };
}

export type PhoenixLiveMarket = {
  detail: PhoenixMarketDetail | null;
  candles: PhoenixCandle[];
  loading: boolean;
  error: string | null;
  /** Kept apart from `error`: the price can be live while the chart failed. */
  candlesError: string | null;
  refresh: () => void;
};

/**
 * Everything the detail sheet needs for one market, kept live.
 *
 * Two independent polls, because the data changes at different rates and the
 * mark price is what the user watches: the price ticks every 5s while candles
 * refresh every 15s.
 *
 * The chart is made to tick with the price by folding the live mark into the
 * most recent candle (see `applyLiveMark`), so the rightmost bar moves between
 * candle refreshes instead of sitting frozen for 15 seconds.
 */
export function usePhoenixLiveMarket(
  symbol: string | null,
  timeframe: PhoenixTimeframe,
  enabled = true,
): PhoenixLiveMarket {
  const [detail, setDetail] = useState<PhoenixMarketDetail | null>(null);
  const [candles, setCandles] = useState<PhoenixCandle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candlesError, setCandlesError] = useState<string | null>(null);
  const foreground = useIsForeground();

  const active = enabled && foreground && !!symbol;

  // Drop stale data the moment the symbol changes, so the sheet never shows one
  // market's price above another's chart.
  useEffect(() => {
    setDetail(null);
    setCandles([]);
    setError(null);
    setLoading(!!symbol);
  }, [symbol]);

  // A timeframe switch throws away the old series, so the chart has nothing to
  // draw until the refetch lands — say so, or the plot renders its "No candles"
  // empty state and the timeframe looks broken.
  useEffect(() => {
    setCandles([]);
    setCandlesError(null);
    setLoading(!!symbol);
  }, [timeframe, symbol]);

  const detailTick = useCallback(async () => {
    if (!symbol) return;
    try {
      setDetail(await getPhoenixMarket(symbol));
      setError(null);
    } catch (e) {
      // Only surface an error while there is nothing to show; once a price is on
      // screen a failed poll should leave it there.
      setError((current) =>
        current ?? (e instanceof Error ? e.message : 'Failed to load market'),
      );
      throw e;
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const candleTick = useCallback(async () => {
    if (!symbol) return;
    try {
      // Deep enough that the chart has history to scroll into: the plot shows
      // ~34 bars at rest and zooms out to 160, so 120 ran out under a pinch.
      setCandles(await getPhoenixCandles(symbol, timeframe, CANDLE_HISTORY));
      setCandlesError(null);
    } catch (e) {
      // A failed candle poll used to be invisible: the series stayed empty and
      // the chart drew its "No candles" empty state, which reads as "this
      // timeframe is broken" rather than "that one request failed".
      setCandlesError(e instanceof Error ? e.message : 'Failed to load candles');
      throw e;
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  const refreshDetail = usePoll(detailTick, PRICE_POLL_MS, active);
  // Keyed on the timeframe: without it the loop keeps its old schedule and the
  // new series doesn't arrive until the next 15s tick.
  const refreshCandles = usePoll(candleTick, CANDLE_POLL_MS, active, timeframe);

  const refresh = useCallback(() => {
    refreshDetail();
    refreshCandles();
  }, [refreshDetail, refreshCandles]);

  return { detail, candles, loading, error, candlesError, refresh };
}

/**
 * Fold the live mark price into the newest candle so the chart's last bar tracks
 * it between refreshes.
 *
 * Only `markClose` — and `markHigh`/`markLow` when the price moves outside them —
 * are touched. `markOpen` is left alone: rewriting it would redraw history, and
 * the whole point of charting the mark series is that it agrees with the number
 * printed above the chart.
 */
export function applyLiveMark(candles: PhoenixCandle[], mark: number | null): PhoenixCandle[] {
  if (mark === null || candles.length === 0) return candles;

  const last = candles[candles.length - 1];
  const updated: PhoenixCandle = {
    ...last,
    markClose: mark,
    markHigh: Math.max(last.markHigh, mark),
    markLow: Math.min(last.markLow, mark),
    close: mark,
  };

  return [...candles.slice(0, -1), updated];
}

/**
 * Move across the chart's visible window: the first visible bar's mark open to
 * the live mark (or the newest close). This is what the header % must show —
 * the timeframe pills change the window, and a fixed 24h figure beside a 4H or
 * 1D chart made the change look frozen. `visibleCount` is the chart's opening
 * viewport (it loads far more history than it shows). Null until loaded.
 */
export function chartWindowChange(
  candles: PhoenixCandle[],
  mark: number | null,
  visibleCount: number,
): { changeUsd: number; changePercent: number } | null {
  if (candles.length === 0) return null;
  const first = candles[Math.max(0, candles.length - Math.max(1, visibleCount))];
  const start = first.markOpen > 0 ? first.markOpen : first.open;
  const last = candles[candles.length - 1];
  const end = mark ?? (last.markClose > 0 ? last.markClose : last.close);
  if (!(start > 0) || !Number.isFinite(end)) return null;
  return { changeUsd: end - start, changePercent: ((end - start) / start) * 100 };
}

/**
 * The perp chart's pills are *ranges*, the same 24H / 7D / 1M / 3M the spot
 * chart offers beside it. They used to be candle sizes (15M…1D) showing 34
 * bars, so perp "1D" meant ~34 days and its % could never match spot's 24H.
 * Each range picks a candle size and exactly the bars that span it.
 */
export type PhoenixRange = '24H' | '7D' | '1M' | '3M';

export const PHOENIX_RANGES: Record<PhoenixRange, { timeframe: PhoenixTimeframe; bars: number }> = {
  '24H': { timeframe: '15m', bars: 96 },
  '7D': { timeframe: '1h', bars: 168 },
  '1M': { timeframe: '4h', bars: 180 },
  '3M': { timeframe: '1d', bars: 90 },
};

export const PHOENIX_RANGE_ORDER: PhoenixRange[] = ['24H', '7D', '1M', '3M'];
