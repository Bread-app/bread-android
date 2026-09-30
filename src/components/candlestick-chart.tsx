import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import {
  downsampleOhlcv,
  getBirdeyeOhlcv,
  type BirdeyeOhlcvItem,
  type BirdeyeOhlcvTimeframe,
} from '@/lib/api';
import type { PhoenixCandle } from '@/lib/phoenix-api';
import { type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { PhoenixMarkChart } from './phoenix-mark-chart';
import { WavingLineSkeleton } from './waving-line-skeleton';

/* ─── Types ─── */

export type ChartWindow = '24H' | '1W' | '1M' | '3M' | '1Y';

type CandlestickChartProps = {
  mint: string;
  /** Canonical Tokens.xyz asset id; history matches its dashboard when present. */
  assetId?: string | null;
  activeWindow: ChartWindow;
  onScrub?: (price: number | null, change: number | null) => void;
  onScrubTime?: (timestamp: number | null) => void;
  onWindowChange?: (
    price: number | null,
    change: number | null,
    window: ChartWindow,
  ) => void;
  /**
   * Latest traded price from the caller's live feed, folded into the newest
   * bar and drawn as the live-price rule — the same thing `markPrice` is on a
   * Perps chart.
   */
  livePrice?: number | null;
  /** Plot height. Defaults to the 220 the compact detail sheets use. */
  height?: number;
};

/* ─── Constants ─── */

const CHART_HEIGHT = 220;

// The SVG chart capped at 60 because a phone-width plot could not draw more
// legibly. lightweight-charts pans and zooms, so the cap now exists only to
// bound the payload crossing the bridge. Lower it if the 1Y fetch feels heavy.
const MAX_CANDLES = 240;
const LIVE_REFRESH_MS = 15_000;

const DAY = 24 * 60 * 60;

const now = () => Math.floor(Date.now() / 1000);

type Window = ChartWindow;

const WINDOWS: {
  label: Window;
  birdeyeType: BirdeyeOhlcvTimeframe;
  durationSec: number;
}[] = [
  { label: '24H', birdeyeType: '1H', durationSec: DAY },
  { label: '1W', birdeyeType: '4H', durationSec: 7 * DAY },
  // 1M uses 4H (not 1D) candles: 30 daily bars are sparse, and — more
  // importantly — recently-listed stocks only have a few days of daily
  // history, so a 1D 1M chart collapses to the exact same candles as the 1D 3M
  // chart. A finer interval keeps 1M distinct from 3M and adds intraday detail.
  { label: '1M', birdeyeType: '4H', durationSec: 30 * DAY },
  { label: '3M', birdeyeType: '1D', durationSec: 90 * DAY },
  { label: '1Y', birdeyeType: '1D', durationSec: 365 * DAY },
];

/* ─── Helpers ─── */

function getWindowChange(
  candles: BirdeyeOhlcvItem[],
  targetIndex = candles.length - 1,
): { price: number | null; change: number | null } {
  if (candles.length === 0) {
    return { price: null, change: null };
  }

  const first = candles[0];
  const target = candles[Math.max(0, Math.min(targetIndex, candles.length - 1))];
  const base = first.open || first.close;
  const price = target.close;

  if (!Number.isFinite(base) || !Number.isFinite(price) || base <= 0) {
    return { price: Number.isFinite(price) ? price : null, change: null };
  }

  return {
    price,
    change: ((price - base) / base) * 100,
  };
}

/* ─── Component ─── */

function CandlestickChartImpl({
  mint,
  assetId,
  activeWindow,
  onScrub,
  onScrubTime,
  onWindowChange,
  livePrice,
  height = CHART_HEIGHT,
}: CandlestickChartProps) {
  const styles = useThemedStyles(makeStyles);
  const [candles, setCandles] = useState<BirdeyeOhlcvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const chartIdentity = assetId?.trim() || mint;
  // PhoenixMarkChart lays out against an explicit width — it has to know the
  // plot's pixel width to place candles on the UI thread — so the plot is
  // measured rather than flexed.
  const [chartWidth, setChartWidth] = useState(0);
  const handleChartLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setChartWidth((current) => (current === next ? current : next));
  }, []);

  /* Fetch candles on mount & window change — unchanged data source. */
  const fetchCandles = useCallback(
    async (win: Window, silent = false) => {
      const cfg = WINDOWS.find((w) => w.label === win) ?? WINDOWS[0];
      const id = ++requestIdRef.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }

      try {
        // Anchor the request to real time: `from = now - window`. This keeps
        // the chart's up/down consistent with the header's 24h change. If a
        // feed lags real-time (e.g. some prestocks/Kalshi), this window simply
        // has no candles and we render the "No data" state rather than showing
        // stale data that disagrees with the headline numbers.
        const bucketSec = cfg.birdeyeType === '5m' ? 300 : cfg.birdeyeType === '1H' ? 3_600 : 14_400;
        const fromSec = Math.floor((now() - cfg.durationSec) / bucketSec) * bucketSec;
        const result = await getBirdeyeOhlcv(chartIdentity, cfg.birdeyeType, fromSec, {
          bypassCache: win === '24H',
        });

        if (id !== requestIdRef.current) return;

        // Downsample (not slice) so long windows like 1Y keep their full span
        // instead of collapsing to the most recent MAX_CANDLES days.
        setCandles(downsampleOhlcv(result.items, MAX_CANDLES));
      } catch (err) {
        if (id !== requestIdRef.current) return;
        if (!silent) {
          setCandles([]);
          setError(err instanceof Error ? err.message : 'Failed to load chart data');
        }
      } finally {
        if (!silent && id === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [chartIdentity],
  );

  useEffect(() => {
    void fetchCandles(activeWindow);
  }, [fetchCandles, activeWindow]);

  useEffect(() => {
    if (activeWindow !== '24H') return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = setInterval(() => void fetchCandles('24H', true), LIVE_REFRESH_MS);
    };

    if (AppState.currentState === 'active') start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void fetchCandles('24H', true);
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      subscription.remove();
    };
  }, [activeWindow, fetchCandles]);

  /**
   * Spot OHLCV in the shape the Perps chart draws.
   *
   * That chart plots the `mark*` series (on a perp, mark price rather than
   * last trade — see its own docs); spot has one price, so both sets carry the
   * same numbers. `livePrice` is folded into the newest bar here, which is what
   * `applyLiveMark` does for a Perps market: the last candle grows to include
   * the tick instead of the series being replaced.
   */
  const data = useMemo<PhoenixCandle[]>(() => {
    const mapped = candles.map((c): PhoenixCandle => ({
      time: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      markOpen: c.open,
      markHigh: c.high,
      markLow: c.low,
      markClose: c.close,
      volume: 0,
      volumeQuote: 0,
      tradeCount: 0,
    }));

    const live = livePrice;
    const last = mapped[mapped.length - 1];
    if (last && live != null && Number.isFinite(live) && live > 0) {
      mapped[mapped.length - 1] = {
        ...last,
        high: Math.max(last.high, live),
        low: Math.min(last.low, live),
        close: live,
        markHigh: Math.max(last.markHigh, live),
        markLow: Math.min(last.markLow, live),
        markClose: live,
      };
    }
    return mapped;
  }, [candles, livePrice]);

  useEffect(() => {
    const windowChange = getWindowChange(candles);
    onWindowChange?.(windowChange.price, windowChange.change, activeWindow);
  }, [candles, onWindowChange, activeWindow]);

  /* Crosshair → the sheet header's scrub price. The chart's own crosshair
   * already carries the haptic (selection feedback per bar, same as Perps), so
   * nothing is fired here on top of it. */
  const handleCrosshair = useCallback(
    (bar: PhoenixCandle | null) => {
      if (!bar) {
        onScrub?.(null, null);
        onScrubTime?.(null);
        return;
      }

      const index = candles.findIndex((c) => c.timestamp === bar.time);
      const windowChange = getWindowChange(candles, index < 0 ? candles.length - 1 : index);
      if (windowChange.price !== null) onScrub?.(windowChange.price, windowChange.change);
      onScrubTime?.(bar.time);
    },
    [candles, onScrub, onScrubTime],
  );

  return (
    <View style={styles.container}>
      {loading && candles.length === 0 ? (
        <WavingLineSkeleton height={height} />
      ) : error && candles.length === 0 ? (
        <View style={[styles.errorWrap, { height }]}>
          <Text style={styles.errorTitle}>Chart unavailable</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Pressable onPress={() => void fetchCandles(activeWindow)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : candles.length === 0 ? (
        <View style={[styles.emptyState, { height }]}>
          <Text style={styles.emptyTitle}>No candlestick data</Text>
          <Text style={styles.emptyBody}>No chart data was returned for this asset.</Text>
        </View>
      ) : (
        <View
          onLayout={handleChartLayout}
          style={[styles.chartArea, { height }, loading && styles.chartAreaLoading]}
        >
          {chartWidth > 0 ? (
            // The Perps chart, on spot candles — same Skia plot, same grid,
            // same price/time axes, and the same gestures (pinch to zoom,
            // drag to scroll history, hold for a crosshair). It draws
            // straight onto the sheet's own surface, so the chart has no
            // background of its own.
            <PhoenixMarkChart
              candles={data}
              width={chartWidth}
              height={height}
              priceAxis
              timeAxis
              interactive
              initialVisibleCandles="all"
              hideAxis
              viewportKey={`${chartIdentity}:${activeWindow}`}
              markPrice={livePrice ?? null}
              onCrosshairChange={handleCrosshair}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

/* ─── Styles ─── */

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    gap: 8,
  },
  chartArea: {
    height: CHART_HEIGHT,
  },
  chartAreaLoading: {
    opacity: 0.5,
  },
  errorWrap: {
    height: CHART_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 6,
  },
  errorTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: '800',
  },
  errorBody: {
    color: c.textSecondary,
    fontSize: 12,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: c.text,
  },
  retryText: {
    color: c.background,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyState: {
    height: CHART_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  emptyTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: '800',
  },
  emptyBody: {
    color: c.textSecondary,
    fontSize: 12,
  },
});

// Memoized so the detail sheet re-rendering on every scrub frame / network
// state change doesn't re-render this heavy chart. Props are primitives plus
// stable (useCallback) callbacks and a memoized `tweetMarkers` array.
export const CandlestickChart = React.memo(CandlestickChartImpl);
