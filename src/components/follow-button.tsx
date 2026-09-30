import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Fonts } from "@/constants/theme";
import { PressableScale } from "@/components/pressable-scale";
import { useThemeStore } from "@/lib/theme-store";

// SF Pro Rounded (`ui-rounded`) — weight comes from `fontWeight` on the system
// face, unlike the named Rubik files.
const F_LABEL = Fonts.rounded;

// Brand follow/following palette (matches the sandwich detail header button).
// Following uses the existing lavender treatment by default. List surfaces can
// opt into the pale sky treatment requested for the people screen. The followed
// state is the quieter of the two — same rounded label, a touch faded, so
// the pill reads as settled rather than as a live call to action.
const FOLLOWING_BG = "#F4F1FF";
const FOLLOWING_TEXT = "rgba(11, 18, 32, 0.6)";
const FOLLOWING_SKY_BG = "#F1FAFF";
const FOLLOWING_SKY_TEXT = "rgba(11, 18, 32, 0.6)";

// Follow ⇄ Following cross-fades rather than snapping: the fill tints across
// and the two labels dissolve into each other (the faces differ, so the text
// can't be interpolated — it has to be two layers). Long enough to read as a
// state settling, short enough that it never lags the tap. Instant under the
// system Reduce Motion setting.
const TOGGLE_TIMING = {
  duration: 280,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
};

export type FollowButtonSize = "sm" | "lg";

const SIZES: Record<
  FollowButtonSize,
  {
    borderRadius: number;
    paddingHorizontal: number;
    paddingVertical: number;
    fontSize: number;
    minWidth?: number;
  }
> = {
  // Compact pill for list rows (followers list, search results).
  sm: { borderRadius: 999, paddingHorizontal: 20, paddingVertical: 8, fontSize: 14, minWidth: 116 },
  // Prominent button for profile / sandwich detail headers. minWidth is sized
  // to the longer "Following" label so the button doesn't jump on toggle.
  lg: { borderRadius: 14, paddingHorizontal: 34, paddingVertical: 10, fontSize: 18, minWidth: 176 },
};

type Props = {
  following: boolean;
  onPress: (event: GestureResponderEvent) => void;
  /**
   * Blocks taps without restyling. Callers pass their in-flight flag here, and
   * the button has already flipped optimistically — dimming it mid-toggle
   * would read as a third state flashing between the two real ones. Pass
   * `dimmed` for a genuinely unavailable button.
   */
  disabled?: boolean;
  /** Fade the button out — for "can't follow" (no viewer), not for loading. */
  dimmed?: boolean;
  size?: FollowButtonSize;
  followingTone?: "default" | "sky";
  shape?: "pill" | "rounded";
  style?: StyleProp<ViewStyle>;
};

/**
 * The shared Follow / Following button used across the app. Follow shows a blue
 * brand gradient; Following shows a light-purple pill. Pick `size="sm"` for list
 * rows and `size="lg"` for header-level placements.
 *
 * The label flips locally on tap so the button feels instant even when the
 * parent is still awaiting the network round-trip. The parent's `following`
 * prop is honored whenever it changes (server truth wins on rehydrate or when
 * the request rejects and the parent reverts its optimistic state).
 */
export function FollowButton({
  following,
  onPress,
  disabled,
  dimmed,
  size = "lg",
  followingTone = "default",
  shape = "pill",
  style,
}: Props) {
  const { colors } = useThemeStore();
  const sz = SIZES[size];
  const borderRadius = shape === "rounded" ? 12 : sz.borderRadius;
  const followingBackground =
    followingTone === "sky" ? FOLLOWING_SKY_BG : FOLLOWING_BG;
  const followingText =
    followingTone === "sky" ? FOLLOWING_SKY_TEXT : FOLLOWING_TEXT;

  // Local mirror of `following` that flips synchronously on tap. We reconcile
  // to the incoming prop whenever the parent's value changes so a failed
  // network call (parent reverts) or a stale optimistic guess is corrected.
  const [localFollowing, setLocalFollowing] = useState(following);
  const lastPropRef = useRef(following);
  useEffect(() => {
    if (following !== lastPropRef.current) {
      lastPropRef.current = following;
      setLocalFollowing(following);
    }
  }, [following]);

  // 0 = Follow, 1 = Following. Driven from the local state so it animates on
  // tap and again if the parent later reverts.
  const progress = useSharedValue(localFollowing ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(localFollowing ? 1 : 0, TOGGLE_TIMING);
  }, [localFollowing, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.actionPrimary, followingBackground],
    ),
  }));
  const followOpacity = useDerivedValue(() => 1 - progress.value);
  const followLabelStyle = useAnimatedStyle(() => ({ opacity: followOpacity.value }));
  const followingLabelStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      setLocalFollowing((current) => !current);
      onPress(event);
    },
    [onPress],
  );

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected: localFollowing, disabled: !!disabled }}
      accessibilityLabel={localFollowing ? "Unfollow" : "Follow"}
      onPress={handlePress}
      disabled={disabled}
      scaleTo={0.95}
      style={[
        styles.base,
        {
          borderRadius,
          paddingHorizontal: sz.paddingHorizontal,
          paddingVertical: sz.paddingVertical,
          minWidth: sz.minWidth,
        },
        dimmed && styles.dimmed,
        style,
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius }, fillStyle]} />
      {/* "Following" sets the layout (it is the wider label, and what minWidth
          is sized to); "Follow" floats centered over it. */}
      <View style={styles.labels}>
        <Animated.Text
          style={[
            styles.text,
            { fontSize: sz.fontSize, color: followingText },
            followingLabelStyle,
          ]}
        >
          Following
        </Animated.Text>
        <Animated.Text
          style={[
            styles.text,
            styles.overlayLabel,
            { fontSize: sz.fontSize, color: colors.actionPrimaryText },
            followLabelStyle,
          ]}
        >
          Follow
        </Animated.Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    // A soft drop so the pale Following fill still reads as a raised control
    // on a white page. `overflow: hidden` is off — it would clip the shadow;
    // the fill layer carries its own radius.
    shadowColor: "#0B1220",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  dimmed: { opacity: 0.4 },
  labels: {
    alignItems: "center",
    justifyContent: "center",
  },
  overlayLabel: {
    ...StyleSheet.absoluteFillObject,
    textAlign: "center",
    textAlignVertical: "center",
  },
  text: {
    fontWeight: "900",
    fontFamily: F_LABEL,
  },
});
