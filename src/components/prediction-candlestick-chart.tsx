import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import { WavingLineSkeleton } from '@/components/waving-line-skeleton';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  getPredictionMarketCandles,
  type PredictionCandle,
  type PredictionChartWindow,
} from '@/lib/api';

const F = Fonts.rounded;


const CHART_HEIGHT = 200;
const PADDING_X = 8;
const PADDING_Y = 16;
const MAX_CANDLES = 60;

const WINDOWS: PredictionChartWindow[] = ['1D', '1W', '1M', 'ALL'];

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

type PredictionCandlestickChartProps = {
  marketId: string;
  side: 'yes' | 'no';
  mode?: 'line' | 'candle';
  /** Reports the scrubbed (or latest) close probability 0..1 and its time. */
  onScrub?: (close: number | null, timestamp: number | null) => void;
};

type Bar = {
  index: number;
  x: number;
  bodyX: number;
  bodyY: number;
  bodyWidth: number;
  bodyHeight: number;
  highY: number;
  lowY: number;
  color: string;
};

// Aggregate down to at most MAX_CANDLES buckets so bodies stay readable on a
// phone-width plot while preserving the full time span (mirrors the stock
// chart's downsample-not-slice behaviour).
function downsample(candles: PredictionCandle[], max: number): PredictionCandle[] {
  if (candles.length <= max) return candles;
  const groupSize = Math.ceil(candles.length / max);
  const out: PredictionCandle[] = [];
  for (let i = 0; i < candles.length; i += groupSize) {
    const group = candles.slice(i, i + groupSize);
    if (group.length === 0) continue;
    out.push({
      timestamp: group[0].timestamp,
      open: group[0].open,
      close: group[group.length - 1].close,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return out;
}

export function PredictionCandlestickChart({
  marketId,
  side,
  mode = 'line',
  onScrub,
}: PredictionCandlestickChartProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();

  const [window, setWindow] = useState<PredictionChartWindow>('1W');
  const [candles, setCandles] = useState<PredictionCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartWidth, setChartWidth] = useState(320);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const requestIdRef = useRef(0);
  const lastHapticRef = useRef(-1);

  // Fetch candles on mount / market / side / window change.
  useEffect(() => {
    if (!marketId) return;
    const id = ++requestIdRef.current;
    setLoading(true);
    void getPredictionMarketCandles(marketId, side, window)
      .then((result) => {
        if (id !== requestIdRef.current) return;
        setCandles(downsample(result, MAX_CANDLES));
        setSelectedIndex(-1);
      })
      .catch(() => {
        if (id !== requestIdRef.current) return;
        setCandles([]);
      })
      .finally(() => {
        if (id === requestIdRef.current) setLoading(false);
      });
  }, [marketId, side, window]);

  // Report the latest close whenever candles change and nothing is scrubbed.
  useEffect(() => {
    if (selectedIndex >= 0) return;
    const last = candles[candles.length - 1];
    onScrub?.(last ? last.close : null, last ? last.timestamp : null);
  }, [candles, selectedIndex, onScrub]);

  const plotWidth = chartWidth - PADDING_X * 2;
  const plotHeight = CHART_HEIGHT - PADDING_Y * 2;

  // Probability charts live in 0..1; pad the visible range a touch so the line
  // never sits flush against the top/bottom edge.
  const range = useMemo(() => {
    if (candles.length === 0) return { min: 0, max: 1 };
    let min = Infinity;
    let max = -Infinity;
    for (const c of candles) {
      min = Math.min(min, c.low);
      max = Math.max(max, c.high);
    }
    const pad = Math.max((max - min) * 0.12, 0.02);
    return { min: Math.max(0, min - pad), max: Math.min(1, max + pad) };
  }, [candles]);

  const bars = useMemo<Bar[]>(() => {
    if (candles.length === 0 || plotWidth <= 0) return [];
    const span = Math.max(range.max - range.min, 0.0001);
    const slot = plotWidth / candles.length;
    const bodyWidth = Math.max(2, Math.min(slot * 0.62, 14));
    const yFor = (value: number) =>
      PADDING_Y + (1 - (value - range.min) / span) * plotHeight;

    return candles.map((candle, index) => {
      const x = PADDING_X + slot * index + slot / 2;
      const up = candle.close >= candle.open;
      const openY = yFor(candle.open);
      const closeY = yFor(candle.close);
      const bodyY = Math.min(openY, closeY);
      const bodyHeight = Math.max(1, Math.abs(closeY - openY));
      return {
        index,
        x,
        bodyX: x - bodyWidth / 2,
        bodyY,
        bodyWidth,
        bodyHeight,
        highY: yFor(candle.high),
        lowY: yFor(candle.low),
        color: up ? colors.chartPositive : colors.chartNegative,
      };
    });
  }, [candles, colors.chartNegative, colors.chartPositive, plotWidth, plotHeight, range]);

  const points = useMemo(() => {
    if (candles.length === 0 || plotWidth <= 0) return [];
    const span = Math.max(range.max - range.min, 0.0001);
    const slot = plotWidth / candles.length;
    const yFor = (value: number) =>
      PADDING_Y + (1 - (value - range.min) / span) * plotHeight;

    return candles.map((candle, index) => ({
      x: PADDING_X + slot * index + slot / 2,
      y: yFor(candle.close),
    }));
  }, [candles, plotWidth, plotHeight, range]);

  const linePath = useMemo(() => buildLinePath(points), [points]);

  const isPositive = useMemo(() => {
    if (candles.length < 2) return true;
    return candles[candles.length - 1].close >= candles[0].open;
  }, [candles]);

  const lineColor = isPositive ? colors.chartPositive : colors.chartNegative;

  const selectAtX = useCallback(
    (px: number) => {
      if (candles.length === 0 || plotWidth <= 0) return;
      const slot = plotWidth / candles.length;
      const idx = Math.max(
        0,
        Math.min(candles.length - 1, Math.floor((px - PADDING_X) / slot)),
      );
      setSelectedIndex(idx);
      if (idx !== lastHapticRef.current) {
        lastHapticRef.current = idx;
        void Haptics.selectionAsync();
        const c = candles[idx];
        onScrub?.(c.close, c.timestamp);
      }
    },
    [candles, plotWidth, onScrub],
  );

  // `.runOnJS(true)` keeps the handlers on the JS thread so they can touch React
  // state directly and stay compatible with the surrounding BottomSheet.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .runOnJS(true)
        .onTouchesDown((e) => {
          if (e.allTouches.length > 0) selectAtX(e.allTouches[0].x);
        })
        .onUpdate((e) => selectAtX(e.x))
        .onEnd(() => {
          lastHapticRef.current = -1;
          setSelectedIndex(-1);
        }),
    [selectAtX],
  );

  const selected = selectedIndex >= 0 ? bars[selectedIndex] : null;

  return (
    <View>
      <View
        style={styles.plot}
        onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
      >
        {loading ? (
          <WavingLineSkeleton height={CHART_HEIGHT} />
        ) : candles.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.empty}>No price history yet</Text>
          </View>
        ) : (
          <GestureDetector gesture={pan}>
            <Svg width={chartWidth} height={CHART_HEIGHT}>
              {selected ? (
                <Line
                  x1={selected.x}
                  y1={PADDING_Y}
                  x2={selected.x}
                  y2={CHART_HEIGHT - PADDING_Y}
                  stroke={colors.chartCrosshair}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              ) : null}
              {mode === 'line' ? (
                <>
                  {linePath ? (
                    <Path
                      d={linePath}
                      fill="none"
                      stroke={lineColor}
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                  {!selected && points.length > 0 ? (
                    <>
                      <Circle
                        cx={points[points.length - 1].x}
                        cy={points[points.length - 1].y}
                        r="4.5"
                        fill={lineColor}
                      />
                      <Circle
                        cx={points[points.length - 1].x}
                        cy={points[points.length - 1].y}
                        r="2.5"
                        fill="#ffffff"
                      />
                    </>
                  ) : null}
                  {selected ? (
                    <Circle
                      cx={selected.x}
                      cy={points[selected.index].y}
                      r="5"
                      fill="#ffffff"
                      stroke={lineColor}
                      strokeWidth={2}
                    />
                  ) : null}
                </>
              ) : (
                bars.map((bar) => (
                  <React.Fragment key={bar.index}>
                    <Line
                      x1={bar.x}
                      y1={bar.highY}
                      x2={bar.x}
                      y2={bar.lowY}
                      stroke={bar.color}
                      strokeWidth={1}
                      opacity={selected && selected.index !== bar.index ? 0.4 : 1}
                    />
                    <Rect
                      x={bar.bodyX}
                      y={bar.bodyY}
                      width={bar.bodyWidth}
                      height={bar.bodyHeight}
                      rx={1.5}
                      fill={bar.color}
                      opacity={selected && selected.index !== bar.index ? 0.4 : 1}
                    />
                  </React.Fragment>
                ))
              )}
            </Svg>
          </GestureDetector>
        )}
      </View>

      <View style={styles.pills}>
        {WINDOWS.map((w) => {
          const active = w === window;
          return (
            <Pressable
              key={w}
              onPress={() => setWindow(w)}
              style={[styles.pill, active && styles.pillActive]}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                {w}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    plot: {
      height: CHART_HEIGHT,
      justifyContent: 'center',
    },
    center: {
      height: CHART_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    empty: {
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: '600',
      fontFamily: F,
    },
    pills: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
      marginTop: 12,
    },
    pill: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 999,
    },
    pillActive: {
      backgroundColor: c.surfaceAlt,
    },
    pillText: {
      color: c.textQuaternary,
      fontSize: 13,
      fontWeight: '700',
      fontFamily: F,
    },
    pillTextActive: {
      color: c.text,
    },
  });
