import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { ClipPath, Defs, Line, Path, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { PortfolioHistoryPoint } from '@/lib/api';
import { useThemeStore } from '@/lib/theme-store';

const F = Fonts.rounded;

const CHART_HEIGHT = 120;
const PADDING_Y = 12;

type Props = {
  points: PortfolioHistoryPoint[];
  changeUsd: number | null;
  loading?: boolean;
  /** Compact embeds can override the default 120px chart height. */
  height?: number;
  /** Hide the built-in value/change header (caller renders its own). */
  showHeader?: boolean;
  containerStyle?: import('react-native').StyleProp<import('react-native').ViewStyle>;
  /**
   * Fires as the user scrubs across the chart with the point under their finger,
   * and once with `null` when the touch ends. Lets the caller drive its own
   * headline off the hovered P&L point.
   */
  onScrub?: (point: { index: number; valueUsd: number } | null) => void;
};

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function buildLinePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;

  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const tension = 0.3;
    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 3;
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 3;
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 3;
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 3;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

export function PnlChart({
  points,
  changeUsd,
  loading,
  height = CHART_HEIGHT,
  showHeader = true,
  containerStyle,
  onScrub,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const [width, setWidth] = useState(320);
  const [scrubClipPathId] = useState(
    () => `portfolio-chart-scrub-${Math.random().toString(36).slice(2)}`,
  );
  // The scrub dot's exact SVG position under the finger (interpolated between
  // data points so it glides along the line rather than snapping point-to-point).
  const [activePos, setActivePos] = useState<{ x: number; y: number } | null>(null);

  // The PanResponder is created once but must read the latest geometry/handler at
  // touch time, so route everything through a ref instead of capturing closures.
  // Filled in below once `chartPoints`/`plotPoints` exist.
  const scrubState = useRef<{
    width: number;
    chartPoints: { x: number; y: number }[];
    valuePoints: PortfolioHistoryPoint[];
    onScrub?: Props['onScrub'];
  }>({ width, chartPoints: [], valuePoints: [], onScrub });

  // Tracks the last whole data-point index the finger crossed, so we only fire a
  // haptic tick when the scrub actually advances to a new point (not every pixel).
  const lastScrubIndexRef = useRef<number | null>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        scrubState.current.onScrub != null && scrubState.current.chartPoints.length >= 2,
      onMoveShouldSetPanResponder: () =>
        scrubState.current.onScrub != null && scrubState.current.chartPoints.length >= 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        updateScrub(e.nativeEvent.locationX, { haptic: false });
      },
      onPanResponderMove: (e) => updateScrub(e.nativeEvent.locationX),
      onPanResponderRelease: clearScrub,
      onPanResponderTerminate: clearScrub,
    }),
  ).current;

  function updateScrub(x: number, opts?: { haptic?: boolean }) {
    const { width: w, chartPoints: cp, valuePoints: vp, onScrub: cb } = scrubState.current;
    const n = cp.length;
    if (n < 2) return;
    // Continuous fractional position along the evenly-spaced points, then linearly
    // interpolate both the on-screen y and the USD value between the two it falls
    // between — so a finger between samples reads an in-between value, not a snap.
    const clampedX = Math.max(0, Math.min(w, x));
    const f = (clampedX / Math.max(w, 1)) * (n - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, n - 1);
    const frac = f - i0;
    const y = cp[i0].y + (cp[i1].y - cp[i0].y) * frac;
    const valueUsd = vp[i0].valueUsd + (vp[i1].valueUsd - vp[i0].valueUsd) * frac;
    const index = Math.round(f);
    if (opts?.haptic !== false && lastScrubIndexRef.current !== index) {
      void Haptics.selectionAsync();
    }
    lastScrubIndexRef.current = index;
    setActivePos({ x: clampedX, y });
    cb?.({ index, valueUsd });
  }

  function clearScrub() {
    lastScrubIndexRef.current = null;
    setActivePos(null);
    scrubState.current.onScrub?.(null);
  }

  const latest = points.length > 0 ? points[points.length - 1].valueUsd : 0;
  const isPositive = (changeUsd ?? 0) >= 0;
  const lineColor = isPositive ? colors.chartPositive : colors.chartNegative;

  // No closed trades still gets a graph: synthesize a flat zero line so it reads
  // as a clean $0.00 P&L baseline instead of an empty box.
  const plotPoints = useMemo<PortfolioHistoryPoint[]>(() => {
    if (points.length >= 2) return points;
    const now = Date.now();
    const value = points[0]?.valueUsd ?? 0;
    return [
      { t: now - 6 * 24 * 60 * 60 * 1000, valueUsd: value },
      { t: now, valueUsd: value },
    ];
  }, [points]);

  const stats = useMemo(() => {
    const values = plotPoints.map((p) => p.valueUsd);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = Math.max(max - min, Math.max(max * 0.02, 0.01));
    const pad = span * 0.12;
    return { min: min - pad, max: max + pad, span: span + pad * 2 };
  }, [plotPoints]);

  const chartPoints = useMemo(() => {
    const plotH = height - PADDING_Y * 2;
    return plotPoints.map((p, i) => ({
      x: (width * i) / Math.max(plotPoints.length - 1, 1),
      y: PADDING_Y + ((stats.max - p.valueUsd) / stats.span) * plotH,
    }));
  }, [height, plotPoints, width, stats]);

  const linePath = useMemo(() => buildLinePath(chartPoints), [chartPoints]);

  // Keep the gesture handler's geometry current (it reads this at touch time).
  scrubState.current = { width, chartPoints, valuePoints: plotPoints, onScrub };

  const changeLabel =
    changeUsd === null
      ? null
      : `${changeUsd >= 0 ? '+' : ''}${formatUsd(changeUsd)} P&L`;

  return (
    <View style={[styles.container, containerStyle]}>
      {showHeader ? (
        <View style={styles.header}>
          <View>
            <Text style={styles.label}>PnL</Text>
            <Text style={styles.value}>{formatUsd(latest)}</Text>
          </View>
          {changeLabel ? (
            <Text style={[styles.change, { color: lineColor }]}>{changeLabel}</Text>
          ) : null}
        </View>
      ) : null}

      <View
        style={[styles.chartWrap, { height }]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        {...panResponder.panHandlers}>
        {loading && points.length === 0 ? (
          <View style={[styles.skeleton, { height: Math.max(0, height - 16) }]} />
        ) : (
          <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
            {activePos ? (
              <>
                {/* Keep the complete spline as the preview. Clipping the same
                    path for the active side prevents the spline's endpoint
                    control points from changing while the finger moves. */}
                <Defs>
                  <ClipPath id={scrubClipPathId}>
                    <Rect x={0} y={0} width={activePos.x} height={height} />
                  </ClipPath>
                </Defs>
                <Path
                  d={linePath}
                  fill="none"
                  stroke={lineColor}
                  strokeOpacity={0.3}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Path
                  d={linePath}
                  clipPath={`url(#${scrubClipPathId})`}
                  fill="none"
                  stroke={lineColor}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            ) : linePath ? (
              <Path
                d={linePath}
                fill="none"
                stroke={lineColor}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {/* Scrub indicator: vertical guide under the finger. */}
            {activePos ? (
              <Line
                x1={activePos.x}
                y1={0}
                x2={activePos.x}
                y2={height}
                stroke={lineColor}
                strokeWidth={1}
                strokeOpacity={0.4}
              />
            ) : null}
          </Svg>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  label: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: F,
  },
  value: {
    color: c.text,
    fontSize: 24,
    fontWeight: '900',
    fontFamily: F,
    marginTop: 2,
  },
  change: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: Fonts.displayMedium,
  },
  chartWrap: {
    justifyContent: 'center',
  },
  skeleton: {
    borderRadius: 12,
    backgroundColor: c.surfaceAlt,
  },
});
