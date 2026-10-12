import { Ionicons } from '@expo/vector-icons';
import {
  Canvas,
  DashPathEffect,
  Group,
  Path,
  Skia,
  usePathValue,
  type SkPath,
} from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDecay,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { PhoenixCandle } from '@/lib/phoenix-api';
import { PressableScale } from '@/components/pressable-scale';
import {
  CallerPin,
  callerPinReach,
  hitCallerPin,
  type ChartPinAnchor,
  nearestBarIndex,
  stackLifts,
  type ChartCaller,
} from '@/components/chart-caller-pins';

const F = Fonts.rounded;

const CHART_HEIGHT = 200;
const PADDING_Y = 14;
/**
 * Gutter reserved on the right for the price scale, when it is shown.
 *
 * Sized for the *pills*, not the tick labels. The labels are compact
 * ("$77.5K"), while the mark and crosshair pills carry full precision
 * ("$77,524.00") — so a gutter that merely fits the labels leaves the pills
 * hanging out over the candles.
 *
 * 88 comes from measuring the pill's own text style (11pt, weight 800, tabular):
 * "$110,000.00" is the binding case at ~84pt including padding. Sub-dollar
 * marks are far narrower. Every pill on this scale is price-only — labels live
 * in left-hand tags — so nothing on the right is wider than a formatted price.
 */
const AXIS_WIDTH = 88;
/** Narrowest the gutter shrinks to, whatever the price. */
const AXIS_MIN_WIDTH = 44;

/**
 * Gutter sized to the widest price this chart can print, not the worst case
 * across every market: a fixed 88pt left a dead band between the last candle
 * and a "$187.20" scale. Glyph widths are the pill text's (11pt, 800,
 * tabular): digits and "$" ~6.9pt, separators ~3.2pt; plus the pill's 12pt
 * of padding and a 4pt breath off the candles.
 */
function axisWidthFor(prices: (number | null | undefined)[]): number {
  let top = 0;
  for (const price of prices) {
    if (price != null && Number.isFinite(price)) top = Math.max(top, Math.abs(price));
  }
  if (top <= 0) return AXIS_WIDTH;
  // Headroom for the plot's vertical padding and a crosshair at the top edge.
  const text = formatPrice(top * 1.05, decimalsForPrice(0, top));
  let glyphs = 0;
  for (const char of text) glyphs += char === ',' || char === '.' ? 3.2 : 6.9;
  return Math.round(Math.min(AXIS_WIDTH, Math.max(AXIS_MIN_WIDTH, glyphs + 12 + 4)));
}
/** Height of the time-label strip under the plot, when it is shown. */
const TIME_AXIS_HEIGHT = 22;
/** Drag distance, as a fraction of plot width, that doubles the bar count. */
const TIME_ZOOM_TRAVEL = 0.55;
const GRID_LINES = 4;
// Phone-width plots get unreadable past ~50 bodies; the backend already limits
// the series, this just guards a wide `limit`.
const MAX_CANDLES = 50;
/** Fewer, fatter candles when the plot is also carrying trigger lines. */
export const FOCUSED_CANDLES = 34;
/** Zoom limits, in candles across the plot. */
const MIN_VISIBLE = 10;
const MAX_VISIBLE = 200;
/**
 * Limits on the manual price-scale stretch, as a multiple of the auto-fitted
 * range. Past these the plot is either three candles tall or a flat line.
 */
const MIN_Y_ZOOM = 0.2;
const MAX_Y_ZOOM = 8;
/** Drag distance, as a fraction of chart height, that doubles the range. */
const Y_ZOOM_TRAVEL = 0.6;
/** How long a finger must rest on the plot before it becomes a crosshair. */
const CROSSHAIR_HOLD_MS = 160;
/** How far a finger may drift and still count as holding still for a crosshair. */
const HOLD_SLOP = 12;
/** Hold on the price scale before a drag stretches it (see `axisGesture`). */
const AXIS_HOLD_MS = 250;
/**
 * Horizontal travel that hands the finger to the chart's pan rather than to the
 * scroller behind it. This used to be an `activeOffsetX` range; it is enforced
 * by hand now because the crosshair needs to claim the gesture in *every*
 * direction, which an axis-locked activation cannot express.
 */
const PAN_ACTIVATE_SLOP = 10;
/** How long after a pinch a double-tap is ignored as pinch fallout. */
const PINCH_TAP_LOCKOUT_MS = 400;
/** How near a trigger line a touch has to land to grab it. */
const GRAB_SLOP = 26;
/** Vertical gap under which two price pills would overlap. */
const PILL_COLLISION = 22;
/**
 * How often the React side re-reads the viewport while a gesture is running.
 * The canvas never waits on this — it is only for things made of text, whose
 * *content* changes with the window (scale prices, clock labels). 12/second is
 * past the point where a number changing reads as continuous.
 */
const LABEL_SYNC_MS = 80;
/**
 * How often the crosshair's *readout* re-renders while a finger drags it. The
 * lines themselves are not on this budget — they run on the UI thread — so this
 * only paces the formatted price and clock, which cannot leave JS.
 */
const CROSSHAIR_SYNC_MS = 32;
/**
 * How far past the candle range an overlay may stretch the y-axis, as a
 * multiple of that range. Without a cap a liquidation price 40% away squashes
 * every candle into a flat line at the top of the plot — the chart stops being
 * a chart. Levels beyond the cap are drawn pinned to the plot edge, with their
 * true price still on the label.
 */
const OVERLAY_EXTENSION = 0.35;
/**
 * How long the price scale takes to glide to a new fit. Panning a tall candle
 * into or out of view used to snap the whole scale in one frame; easing it
 * over a few frames is what makes a scroll read as continuous.
 */
const DOMAIN_EASE_MS = 140;

export type TriggerLeg = 'takeProfit' | 'stopLoss';

/**
 * The visible window, anchored to the **right** edge of the series rather than
 * to absolute indices: `offset` is how many candles are hidden to the right of
 * the view. Anchoring this way means a poll that appends a new candle keeps the
 * user where they were, and the default (`offset` 0) keeps following the live
 * bar for free.
 */
type Viewport = { count: number; offset: number };

/** The viewport as React sees it, including the hand-set price-scale stretch. */
type Committed = Viewport & { yZoom: number };

type Crosshair = { index: number; y: number };

/** The candle series as flat number arrays — what a worklet can read cheaply. */
type Series = { opens: number[]; highs: number[]; lows: number[]; closes: number[] };

/** Everything the painters need, recomputed on the UI thread every frame. */
type Frame = {
  min: number;
  max: number;
  span: number;
  viewStart: number;
  slotWidth: number;
  first: number;
  last: number;
};

type Props = {
  candles: PhoenixCandle[];
  width: number;
  /**
   * Auto-close overlay. When `markPrice` is present the chart draws the live
   * price line, and each trigger that is set gets a labelled line plus a shaded
   * band back to the mark — the profit zone above a long, the loss zone below.
   * The y-domain stretches to include them, so a far-off trigger is still on
   * screen instead of clipped to the top of the plot.
   */
  markPrice?: number | null;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  /**
   * Where the position was opened. Drawn as a dashed line — it is a fact about
   * the past, not a level that will act, so it reads differently from the solid
   * trigger lines.
   */
  entryPrice?: number | null;
  /** Drawn dashed and muted, like the entry, but in the loss colour. */
  liquidationPrice?: number | null;
  /** Compact axis labels are dropped when the overlay carries its own prices. */
  hideAxis?: boolean;
  /** Right-hand price scale. Also enables the horizontal grid. */
  priceAxis?: boolean;
  /** Faint horizontal guides behind the candles, without adding axis labels. */
  showGrid?: boolean;
  /** Clock labels under the plot. */
  timeAxis?: boolean;
  height?: number;
  /**
   * Pinch to zoom, drag to scroll through history, hold for a crosshair — the
   * TradingView gestures. Ignored while `onDragTrigger` is set: that mode owns
   * the pan for moving trigger lines.
   */
  interactive?: boolean;
  /** Initial/reset viewport size. Spot's 24H chart uses the whole day. */
  initialVisibleCandles?: number | 'all';
  /**
   * Changing this resets the zoom. Pass the timeframe: 200 bars of 1m and of 1d
   * are different charts, and holding a scroll position across that switch
   * lands the user somewhere arbitrary.
   */
  viewportKey?: string | number;
  /**
   * Makes the trigger lines draggable. Fires continuously with the price under
   * the finger; the owner clamps and re-renders, so the line follows the touch.
   */
  onDragTrigger?: (leg: TriggerLeg, price: number) => void;
  /** Tapping a trigger's tag clears that leg. */
  onClearTrigger?: (leg: TriggerLeg) => void;
  /**
   * Fires with the candle under the crosshair, and `null` when it lifts.
   *
   * Read-only: it observes the crosshair state this chart already keeps, so it
   * costs nothing when unused and cannot affect the gesture path. Spot's detail
   * sheet uses it to drive the scrub price in its header.
   */
  onCrosshairChange?: (candle: PhoenixCandle | null) => void;
  /**
   * Optional UI-thread signal for a parent whose dismiss gesture spans this
   * chart. True from touch-down until this chart's gesture sequence finalizes.
   */
  interactionActive?: SharedValue<boolean>;
  /**
   * Creators who called this market, pinned at the candle where each call was
   * made. They ride the same UI-thread frame as the candles, so a pan or pinch
   * carries them along without React.
   */
  callers?: readonly ChartCaller[];
  /** A tap on a caller's avatar. */
  onPressCaller?: (caller: ChartCaller, at: ChartPinAnchor) => void;
  /**
   * `line` draws the mark closes as one stroke instead of candles — the same
   * look as spot's line chart. Pan, zoom, crosshair and pins all still apply.
   */
  variant?: 'candle' | 'line';
  /** Stroke colour for the `line` variant. Defaults to the rising colour. */
  lineColor?: string;
};

/**
 * Candlestick chart for Phoenix markets.
 *
 * Standalone rather than reusing `<CandlestickChart>`: that component fetches
 * its own OHLCV keyed by **mint** via tokens.xyz/Birdeye, which Phoenix markets
 * have no equivalent of (they are symbol-keyed perps). Rather than destabilise
 * a component the live spot detail screen depends on, this takes candles as a
 * prop and draws them.
 *
 * **Plots the mark series, not last-trade.** Mark price drives PnL and
 * liquidation, and Phoenix's on-chain book is thin enough that trade prints gap
 * and spike — charting trades while quoting mark-based PnL is how a chart ends
 * up disagreeing with the number printed above it.
 *
 * ## Why Skia, and why the viewport lives in a shared value
 *
 * Panning used to run gesture → React state → re-render → SVG node updates,
 * once per frame. Every step of that is on the JS thread, so the frame rate was
 * hostage to whatever else JS was doing — a candle poll landing mid-drag cost
 * frames, and nothing about the drawing could fix it.
 *
 * Here the window (`offsetSV`, `countSV`) is a Reanimated shared value written
 * directly by the gesture worklets, and every painter is a `usePathValue` that
 * rebuilds its path from that window **on the UI thread**. A pan, a pinch and
 * the release momentum all run without JS being involved at all.
 *
 * React still owns anything made of text — the price scale, clock labels, the
 * crosshair readout — because their *content* changes with the window and only
 * JS can format a number into a `<Text>`. Those re-sync on a {@link
 * LABEL_SYNC_MS} throttle. Crucially they never hold up the plot: the labels'
 * *positions* are animated from the same shared frame, so a lagging sync can
 * change what a label says but can never leave it drifting off its gridline.
 */
export const PhoenixMarkChart = React.memo(function PhoenixMarkChart({
  candles,
  width,
  markPrice = null,
  takeProfitPrice = null,
  stopLossPrice = null,
  entryPrice = null,
  liquidationPrice = null,
  hideAxis = false,
  priceAxis = false,
  showGrid = false,
  timeAxis = false,
  height,
  interactive = false,
  initialVisibleCandles,
  viewportKey,
  onDragTrigger,
  onClearTrigger,
  onCrosshairChange,
  interactionActive,
  callers,
  onPressCaller,
  variant = 'candle',
  lineColor,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const chartHeight = height ?? CHART_HEIGHT;
  // The plot stops at the gutter so bodies never run under the price scale.
  const axisWidth = useMemo(
    () =>
      priceAxis
        ? axisWidthFor([
            ...candles.map((candle) => candle.markHigh),
            markPrice,
            takeProfitPrice,
            stopLossPrice,
            entryPrice,
            liquidationPrice,
          ])
        : 0,
    [candles, entryPrice, liquidationPrice, markPrice, priceAxis, stopLossPrice, takeProfitPrice],
  );
  const plotWidth = priceAxis ? Math.max(40, width - axisWidth) : width;
  // Dragging trigger lines owns the pan; the two cannot share a finger.
  const zoomable = interactive && !onDragTrigger;

  const total = candles.length;
  const maxVisible = Math.max(1, Math.min(total, MAX_VISIBLE));
  const minVisible = Math.min(MIN_VISIBLE, maxVisible);
  const defaultCount = Math.min(
    initialVisibleCandles === 'all'
      ? maxVisible
      : initialVisibleCandles ?? (priceAxis || interactive ? FOCUSED_CANDLES : MAX_CANDLES),
    maxVisible,
  );

  // Flat arrays rather than the candle objects: a worklet closure has to copy
  // whatever it captures, and 4 number arrays cross far cheaper than 400
  // objects of 12 fields.
  const series = useMemo<Series>(
    () => ({
      opens: candles.map((candle) => candle.markOpen),
      highs: candles.map((candle) => candle.markHigh),
      lows: candles.map((candle) => candle.markLow),
      closes: candles.map((candle) => candle.markClose),
    }),
    [candles],
  );

  // ---- the viewport, as the UI thread sees it -----------------------------
  const offsetSV = useSharedValue(0);
  const countSV = useSharedValue(defaultCount);
  /**
   * How far the price scale has been stretched by hand. 1 is auto-fit; the
   * price-axis drag moves it and nothing else touches it, so the chart keeps
   * auto-fitting horizontally while obeying the user vertically.
   */
  const yZoomSV = useSharedValue(1);
  /**
   * The price domain actually drawn, eased toward the fitted one (see the
   * reaction beside `frame`). NaN means "not seeded yet — snap".
   */
  const domainMinSV = useSharedValue(NaN);
  const domainMaxSV = useSharedValue(NaN);
  /** The price-scale drag is the finger itself, so it must not be eased. */
  const axisDraggingSV = useSharedValue(false);
  // …and as React sees it, for the text. Lags by at most LABEL_SYNC_MS.
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [crosshair, setCrosshair] = useState<Crosshair | null>(null);

  const view = useMemo<Viewport>(() => {
    const count = clamp(committed?.count ?? defaultCount, minVisible, maxVisible);
    const offset = clamp(committed?.offset ?? 0, 0, Math.max(0, total - count));
    return { count, offset };
  }, [committed, defaultCount, minVisible, maxVisible, total]);

  const yZoom = clamp(committed?.yZoom ?? 1, MIN_Y_ZOOM, MAX_Y_ZOOM);

  // Report the scrubbed candle outward. Driven off the crosshair state that
  // already exists rather than from the touch worklets, so an owner listening
  // here can never slow the plot down: the lines run on the UI thread whatever
  // this does.
  const crosshairIndex = crosshair?.index ?? null;
  useEffect(() => {
    if (!onCrosshairChange) return;
    onCrosshairChange(crosshairIndex === null ? null : (candles[crosshairIndex] ?? null));
  }, [crosshairIndex, candles, onCrosshairChange]);

  // A different timeframe is a different chart; keep neither the zoom nor a
  // crosshair pointing at a bar that no longer exists.
  //
  // Seeded once per viewport key, and never again. This used to key off
  // `defaultCount` on the assumption it "only moves when the series is first
  // filled" — but `defaultCount` is `min(FOCUSED_CANDLES, total)`, so while the
  // series is shorter than that, *every candle the poll appends* changed it and
  // silently threw away the zoom and scroll position the user had set.
  const seededKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = String(viewportKey);
    // Nothing to seed against yet — wait for the first candles.
    if (total === 0 || seededKeyRef.current === key) return;
    seededKeyRef.current = key;
    cancelAnimation(offsetSV);
    offsetSV.value = 0;
    countSV.value = defaultCount;
    yZoomSV.value = 1;
    // A new timeframe lands already fitted, rather than gliding in from the
    // previous one's scale.
    domainMinSV.value = NaN;
    domainMaxSV.value = NaN;
    setCommitted(null);
    setCrosshair(null);
  }, [viewportKey, total, defaultCount, offsetSV, countSV, yZoomSV, domainMinSV, domainMaxSV]);

  /*
   * Overlay levels, mirrored where the painters can read them — split by who
   * chose them.
   *
   * `levelsSV` holds the levels the user is *setting*: the mark they are
   * measured from and the two triggers. Those own the y-axis outright, because
   * a target dragged to +40% that stops climbing at the edge of the old candle
   * range is a control that has silently stopped responding. Raising the bar
   * zooms the chart out instead.
   *
   * `pinnedSV` holds levels that are merely *reported* — the entry and the
   * liquidation price. Those are capped (see {@link OVERLAY_EXTENSION}): a
   * liquidation price sitting 40% away is not something the user asked to look
   * at, and letting it drive the scale flattens every candle into a line.
   */
  const levelsSV = useSharedValue<number[]>([]);
  const pinnedSV = useSharedValue<number[]>([]);
  /**
   * A draggable chart is an editor, and its triggers are being chosen right
   * now. A read-only one is a report, where a target set at +80% last week must
   * not flatten today's candles into a line.
   */
  const editable = onDragTrigger !== undefined;
  useEffect(() => {
    levelsSV.value = (
      editable ? [markPrice, takeProfitPrice, stopLossPrice] : [markPrice]
    ).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  }, [editable, levelsSV, markPrice, takeProfitPrice, stopLossPrice]);
  useEffect(() => {
    pinnedSV.value = (
      editable
        ? [entryPrice, liquidationPrice]
        : [entryPrice, liquidationPrice, takeProfitPrice, stopLossPrice]
    ).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  }, [editable, pinnedSV, entryPrice, liquidationPrice, takeProfitPrice, stopLossPrice]);

  /**
   * The price domain, held still for the duration of a trigger drag.
   *
   * Levels now stretch the axis, which would otherwise put a drag in a feedback
   * loop with the scale it is being measured against: raising the target widens
   * the domain, which lowers the price under the unmoved finger, which widens it
   * again. Pinning the domain while a line is held makes the drag exactly
   * one-to-one with the finger; the chart re-fits the moment it is released.
   */
  const frozenSV = useSharedValue<number[] | null>(null);
  const [frozenDomain, setFrozenDomain] = useState<number[] | null>(null);

  /** Where the geometry *should* be this frame — the price domain un-eased. */
  const targetFrame = useDerivedValue<Frame>(() => {
    'worklet';
    const window = clampWindow(total, countSV.value, offsetSV.value);
    return computeFrame(
      series,
      total,
      window,
      plotWidth,
      levelsSV.value,
      pinnedSV.value,
      yZoomSV.value,
      frozenSV.value,
    );
  });

  /*
   * The price domain actually drawn, gliding toward the target. Horizontal
   * geometry is never eased — the candles stay glued to the finger — only the
   * vertical re-fit is, so a spike scrolling into view grows the scale over a
   * few frames instead of in one jump.
   *
   * Snapped (not eased) whenever the domain is under direct control: a trigger
   * drag holds it frozen and must stay one-to-one with the finger, and the
   * price-scale drag *is* the finger.
   */
  useAnimatedReaction(
    () => [targetFrame.value.min, targetFrame.value.max],
    (next, previous) => {
      'worklet';
      const [min, max] = next;
      const snap =
        previous === null ||
        !Number.isFinite(domainMinSV.value) ||
        !Number.isFinite(domainMaxSV.value) ||
        frozenSV.value !== null ||
        axisDraggingSV.value;
      if (snap) {
        cancelAnimation(domainMinSV);
        cancelAnimation(domainMaxSV);
        domainMinSV.value = min;
        domainMaxSV.value = max;
        return;
      }
      if (previous[0] === min && previous[1] === max) return;
      const ease = { duration: DOMAIN_EASE_MS, easing: Easing.out(Easing.cubic) };
      domainMinSV.value = withTiming(min, ease);
      domainMaxSV.value = withTiming(max, ease);
    },
  );

  /** The whole geometry of one frame. Every painter below reads this. */
  const frame = useDerivedValue<Frame>(() => {
    'worklet';
    const target = targetFrame.value;
    const min = domainMinSV.value;
    const max = domainMaxSV.value;
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return target;
    return { ...target, min, max, span: max - min };
  });

  // The spare bars either side of the window, and anything a stretched scale
  // pushes past the top or bottom, stop at the plot's edge.
  const plotClip = useMemo(
    () => Skia.XYWHRect(0, 0, plotWidth, chartHeight),
    [plotWidth, chartHeight],
  );

  // ---- painters: all of these run on the UI thread ------------------------
  const bodyRatio = priceAxis ? 0.72 : 0.6;

  // The painter callbacks are memoized on purpose: `usePathValue` re-registers
  // its worklet whenever the callback's identity changes, and the label sync
  // re-renders this component several times a second. A fresh arrow each render
  // would put that churn on the JS thread — exactly what the canvas is here to
  // avoid.
  const risingPath = usePathValue(
    useCallback(
      (path: SkPath) => {
        'worklet';
        paintCandles(path, series, frame.value, chartHeight, bodyRatio, true);
      },
      [series, frame, chartHeight, bodyRatio],
    ),
  );
  const fallingPath = usePathValue(
    useCallback(
      (path: SkPath) => {
        'worklet';
        paintCandles(path, series, frame.value, chartHeight, bodyRatio, false);
      },
      [series, frame, chartHeight, bodyRatio],
    ),
  );

  const linePath = usePathValue(
    useCallback(
      (path: SkPath) => {
        'worklet';
        paintLine(path, series, frame.value, chartHeight);
      },
      [series, frame, chartHeight],
    ),
  );

  // Gridline *prices* are picked by React (they have to match the labels it
  // prints); their *positions* are resolved here, every frame.
  const ticksSV = useSharedValue<number[]>([]);
  const gridPath = usePathValue(
    useCallback(
      (path: SkPath) => {
        'worklet';
        const f = frame.value;
        const ticks = ticksSV.value;
        for (let index = 0; index < ticks.length; index += 1) {
          const y = yOf(ticks[index], f, chartHeight);
          path.moveTo(0, y);
          path.lineTo(width, y);
        }
      },
      [frame, ticksSV, chartHeight, width],
    ),
  );

  // Level lines run the FULL width, not just the plot: each one ends at its own
  // pill in the price column. Stopping them at the plot edge left the scale
  // floating as a detached panel with a band of dead space in between.
  const markPath = useLevelPath(frame, markPrice, width, chartHeight);
  const entryPath = useLevelPath(frame, entryPrice, width, chartHeight);
  const liquidationPath = useLevelPath(frame, liquidationPrice, width, chartHeight);
  const takeProfitPath = useLevelPath(frame, takeProfitPrice, width, chartHeight);
  const stopLossPath = useLevelPath(frame, stopLossPrice, width, chartHeight);

  // The crosshair's *position*, written straight from the touch worklet. React
  // state still owns its text; these own where the lines are drawn. Declared
  // above the styles that capture them — a worklet closing over a `const` from
  // further down the body reads it as undefined at runtime, and TypeScript
  // cannot see it because the reference lives inside a closure.
  const crosshairXSV = useSharedValue(0);
  const crosshairYSV = useSharedValue(0);

  // Crosshair lines are positioned here rather than from React state, so a drag
  // moves them at canvas framerate instead of at re-render rate.
  const crosshairVStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: crosshairXSV.value }],
  }));
  const crosshairHStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: crosshairYSV.value }],
  }));
  const crosshairPillStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: crosshairYSV.value - 10 }],
  }));
  const profitZone = useZonePath(frame, markPrice, takeProfitPrice, plotWidth, chartHeight);
  const lossZone = useZonePath(frame, markPrice, stopLossPrice, plotWidth, chartHeight);

  // ---- React's copy of the geometry, for text and hit-testing -------------
  const shaped = useMemo(() => {
    if (total === 0) return null;
    const window = clampWindow(total, view.count, view.offset);
    // Same split as the painter's shared values, or the text scale would
    // disagree with the lines it labels.
    const f = computeFrame(
      series,
      total,
      window,
      plotWidth,
      editable ? levelPrices(markPrice, takeProfitPrice, stopLossPrice) : levelPrices(markPrice),
      editable
        ? levelPrices(entryPrice, liquidationPrice)
        : levelPrices(entryPrice, liquidationPrice, takeProfitPrice, stopLossPrice),
      yZoom,
      frozenDomain,
    );

    const first = f.first;
    const drawn = candles.slice(first, f.last + 1);
    const timeSpanMs = drawn.length > 1 ? drawn[drawn.length - 1].time - drawn[0].time : 0;
    const labelCount = plotWidth > 260 ? 4 : 3;

    // "Nice" round prices, deduplicated once formatted: a flat market can round
    // several ticks onto the same string, and drawing "$3.00" four times down
    // the scale is worse than drawing it once.
    // Every price on this scale — ticks, crosshair, mark — goes through the
    // same formatter at the same precision. A compact tick ("$77.5K") beside a
    // full-precision pill ("$77,509.00") is what stops the right-hand column
    // reading as one column.
    const priceDecimals = decimalsForPrice(f.span, Math.abs(f.max));
    const seen = new Set<string>();
    const ticks: { price: number; label: string }[] = [];
    for (const price of niceTicks(f.min, f.max, GRID_LINES + 1)) {
      const label = formatPrice(price, priceDecimals);
      if (seen.has(label)) continue;
      seen.add(label);
      ticks.push({ price, label });
    }

    return {
      ...f,
      drawn,
      ticks,
      priceDecimals,
      toPrice: (y: number) => f.max - ((y - PADDING_Y) / (chartHeight - PADDING_Y * 2)) * f.span,
      xForIndex: (index: number) => (first + index - f.viewStart + 0.5) * f.slotWidth,
      // Anchored to fixed screen columns rather than to bars, so the labels sit
      // still while the candles slide under them.
      timeLabels: buildTimeLabels(drawn, f, first, plotWidth, labelCount, timeSpanMs),
    };
  }, [
    candles,
    series,
    total,
    editable,
    frozenDomain,
    view,
    plotWidth,
    chartHeight,
    markPrice,
    takeProfitPrice,
    stopLossPrice,
    entryPrice,
    liquidationPrice,
    yZoom,
  ]);

  // Hand the chosen tick prices to the painter, so line and label can never
  // disagree about which price they represent.
  useEffect(() => {
    ticksSV.value = shaped && (priceAxis || showGrid) ? shaped.ticks.map((t) => t.price) : [];
  }, [shaped, priceAxis, showGrid, ticksSV]);

  // ---- gestures ------------------------------------------------------------
  const lastSyncSV = useSharedValue(0);
  const panStart = useSharedValue<Viewport>({ count: 0, offset: 0 });
  const pinchStart = useSharedValue<Viewport>({ count: 0, offset: 0 });
  const pinchingSV = useSharedValue(false);
  const crosshairSV = useSharedValue(false);
  const panTravelSV = useSharedValue(0);
  const touchStartSV = useSharedValue({ x: 0, y: 0 });
  const lastTouchSyncSV = useSharedValue(0);
  // The price gutter's stretch lives inside the plot's own pan (see below), so
  // it needs to know when the finger landed and whether it has taken over.
  const touchStartAtSV = useSharedValue(0);
  const axisStretchSV = useSharedValue(false);
  const axisZoomStart = useSharedValue(1);
  const lastPinchAtSV = useSharedValue(0);

  const syncLabels = useCallback((next: Committed) => {
    setCommitted(next);
  }, []);

  // The text follows the window on a throttle. `false` for the second argument
  // of the reaction would run it on every frame; the throttle is what keeps
  // React off the critical path.
  useAnimatedReaction(
    () => ({ count: countSV.value, offset: offsetSV.value, yZoom: yZoomSV.value }),
    (current) => {
      'worklet';
      const now = Date.now();
      if (now - lastSyncSV.value < LABEL_SYNC_MS) return;
      lastSyncSV.value = now;
      runOnJS(syncLabels)(current);
    },
  );

  const moveCrosshair = useCallback(
    (x: number, y: number) => {
      const { count, offset } = clampWindow(total, countSV.value, offsetSV.value);
      const slot = plotWidth / Math.max(1, count);
      // Absolute index into the whole series, so a poll that appends a candle
      // mid-hold doesn't slide the crosshair onto its neighbour.
      const index = clamp(
        Math.floor(total - offset - count + x / slot),
        0,
        Math.max(0, total - 1),
      );
      setCrosshair((current) =>
        current && current.index === index && Math.abs(current.y - y) < 0.5
          ? current
          : { index, y },
      );
    },
    [countSV, offsetSV, plotWidth, total],
  );

  /**
   * Crosshair entry is timed here rather than handed to a recognizer.
   *
   * Both obvious constructions were tried on device and neither works: a
   * `LongPress` wide enough to survive the finger travelling also fires 220ms
   * into an ordinary scroll drag, and a `Pan` held back by an unreachable
   * `minDistance` never activates at all — `activateAfterLongPress` does not
   * override the distance gate, so the crosshair simply never appeared.
   *
   * What is left is the touch callbacks, which fire whatever state the gesture
   * is in: arm a timer on touch-down, and if the finger is still near where it
   * landed when the timer fires, take over. The pan then defers to the flag.
   */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchDown = useRef({ x: 0, y: 0 });
  const touchAt = useRef({ x: 0, y: 0 });

  const armCrosshair = useCallback(
    (x: number, y: number) => {
      touchDown.current = { x, y };
      touchAt.current = { x, y };
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        const { x: startX, y: startY } = touchDown.current;
        const { x: nowX, y: nowY } = touchAt.current;
        // It travelled — that was a scroll, not a hold.
        if (Math.hypot(nowX - startX, nowY - startY) > HOLD_SLOP) return;
        crosshairSV.value = true;
        const f = frame.value;
        const index = Math.min(
          Math.max(Math.floor(f.viewStart + nowX / f.slotWidth), 0),
          Math.max(0, total - 1),
        );
        crosshairXSV.value = (index - f.viewStart + 0.5) * f.slotWidth;
        crosshairYSV.value = nowY;
        void Haptics.selectionAsync();
        moveCrosshair(nowX, nowY);
      }, CROSSHAIR_HOLD_MS);
    },
    [crosshairSV, crosshairXSV, crosshairYSV, frame, moveCrosshair, total],
  );

  // Already paced by the touch worklet, which gates the hop before scheduling
  // it — so this just applies whatever arrives.
  const trackTouch = useCallback(
    (x: number, y: number) => {
      touchAt.current = { x, y };
      if (crosshairSV.value) moveCrosshair(x, y);
    },
    [crosshairSV, moveCrosshair],
  );

  const clearCrosshair = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    crosshairSV.value = false;
    setCrosshair(null);
  }, [crosshairSV]);

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );
  const resetViewport = useCallback(() => {
    void Haptics.selectionAsync();
    setCommitted(null);
  }, []);

  /** Auto-fit again, without disturbing where the user has scrolled to. */
  const resetAxisZoom = useCallback(() => {
    void Haptics.selectionAsync();
    setCommitted((current) => (current ? { ...current, yZoom: 1 } : null));
  }, []);
  const tapFeedback = useCallback(() => void Haptics.selectionAsync(), []);

  const viewportGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .averageTouches(true)
      // Let a vertical swipe fall through to the sheet's scroll view; only a
      // clearly horizontal drag is ours.
      // The chart lives inside a BottomSheetScrollView. `activeOffsetX` let it
      // claim horizontal drags only, which is right for panning history but
      // wrong for the crosshair: a scrub with any vertical component was never
      // claimed, so the scroller took it and the sheet slid under the finger.
      // Manual activation lets the crosshair claim the finger outright.
      .manualActivation(true)
      .onBegin(() => {
        'worklet';
        // Touching the chart catches it mid-glide, like a scroll view.
        cancelAnimation(offsetSV);
        panStart.value = clampWindow(total, countSV.value, offsetSV.value);
        panTravelSV.value = 0;
      })
      // Touch callbacks fire in every gesture state, activated or not — which is
      // what lets a finger that never moves enough to activate the pan still
      // arm, and then drive, the crosshair.
      .onTouchesDown((event) => {
        'worklet';
        if (interactionActive) interactionActive.value = true;
        const touch = event.allTouches[0];
        if (!touch) return;
        touchStartSV.value = { x: touch.x, y: touch.y };
        touchStartAtSV.value = Date.now();
        axisStretchSV.value = false;
        lastTouchSyncSV.value = 0;
        // A hold in the price gutter is the scale's stretch, not a crosshair —
        // there is no bar under the finger there.
        if (touch.x >= plotWidth) return;
        runOnJS(armCrosshair)(touch.x, touch.y);
      })
      .onTouchesMove((event, manager) => {
        'worklet';
        const touch = event.allTouches[0];
        if (!touch) return;
        if (axisStretchSV.value) return;
        const inGutter = priceAxis && touchStartSV.value.x >= plotWidth;
        const dx = Math.abs(touch.x - touchStartSV.value.x);
        const dy = Math.abs(touch.y - touchStartSV.value.y);
        if (
          inGutter &&
          !pinchingSV.value &&
          Date.now() - touchStartAtSV.value >= AXIS_HOLD_MS &&
          dx <= PAN_ACTIVATE_SLOP &&
          dy <= PAN_ACTIVATE_SLOP * 2
        ) {
          // Held still in the price gutter, then moved: the price scale's own
          // stretch. Judged here rather than by a separate gesture, because a
          // second (long-press) pan on the gutter blocked every scroll that
          // started there.
          axisStretchSV.value = true;
          axisDraggingSV.value = true;
          axisZoomStart.value = yZoomSV.value;
          runOnJS(tapFeedback)();
          manager.activate();
          return;
        }
        if (crosshairSV.value) {
          // Take the finger away from the scroller for as long as the crosshair
          // has it — in both axes, which is the whole point.
          manager.activate();
        } else if (Math.abs(touch.x - touchStartSV.value.x) > PAN_ACTIVATE_SLOP) {
          // What `activeOffsetX` used to do: horizontal intent is a pan through
          // history, anything else belongs to the scroller.
          manager.activate();
        }
        // Snap to the bar under the finger and move the lines here, on the UI
        // thread. Routing this through runOnJS -> setState -> re-render is what
        // made the crosshair lag the finger: it put every frame behind whatever
        // else JS was doing, which is precisely what the plot was rewritten to
        // avoid. Mirrors `moveCrosshair`'s maths so both agree on the bar.
        if (crosshairSV.value) {
          const f = frame.value;
          const index = Math.min(
            Math.max(Math.floor(f.viewStart + touch.x / f.slotWidth), 0),
            Math.max(0, total - 1),
          );
          crosshairXSV.value = (index - f.viewStart + 0.5) * f.slotWidth;
          crosshairYSV.value = touch.y;
        }
        // Gate the hop to JS *here*. Throttling on the far side still paid for
        // ~60 runOnJS schedulings a second, every one of them competing with
        // the same JS thread the sheet and the candle poll are using.
        const now = Date.now();
        if (now - lastTouchSyncSV.value < CROSSHAIR_SYNC_MS) return;
        lastTouchSyncSV.value = now;
        runOnJS(trackTouch)(touch.x, touch.y);
      })
      // The finger leaving is the end of the crosshair, and of any pending hold.
      // `onFinalize` is not enough on its own: a tap that never activates the pan
      // can leave the armed timer to fire after the touch is gone, painting a
      // crosshair nobody is holding.
      .onTouchesUp(() => {
        'worklet';
        runOnJS(clearCrosshair)();
      })
      .onTouchesCancelled(() => {
        'worklet';
        if (interactionActive) interactionActive.value = false;
        runOnJS(clearCrosshair)();
      })
      .onUpdate((event) => {
        'worklet';
        if (axisStretchSV.value) {
          // Drag down squeezes the range (candles flatten), up stretches it.
          const factor = Math.exp(
            (event.y - touchStartSV.value.y) / (chartHeight * Y_ZOOM_TRAVEL),
          );
          yZoomSV.value = Math.min(MAX_Y_ZOOM, Math.max(MIN_Y_ZOOM, axisZoomStart.value * factor));
          return;
        }
        panTravelSV.value = event.translationX;
        // The crosshair owns the finger once it has it.
        if (pinchingSV.value || crosshairSV.value) return;
        const base = panStart.value;
        const slot = plotWidth / Math.max(1, base.count);
        // Drag right → pull older candles into view.
        offsetSV.value = clampOffset(total, base.count, base.offset + event.translationX / slot);
      })
      .onFinalize(() => {
        'worklet';
        if (interactionActive) interactionActive.value = false;
        axisDraggingSV.value = false;
        runOnJS(clearCrosshair)();
      })
      .onEnd((event) => {
        'worklet';
        if (axisStretchSV.value) {
          axisStretchSV.value = false;
          return;
        }
        if (pinchingSV.value || crosshairSV.value) return;
        const slot = plotWidth / Math.max(1, clampWindow(total, countSV.value, offsetSV.value).count);
        // Momentum, decayed on the UI thread and clamped at both ends of the
        // series so it stops at the edge instead of rubber-banding past it.
        offsetSV.value = withDecay({
          velocity: event.velocityX / slot,
          clamp: [0, Math.max(0, total - countSV.value)],
        });
      });

    const pinch = Gesture.Pinch()
      .onBegin(() => {
        'worklet';
        cancelAnimation(offsetSV);
        pinchStart.value = clampWindow(total, countSV.value, offsetSV.value);
        pinchingSV.value = true;
        crosshairSV.value = false;
        runOnJS(clearCrosshair)();
      })
      .onUpdate((event) => {
        'worklet';
        const base = pinchStart.value;
        const scale = event.scale > 0 ? event.scale : 1;
        const next = clampWindow(total, base.count / scale, base.offset);
        // Keep the bar under the focal point where it is, so zooming feels
        // anchored to what you are looking at rather than to the right edge.
        const fromRight = Math.min(1, Math.max(0, 1 - event.focalX / plotWidth));
        countSV.value = next.count;
        offsetSV.value = clampOffset(
          total,
          next.count,
          base.offset + fromRight * (base.count - next.count),
        );
      })
      .onFinalize(() => {
        'worklet';
        pinchingSV.value = false;
        lastPinchAtSV.value = Date.now();
        // The pan is usually still down on one finger; rebase it so lifting the
        // second and dragging on doesn't jump by the pinch's travel.
        const settled = clampWindow(total, countSV.value, offsetSV.value);
        panStart.value = {
          count: settled.count,
          offset: settled.offset - panTravelSV.value / (plotWidth / settled.count),
        };
      });

    const reset = Gesture.Tap()
      .numberOfTaps(2)
      // The gutter's double-tap is the scale's own auto-fit, below.
      .hitSlop({ right: plotWidth - width })
      .onEnd(() => {
        'worklet';
        // A pinch is two fingers landing and lifting, and this tap runs
        // Simultaneous with it — so pinching to zoom out could complete the
        // double-tap and snap the viewport straight back to the default zoom.
        // TapGesture has no `maxPointers` to rule that out, so the pinch is
        // ruled out by time instead: it is either still running, or it just
        // was. A deliberate double-tap after a pinch is worth losing.
        if (pinchingSV.value || Date.now() - lastPinchAtSV.value < PINCH_TAP_LOCKOUT_MS) return;
        cancelAnimation(offsetSV);
        offsetSV.value = 0;
        countSV.value = defaultCount;
        yZoomSV.value = 1;
        runOnJS(resetViewport)();
      });

    return Gesture.Simultaneous(pinch, pan, reset);
  }, [
    armCrosshair,
    clearCrosshair,
    countSV,
    defaultCount,
    crosshairSV,
    crosshairXSV,
    crosshairYSV,
    frame,
    interactionActive,
    touchStartSV,
    lastTouchSyncSV,
    lastPinchAtSV,
    trackTouch,
    offsetSV,
    panStart,
    panTravelSV,
    pinchStart,
    pinchingSV,
    plotWidth,
    resetViewport,
    total,
    width,
    yZoomSV,
    axisDraggingSV,
    axisStretchSV,
    axisZoomStart,
    chartHeight,
    priceAxis,
    tapFeedback,
    touchStartAtSV,
  ]);

  useEffect(
    () => () => {
      if (interactionActive) interactionActive.value = false;
    },
    [interactionActive],
  );

  /**
   * The price scale is its own control, as it is on a desk chart: hold in the
   * gutter, then drag down to squeeze the range into the same height (candles
   * flatten) or up to stretch it. That stretch is judged inside the plot's pan
   * above, so a sideways drag or a pinch that starts in the gutter still moves
   * the chart. What lives here is only the gutter's double-tap, which hands the
   * scale back to auto-fit.
   */
  const axisGesture = useMemo(() => {
    // Confined to the gutter by a negative hit slop on the plot's own view:
    // left edge pulled in to the plot's width, bottom up off the time axis.
    const gutter = {
      left: -plotWidth,
      bottom: -(timeAxis ? TIME_AXIS_HEIGHT : 0),
    };
    const autoFit = Gesture.Tap()
      .numberOfTaps(2)
      .hitSlop(gutter)
      .onEnd(() => {
        'worklet';
        yZoomSV.value = 1;
        runOnJS(resetAxisZoom)();
      });

    return autoFit;
  }, [plotWidth, resetAxisZoom, timeAxis, yZoomSV]);

  /**
   * The gutter is part of the plot, not a separate control laid over it. As
   * its own GestureDetector it swallowed every touch in the price column: a
   * sideways drag there never scrolled the chart, and a hold there armed a
   * crosshair that the blocked plot gesture could never clear. Composed
   * simultaneously instead, the gutter pans and pinches like the rest of the
   * chart and still stretches the scale on a held vertical drag.
   */
  const chartGesture = useMemo(
    () => (priceAxis ? Gesture.Simultaneous(viewportGesture, axisGesture) : viewportGesture),
    [axisGesture, priceAxis, viewportGesture],
  );

  /**
   * The time scale, the horizontal counterpart of the price scale: drag it left
   * and the bars compress so more of them fit, drag right and they spread out.
   * The right edge stays put, so you are always stretching history away from
   * the live candle rather than sliding the window.
   */
  const timeZoomStart = useSharedValue<Viewport>({ count: 0, offset: 0 });
  const timeAxisGesture = useMemo(() => {
    const drag = Gesture.Pan()
      .activeOffsetX([-6, 6])
      .onBegin(() => {
        'worklet';
        cancelAnimation(offsetSV);
        timeZoomStart.value = clampWindow(total, countSV.value, offsetSV.value);
      })
      .onUpdate((event) => {
        'worklet';
        const base = timeZoomStart.value;
        // Drag left (negative) → more bars across the same width.
        const factor = Math.exp(-event.translationX / (plotWidth * TIME_ZOOM_TRAVEL));
        const next = clampWindow(total, base.count * factor, base.offset);
        countSV.value = next.count;
        offsetSV.value = next.offset;
      });

    const reset = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        'worklet';
        countSV.value = Math.min(FOCUSED_CANDLES, Math.max(1, Math.min(total, MAX_VISIBLE)));
        runOnJS(tapFeedback)();
      });

    return Gesture.Simultaneous(drag, reset);
  }, [countSV, offsetSV, plotWidth, tapFeedback, timeZoomStart, total]);

  // ---- trigger dragging (the auto-close pad's mode) -----------------------
  const draggingRef = useRef<TriggerLeg | null>(null);

  const pickLeg = useCallback(
    (y: number): TriggerLeg | null => {
      if (!shaped) return null;
      const candidates: { leg: TriggerLeg; distance: number }[] = [];
      if (takeProfitPrice !== null) {
        candidates.push({
          leg: 'takeProfit',
          distance: Math.abs(y - yOf(takeProfitPrice, shaped, chartHeight)),
        });
      }
      if (stopLossPrice !== null) {
        candidates.push({
          leg: 'stopLoss',
          distance: Math.abs(y - yOf(stopLossPrice, shaped, chartHeight)),
        });
      }
      const nearest = candidates.sort((a, b) => a.distance - b.distance)[0];
      return nearest && nearest.distance <= GRAB_SLOP ? nearest.leg : null;
    },
    [chartHeight, shaped, stopLossPrice, takeProfitPrice],
  );

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        // Prices go straight into React state, so the handlers run on the JS
        // thread rather than as worklets.
        .runOnJS(true)
        .onBegin((event) => {
          const leg = pickLeg(event.y);
          draggingRef.current = leg;
          if (!leg || !shaped) return;
          // Hold the scale exactly where the user grabbed the line. Written to
          // the shared value first — the painter must not run a single frame on
          // a domain the drag is already moving.
          const held = [shaped.min, shaped.max];
          frozenSV.value = held;
          setFrozenDomain(held);
        })
        .onUpdate((event) => {
          const leg = draggingRef.current;
          if (!leg || !shaped || !onDragTrigger) return;
          onDragTrigger(leg, shaped.toPrice(event.y));
        })
        .onFinalize(() => {
          draggingRef.current = null;
          // Released: the chart re-fits, widening to whatever the level became.
          frozenSV.value = null;
          setFrozenDomain(null);
        }),
    [frozenSV, onDragTrigger, pickLeg, shaped],
  );

  const callerPins = useMemo(() => {
    if (!callers || callers.length === 0 || candles.length === 0) return [];
    // Highlighted last, so it draws over any pin sharing its candle.
    const ordered = [...callers].sort((a, b) => Number(a.highlighted) - Number(b.highlighted));
    const times = candles.map((candle) => candle.time);
    const indices = ordered.map((caller) => nearestBarIndex(times, caller.occurredAt));
    const lifts = stackLifts(ordered, indices);
    return ordered.flatMap((caller, i) => {
      const index = indices[i];
      if (index < 0) return [];
      return [{ caller, index, price: candles[index].markClose, lift: lifts[i] }];
    });
  }, [callers, candles]);

  const plotRef = useRef<View>(null);
  // A tap on an avatar previews the caller's post. Pins live on the UI-thread
  // frame, so the hit test reads it where the pins are right now.
  const tapPin = useCallback(
    (x: number, y: number, absX: number, absY: number) => {
      if (!onPressCaller) return;
      const f = frame.value;
      const pins = callerPins.flatMap(({ caller, index, price, lift }) => {
        const px = (index - f.viewStart + 0.5) * f.slotWidth;
        if (px < 0 || px > plotWidth) return [];
        const py = yOf(price, f, chartHeight);
        return [{ caller, x: px, y: py, lift, below: py < callerPinReach(caller, lift) }];
      });
      const hit = hitCallerPin(pins, x, y);
      if (!hit) return;
      // Measured, not taken from the touch: the preview sits over the chart.
      const fallback = { top: absY - y, height: chartHeight };
      const root = plotRef.current;
      if (!root) return onPressCaller(hit, fallback);
      root.measureInWindow((_wx, wy, _ww, wh) =>
        onPressCaller(hit, Number.isFinite(wy) && wh > 0 ? { top: wy, height: Math.min(wh, chartHeight) } : fallback),
      );
    },
    [callerPins, chartHeight, frame, onPressCaller, plotWidth],
  );
  const pinTap = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(300)
        .maxDistance(10)
        .onEnd((event, success) => {
          'worklet';
          if (success) runOnJS(tapPin)(event.x, event.y, event.absoluteX, event.absoluteY);
        }),
    [tapPin],
  );
  const hasPinTap = Boolean(onPressCaller) && callerPins.length > 0;
  const dragGesture = useMemo(() => (hasPinTap ? Gesture.Simultaneous(drag, pinTap) : drag), [drag, hasPinTap, pinTap]);
  const plotGesture = useMemo(
    () => (hasPinTap ? Gesture.Simultaneous(chartGesture, pinTap) : chartGesture),
    [chartGesture, hasPinTap, pinTap],
  );

  if (!shaped) {
    return (
      <View style={[styles.empty, { width, height: chartHeight }]}>
        <Text style={styles.emptyText}>No candles</Text>
      </View>
    );
  }

  const totalHeight = chartHeight + (timeAxis ? TIME_AXIS_HEIGHT : 0);
  const markY = markPrice === null ? null : yOf(markPrice, shaped, chartHeight);
  // The live-price pill takes the newest candle's direction. Read off the MARK
  // series — the one actually painted — so the pill and the candle it sits
  // beside can never disagree about which way the bar went.
  const newest = candles.length > 0 ? candles[candles.length - 1] : null;
  const markUp = newest ? newest.markClose >= newest.markOpen : true;
  // Two pills at the same height render as one unreadable stack. A trigger the
  // user is actively placing wins over the mark, which is also on the line.
  const markPillHidden =
    markY !== null &&
    [takeProfitPrice, stopLossPrice, entryPrice].some(
      (price) => price !== null && Math.abs(yOf(price, shaped, chartHeight) - markY) < PILL_COLLISION,
    );

  // The crosshair holds an absolute index; the drawn window starts at `first`.
  const barIndex = crosshair ? crosshair.index - shaped.first : -1;
  const activeBar =
    barIndex >= 0 && barIndex < shaped.drawn.length ? shaped.drawn[barIndex] : null;
  const crosshairX = activeBar ? shaped.xForIndex(barIndex) : null;
  // Anything sitting on a gridline's row would print over its label.
  const occupiedYs = [markPillHidden ? null : markY, crosshair ? crosshair.y : null].filter(
    (y): y is number => y !== null,
  );

  const plot = (
    <View ref={plotRef} style={{ width, height: totalHeight }}>
      <Canvas style={{ width, height: chartHeight }}>
        {showGrid || priceAxis ? (
          <Path
            path={gridPath}
            style="stroke"
            strokeWidth={1}
            color={colors.chartGrid}
            opacity={0.7}
          />
        ) : null}
        <Path path={profitZone} color={colors.chartPositive} opacity={0.12} />
        <Path path={lossZone} color={colors.chartNegative} opacity={0.12} />

        {/* Two filled paths for the whole series, whatever the zoom: wicks are
            thin rects rather than strokes so a candle needs no second paint. */}
        <Group clip={plotClip}>
          {variant === 'line' ? (
            <Path
              path={linePath}
              style="stroke"
              strokeWidth={2.5}
              strokeJoin="round"
              strokeCap="round"
              color={lineColor ?? colors.chartPositive}
            />
          ) : (
            <>
              <Path path={risingPath} color={colors.chartPositive} />
              <Path path={fallingPath} color={colors.chartNegative} />
            </>
          )}
        </Group>

        {entryPrice !== null ? (
          <Path path={entryPath} style="stroke" strokeWidth={1.25} color={colors.textSecondary}>
            <DashPathEffect intervals={[5, 4]} />
          </Path>
        ) : null}
        {liquidationPrice !== null ? (
          <Path
            path={liquidationPath}
            style="stroke"
            strokeWidth={1.25}
            color={colors.chartNegative}
            opacity={0.8}
          >
            <DashPathEffect intervals={[2, 5]} />
          </Path>
        ) : null}
        {markPrice !== null ? (
          <Path path={markPath} style="stroke" strokeWidth={1} color={colors.text} opacity={0.5} />
        ) : null}
        {takeProfitPrice !== null ? (
          <Path
            path={takeProfitPath}
            style="stroke"
            strokeWidth={1.5}
            color={colors.chartPositive}
          />
        ) : null}
        {stopLossPrice !== null ? (
          <Path path={stopLossPath} style="stroke" strokeWidth={1.5} color={colors.chartNegative} />
        ) : null}
      </Canvas>

      {callerPins.map(({ caller, index, price, lift }) => (
        <PerpCallerPin
          key={caller.id}
          caller={caller}
          index={index}
          price={price}
          lift={lift}
          frame={frame}
          plotWidth={plotWidth}
          chartHeight={chartHeight}
        />
      ))}

      {/* Crosshair. Mounted from React state — once per hold — but *moved* from
          the shared values the touch worklet writes, so dragging it never waits
          on a re-render. The horizontal line spans the full width so it meets
          its price pill instead of stopping at the plot edge. */}
      {crosshair ? (
        <>
          <Reanimated.View
            style={[styles.crosshairV, { height: chartHeight }, crosshairVStyle]}
            pointerEvents="none"
          />
          <Reanimated.View
            style={[styles.crosshairH, { width }, crosshairHStyle]}
            pointerEvents="none"
          />
        </>
      ) : null}

      {/* Right-hand price scale. Fixed number of slots so the hook order in
          <AxisLabel> never changes; unused ones render nothing. */}
      {priceAxis
        ? Array.from({ length: GRID_LINES + 1 }, (_, index) => {
            const tick = shaped.ticks[index];
            const hidden =
              !tick ||
              occupiedYs.some((y) => Math.abs(y - yOf(tick.price, shaped, chartHeight)) < 11);
            return (
              <AxisLabel
                key={index}
                price={tick?.price ?? null}
                label={hidden ? null : (tick?.label ?? null)}
                frame={frame}
                chartHeight={chartHeight}
                style={[styles.scaleLabel, { width: axisWidth - 4 }]}
              />
            );
          })
        : null}

      {/* Centred on their column, since the columns are fixed and the candles
          are what move under them. */}
      {timeAxis
        ? shaped.timeLabels.map((label) => (
            <Text
              key={label.key}
              style={[
                styles.timeLabel,
                {
                  top: chartHeight + 2,
                  left: clamp(label.x - 30, 0, Math.max(0, plotWidth - 60)),
                },
              ]}
            >
              {label.label}
            </Text>
          ))
        : null}

      {/* The crosshair says *when*; the price is already on the right scale. */}
      {activeBar && timeAxis && crosshairX !== null ? (
        <View
          style={[
            styles.stampChip,
            { top: chartHeight, left: clamp(crosshairX - 44, 0, Math.max(0, plotWidth - 88)) },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.stampText}>{formatStamp(activeBar.time)}</Text>
        </View>
      ) : null}

      {/* Price pills ride the lines — animated from the same frame the lines are
          painted from, so they stay glued to them even mid-drag. */}
      <LevelPill
        price={markPillHidden ? null : markPrice}
        frame={frame}
        chartHeight={chartHeight}
        style={[
          styles.pill,
          { backgroundColor: markUp ? colors.chartPositive : colors.chartNegative },
        ]}
        textStyle={styles.pillText}
        text={markPrice === null ? '' : formatPrice(markPrice, shaped.priceDecimals)}
      />
      {crosshair ? (
        <Reanimated.View
          style={[styles0.row, styles0.alignEnd, crosshairPillStyle]}
          pointerEvents="none"
        >
          <View style={[styles.pill, styles.pillCrosshair]}>
            <Text style={[styles.pillText, styles.pillTextCrosshair]}>
              {formatPrice(shaped.toPrice(crosshair.y), shaped.priceDecimals)}
            </Text>
          </View>
        </Reanimated.View>
      ) : null}
      <LevelPill
        price={entryPrice}
        frame={frame}
        chartHeight={chartHeight}
        align="left"
        style={[styles.tagLeft, styles.tagMuted]}
        textStyle={styles.tagText}
        text="Entry"
      />
      <LevelPill
        price={entryPrice}
        frame={frame}
        chartHeight={chartHeight}
        style={[styles.pill, styles.pillMuted]}
        textStyle={styles.pillText}
        text={entryPrice === null ? '' : formatPrice(entryPrice, shaped.priceDecimals)}
      />
      {/* Label on the left, price on the right — the same split Entry, Take
          Profit and Stop Loss already use. Liquidation used to carry its
          "Liq " prefix inside the right-hand pill, which made it the one pill
          too wide for the price gutter. */}
      <LevelPill
        price={liquidationPrice}
        frame={frame}
        chartHeight={chartHeight}
        align="left"
        style={[styles.tagLeft, { backgroundColor: colors.chartNegative }]}
        textStyle={styles.tagText}
        text="Liq"
      />
      <LevelPill
        price={liquidationPrice}
        frame={frame}
        chartHeight={chartHeight}
        style={[styles.pill, styles.pillOutline, { borderColor: colors.chartNegative }]}
        textStyle={[styles.pillText, { color: colors.chartNegative }]}
        text={liquidationPrice === null ? '' : formatPrice(liquidationPrice, shaped.priceDecimals)}
      />
      {takeProfitPrice !== null ? (
        <TriggerTag
          label="Take Profit"
          color={colors.chartPositive}
          price={takeProfitPrice}
          frame={frame}
          chartHeight={chartHeight}
          onClear={onClearTrigger ? () => onClearTrigger('takeProfit') : undefined}
        />
      ) : null}
      <LevelPill
        price={takeProfitPrice}
        frame={frame}
        chartHeight={chartHeight}
        style={[styles.pill, { backgroundColor: colors.chartPositive }]}
        textStyle={styles.pillText}
        text={takeProfitPrice === null ? '' : formatPrice(takeProfitPrice, shaped.priceDecimals)}
      />
      {stopLossPrice !== null ? (
        <TriggerTag
          label="Stop Loss"
          color={colors.chartNegative}
          price={stopLossPrice}
          frame={frame}
          chartHeight={chartHeight}
          onClear={onClearTrigger ? () => onClearTrigger('stopLoss') : undefined}
        />
      ) : null}
      <LevelPill
        price={stopLossPrice}
        frame={frame}
        chartHeight={chartHeight}
        style={[styles.pill, { backgroundColor: colors.chartNegative }]}
        textStyle={styles.pillText}
        text={stopLossPrice === null ? '' : formatPrice(stopLossPrice, shaped.priceDecimals)}
      />

      {/* Scrolled off the live edge — one tap back. */}
      {zoomable && view.offset > 0 ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Scroll to latest candle"
          onPress={() => {
            tapFeedback();
            cancelAnimation(offsetSV);
            offsetSV.value = 0;
            // Back to the live edge, at whatever zoom the user chose — this is
            // "catch up", not "reset".
            setCommitted({ count: view.count, offset: 0, yZoom });
          }}
          hitSlop={10}
          style={[styles.jumpButton, { left: plotWidth - 30, top: chartHeight - 30 }]}
        >
          <Ionicons name="play-forward" size={13} color={colors.textInverse} />
        </PressableScale>
      ) : null}

      {/* The time scale's hit area, over its labels. */}
      {zoomable && timeAxis ? (
        <GestureDetector gesture={timeAxisGesture}>
          <View
            style={[
              styles.timeAxisTouch,
              { top: chartHeight, width: plotWidth, height: TIME_AXIS_HEIGHT },
            ]}
            accessibilityLabel="Time scale — drag to stretch, double-tap to reset"
          />
        </GestureDetector>
      ) : null}

      {/* Once the scale has been set by hand it stops following the candles, so
          say so and offer the way back. A double-tap does the same thing, but a
          62pt gutter is a poor target to have to discover. */}
      {zoomable && priceAxis && Math.abs(yZoom - 1) > 0.01 ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Auto-fit the price scale"
          onPress={() => {
            yZoomSV.value = 1;
            resetAxisZoom();
          }}
          hitSlop={8}
          // Top-left of the gutter: the bottom edge is where a pinned
          // liquidation pill lives, and the chip used to sit right on it.
          style={[styles.autoFitChip, { top: 4, right: axisWidth + 4 }]}
        >
          <Text style={styles.autoFitText}>AUTO</Text>
        </PressableScale>
      ) : null}

      {hideAxis ? null : (
        <View style={styles.axisRow}>
          <Text style={styles.axisText}>{formatPrice(shaped.min)}</Text>
          <Text style={styles.axisText}>mark</Text>
          <Text style={styles.axisText}>{formatPrice(shaped.max)}</Text>
        </View>
      )}
    </View>
  );

  if (onDragTrigger) return <GestureDetector gesture={dragGesture}>{plot}</GestureDetector>;
  if (zoomable) return <GestureDetector gesture={plotGesture}>{plot}</GestureDetector>;
  if (hasPinTap) return <GestureDetector gesture={pinTap}>{plot}</GestureDetector>;
  return plot;
});

// ---------------------------------------------------------------------------
// Worklets. These run on both threads: React uses them to lay out text, the
// painters use them to draw, and both must agree to the pixel.
//
// ⚠️ Definition order matters here in a way it does not for ordinary functions.
// A worklet captures what it references when the worklet is *created*, not when
// it is called, and the transform strips the hoisting a `function` declaration
// would normally give you. A worklet that calls one defined further down the
// file captures `undefined` and dies with "not a function" — so every worklet
// below only ever calls one already defined above it.
// ---------------------------------------------------------------------------

function clampOffset(total: number, count: number, offset: number): number {
  'worklet';
  const limit = Math.max(0, total - count);
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(offset, 0), limit);
}

function clampWindow(total: number, count: number, offset: number): Viewport {
  'worklet';
  const maxVisible = Math.max(1, Math.min(total, MAX_VISIBLE));
  const minVisible = Math.min(MIN_VISIBLE, maxVisible);
  const safeCount = Math.min(
    Math.max(Number.isFinite(count) ? count : minVisible, minVisible),
    maxVisible,
  );
  return { count: safeCount, offset: clampOffset(total, safeCount, offset) };
}

/**
 * One creator pin on the candles. Positioned from the shared frame on the UI
 * thread, exactly like the candle bodies, and hidden while its candle is
 * scrolled out of the plot.
 */
function PerpCallerPin({
  caller,
  index,
  price,
  lift,
  frame,
  plotWidth,
  chartHeight,
}: {
  caller: ChartCaller;
  index: number;
  price: number;
  lift: number;
  frame: SharedValue<Frame>;
  plotWidth: number;
  chartHeight: number;
}) {
  const reach = callerPinReach(caller, lift);
  const [below, setBelow] = useState(false);
  const style = useAnimatedStyle(() => {
    const f = frame.value;
    const x = (index - f.viewStart + 0.5) * f.slotWidth;
    const y = yOf(price, f, chartHeight);
    return {
      opacity: x < 0 || x > plotWidth ? 0 : 1,
      transform: [{ translateX: x }, { translateY: y }],
    };
  });
  // Flip under the candle when there is no headroom above it. Only the flip
  // crosses to JS, and only when it changes.
  useAnimatedReaction(
    () => yOf(price, frame.value, chartHeight) < reach,
    (next, previous) => {
      if (next !== previous) runOnJS(setBelow)(next);
    },
  );
  return (
    <Reanimated.View pointerEvents="none" style={[pinStyles.pin, style]}>
      <CallerPin caller={caller} lift={lift} below={below} />
    </Reanimated.View>
  );
}

const pinStyles = StyleSheet.create({
  pin: { position: 'absolute', left: 0, top: 0 },
});

/**
 * The window as a *fractional* range over the series, not a slice: a drag of
 * half a candle moves the plot half a candle. `first`/`last` carry one spare
 * bar beyond each edge so a body sliding in is already drawn.
 */
function computeFrame(
  series: Series,
  total: number,
  window: Viewport,
  plotWidth: number,
  /** Levels the user is setting. These stretch the axis without limit. */
  levels: number[],
  /** Levels merely reported. These stretch it only to {@link OVERLAY_EXTENSION}. */
  pinned: number[],
  yZoom: number,
  /** `[min, max]` to hold the scale at, while a trigger line is being dragged. */
  frozen: number[] | null,
): Frame {
  'worklet';
  const viewEnd = total - window.offset;
  const viewStart = viewEnd - window.count;
  const slotWidth = plotWidth / window.count;
  const first = Math.min(Math.max(Math.floor(viewStart) - 1, 0), Math.max(0, total - 1));
  const last = Math.min(Math.max(Math.ceil(viewEnd), 0), Math.max(0, total - 1));

  // Only what is actually on the plot may drive the y-axis — including the
  // spare bars would make the scale twitch as they scroll past.
  const from = Math.min(Math.max(Math.ceil(viewStart), 0), Math.max(0, total - 1));
  const to = Math.min(Math.max(Math.floor(viewEnd - 0.0001), 0), Math.max(0, total - 1));
  let high = -Infinity;
  let low = Infinity;
  for (let index = from; index <= to; index += 1) {
    if (series.highs[index] > high) high = series.highs[index];
    if (series.lows[index] < low) low = series.lows[index];
  }
  if (high === -Infinity || low === Infinity) {
    high = series.highs[last] ?? 1;
    low = series.lows[last] ?? 0;
  }

  const candleSpan = high - low || Math.max(high * 0.001, 0.01);
  let rawMax = high;
  let rawMin = low;

  // The user's own levels join the domain whole. A take profit at +40% is a
  // number they are actively choosing, and the chart's job is to widen until it
  // fits — squashing the candles is the honest picture of a target that far out.
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    if (level > rawMax) rawMax = level;
    if (level < rawMin) rawMin = level;
  }

  // Reported levels join only when they are near the candles. One further out
  // does not stretch the scale at all — it is drawn pinned to the plot edge
  // with its true price on the label. Clamping it to the cap and *then*
  // joining (the old rule) meant a distant liquidation always spent a full
  // candle-range of height on empty space, halving every candle.
  const ceiling = high + candleSpan * OVERLAY_EXTENSION;
  const floor = low - candleSpan * OVERLAY_EXTENSION;
  for (let index = 0; index < pinned.length; index += 1) {
    const level = pinned[index];
    if (level > ceiling || level < floor) continue;
    if (level > rawMax) rawMax = level;
    if (level < rawMin) rawMin = level;
  }

  // Breathing room so a line sitting at the extreme isn't drawn on the edge.
  const pad = (rawMax - rawMin || Math.max(rawMax * 0.001, 0.01)) * 0.08;
  const fitMax = rawMax + pad;
  const fitMin = rawMin - pad;

  // The manual stretch is applied last, about the middle of the auto-fitted
  // range: dragging the scale changes how much price the same pixels cover,
  // it does not re-centre the chart on something else.
  const centre = (fitMax + fitMin) / 2;
  const half = ((fitMax - fitMin) / 2) * yZoom;
  let max = centre + half;
  let min = centre - half;
  if (frozen !== null && frozen.length === 2 && frozen[1] > frozen[0]) {
    min = frozen[0];
    max = frozen[1];
  }
  return {
    min,
    max,
    span: max - min || Math.max(max * 0.001, 0.01),
    viewStart,
    slotWidth,
    first,
    last,
  };
}

/** Clamped, so an off-scale level lands on the plot edge rather than outside. */
function yOf(price: number, frame: Frame, chartHeight: number): number {
  'worklet';
  const plotHeight = chartHeight - PADDING_Y * 2;
  return (
    PADDING_Y + ((frame.max - Math.min(frame.max, Math.max(frame.min, price))) / frame.span) * plotHeight
  );
}

/** The mark closes as one polyline, through each candle's centre. */
function paintLine(path: SkPath, series: Series, frame: Frame, chartHeight: number): void {
  'worklet';
  for (let index = frame.first; index <= frame.last; index += 1) {
    const close = series.closes[index];
    if (close === undefined) continue;
    const x = (index - frame.viewStart + 0.5) * frame.slotWidth;
    const y = yOf(close, frame, chartHeight);
    if (index === frame.first) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
}

/**
 * One filled path for every candle of one direction — bodies and wicks both as
 * rects, so the whole series is a single fill with no second paint.
 *
 * This is what stops a frame's cost scaling with the zoom level: 200 candles on
 * screen is still one path.
 */
function paintCandles(
  path: SkPath,
  series: Series,
  frame: Frame,
  chartHeight: number,
  bodyRatio: number,
  rising: boolean,
): void {
  'worklet';
  const bodyWidth = Math.max(frame.slotWidth * bodyRatio, 1.5);
  const wickWidth = Math.max(frame.slotWidth * 0.1, 1);

  for (let index = frame.first; index <= frame.last; index += 1) {
    const open = series.opens[index];
    const close = series.closes[index];
    if (open === undefined || close === undefined) continue;
    if (close >= open !== rising) continue;

    const x = (index - frame.viewStart + 0.5) * frame.slotWidth;
    const highY = yOf(series.highs[index], frame, chartHeight);
    const lowY = yOf(series.lows[index], frame, chartHeight);
    const openY = yOf(open, frame, chartHeight);
    const closeY = yOf(close, frame, chartHeight);
    const top = Math.min(openY, closeY);

    path.addRect(Skia.XYWHRect(x - wickWidth / 2, highY, wickWidth, Math.max(lowY - highY, 1)));
    // Sub-pixel bodies vanish on a doji; floor at 1px so every bar reads.
    path.addRect(
      Skia.XYWHRect(x - bodyWidth / 2, top, bodyWidth, Math.max(Math.abs(closeY - openY), 1)),
    );
  }
}

/** A full-width horizontal line at one price, repositioned every frame. */
function useLevelPath(
  frame: SharedValue<Frame>,
  price: number | null,
  plotWidth: number,
  chartHeight: number,
) {
  return usePathValue(
    useCallback(
      (path: SkPath) => {
        'worklet';
        if (price === null) return;
        const y = yOf(price, frame.value, chartHeight);
        path.moveTo(0, y);
        path.lineTo(plotWidth, y);
      },
      [frame, price, plotWidth, chartHeight],
    ),
  );
}

/** The shaded band between the mark and a trigger. */
function useZonePath(
  frame: SharedValue<Frame>,
  from: number | null,
  to: number | null,
  plotWidth: number,
  chartHeight: number,
) {
  return usePathValue(
    useCallback(
      (path: SkPath) => {
        'worklet';
        if (from === null || to === null) return;
        const a = yOf(from, frame.value, chartHeight);
        const b = yOf(to, frame.value, chartHeight);
        path.addRect(Skia.XYWHRect(0, Math.min(a, b), plotWidth, Math.abs(b - a)));
      },
      [frame, from, to, plotWidth, chartHeight],
    ),
  );
}

// ---------------------------------------------------------------------------

/**
 * A price pill pinned to its line, positioned on the UI thread.
 *
 * The animated element is a full-width row rather than the pill itself: it can
 * then be moved by a single `translateY` with no layout involved, while the
 * pill inside keeps its natural width and hugs whichever edge it belongs to.
 */
function LevelPill({
  price,
  frame,
  chartHeight,
  align = 'right',
  style,
  textStyle,
  text,
}: {
  price: number | null;
  frame: SharedValue<Frame>;
  chartHeight: number;
  align?: 'left' | 'right';
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  text: string;
}) {
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: price === null ? 0 : yOf(price, frame.value, chartHeight) - 10 }],
  }));

  if (price === null) return null;
  return (
    <Reanimated.View
      style={[styles0.row, align === 'right' ? styles0.alignEnd : styles0.alignStart, animated]}
      pointerEvents="none"
    >
      <View style={style}>
        <Text style={textStyle}>{text}</Text>
      </View>
    </Reanimated.View>
  );
}

/** One row of the price scale. Text from React, position from the UI thread. */
function AxisLabel({
  price,
  label,
  frame,
  chartHeight,
  style,
}: {
  price: number | null;
  label: string | null;
  frame: SharedValue<Frame>;
  chartHeight: number;
  style: StyleProp<TextStyle>;
}) {
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: price === null ? 0 : yOf(price, frame.value, chartHeight) - 7 }],
  }));

  if (price === null || label === null) return null;
  return (
    <Reanimated.View style={[styles0.row, styles0.alignEnd, animated]} pointerEvents="none">
      <Text style={style}>{label}</Text>
    </Reanimated.View>
  );
}

/** The line's left-hand label. Tapping the ✕ drops that leg entirely. */
function TriggerTag({
  label,
  color,
  price,
  frame,
  chartHeight,
  onClear,
}: {
  label: string;
  color: string;
  price: number;
  frame: SharedValue<Frame>;
  chartHeight: number;
  onClear?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: yOf(price, frame.value, chartHeight) - 10 }],
  }));

  return (
    <Reanimated.View
      style={[styles0.row, styles0.alignStart, animated]}
      pointerEvents={onClear ? 'box-none' : 'none'}
    >
      {onClear ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          onPress={onClear}
          hitSlop={8}
          style={[styles.tagLeft, { backgroundColor: color }]}
        >
          <Ionicons name="close" size={12} color="#FFFFFF" />
          <Text style={styles.tagText}>{label}</Text>
        </PressableScale>
      ) : (
        <View style={[styles.tagLeft, { backgroundColor: color }]}>
          <Text style={styles.tagText}>{label}</Text>
        </View>
      )}
    </Reanimated.View>
  );
}

function levelPrices(...values: (number | null)[]): number[] {
  return values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
}

function clamp(value: number, min: number, max: number): number {
  'worklet';
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Gridline prices on round numbers (1/2/2.5/5 × 10ⁿ). Evenly dividing the
 * domain gives labels like $173.61 — technically correct, unreadable as a
 * scale.
 */
function niceTicks(min: number, max: number, target: number): number[] {
  const span = max - min;
  if (!(span > 0) || target < 2) return [min, max];

  const rough = span / (target - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step =
    (normalized > 5 ? 10 : normalized > 2.5 ? 5 : normalized > 2 ? 2.5 : normalized > 1 ? 2 : 1) *
    magnitude;

  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + step * 0.001; tick += step) {
    ticks.push(tick);
  }
  // A domain narrower than one step leaves nothing to draw; fall back to ends.
  return ticks.length >= 2 ? ticks : [min + span * 0.25, min + span * 0.75];
}

/** Zoomed into a $0.40 range, two decimals is one flat number. */
/**
 * Decimals for every price on the scale.
 *
 * Span alone isn't enough: zooming a $77k market to a $2 window asked for three
 * decimals, printing "$77,524.123" — precision nobody trades on, and wide
 * enough to push the pill out of its gutter. Above four figures the cents are
 * already the fine detail, so magnitude caps it.
 */
function decimalsForPrice(span: number, magnitude: number): number {
  // Anything priced in whole dollars reads in cents — "$149.570" is precision
  // nobody trades on. Only a sub-dollar asset, where cents collapse the whole
  // window onto one label, earns a third or fourth place.
  if (magnitude >= 1) return 2;
  if (span >= 0.5) return 3;
  return 4;
}

function formatPrice(value: number, decimals = 2): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * The label format follows the gap *between* labels, not the window's total
 * span — that distinction is what stops a 34-hour window printing "Mon Mon Mon
 * Tue", four columns that agree with each other and locate nothing.
 *
 * Within a day the labels are clock times, and a column that crosses midnight
 * prints its date instead, so the day is stated exactly once where it changes.
 */
/** Fixed screen columns, each resolved to the bar under it and then labelled. */
function buildTimeLabels(
  drawn: PhoenixCandle[],
  frame: Frame,
  first: number,
  plotWidth: number,
  labelCount: number,
  spanMs: number,
): { key: number; x: number; label: string }[] {
  if (drawn.length < 3) return [];

  const stamps = Array.from({ length: labelCount }, (_, slot) => {
    const x = ((slot + 0.5) * plotWidth) / labelCount;
    const index = clamp(
      Math.round(frame.viewStart + x / frame.slotWidth - 0.5) - first,
      0,
      drawn.length - 1,
    );
    return { key: slot, x, time: drawn[index].time };
  });

  // The gap between neighbouring columns is what decides the format; fall back
  // to the whole window when there is only one column to go on.
  const stepMs =
    stamps.length > 1 ? Math.abs(stamps[1].time - stamps[0].time) : spanMs;

  return stamps.map((stamp, index) => ({
    key: stamp.key,
    x: stamp.x,
    label: formatAxisStamp(stamp.time, stepMs, index === 0 ? null : stamps[index - 1].time),
  }));
}

function formatAxisStamp(epochMs: number, stepMs: number, previousMs: number | null): string {
  const date = new Date(epochMs);
  if (stepMs >= 25 * 86_400_000) {
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  if (stepMs >= 20 * 3_600_000) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  const previous = previousMs === null ? null : new Date(previousMs);
  const startsNewDay =
    previous === null ||
    previous.getDate() !== date.getDate() ||
    previous.getMonth() !== date.getMonth();
  return startsNewDay
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : formatClock(epochMs);
}

function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Full stamp for the crosshair readout, where the exact bar matters. */
function formatStamp(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${formatClock(epochMs)}`;
}

/** Theme-free positioning shared by the animated overlays. */
const styles0 = StyleSheet.create({
  row: { position: 'absolute', left: 0, right: 0, top: 0 },
  alignEnd: { alignItems: 'flex-end' },
  alignStart: { alignItems: 'flex-start' },
});

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    empty: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 13,
    },
    axisRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 6,
    },
    axisText: {
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 11,
    },
    scaleLabel: {
      width: AXIS_WIDTH - 6,
      // Mirrors the pill's paddingHorizontal, so pill text and tick text share
      // one right edge rather than sitting 6pt apart.
      paddingRight: 6,
      textAlign: 'right',
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 11,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    timeLabel: {
      position: 'absolute',
      width: 60,
      textAlign: 'center',
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 10.5,
      fontWeight: '600',
    },
    crosshairV: {
      position: 'absolute',
      top: 0,
      // Explicit origin: the line is placed by translateX now, and an absolute
      // view with no `left` would resolve to its static position instead of 0.
      left: 0,
      width: StyleSheet.hairlineWidth * 2,
      backgroundColor: c.text,
      opacity: 0.5,
    },
    crosshairH: {
      position: 'absolute',
      left: 0,
      top: 0,
      height: StyleSheet.hairlineWidth * 2,
      backgroundColor: c.text,
      opacity: 0.5,
    },
    // Sits in the time-axis strip under the crosshair, the way a chart's x-axis
    // badge does — it covers labels, never candles.
    stampChip: {
      position: 'absolute',
      width: 88,
      height: 16,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.text,
    },
    stampText: {
      fontFamily: F,
      color: c.textInverse,
      fontSize: 10,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    // Overlay chrome. The animated row owns the y; these just draw the chip.
    pill: {
      height: 20,
      paddingHorizontal: 6,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      // Deliberately no minWidth: a chip hugs its text. Forcing every pill out
      // to the gutter's width just parks empty background beside short prices.
      // The column comes from the shared price format plus the row's right
      // alignment, not from padding pills out to a common size.
    },
    // Light grey so it reads as a transient readout, distinct from the
    // live-price pill's green/pink on the same scale.
    pillCrosshair: { backgroundColor: c.surfaceSelected },
    pillTextCrosshair: { color: c.text },
    pillMuted: { backgroundColor: c.textSecondary },
    pillOutline: { backgroundColor: c.background, borderWidth: 1 },
    pillText: {
      fontFamily: F,
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    tagLeft: {
      height: 20,
      paddingHorizontal: 8,
      borderRadius: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
    },
    tagMuted: { backgroundColor: c.textSecondary },
    tagText: { fontFamily: F, color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
    // Transparent: they exist to catch the drag, not to be seen.
    timeAxisTouch: { position: 'absolute', left: 0 },
    autoFitChip: {
      position: 'absolute',
      paddingHorizontal: 7,
      height: 18,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.textSecondary,
    },
    autoFitText: {
      fontFamily: F,
      color: '#FFFFFF',
      fontSize: 9.5,
      fontWeight: '800',
      letterSpacing: 0.4,
    },
    jumpButton: {
      position: 'absolute',
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.text,
      opacity: 0.85,
    },
  });
