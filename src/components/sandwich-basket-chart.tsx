import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Pattern, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { AnimatedScrubText } from '@/components/animated-scrub-text';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  getBirdeyeOhlcv,
  getPolymarketCandles,
  type BirdeyeOhlcvTimeframe,
} from '@/lib/api';
import { getPhoenixCandles, type PhoenixTimeframe } from '@/lib/phoenix-api';
import { positionChartMarkers } from '@/lib/chart-markers';
import {
  anchorLatestReturn,
  buildBasketPoints,
  buildPredictionPoints,
  clipCandlesAt,
  synthesizeFallbackPoints,
  type BasketPoint,
  type LoadedLeg,
  type SandwichBasketChartLeg,
} from '@/lib/basket-points';

export type { SandwichBasketChartLeg } from '@/lib/basket-points';

const F = Fonts.rounded;

const SCRUB_DOT_SIZE = 12;

type SandwichBasketChartProps = {
  legs: SandwichBasketChartLeg[];
  createdAt: string | null;
  /** Freeze a settled position's curve at its exit instead of extending to now. */
  endedAt?: string | null;
  /** User fills pinned to the nearest point on the performance line. */
  markers?: readonly SandwichChartMarker[];
  targetReturnPct?: number | null;
  title?: string;
  subtitle?: string;
  showReturn?: boolean;
  /**
   * 'full' (default) renders the boxed chart with grid, baseline and footer.
   * 'spark' renders a bare, glowing line only — no grid, box, footer or
   * scrub chrome — for embedding as a sparkline inside another card.
   */
  variant?: 'full' | 'spark';
  /** Override the chart height. Defaults to the full-chart height (160). */
  height?: number;
  /**
   * Lookback window for the chart. When set, the chart starts at
   * `max(createdAt, now - window)` so it shows just that recent slice of the
   * basket's life (clamped to never start before the thesis was created). When
   * omitted, the chart shows the full history since creation (default).
   */
  window?: SandwichChartRange;
  onScrub?: (returnPct: number | null) => void;
  showEndpointDot?: boolean;
  /** Optional fixed line color for theme-independent embeds such as share cards. */
  color?: string;
  /** Background used by the line-reveal mask. Defaults to the active theme. */
  revealBackgroundColor?: string;
  /**
   * Reports the drawn line's pixel geometry (points in chart-local
   * coordinates, plus the chart's size) whenever it changes, so a parent can
   * pin overlays — markers, callouts — onto the line. Called with null while
   * there is no drawable line.
   */
  onGeometry?: (geometry: SandwichChartGeometry | null) => void;
  /** Draw a faint dotted grid behind the line (detail screens only; ignored for 'spark'). */
  showDotGrid?: boolean;
  /** Drops the date / "Holding period" line under the plot. */
  hideFooter?: boolean;
  /**
   * UI-thread mirror of the number the chart is displaying. The owner reads
   * these to render its own headline without a render per scrub sample:
   * `scrubValueActive` is 1 while the chart's figure should win over the
   * owner's resting value.
   */
  scrubValue?: SharedValue<number>;
  scrubValueActive?: SharedValue<number>;
};

export type SandwichChartMarker = {
  id: string;
  side: 'entry' | 'exit';
  occurredAt: string;
};

export type SandwichChartGeometry = {
  points: { x: number; y: number }[];
  width: number;
  height: number;
};

type ChartDataSource = 'basket' | 'polymarket';

const CHART_HEIGHT = 160;

function ChartSkeleton() {
  const styles = useThemedStyles(makeStyles);
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
  }, [shimmer]);

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmer.value, [0, 1], [0.45, 0.9]),
  }));

  return (
    <Animated.View style={[styles.skeletonWrap, shimmerStyle]}>
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonLineMid]} />
      <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
      <View style={styles.skeletonBar} />
    </Animated.View>
  );
}
const MAX_PREDICTION_CANDLES = 48;

const now = () => Math.floor(Date.now() / 1000);

/**
 * Selectable lookback windows for the detail-screen timeframe pills. 'ALL' is
 * the full history since creation — the window the headline PnL is measured
 * over, so it's the only one whose curve is anchored to that number.
 */
export type SandwichChartRange = '24H' | '1W' | '1M' | '3M' | 'ALL';

const RANGE_SECONDS: Record<Exclude<SandwichChartRange, 'ALL'>, number> = {
  '24H': 24 * 60 * 60,
  '1W': 7 * 24 * 60 * 60,
  '1M': 30 * 24 * 60 * 60,
  '3M': 90 * 24 * 60 * 60,
};

function rangeSeconds(range: SandwichChartRange | undefined): number | null {
  if (!range || range === 'ALL') return null;
  return RANGE_SECONDS[range];
}

function formatPercent(value: number | null): string {
  if (value === null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatPredictionPrice(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return `${Math.round(value * 100)}c`;
}

function formatAxisLabel(timestamp: number): string {
  const ageMs = Date.now() - timestamp;
  if (ageMs < 3 * 24 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(timestamp));
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

function buildLinePath(
  points: { x: number; y: number }[],
  smooth = true,
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;

  if (!smooth) {
    return points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
      .join(" ");
  }

  // Catmull-Rom to cubic bezier for a smooth curve
  let d = `M${points[0].x},${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    const tension = 0.3;
    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 3;
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 3;
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 3;
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 3;

    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }

  return d;
}

function parseCreatedAt(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function getTimeframeForCreatedAt(
  createdAtSeconds: number,
  endSeconds = now(),
): BirdeyeOhlcvTimeframe {
  const ageSeconds = Math.max(0, endSeconds - createdAtSeconds);

  if (ageSeconds <= 60 * 60) return '1m';
  if (ageSeconds <= 6 * 60 * 60) return '5m';
  if (ageSeconds <= 7 * 24 * 60 * 60) return '1H';
  if (ageSeconds <= 30 * 24 * 60 * 60) return '4H';
  return '1D';
}

function getPredictionTimeframeForCreatedAt(
  createdAtSeconds: number,
  endSeconds = now(),
): BirdeyeOhlcvTimeframe {
  const ageSeconds = Math.max(0, endSeconds - createdAtSeconds);

  if (ageSeconds <= 60 * 60) return '1m';
  if (ageSeconds <= 6 * 60 * 60) return '5m';
  if (ageSeconds <= 24 * 60 * 60) return '1H';
  if (ageSeconds <= 45 * 24 * 60 * 60) return '4H';
  return '1D';
}

function phoenixWindow(
  fromSeconds: number,
  toSeconds: number,
): { timeframe: PhoenixTimeframe; basketTimeframe: BirdeyeOhlcvTimeframe; limit: number } {
  const duration = Math.max(60, toSeconds - fromSeconds);
  const choice = duration <= 60 * 60
    ? { timeframe: '1m' as const, basketTimeframe: '1m' as const, step: 60 }
    : duration <= 6 * 60 * 60
      ? { timeframe: '5m' as const, basketTimeframe: '5m' as const, step: 300 }
      : duration <= 7 * 24 * 60 * 60
        ? { timeframe: '1h' as const, basketTimeframe: '1H' as const, step: 3600 }
        : duration <= 30 * 24 * 60 * 60
          ? { timeframe: '4h' as const, basketTimeframe: '4H' as const, step: 14_400 }
          : { timeframe: '1d' as const, basketTimeframe: '1D' as const, step: 86_400 };
  return { ...choice, limit: Math.min(1000, Math.max(2, Math.ceil(duration / choice.step) + 2)) };
}

export function SandwichBasketChart({
  legs,
  createdAt,
  endedAt = null,
  markers = [],
  targetReturnPct,
  showReturn = true,
  variant = 'full',
  height,
  window: rangeWindow,
  onScrub,
  showEndpointDot = true,
  color,
  revealBackgroundColor,
  onGeometry,
  showDotGrid = false,
  hideFooter = false,
  scrubValue,
  scrubValueActive,
}: SandwichBasketChartProps) {
  const { colors } = useThemeStore();
  const styles = useThemedStyles(makeStyles);
  const isSpark = variant === 'spark';
  const chartHeight = height ?? CHART_HEIGHT;
  const paddingX = isSpark ? 10 : 0;
  const paddingTop = isSpark ? 18 : 16;
  const paddingBottom = isSpark ? 18 : 8;
  const [points, setPoints] = useState<BasketPoint[]>([]);
  const [chartDataSource, setChartDataSource] = useState<ChartDataSource>('basket');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartWidth, setChartWidth] = useState(320);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const requestIdRef = useRef(0);
  const wipeProgress = useSharedValue(0);

  // Scrub state lives on the UI thread: the crosshair and dot follow the finger
  // frame-for-frame without waiting on a React render. JS only hears about the
  // scrub when the *nearest index* changes, which is all the labels need.
  const scrubX = useSharedValue(0);
  const scrubY = useSharedValue(0);
  const scrubActive = useSharedValue(0);
  const scrubPointXs = useSharedValue<number[]>([]);
  const scrubPointYs = useSharedValue<number[]>([]);
  const lastScrubIndex = useSharedValue(-1);
  const lastHapticAt = useSharedValue(0);
  // Labels are formatted once per data load, in JS, and picked by index inside
  // the worklet — Intl and Date are not worklet-safe, and formatting per frame
  // would be wasted work anyway.
  const scrubReturnLabels = useSharedValue<string[]>([]);
  const scrubDateLabels = useSharedValue<string[]>([]);
  const scrubReturns = useSharedValue<number[]>([]);
  const returnText = useSharedValue('--');
  const returnColor = useSharedValue('#FFFFFF');
  const dateText = useSharedValue('');
  const isScrubbing = useSharedValue(0);
  // What the labels fall back to the moment the finger lifts.
  const restReturnText = useSharedValue('--');
  const restDateText = useSharedValue('');
  const restReturnValue = useSharedValue(Number.NaN);
  const restReturnActive = useSharedValue(0);

  // Keyed on what the fetch actually reads, not on array identity. The owner
  // hands us a new `legs` array on every state change it makes — liking the
  // sandwich, a background refresh — and keying the memos below on the array
  // itself rebuilt fetchBasket each time, reloading a chart whose inputs had
  // not changed.
  const legsKey = useMemo(
    () =>
      legs
        .map(
          (leg) =>
            `${leg.id}:${leg.type ?? ''}:${leg.mint ?? ''}:${leg.marketId ?? ''}:${leg.side ?? ''}:${leg.weightBps}`,
        )
        .join('|'),
    [legs],
  );
  const chartLegs = useMemo(
    () =>
      legs
        .filter(
          (leg) =>
            leg.weightBps > 0 &&
            (leg.type === 'perp'
              ? Boolean(leg.symbol)
              : (leg.type === undefined || leg.type === 'tokenized_stock') && Boolean(leg.mint)),
        )
        .sort((a, b) => (b.weightBps ?? 0) - (a.weightBps ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- legsKey covers every field read here
    [legsKey],
  );
  const predictionLegs = useMemo(
    () =>
      legs
        .filter((leg) => leg.type === 'prediction_market' && leg.weightBps > 0)
        .sort((a, b) => (b.weightBps ?? 0) - (a.weightBps ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- legsKey covers every field read here
    [legsKey],
  );
  const primaryPredictionLeg = predictionLegs[0] ?? null;
  const createdAtSeconds = useMemo(() => parseCreatedAt(createdAt), [createdAt]);
  const endedAtSeconds = useMemo(() => parseCreatedAt(endedAt), [endedAt]);

  const loadPredictionPoints = useCallback(
    async (createdAtValue: number): Promise<BasketPoint[]> => {
      if (!primaryPredictionLeg?.marketId) return [];
      const timeframe = getPredictionTimeframeForCreatedAt(
        createdAtValue,
        endedAtSeconds ?? now(),
      );
      const result = await getPolymarketCandles(
        primaryPredictionLeg.marketId,
        primaryPredictionLeg.side ?? 'yes',
        timeframe,
        createdAtValue,
      );
      const nextCandles = clipCandlesAt(result.candles, endedAtSeconds)
        .filter((candle) => Number.isFinite(candle.close) && candle.close > 0)
        .slice(-MAX_PREDICTION_CANDLES);
      return buildPredictionPoints(nextCandles);
    },
    [endedAtSeconds, primaryPredictionLeg?.marketId, primaryPredictionLeg?.side],
  );

  const fetchBasket = useCallback(
    async () => {
      const id = ++requestIdRef.current;

      setLoading(true);
      setError(null);

      if (createdAtSeconds === null) {
        setPoints([]);
        setChartDataSource('basket');
        setSelectedIndex(-1);
        setError('Sandwich creation time is missing.');
        setLoading(false);
        return;
      }

      // Windowed views start at `now - window`, clamped to never begin before
      // the thesis was created (we have no position before then). With no
      // window, show the full history since creation. `isFullHistory` gates the
      // PnL anchoring: a zoomed-in window's return is window-relative, not the
      // canonical since-creation PnL, so it must not be re-anchored.
      const windowSeconds = rangeSeconds(rangeWindow);
      const fromSeconds = windowSeconds
        ? Math.max(createdAtSeconds, now() - windowSeconds)
        : createdAtSeconds;
      const isFullHistory = fromSeconds <= createdAtSeconds;

      const totalLegCount = chartLegs.length + predictionLegs.length;
      const isPmOnlyBasket = chartLegs.length === 0 && predictionLegs.length === 1 && !!primaryPredictionLeg?.marketId;

      if (chartLegs.length === 0) {
        setPoints([]);
        setChartDataSource('basket');

        if (isPmOnlyBasket && primaryPredictionLeg?.marketId) {
          try {
            const nextPoints = await loadPredictionPoints(fromSeconds);
            if (id !== requestIdRef.current) return;

            if (nextPoints.length > 0) {
              setChartDataSource('polymarket');
              setPoints(nextPoints);
              setSelectedIndex(nextPoints.length - 1);
              setError(null);
              setLoading(false);
              return;
            }
          } catch {
            if (id !== requestIdRef.current) return;
          }
        }

        setPoints([]);
        setSelectedIndex(-1);
        setError(
          predictionLegs.length > 0
            ? 'Historical candles are unavailable for this position.'
            : 'No chartable legs were recorded for this position.',
        );
        setLoading(false);
        return;
      }

      let timeframe = getTimeframeForCreatedAt(
        fromSeconds,
        endedAtSeconds ?? now(),
      );

      const loadLegs = (spotTimeframe: BirdeyeOhlcvTimeframe) => Promise.allSettled(
        [
          ...chartLegs.map(async (leg): Promise<LoadedLeg> => {
            if (leg.type === 'perp' && leg.symbol) {
              const endSeconds = endedAtSeconds ?? now();
              const phoenix = phoenixWindow(fromSeconds, endSeconds);
              const candles = await getPhoenixCandles(leg.symbol, phoenix.timeframe, phoenix.limit);
              return {
                leg,
                items: candles
                  .filter(
                    (candle) =>
                      candle.time >= fromSeconds * 1000 && candle.time <= endSeconds * 1000,
                  )
                  .map((candle) => ({
                    timestamp: candle.time,
                    open: candle.markOpen,
                    high: candle.markHigh,
                    low: candle.markLow,
                    close: candle.markClose,
                    volume: candle.volume,
                  })),
              };
            }
            const result = await getBirdeyeOhlcv(leg.mint!, spotTimeframe, fromSeconds, {
              ...(endedAtSeconds !== null ? { timeTo: endedAtSeconds } : {}),
            });
            return { leg, items: clipCandlesAt(result.items, endedAtSeconds) };
          }),
          ...predictionLegs.map(async (leg): Promise<LoadedLeg> => {
            if (!leg.marketId) return { leg, items: [] };
            const predictionTimeframe = getPredictionTimeframeForCreatedAt(
              fromSeconds,
              endedAtSeconds ?? now(),
            );
            const result = await getPolymarketCandles(
              leg.marketId,
              leg.side ?? 'yes',
              predictionTimeframe,
              fromSeconds,
            );
            return {
              leg,
              items: clipCandlesAt(result.candles, endedAtSeconds),
            };
          }),
        ],
      );

      let results = await loadLegs(timeframe);
      if (id !== requestIdRef.current) return;

      // tokens.xyz serves no 1m/5m candles for most equities, so a position
      // only hours old came back with nothing at all. Every spot leg empty at
      // an intraday interval → ask again at 1H, which it does serve.
      const spotLegsEmpty = (settled: typeof results) =>
        chartLegs.length > 0 &&
        settled
          .slice(0, chartLegs.length)
          .every((r) => r.status !== 'fulfilled' || r.value.items.length === 0);
      if ((timeframe === '1m' || timeframe === '5m') && spotLegsEmpty(results)) {
        timeframe = '1H';
        results = await loadLegs(timeframe);
        if (id !== requestIdRef.current) return;
      }

      const loaded = results
        .filter((result): result is PromiseFulfilledResult<LoadedLeg> => result.status === 'fulfilled')
        .map((result) => result.value);
      const loadedIds = new Set(loaded.map((entry) => entry.leg.id ?? entry.leg.legId ?? entry.leg.mint ?? entry.leg.marketId));
      for (const leg of [...chartLegs, ...predictionLegs]) {
        const idKey = leg.id ?? leg.legId ?? leg.mint ?? leg.marketId;
        if (!loadedIds.has(idKey)) loaded.push({ leg, items: [] });
      }
      // A basket missing SOME legs can't be blended honestly. One where EVERY
      // leg is empty has nothing to blend at all — that falls through to the
      // no-candles path below, which draws the known return instead.
      const anyLegHasCandles = loaded.some(({ items }) => items.length > 0);
      const hasUnrecoverableLeg = anyLegHasCandles && loaded.some(
        ({ leg, items }) =>
          items.length === 0 &&
          !(typeof leg.pnlPct === 'number' && Number.isFinite(leg.pnlPct)),
      );
      if (hasUnrecoverableLeg) {
        setChartDataSource('basket');
        setPoints([]);
        setSelectedIndex(-1);
        setError('Historical candles are unavailable for one or more position legs.');
        setLoading(false);
        return;
      }
      const basketPoints = buildBasketPoints(loaded, timeframe);
      const nextPoints = isFullHistory
        ? anchorLatestReturn(basketPoints, targetReturnPct)
        : basketPoints;

      if (nextPoints.length === 0 && totalLegCount === 1 && primaryPredictionLeg?.marketId) {
        try {
          const predictionPoints = await loadPredictionPoints(fromSeconds);
          if (id !== requestIdRef.current) return;
          if (predictionPoints.length > 0) {
            setChartDataSource('polymarket');
            setPoints(predictionPoints);
            setSelectedIndex(predictionPoints.length - 1);
            setError(null);
            setLoading(false);
            return;
          }
        } catch {
          if (id !== requestIdRef.current) return;
        }
      }

      if (nextPoints.length === 0) {
        // No candles anywhere in the window. For a position created while the
        // equity market is shut — a Sunday basket, an after-hours one — that is
        // the NORMAL state, not a failure: nothing has printed since creation,
        // so there is no series to blend, and the screen used to answer a
        // 14-minute-old sandwich with "Chart unavailable" and a Retry that
        // could not succeed before Monday's bell.
        //
        // The return since creation is still known (the server's headline), so
        // draw that: a line from 0 to the real figure across the window. Only
        // for the full-history view, where the headline describes exactly this
        // span — a zoomed window measures a period we have no number for — and
        // only when there IS a figure, so a genuine outage still says so
        // instead of drawing a confident flat line through nothing.
        const canSynthesize =
          isFullHistory && typeof targetReturnPct === 'number' && Number.isFinite(targetReturnPct);
        const fallbackPoints = canSynthesize
          ? synthesizeFallbackPoints(fromSeconds, targetReturnPct, timeframe, endedAtSeconds)
          : [];

        if (fallbackPoints.length > 0) {
          setChartDataSource('basket');
          setPoints(fallbackPoints);
          setSelectedIndex(fallbackPoints.length - 1);
          setError(null);
          setLoading(false);
          return;
        }

        setChartDataSource('basket');
        setPoints([]);
        setSelectedIndex(-1);
        setError('Historical candles are unavailable for this position.');
        setLoading(false);
        return;
      }

      setChartDataSource('basket');
      setPoints(nextPoints);
      setSelectedIndex(nextPoints.length - 1);
      setError(null);
      setLoading(false);
    },
    [chartLegs, createdAtSeconds, endedAtSeconds, loadPredictionPoints, predictionLegs, primaryPredictionLeg?.marketId, targetReturnPct, rangeWindow],
  );

  useEffect(() => {
    void fetchBasket();
  }, [fetchBasket]);

  useEffect(() => {
    if (points.length > 0) {
      wipeProgress.value = 0;
      wipeProgress.value = withTiming(1, {
        duration: 800,
        easing: Easing.out(Easing.ease),
      });
    }
  }, [points, wipeProgress]);

  const isPolymarketChart = chartDataSource === 'polymarket';
  const selectedPoint =
    selectedIndex >= 0
      ? (points[Math.min(selectedIndex, points.length - 1)] ?? null)
      : null;
  const latestPoint = points[points.length - 1] ?? null;
  const displayPoint = selectedPoint ?? latestPoint;
  const isPositive = (displayPoint?.returnPct ?? 0) >= 0;
  const lineColor = color ?? (isPositive ? colors.chartPositive : colors.chartNegative);
  const displayReturn = displayPoint?.returnPct ?? null;

  // Only surface the scrubbed value while the user is actively dragging over a
  // historical point. When resting on the latest point, report null so the
  // screen falls back to the authoritative since-creation PnL (sandwich.pnlPct)
  // instead of the chart's locally-derived basket return.
  const isScrubbingHistory = selectedIndex >= 0 && selectedIndex < points.length - 1;

  // A zoomed window measures a different period than the headline PnL, so its
  // curve is deliberately NOT anchored to that number — which used to leave a
  // green 3M curve sitting under a red since-creation figure. Report the
  // window's own return at rest so the number always describes the line the
  // viewer is looking at.
  const isWindowedView = useMemo(() => {
    const windowSeconds = rangeSeconds(rangeWindow);
    if (windowSeconds === null || createdAtSeconds === null) return false;
    return now() - windowSeconds > createdAtSeconds;
  }, [rangeWindow, createdAtSeconds]);

  useEffect(() => {
    onScrub?.(isScrubbingHistory || isWindowedView ? displayReturn : null);
  }, [isScrubbingHistory, isWindowedView, displayReturn, onScrub]);

  const stats = useMemo(() => {
    if (points.length === 0) return { baseline: 100, highest: 101, lowest: 99, spread: 2 };

    const values = points.map((point) => point.index);
    const highest = Math.max(...values, 100);
    const lowest = Math.min(...values, 100);
    const spread = Math.max(highest - lowest, 2); // minimum 2% visible range for flat/new charts
    const padding = spread * 0.15;

    return {
      baseline: 100,
      highest: highest + padding,
      lowest: lowest - padding,
      spread: spread + padding * 2,
    };
  }, [points]);

  const chartPoints = useMemo(() => {
    const plotWidth = chartWidth - paddingX * 2;
    const plotHeight = chartHeight - paddingTop - paddingBottom;

    return points.map((point, index) => {
      const x = paddingX + (plotWidth * index) / Math.max(points.length - 1, 1);
      const y = paddingTop + ((stats.highest - point.index) / stats.spread) * plotHeight;
      return { x, y };
    });
  }, [chartWidth, chartHeight, points, stats.highest, stats.spread, paddingX, paddingTop, paddingBottom]);

  const markerShapes = useMemo(() => {
    return positionChartMarkers(markers, points, chartPoints, chartWidth, chartHeight);
  }, [chartHeight, chartPoints, chartWidth, markers, points]);

  const baselineY = useMemo(() => {
    const plotHeight = chartHeight - paddingTop - paddingBottom;
    return paddingTop + ((stats.highest - stats.baseline) / stats.spread) * plotHeight;
  }, [chartHeight, stats.baseline, stats.highest, stats.spread, paddingTop, paddingBottom]);

  useEffect(() => {
    if (!onGeometry) return;
    onGeometry(
      chartPoints.length > 1
        ? { points: chartPoints, width: chartWidth, height: chartHeight }
        : null,
    );
  }, [onGeometry, chartPoints, chartWidth, chartHeight]);

  const linePath = useMemo(() => buildLinePath(chartPoints, true), [chartPoints]);

  // Mirror the plotted geometry and every label the scrub can show into shared
  // values, so the pan worklet needs neither React state nor the JS thread.
  useEffect(() => {
    scrubPointXs.value = chartPoints.map((point) => point.x);
    scrubPointYs.value = chartPoints.map((point) => point.y);
  }, [chartPoints, scrubPointXs, scrubPointYs]);

  useEffect(() => {
    scrubReturns.value = points.map((point) => point.returnPct);
    scrubReturnLabels.value = points.map((point) => formatPercent(point.returnPct));
    scrubDateLabels.value = points.map((point) => formatAxisLabel(point.timestamp));
  }, [points, scrubDateLabels, scrubReturnLabels, scrubReturns]);

  const tapHaptic = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const endScrub = useCallback(() => {
    setSelectedIndex((current) => (current === -1 ? current : -1));
  }, []);

  const positiveColor = color ?? colors.chartPositive;
  const negativeColor = color ?? colors.chartNegative;

  // Resting labels. Written on data/theme changes only, and pushed straight
  // through to the visible values unless a finger is currently down.
  useEffect(() => {
    const restReturn = isWindowedView ? (latestPoint?.returnPct ?? null) : null;
    const restLabel = formatPercent(latestPoint?.returnPct ?? null);
    const restDate = latestPoint ? formatAxisLabel(latestPoint.timestamp) : '';
    const restColor = (latestPoint?.returnPct ?? 0) >= 0 ? positiveColor : negativeColor;

    restReturnText.value = restLabel;
    restDateText.value = restDate;
    restReturnValue.value = restReturn ?? Number.NaN;
    restReturnActive.value = restReturn === null ? 0 : 1;

    if (isScrubbing.value === 0) {
      returnText.value = restLabel;
      dateText.value = restDate;
      returnColor.value = restColor;
      if (scrubValue && scrubValueActive) {
        scrubValue.value = restReturn ?? Number.NaN;
        scrubValueActive.value = restReturn === null ? 0 : 1;
      }
    }
  }, [
    dateText,
    isScrubbing,
    isWindowedView,
    latestPoint,
    negativeColor,
    positiveColor,
    restDateText,
    restReturnActive,
    restReturnText,
    restReturnValue,
    returnColor,
    returnText,
    scrubValue,
    scrubValueActive,
  ]);

  // Legacy consumers (profile charts) still read the scrub through onScrub,
  // which costs them a render per sample. Owners that pass shared values in get
  // the fully UI-thread path instead.
  const notifyJs = onScrub !== undefined;

  const scrubGesture = useMemo(() => {
    // Interpolate the y of the line at the finger's x instead of snapping to the
    // nearest sample: on a sparse series snapping makes the dot jump between
    // points, which is what read as "not smooth".
    const applyScrub = (x: number) => {
      'worklet';
      const xs = scrubPointXs.value;
      const ys = scrubPointYs.value;
      const count = xs.length;
      if (count === 0) return;
      if (count === 1) {
        scrubX.value = xs[0];
        scrubY.value = ys[0];
        return;
      }

      const first = xs[0];
      const last = xs[count - 1];
      const clampedX = Math.min(Math.max(x, first), last);
      const span = Math.max(last - first, 1);
      const fractional = ((clampedX - first) / span) * (count - 1);
      const lower = Math.max(0, Math.min(Math.floor(fractional), count - 2));
      const t = fractional - lower;

      scrubX.value = clampedX;
      scrubY.value = ys[lower] + (ys[lower + 1] - ys[lower]) * t;

      const returns = scrubReturns.value;
      if (returns.length === count) {
        const interpolated = returns[lower] + (returns[lower + 1] - returns[lower]) * t;
        returnColor.value = interpolated >= 0 ? positiveColor : negativeColor;
        if (scrubValue && scrubValueActive) {
          scrubValue.value = interpolated;
          scrubValueActive.value = 1;
        }
      }

      const nearest = Math.max(0, Math.min(Math.round(fractional), count - 1));
      if (nearest !== lastScrubIndex.value) {
        lastScrubIndex.value = nearest;

        const labels = scrubReturnLabels.value;
        if (nearest < labels.length) returnText.value = labels[nearest];
        const dates = scrubDateLabels.value;
        if (nearest < dates.length) dateText.value = dates[nearest];

        // The owner only hears about the scrub if it asked for the JS callback;
        // that path costs a render per crossed sample, which is exactly what
        // the shared-value props exist to avoid.
        if (notifyJs) runOnJS(setSelectedIndex)(nearest);

        // Rate-limit the taptic engine. One impact per crossed sample stalls the
        // gesture on dense series.
        const stamp = Date.now();
        if (stamp - lastHapticAt.value > 45) {
          lastHapticAt.value = stamp;
          runOnJS(tapHaptic)();
        }
      }
    };

    return Gesture.Pan()
      .activeOffsetX([-5, 5])
      .onTouchesDown((event) => {
        if (event.allTouches.length === 0) return;
        isScrubbing.value = 1;
        applyScrub(event.allTouches[0].x);
        // Fade the chrome in once per gesture — re-issuing the timing on every
        // move restarts the animation and makes the crosshair flicker.
        scrubActive.value = withTiming(1, { duration: 90 });
      })
      .onUpdate((event) => {
        applyScrub(event.x);
      })
      .onFinalize(() => {
        isScrubbing.value = 0;
        lastScrubIndex.value = -1;
        scrubActive.value = withTiming(0, { duration: 140 });
        returnText.value = restReturnText.value;
        dateText.value = restDateText.value;
        returnColor.value =
          Number.isNaN(restReturnValue.value) || restReturnValue.value >= 0
            ? positiveColor
            : negativeColor;
        if (scrubValue && scrubValueActive) {
          scrubValue.value = restReturnValue.value;
          scrubValueActive.value = restReturnActive.value;
        }
        if (notifyJs) runOnJS(endScrub)();
      });
  }, [
    dateText,
    endScrub,
    isScrubbing,
    lastHapticAt,
    lastScrubIndex,
    negativeColor,
    notifyJs,
    positiveColor,
    restDateText,
    restReturnActive,
    restReturnText,
    restReturnValue,
    returnColor,
    returnText,
    scrubActive,
    scrubDateLabels,
    scrubPointXs,
    scrubPointYs,
    scrubReturnLabels,
    scrubReturns,
    scrubValue,
    scrubValueActive,
    scrubX,
    scrubY,
    tapHaptic,
  ]);

  const crosshairStyle = useAnimatedStyle(() => ({
    opacity: scrubActive.value * 0.28,
    transform: [{ translateX: scrubX.value }],
  }));

  const scrubDotStyle = useAnimatedStyle(() => ({
    opacity: scrubActive.value,
    transform: [
      { translateX: scrubX.value - SCRUB_DOT_SIZE / 2 },
      { translateY: scrubY.value - SCRUB_DOT_SIZE / 2 },
    ],
  }));

  const wipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: wipeProgress.value * chartWidth }],
  }));

  const lastChartPoint = chartPoints[chartPoints.length - 1] ?? null;

  return (
    <View style={isSpark ? styles.sparkContainer : styles.container}>
      {!isSpark ? (
        <View style={styles.headerRow}>
          {showReturn ? (
            <AnimatedScrubText text={returnText} color={returnColor} style={styles.returnText} />
          ) : null}
        </View>
      ) : null}

      <View style={isSpark ? styles.sparkCard : styles.card}>
        {loading && points.length === 0 ? (
          isSpark ? (
            <View style={{ height: chartHeight }} />
          ) : (
            <ChartSkeleton />
          )
        ) : error && points.length === 0 ? (
          isSpark ? (
            <View style={[styles.sparkUnavailable, { height: chartHeight }]}> 
              <Text style={styles.sparkUnavailableText}>Chart unavailable</Text>
            </View>
          ) : (
          <View style={styles.stateWrap}>
            <Text style={styles.stateTitle}>
              {primaryPredictionLeg ? 'Prediction market odds' : 'Chart unavailable'}
            </Text>
            {primaryPredictionLeg ? (
              <>
                <Text style={styles.stateBody}>
                  {primaryPredictionLeg.label}
                </Text>
                <View style={styles.pmOddsRow}>
                  <View style={styles.pmOddsCell}>
                    <Text style={styles.pmOddsLabel}>Entry</Text>
                    <Text style={styles.pmOddsValue}>
                      {formatPredictionPrice(primaryPredictionLeg.priceUsd)}
                    </Text>
                  </View>
                  <View style={styles.pmOddsCell}>
                    <Text style={styles.pmOddsLabel}>Live</Text>
                    <Text style={styles.pmOddsValue}>
                      {formatPredictionPrice(primaryPredictionLeg.currentPriceUsd)}
                    </Text>
                  </View>
                  <View style={styles.pmOddsCell}>
                    <Text style={styles.pmOddsLabel}>Return</Text>
                    <Text style={styles.pmOddsValue}>
                      {formatPercent(primaryPredictionLeg.pnlPct ?? null)}
                    </Text>
                  </View>
                </View>
                <Text style={styles.stateBody}>{error}</Text>
              </>
            ) : (
              <Text style={styles.stateBody}>{error}</Text>
            )}
            {chartLegs.length > 0 ? (
              <Pressable onPress={() => void fetchBasket()} style={styles.retryBtn}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
          )
        ) : (
          <>
            <View
              style={[
                isSpark ? null : styles.chartArea,
                { minHeight: chartHeight },
                loading && styles.chartAreaLoading,
              ]}
            >
              <GestureDetector gesture={scrubGesture}>
                <View style={styles.chartWrap} onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}>
                  <View style={{ width: '100%', height: chartHeight }}>
                  <Svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
                    <Defs>
                      <LinearGradient id="basketBg" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor={colors.backgroundAlt} stopOpacity="0.6" />
                        <Stop offset="1" stopColor={colors.background} stopOpacity="0.2" />
                      </LinearGradient>
                      <LinearGradient id="basketArea" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor={lineColor} stopOpacity="0.22" />
                        <Stop offset="1" stopColor={lineColor} stopOpacity="0.02" />
                      </LinearGradient>
                      <Pattern
                        id="basketDotGrid"
                        x={0}
                        y={0}
                        width={18}
                        height={18}
                        patternUnits="userSpaceOnUse"
                      >
                        <Circle
                          cx={1}
                          cy={1}
                          r={1}
                          fill={colors.chartCrosshair}
                          fillOpacity={0.1}
                        />
                      </Pattern>
                    </Defs>

                    {/* Faint dotted grid behind the line (detail screens only). */}
                    {!isSpark && showDotGrid ? (
                      <Rect
                        x={0}
                        y={0}
                        width={chartWidth}
                        height={chartHeight}
                        fill="url(#basketDotGrid)"
                      />
                    ) : null}

                    {/* Bare look (both variants): just a faint dashed baseline —
                        no box, grid or area fill, matching the design. */}
                    {!isSpark ? (
                      <Line
                        x1="0"
                        x2={chartWidth}
                        y1={baselineY}
                        y2={baselineY}
                        stroke={colors.chartCrosshair}
                        strokeOpacity="0.14"
                        strokeWidth="1.5"
                        strokeDasharray="2 7"
                        strokeLinecap="round"
                      />
                    ) : null}


                    {linePath ? (
                      <Path
                        d={linePath}
                        fill="none"
                        stroke={lineColor}
                        strokeWidth={isSpark ? 3 : 4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null}

                    {markerShapes.map((marker) => {
                      const markerColor = marker.side === 'entry' ? '#02C95A' : '#FF4D2E';
                      const radius = isSpark ? 8 : 10;
                      return (
                        <React.Fragment key={marker.id}>
                          <Circle
                            cx={marker.x}
                            cy={marker.y}
                            r={radius}
                            fill={markerColor}
                            stroke={revealBackgroundColor ?? colors.background}
                            strokeWidth={2}
                          />
                          <SvgText
                            x={marker.x}
                            y={marker.y + (isSpark ? 3 : 4)}
                            fill="#FFFFFF"
                            fontSize={isSpark ? 11 : 14}
                            fontWeight="900"
                            textAnchor="middle"
                          >
                            {marker.side === 'entry' ? '+' : '−'}
                          </SvgText>
                        </React.Fragment>
                      );
                    })}

                    {/* Rounded endpoint cap. */}
                    {lastChartPoint && showEndpointDot ? (
                      isSpark ? (
                        <>
                          <Circle cx={lastChartPoint.x} cy={lastChartPoint.y} r="9" fill={lineColor} fillOpacity="0.25" />
                          <Circle cx={lastChartPoint.x} cy={lastChartPoint.y} r="5" fill={lineColor} />
                        </>
                      ) : (
                        <>
                          <Circle cx={lastChartPoint.x} cy={lastChartPoint.y} r="5" fill={lineColor} />
                          <Circle cx={lastChartPoint.x} cy={lastChartPoint.y} r="3" fill={colors.actionPrimaryText} />
                        </>
                      )
                    ) : null}

                  </Svg>

                  {!isSpark ? (
                    <>
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          styles.scrubLine,
                          { height: chartHeight, backgroundColor: colors.chartCrosshair },
                          crosshairStyle,
                        ]}
                      />
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          styles.scrubDot,
                          {
                            backgroundColor: lineColor,
                            borderColor: revealBackgroundColor ?? colors.background,
                          },
                          scrubDotStyle,
                        ]}
                      />
                    </>
                  ) : null}
                  </View>
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      StyleSheet.absoluteFill,
                      {
                        backgroundColor:
                          revealBackgroundColor ?? colors.background,
                        width: chartWidth,
                      },
                      wipeStyle,
                    ]}
                  />
                </View>
              </GestureDetector>
            </View>

            {!isSpark && !hideFooter ? (
              <View style={styles.footerRow}>
                <AnimatedScrubText
                  text={dateText}
                  style={[styles.footerLabel, styles.footerScrubLabel]}
                />
                <Text style={styles.footerLabel}>
                  {isPolymarketChart
                    ? 'Polymarket history'
                    : endedAtSeconds === null
                      ? 'Since entry'
                      : 'Holding period'}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    gap: 8,
  },
  sparkContainer: {
    flex: 1,
  },
  sparkCard: {
    backgroundColor: 'transparent',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    color: c.text,
    fontSize: 16,
    fontWeight: '900',
    fontFamily: F,
  },
  subtitle: {
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: F,
    marginTop: 2,
  },
  returnText: {
    fontSize: 24,
    fontWeight: '900',
    fontFamily: Fonts.displayMedium,
    // Reanimated writes this label's text natively, which does not re-run Yoga
    // measurement — so the box must be wide enough for the longest value it can
    // ever hold rather than hugging its content.
    width: 160,
    textAlign: 'left',
  },
  card: {
    borderRadius: 16,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 8,
    backgroundColor: 'transparent',
  },
  chartArea: {
    minHeight: CHART_HEIGHT,
  },
  chartAreaLoading: {
    opacity: 0.5,
  },
  chartWrap: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  scrubLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    opacity: 0,
  },
  scrubDot: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCRUB_DOT_SIZE,
    height: SCRUB_DOT_SIZE,
    borderRadius: SCRUB_DOT_SIZE / 2,
    borderWidth: 2,
    opacity: 0,
  },
  footerRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    gap: 8,
  },
  footerLabel: {
    color: c.chartNeutral,
    fontSize: 9,
    fontWeight: '700',
    fontFamily: F,
  },
  footerScrubLabel: {
    width: 130,
    textAlign: 'left',
  },
    sparkUnavailable: { alignItems: 'center', justifyContent: 'center' },
    // Rung 3 (tertiary): an empty state is metadata about a missing chart,
    // not a chart element — so it takes the ladder rather than the line color.
    sparkUnavailableText: { fontFamily: F, fontSize: 12, fontWeight: '800', color: c.textTertiary },
    skeletonWrap: {
    height: CHART_HEIGHT,
    borderRadius: 12,
    backgroundColor: c.surfaceAlt,
    padding: 16,
    justifyContent: 'flex-end',
    gap: 6,
  },
  skeletonBar: {
    height: 80,
    borderRadius: 6,
    backgroundColor: c.surfaceSelected,
    width: '100%',
  },
  skeletonLine: {
    height: 8,
    borderRadius: 4,
    backgroundColor: c.surfaceSelected,
    width: '60%',
  },
  skeletonLineMid: {
    width: '40%',
  },
  skeletonLineShort: {
    width: '25%',
  },
  stateWrap: {
    height: CHART_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  stateTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: '900',
    fontFamily: F,
  },
  stateBody: {
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: F,
  },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: c.actionPrimary,
  },
  retryText: {
    color: c.actionPrimaryText,
    fontSize: 12,
    fontWeight: '800',
    fontFamily: F,
  },
  pmOddsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
  },
  pmOddsCell: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: c.surfaceAlt,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  pmOddsLabel: {
    color: c.chartNeutral,
    fontSize: 10,
    fontWeight: '800',
    fontFamily: F,
    textTransform: 'uppercase',
  },
  pmOddsValue: {
    color: c.text,
    fontSize: 15,
    fontWeight: '900',
    fontFamily: Fonts.displayMedium,
    marginTop: 2,
  },
});
