import Ionicons from "@expo/vector-icons/Ionicons";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { HEART_BURST_DOTS, LIKE_PINK } from "@/lib/sandwich-feed";

/**
 * The like heart, extracted from `screens/sandwich-screen.tsx` so a card can be
 * rendered without importing that screen. See `components/sandwich-card.tsx`.
 */
const styles = StyleSheet.create({
  heartLayer: { alignItems: "center", justifyContent: "center" },
});

export type HeartToggleRef = { toggle: (nextLiked: boolean) => void };

function HeartBurstDot({
  angle,
  color,
  distance,
  progress,
  size,
}: {
  angle: number;
  color: string;
  distance: number;
  progress: SharedValue<number>;
  size: number;
}) {
  const dotSize = Math.max(3, Math.round(size * 0.14));
  const style = useAnimatedStyle(() => {
    const travel = interpolate(progress.value, [0, 1], [0, size * distance]);
    return {
      opacity: interpolate(progress.value, [0, 0.12, 0.68, 1], [0, 1, 0.72, 0]),
      transform: [
        { translateX: Math.cos(angle) * travel },
        { translateY: Math.sin(angle) * travel },
        { scale: interpolate(progress.value, [0, 0.16, 0.72, 1], [0.25, 1, 0.7, 0.15]) },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: (size - dotSize) / 2,
          top: (size - dotSize) / 2,
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

/**
 * The heart, animated entirely on the UI thread.
 *
 * Liking used to be driven by a `useEffect` watching the `liked` prop, so the
 * burst could not start until React had re-rendered whatever owns the
 * sandwich — the whole feed, or the whole detail screen with its chart. That
 * commit is what read as lag: the tap was instant, the heart was not.
 *
 * Now the press calls `toggle()` on this ref, which writes shared values
 * directly. The fill and the burst play on the very next frame no matter how
 * long React takes, and the `liked` prop only has to agree afterwards (it
 * still drives the icon if the server rejects the like and the state rolls
 * back).
 */
export const HeartToggle = forwardRef<
  HeartToggleRef,
  { liked: boolean; size: number; idleColor: string }
>(function HeartToggle({ liked, size, idleColor }, ref) {

  const fill = useSharedValue(liked ? 1 : 0);
  const scale = useSharedValue(1);
  const burst = useSharedValue(0);

  // What the heart is currently *showing*. The tap paints ahead of React, so
  // this is what tells the prop effect below there is nothing left to do.
  const shown = useRef(liked);

  const play = useCallback(
    (nextLiked: boolean) => {
      shown.current = nextLiked;
      fill.value = withTiming(nextLiked ? 1 : 0, {
        duration: 120,
        reduceMotion: ReduceMotion.System,
      });
      // Asymmetric on purpose: liking gets the burst, unliking stays quiet.
      //
      // The grow leg is a timing, not a spring. A spring in a withSequence has
      // to *settle* before the next animation starts, and an underdamped one
      // (damping 7) rings around its target for a few hundred ms first — which
      // is exactly the "jumps up, wobbles, hangs big, then drops back" the
      // heart was doing. A timing ends when it says it ends; the spring back
      // to rest then carries the only bounce anyone should see.
      if (nextLiked) {
        // One shared clock keeps the ring and every particle perfectly aligned
        // with the heart pop, even if React is busy rendering the feed.
        burst.value = 0;
        burst.value = withTiming(1, {
          duration: 420,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.System,
        });
        scale.value = withSequence(
          withTiming(1.25, {
            duration: 110,
            easing: Easing.out(Easing.quad),
            reduceMotion: ReduceMotion.System,
          }),
          withSpring(1, {
            damping: 14,
            stiffness: 340,
            mass: 0.5,
            reduceMotion: ReduceMotion.System,
          }),
        );
      } else {
        burst.value = 1;
      }
    },
    [burst, fill, scale],
  );

  useImperativeHandle(ref, () => ({ toggle: play }), [play]);

  // Follows the prop for changes this button did not cause: a failed like
  // rolling back, or the same sandwich being liked from another screen. Skips
  // when the tap already painted it, so the fade never restarts mid-flight.
  useEffect(() => {
    if (shown.current === liked) return;
    shown.current = liked;
    fill.value = withTiming(liked ? 1 : 0, {
      duration: 120,
      reduceMotion: ReduceMotion.System,
    });
  }, [liked, fill]);

  const heartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burst.value, [0, 0.08, 0.62, 1], [0, 0.9, 0.3, 0]),
    transform: [
      { scale: interpolate(burst.value, [0, 1], [0.55, 1.75]) },
    ],
  }));
  const outlineStyle = useAnimatedStyle(() => ({ opacity: 1 - fill.value }));
  const filledStyle = useAnimatedStyle(() => ({ opacity: fill.value }));

  return (
    <View
      pointerEvents="none"
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
      }}
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: Math.max(1.5, size * 0.075),
            borderColor: LIKE_PINK,
          },
          ringStyle,
        ]}
      />
      {HEART_BURST_DOTS.map((dot, index) => (
        <HeartBurstDot
          key={index}
          {...dot}
          progress={burst}
          size={size}
        />
      ))}
      <Animated.View style={[StyleSheet.absoluteFill, styles.heartLayer, heartStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.heartLayer, outlineStyle]}>
          <Ionicons name="heart-outline" size={size} color={idleColor} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, styles.heartLayer, filledStyle]}>
          <Ionicons name="heart" size={size} color={LIKE_PINK} />
        </Animated.View>
      </Animated.View>
    </View>
  );
});

