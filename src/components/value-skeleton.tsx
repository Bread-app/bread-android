import React, { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useThemeStore } from "@/lib/theme-store";

/**
 * Placeholder bar for a figure that hasn't arrived yet — a price, a balance, a
 * P&L. It stands in for the number itself, not for the row around it, so it is
 * sized to the glyphs it replaces and pulses gently rather than sitting inert.
 *
 * A dash is a statement: "there is no number here". Use one only when the value
 * is genuinely absent (an unpriced market, a position with no stop). While a
 * fetch is still in flight the value is unknown, not absent — that's this.
 */
type ValueSkeletonProps = {
  /** Width of the bar. A number of pixels, or a percentage string. */
  width?: number | `${number}%`;
  /** Height of the bar. Match the line-height of the text it replaces. */
  height?: number;
  /** Overrides the themed fill — for figures on the dark board or over glass. */
  color?: string;
  /** Corner rounding; defaults to a pill-ish radius derived from `height`. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
  /** Announced while the figure loads, e.g. "Loading price". */
  accessibilityLabel?: string;
};

export function ValueSkeleton({
  width = 64,
  height = 14,
  color,
  radius,
  style,
  accessibilityLabel = "Loading",
}: ValueSkeletonProps) {
  const { colors } = useThemeStore();
  const opacity = useSharedValue(0.55);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 780, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.55, { duration: 780, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      style={[
        styles.bar,
        {
          width,
          height,
          borderRadius: radius ?? Math.min(height / 2, 7),
          backgroundColor: color ?? colors.surfaceAlt,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/**
 * Keeps a skeleton on the text baseline it replaces. Text sits inside a line
 * box taller than the bar, so a bare bar in a row of numbers rides high; this
 * pads the difference out so columns of figures stay aligned as they resolve.
 */
export function ValueSkeletonLine({
  lineHeight,
  style,
  ...props
}: ValueSkeletonProps & {
  /** The `lineHeight` of the text being replaced. */
  lineHeight: number;
}) {
  const height = props.height ?? Math.round(lineHeight * 0.62);
  return (
    <View style={[styles.line, { height: lineHeight }, style]}>
      <ValueSkeleton {...props} height={height} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    overflow: "hidden",
  },
  line: {
    justifyContent: "center",
  },
});
