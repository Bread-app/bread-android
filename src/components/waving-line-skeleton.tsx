import React, { useMemo, useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useThemeStore } from "@/lib/theme-store";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

/**
 * Loading placeholder for the price charts: an animated sine wave that scrolls
 * horizontally and gently pulses, instead of a spinner. The wave is drawn twice
 * as wide as the container and translated by exactly one container width, so the
 * loop is seamless (the container width is a whole number of wavelengths).
 */
type WavingLineSkeletonProps = {
  height: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

function buildWavePath(width: number, height: number): string {
  const midY = height / 2;
  // Keep it minimal: a shallow wave hugging the vertical center.
  const amplitude = Math.min(height * 0.05, 8);
  // Two wavelengths across the visible width → translating by `width` loops cleanly.
  const wavelength = width / 2;
  const totalWidth = width * 2;
  const step = 4;

  let d = "";
  for (let x = 0; x <= totalWidth; x += step) {
    const y = midY + amplitude * Math.sin((2 * Math.PI * x) / wavelength);
    d += x === 0 ? `M ${x} ${y.toFixed(2)}` : ` L ${x} ${y.toFixed(2)}`;
  }
  return d;
}

export function WavingLineSkeleton({
  height,
  color,
  style,
}: WavingLineSkeletonProps) {
  const { colors } = useThemeStore();
  const strokeColor = color ?? colors.iconMuted;
  const [width, setWidth] = useState(0);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(0.4);

  React.useEffect(() => {
    translateX.value = 0;
    translateX.value = withRepeat(
      withTiming(-1, { duration: 3600, easing: Easing.linear }),
      -1,
      false,
    );
    opacity.value = withDelay(
      0,
      withRepeat(
        withSequence(
          withTiming(0.75, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.4, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [opacity, translateX]);

  const path = useMemo(
    () => (width > 0 ? buildWavePath(width, height) : ""),
    [width, height],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    // translateX.value runs 0 → -1; scale by width so the wave scrolls exactly
    // one container width before looping.
    transform: [{ translateX: translateX.value * width }],
  }));

  return (
    <View
      style={[styles.wrap, { height }, style]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Animated.View style={[styles.waveLayer, animatedStyle]}>
          <Svg width={width * 2} height={height}>
            <Path
              d={path}
              fill="none"
              stroke={strokeColor}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    overflow: "hidden",
    justifyContent: "center",
  },
  waveLayer: {
    ...StyleSheet.absoluteFillObject,
  },
});
