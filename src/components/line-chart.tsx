import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, Mask, Path, Pattern, RadialGradient, Rect, Stop } from "react-native-svg";
import * as Haptics from "expo-haptics";

import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import { useThemeStore } from "@/lib/theme-store";
import {
  downsampleOhlcv,
  getBirdeyeOhlcv,
  type BirdeyeOhlcvItem,
  type BirdeyeOhlcvTimeframe,
} from "@/lib/api";
import { WavingLineSkeleton } from "./waving-line-skeleton";

const F = Fonts.rounded;

/* ─── Types ─── */

export type LineChartWindow = "24H" | "1W" | "1M" | "3M" | "1Y";

type LineChartProps = {
  mint: string;
  /** Canonical Tokens.xyz asset id; history matches its dashboard when present. */
  assetId?: string | null;
  activeWindow: LineChartWindow;
  /** Fixed plot height. Detail sheets use 220; compact share cards override it. */
  height?: number;
  /**
   * Live headline price to anchor the series to. The OHLCV feed is the on-chain
   * token price, but the header shows the equity (tokens.xyz `stats`) price —
   * the two differ by a ~5-8% premium/discount. We scale every candle by
   * `anchorPrice / lastClose` so the chart's endpoint and scrubbed prices line
   * up exactly with the header, while preserving the shape and % change.
   */
  anchorPrice?: number | null;
  onScrub?: (price: number | null, change: number | null) => void;
  onScrubTime?: (timestamp: number | null) => void;
  onWindowChange?: (
    price: number | null,
    change: number | null,
    window: LineChartWindow,
  ) => void;
  color?: string;
  /** Draw a faint dotted grid behind the line (detail/modal surfaces only). */
  showDotGrid?: boolean;
  /**
   * The colour of whatever this chart is sitting on.
   *
   * Both of the chart's overlays — the wipe-in and the scrub veil — work by
   * painting the host's own surface back over the line, so a wrong value here
   * shows up as a pale rectangle rather than as nothing. Hosts with a tinted
   * surface (the stock sheet is `#f7fcf8`, not white) must pass it.
   */
  surfaceColor?: string;
};

/* ─── Constants ─── */

const CHART_HEIGHT = 220;
const CHART_PADDING_X = 0;
const CHART_PADDING_TOP = 28;
const CHART_PADDING_BOTTOM = 28;
const MAX_POINTS = 120;
const LIVE_REFRESH_MS = 15_000;
/** Radius of the dot riding the line under the finger. */
const SCRUB_DOT_R = 3.5;
/** Fixed bounds keep the top-pinned time label inside the chart edges. */
const SCRUB_LABEL_WIDTH = 92;
const SCRUB_LABEL_HEIGHT = 22;
const SCRUB_LABEL_EDGE_GAP = 4;
/**
 * How far the chart ahead of the finger is washed out while scrubbing.
 *
 * A veil in the surface colour rather than a second, faded copy of the line:
 * the line lives in SVG, whose props cannot be driven from a shared value, so
 * re-clipping it per frame would drag the whole scrub back onto the JS thread.
 * Painting over it keeps the hover on the UI thread at 60fps.
 */
const SCRUB_VEIL_OPACITY = 0.72;
/** Fade of that veil, so it doesn't pop in under the crosshair. */
const SCRUB_VEIL_FADE_MS = 140;

const DAY = 24 * 60 * 60;

const now = () => Math.floor(Date.now() / 1000);

const WINDOWS: {
  label: LineChartWindow;
  birdeyeType: BirdeyeOhlcvTimeframe;
  durationSec: number;
}[] = [
  { label: "24H", birdeyeType: "1H", durationSec: DAY },
  { label: "1W", birdeyeType: "4H", durationSec: 7 * DAY },
  // 1M uses 4H (not 1D) candles: 30 daily bars are sparse, and — more
  // importantly — recently-listed stocks only have a few days of daily
  // history, so a 1D 1M chart collapses to the exact same candles as the 1D 3M
  // chart. A finer interval keeps 1M distinct from 3M and adds intraday detail.
  { label: "1M", birdeyeType: "4H", durationSec: 30 * DAY },
  { label: "3M", birdeyeType: "1D", durationSec: 90 * DAY },
  { label: "1Y", birdeyeType: "1D", durationSec: 365 * DAY },
];


/* ─── Helpers ─── */

function getWindowChange(
  candles: BirdeyeOhlcvItem[],
  targetIndex = candles.length - 1,
): { price: number | null; change: number | null } {
  if (candles.length === 0) return { price: null, change: null };

  const first = candles[0];
  const target = candles[Math.max(0, Math.min(targetIndex, candles.length - 1))];
  const base = first.open || first.close;
  const price = target.close;

  if (!Number.isFinite(base) || !Number.isFinite(price) || base <= 0) {
    return { price: Number.isFinite(price) ? price : null, change: null };
  }

  return { price, change: ((price - base) / base) * 100 };
}

/** How far past the window to reach for a last-known price. 7× makes a 24H
 *  chart look back eight days — past any normal gap in a thin token's prints
 *  without dragging in a price old enough to be meaningless. */
const ANCHOR_LOOKBACK_MULTIPLE = 7;

/**
 * Give a window with too few prints something to draw.
 *
 * Thin wrappers barely trade — Bloom Energy's Ondo token prints about twice a
 * day — so a 24H window can hold a single candle, which renders as a blank
 * chart even though the asset has a perfectly good known price. Pin the last
 * close before the window at the window's start and the line reads "flat at the
 * last traded price, then this move", which is what actually happened.
 *
 * Returns the candles untouched whenever the window already has a shape, and
 * whenever there's no prior print to anchor to (a genuinely new listing keeps
 * its "No data" state rather than inventing history).
 */
async function withOpeningAnchor(
  mint: string,
  cfg: (typeof WINDOWS)[number],
  fromSec: number,
  items: BirdeyeOhlcvItem[],
): Promise<BirdeyeOhlcvItem[]> {
  if (items.length >= 2) return items;

  const wide = await getBirdeyeOhlcv(
    mint,
    cfg.birdeyeType,
    fromSec - cfg.durationSec * ANCHOR_LOOKBACK_MULTIPLE,
  );

  const fromMs = fromSec * 1000;
  const prior = wide.items.filter((c) => c.timestamp < fromMs).pop();
  if (!prior) return items;

  const flat = (timestamp: number): BirdeyeOhlcvItem => ({
    timestamp,
    open: prior.close,
    high: prior.close,
    low: prior.close,
    close: prior.close,
    volume: 0,
  });

  // No prints at all in the window: draw the last known price flat across it
  // rather than a single unplottable point.
  if (items.length === 0) return [flat(fromMs), flat(Date.now())];

  return [flat(fromMs), ...items];
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

function cubicBezierValue(
  start: number,
  control1: number,
  control2: number,
  end: number,
  t: number,
): number {
  "worklet";
  const inverse = 1 - t;
  return (
    inverse * inverse * inverse * start +
    3 * inverse * inverse * t * control1 +
    3 * inverse * t * t * control2 +
    t * t * t * end
  );
}

/**
 * Return the exact Y coordinate of the rendered Catmull-Rom/Bézier line for a
 * fractional candle index. This runs inside the gesture worklet, so the point
 * never waits for a JS round trip and never cuts across the curve's chords.
 */
function curveYAtIndex(
  points: { x: number; y: number }[],
  fractionalIndex: number,
): number {
  "worklet";
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].y;

  const segmentIndex = Math.min(
    Math.max(Math.floor(fractionalIndex), 0),
    points.length - 2,
  );
  const p0 = points[Math.max(segmentIndex - 1, 0)];
  const p1 = points[segmentIndex];
  const p2 = points[segmentIndex + 1];
  const p3 = points[Math.min(segmentIndex + 2, points.length - 1)];
  const tension = 0.3;
  const control1X = p1.x + ((p2.x - p0.x) * tension) / 3;
  const control1Y = p1.y + ((p2.y - p0.y) * tension) / 3;
  const control2X = p2.x - ((p3.x - p1.x) * tension) / 3;
  const control2Y = p2.y - ((p3.y - p1.y) * tension) / 3;
  const localProgress = Math.max(0, Math.min(fractionalIndex - segmentIndex, 1));
  const targetX = p1.x + (p2.x - p1.x) * localProgress;

  // Bézier X is not linear in t. A short binary solve keeps the dot precisely
  // on the rendered curve while remaining tiny enough to run every frame.
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const candidate = (lower + upper) / 2;
    const candidateX = cubicBezierValue(
      p1.x,
      control1X,
      control2X,
      p2.x,
      candidate,
    );
    if (candidateX < targetX) lower = candidate;
    else upper = candidate;
  }

  return cubicBezierValue(
    p1.y,
    control1Y,
    control2Y,
    p2.y,
    (lower + upper) / 2,
  );
}

function formatScrubTimestamp(timestamp: number, window: LineChartWindow): string {
  if (window === "24H") {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  }
  return new Intl.DateTimeFormat(
    "en-US",
    window === "1W"
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "2-digit" },
  ).format(new Date(timestamp));
}

/* ─── Component ─── */

function LineChartImpl({
  mint,
  assetId,
  activeWindow,
  height = CHART_HEIGHT,
  anchorPrice,
  onScrub,
  onScrubTime,
  onWindowChange,
  color,
  showDotGrid = false,
  surfaceColor,
}: LineChartProps) {
  const { colors } = useThemeStore();
  const styles = useThemedStyles(makeStyles);
  const surface = surfaceColor ?? colors.background;
  const [candles, setCandles] = useState<BirdeyeOhlcvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const animateNextUpdateRef = useRef(true);

  const [chartWidth, setChartWidth] = useState(320);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const lastHapticIndexRef = useRef(-1);
  const chartIdentity = assetId?.trim() || mint;

  /* Fetch data */
  const fetchData = useCallback(
    async (win: LineChartWindow, silent = false) => {
      const cfg = WINDOWS.find((w) => w.label === win) ?? WINDOWS[0];
      const id = ++requestIdRef.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }

      try {
        // Anchor the request to real time: `from = now - window`. This keeps
        // the chart's up/down (green/red) consistent with the header's 24h
        // change. If a feed lags real-time (e.g. some prestocks/Kalshi), this
        // window simply has no candles and we render the "No data" state rather
        // than showing stale data that disagrees with the headline numbers.
        const bucketSec = cfg.birdeyeType === "5m" ? 300 : cfg.birdeyeType === "1H" ? 3_600 : 14_400;
        const fromSec = Math.floor((now() - cfg.durationSec) / bucketSec) * bucketSec;
        const result = await getBirdeyeOhlcv(chartIdentity, cfg.birdeyeType, fromSec, {
          // The backend still coalesces requests for 30 seconds. Bypassing the
          // five-minute device cache lets the newest in-progress candle land.
          bypassCache: win === "24H",
        });

        if (id !== requestIdRef.current) return;

        const items = await withOpeningAnchor(chartIdentity, cfg, fromSec, result.items);

        if (id !== requestIdRef.current) return;

        // Downsample (not slice) so long windows like 1Y keep their full span
        // instead of collapsing to the most recent MAX_POINTS days.
        animateNextUpdateRef.current = !silent;
        setCandles(downsampleOhlcv(items, MAX_POINTS));
        if (!silent) setSelectedIndex(-1);
      } catch (err) {
        if (id !== requestIdRef.current) return;
        if (!silent) {
          setCandles([]);
          setError(
            err instanceof Error ? err.message : "Failed to load chart data",
          );
        }
      } finally {
        if (!silent && id === requestIdRef.current) setLoading(false);
      }
    },
    [chartIdentity],
  );

  useEffect(() => {
    void fetchData(activeWindow);
  }, [fetchData, activeWindow]);

  // Keep the in-progress hourly candle moving while the app is visible.
  // Silent refreshes preserve the existing plot if the network briefly fails.
  useEffect(() => {
    if (activeWindow !== "24H") return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = setInterval(() => void fetchData("24H", true), LIVE_REFRESH_MS);
    };

    if (AppState.currentState === "active") start();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void fetchData("24H", true);
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      subscription.remove();
    };
  }, [activeWindow, fetchData]);

  useEffect(() => {
    setSelectedIndex(candles.length > 0 ? candles.length - 1 : -1);
  }, [candles.length]);

  /* Anchor the on-chain series to the equity headline price so the chart's
   * last point + scrubbed prices match the header exactly (see anchorPrice). A
   * uniform scale preserves the shape and every % change. */
  const scaledCandles = useMemo(() => {
    if (candles.length === 0) return candles;
    const lastClose = candles[candles.length - 1].close;
    if (
      anchorPrice == null ||
      !Number.isFinite(anchorPrice) ||
      anchorPrice <= 0 ||
      !Number.isFinite(lastClose) ||
      lastClose <= 0
    ) {
      return candles;
    }
    const factor = anchorPrice / lastClose;
    if (Math.abs(factor - 1) < 1e-9) return candles;
    return candles.map((c) => ({
      ...c,
      open: c.open * factor,
      high: c.high * factor,
      low: c.low * factor,
      close: c.close * factor,
    }));
  }, [candles, anchorPrice]);

  /* Compute line points */
  const isPositive = useMemo(() => {
    if (scaledCandles.length < 2) return true;
    return scaledCandles[scaledCandles.length - 1].close >= scaledCandles[0].open;
  }, [scaledCandles]);

  const lineColor = color || (isPositive ? colors.chartPositive : colors.chartNegative);

  const points = useMemo(() => {
    if (scaledCandles.length === 0) return [];

    const plotWidth = chartWidth - CHART_PADDING_X * 2;
    const plotHeight = height - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;

    const closes = scaledCandles.map((c) => c.close);
    const highest = Math.max(...closes);
    const lowest = Math.min(...closes);
    const spread = Math.max(highest - lowest, 0.000001);

    return scaledCandles.map((candle, i) => ({
      x: CHART_PADDING_X + (i / Math.max(scaledCandles.length - 1, 1)) * plotWidth,
      y:
        CHART_PADDING_TOP +
        ((highest - candle.close) / spread) * plotHeight,
    }));
  }, [scaledCandles, chartWidth, height]);

  const linePath = useMemo(() => buildLinePath(points), [points]);

  const lastPoint = points.length > 0 ? points[points.length - 1] : null;

  const safeSelectedIndex = Math.max(
    0,
    Math.min(selectedIndex, candles.length - 1),
  );
  const selectedTimestamp = candles[safeSelectedIndex]?.timestamp;

  const axisLabels = useMemo(() => {
    if (candles.length === 0) return [];
    const midIndex = Math.floor(candles.length / 2);
    return [
      candles[0].timestamp,
      candles[midIndex].timestamp,
      candles[candles.length - 1].timestamp,
    ];
  }, [candles]);

  /* Fire callbacks */
  useEffect(() => {
    const windowChange = getWindowChange(scaledCandles);
    onWindowChange?.(windowChange.price, windowChange.change, activeWindow);
  }, [scaledCandles, onWindowChange, activeWindow]);

  const fireScrub = useCallback(
    (index: number) => {
      const windowChange = getWindowChange(scaledCandles, index);
      if (windowChange.price === null) return;
      onScrub?.(windowChange.price, windowChange.change);
      const ts = scaledCandles[index]?.timestamp;
      onScrubTime?.(typeof ts === 'number' ? ts : null);
      if (lastHapticIndexRef.current !== index) {
        lastHapticIndexRef.current = index;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    },
    [scaledCandles, onScrub, onScrubTime],
  );

  /* Smooth scrub: the crosshair X follows the finger on the UI thread (via the
   * shared values below) for a fluid 60 fps hover, while the price readout only
   * pushes to the parent when the *nearest candle* changes — so the header
   * isn't re-rendered every pixel. The dot's Y is interpolated to sit on the
   * line at the finger's X. */
  const scrubX = useSharedValue(0);
  const scrubY = useSharedValue(0);
  const scrubActive = useSharedValue(0);
  const committedIndex = useSharedValue(-1);

  const commitScrubIndex = useCallback(
    (index: number) => {
      setSelectedIndex(index);
      fireScrub(index);
    },
    [fireScrub],
  );

  const endScrub = useCallback(() => {
    lastHapticIndexRef.current = -1;
    setSelectedIndex(candles.length - 1);
    onScrub?.(null, null);
    onScrubTime?.(null);
  }, [candles.length, onScrub, onScrubTime]);

  /* Gesture handler — X and the exact curve Y stay inside one UI-thread
   * worklet. Only a deduped candle-index change hops to JS for header text and
   * haptics. */
  const scrubGesture = useMemo(
    () => {
      const updateScrub = (rawX: number) => {
        "worklet";
        const n = points.length;
        if (n === 0) return;
        const x = Math.max(0, Math.min(rawX, chartWidth));
        const plotWidth = Math.max(chartWidth - CHART_PADDING_X * 2, 1);
        const fractionalIndex =
          Math.max(0, Math.min((x - CHART_PADDING_X) / plotWidth, 1)) * (n - 1);

        scrubX.value = x;
        scrubY.value = curveYAtIndex(points, fractionalIndex);
        scrubActive.value = 1;

        const index = Math.round(fractionalIndex);
        if (index !== committedIndex.value) {
          committedIndex.value = index;
          runOnJS(commitScrubIndex)(index);
        }
      };

      return Gesture.Pan()
        .minDistance(0)
        .maxPointers(1)
        .onTouchesDown((event) => {
          if (event.allTouches.length === 0) return;
          updateScrub(event.allTouches[0].x);
        })
        .onUpdate((event) => {
          updateScrub(event.x);
        })
        .onFinalize(() => {
          scrubActive.value = 0;
          committedIndex.value = -1;
          runOnJS(endScrub)();
        });
    },
    [
      chartWidth,
      commitScrubIndex,
      committedIndex,
      endScrub,
      points,
      scrubActive,
      scrubX,
      scrubY,
    ],
  );

  const scrubLineStyle = useAnimatedStyle(() => ({
    opacity: scrubActive.value,
    transform: [{ translateX: scrubX.value }],
  }));

  /* Everything to the RIGHT of the finger dims, so the part of the window
   * being read stays at full strength. Anchored at the crosshair and one full
   * chart wide, so it always reaches the right edge; `chartWrap` clips the
   * overhang. */
  const scrubVeilStyle = useAnimatedStyle(() => ({
    opacity: withTiming(scrubActive.value * SCRUB_VEIL_OPACITY, {
      duration: SCRUB_VEIL_FADE_MS,
    }),
    transform: [{ translateX: scrubX.value }],
  }));

  const scrubDotStyle = useAnimatedStyle(() => ({
    opacity: scrubActive.value,
    transform: [
      { translateX: scrubX.value - SCRUB_DOT_R },
      { translateY: scrubY.value - SCRUB_DOT_R },
    ],
  }));

  const scrubLabelStyle = useAnimatedStyle(() => ({
    opacity: scrubActive.value,
    transform: [
      {
        translateX: Math.max(
          SCRUB_LABEL_EDGE_GAP,
          Math.min(
            scrubX.value - SCRUB_LABEL_WIDTH / 2,
            chartWidth - SCRUB_LABEL_WIDTH - SCRUB_LABEL_EDGE_GAP,
          ),
        ),
      },
    ],
  }));

  /* Wipe-in animation */
  const wipeProgress = useSharedValue(0);

  useEffect(() => {
    if (candles.length > 0 && animateNextUpdateRef.current) {
      animateNextUpdateRef.current = false;
      wipeProgress.value = 0;
      wipeProgress.value = withTiming(1, {
        duration: 900,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [candles, wipeProgress]);

  const wipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: wipeProgress.value * chartWidth }],
  }));

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {loading && candles.length === 0 ? (
          <WavingLineSkeleton height={height} />
        ) : error && candles.length === 0 ? (
          <View style={[styles.errorWrap, { height }]}>
            <Text style={styles.errorTitle}>Chart unavailable</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable
              onPress={() => void fetchData(activeWindow)}
              style={styles.retryBtn}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : candles.length === 0 ? (
          <View style={[styles.emptyWrap, { height }]}>
            <Text style={styles.errorTitle}>No data</Text>
          </View>
        ) : (
          <>
            <View style={[styles.chartArea, { minHeight: height }, loading && styles.chartAreaLoading]}>
              <GestureDetector gesture={scrubGesture}>
                <View
                  style={styles.chartWrap}
                  onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
                >
                  <Svg
                    width="100%"
                    height={height}
                    viewBox={`0 0 ${chartWidth} ${height}`}
                  >
                    {/* Faint dotted grid behind the line, fading out
                        radially from the centre so the field has no hard
                        edge where the plot meets the page. The mask is a
                        white-to-black radial: white keeps the dots, black
                        hides them. */}
                    {showDotGrid ? (
                      <>
                        <Defs>
                          <Pattern
                            id="lineChartDotGrid"
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
                              fillOpacity={0.14}
                            />
                          </Pattern>
                          <RadialGradient
                            id="lineChartDotFade"
                            cx="50%"
                            cy="50%"
                            r="50%"
                            fx="50%"
                            fy="50%"
                            gradientUnits="objectBoundingBox"
                          >
                            <Stop offset="0" stopColor="#ffffff" stopOpacity={1} />
                            <Stop offset="0.55" stopColor="#ffffff" stopOpacity={0.7} />
                            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
                          </RadialGradient>
                          <Mask id="lineChartDotMask" maskUnits="userSpaceOnUse" x={0} y={0} width={chartWidth} height={height}>
                            <Rect x={0} y={0} width={chartWidth} height={height} fill="url(#lineChartDotFade)" />
                          </Mask>
                        </Defs>
                        <Rect
                          x={0}
                          y={0}
                          width={chartWidth}
                          height={height}
                          fill="url(#lineChartDotGrid)"
                          mask="url(#lineChartDotMask)"
                        />
                      </>
                    ) : null}

                    {/* Main line */}
                    {linePath ? (
                      <Path
                        d={linePath}
                        fill="none"
                        stroke={lineColor}
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null}

                    {/* Endpoint dot */}
                    {lastPoint ? (
                      <>
                        <Circle
                          cx={lastPoint.x}
                          cy={lastPoint.y}
                          r="5"
                          fill={lineColor}
                        />
                        <Circle
                          cx={lastPoint.x}
                          cy={lastPoint.y}
                          r="3"
                          fill="#ffffff"
                        />
                      </>
                    ) : null}

                  </Svg>

                  {/* Wash over the not-yet-scrubbed side. Below the crosshair
                      in paint order so the guide line and its dot stay crisp. */}
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.scrubVeil,
                      { width: chartWidth, backgroundColor: surface },
                      scrubVeilStyle,
                    ]}
                  />

                  {/* Smooth scrub crosshair — vertical guide line + dot, both
                      driven by shared values so they track the finger on the UI
                      thread (no per-pixel re-render). */}
                  <Animated.View
                    pointerEvents="none"
                    style={[styles.scrubLine, { height }, scrubLineStyle]}
                  />
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.scrubDot,
                      { backgroundColor: lineColor },
                      scrubDotStyle,
                    ]}
                  />
                  <Animated.View
                    pointerEvents="none"
                    style={[styles.scrubTimeLabel, scrubLabelStyle]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.scrubTimeText, { color: colors.text }]}
                    >
                      {selectedTimestamp == null
                        ? ""
                        : formatScrubTimestamp(selectedTimestamp, activeWindow)}
                    </Text>
                  </Animated.View>

                  {/* Wipe-in overlay */}
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: surface, width: chartWidth },
                      wipeStyle,
                    ]}
                  />
                </View>
              </GestureDetector>
              {loading && (
                <View style={styles.loaderContainer} pointerEvents="none">
                  <ActivityIndicator size="small" color={colors.actionBuy} />
                </View>
              )}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/* ─── Styles ─── */

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    gap: 8,
  },
  card: {
    borderRadius: 16,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 8,
    backgroundColor: "transparent",
  },
  chartArea: {
    minHeight: CHART_HEIGHT,
  },
  chartAreaLoading: {
    opacity: 0.45,
  },
  chartWrap: {
    flex: 1,
    overflow: "hidden",
    justifyContent: "center",
  },
  scrubLine: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 1.5,
    backgroundColor: "rgba(148,163,184,0.55)",
  },
  scrubVeil: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
  },
  scrubDot: {
    position: "absolute",
    left: 0,
    top: 0,
    width: SCRUB_DOT_R * 2,
    height: SCRUB_DOT_R * 2,
    borderRadius: SCRUB_DOT_R,
  },
  scrubTimeLabel: {
    position: "absolute",
    left: 0,
    top: 2,
    width: SCRUB_LABEL_WIDTH,
    height: SCRUB_LABEL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  scrubTimeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
  },
  pillRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 4,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
  },
  pillActive: {
    backgroundColor: c.surfaceAlt,
  },
  pillText: {
    fontSize: 14,
    fontWeight: "700",
    color: c.textTertiary,
    fontFamily: F,
  },
  pillTextActive: {
    color: c.text,
  },
  loadingWrap: {
    height: CHART_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  errorWrap: {
    height: CHART_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 6,
  },
  errorTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: F,
  },
  errorBody: {
    color: c.textSecondary,
    fontSize: 12,
    textAlign: "center",
    fontFamily: F,
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
    fontWeight: "700",
    fontFamily: F,
  },
  emptyWrap: {
    height: CHART_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  footerRow: {
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  footerLabel: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: F,
  },
  loaderContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
});

// Memoized so the detail sheet's frequent re-renders (scrub, network state)
// don't re-render this chart while its props are unchanged.
export const LineChart = React.memo(LineChartImpl);
