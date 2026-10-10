import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// ── Animated amount ─────────────────────────────────────────────────────────
// Snappy, no visible overshoot — a digit should land, not wobble.
const DIGIT_SPRING = { damping: 18, stiffness: 320, mass: 0.6, reduceMotion: ReduceMotion.System };
const DIGIT_LAYOUT = LinearTransition.springify().damping(20).stiffness(300).mass(0.6).reduceMotion(ReduceMotion.System);
// Past this many characters the figure shrinks to keep fitting on one line
// (stands in for `adjustsFontSizeToFit`, which per-digit Text can't use).
const DIGITS_BEFORE_SHRINK = 7;

function digitEntering() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 22 }, { scale: 0.6 }] },
    animations: {
      opacity: withTiming(1, { duration: 120, reduceMotion: ReduceMotion.System }),
      transform: [
        { translateY: withSpring(0, DIGIT_SPRING) },
        { scale: withSpring(1, DIGIT_SPRING) },
      ],
    },
  };
}

function digitExiting() {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 110, reduceMotion: ReduceMotion.System }),
      transform: [
        { translateY: withTiming(14, { duration: 140, reduceMotion: ReduceMotion.System }) },
        { scale: withTiming(0.6, { duration: 140, reduceMotion: ReduceMotion.System }) },
      ],
    },
  };
}

/**
 * The amount as one view per character. Keys are position + character, so an
 * appended digit (or a replaced one) mounts and springs up, a deleted one drops
 * away, and the rest glide to their new spots as the centred row resizes.
 * `skipEntering` keeps the initial "0" from animating when the pad opens.
 */
export function AnimatedAmountDigits({ value, style, shrinkToFit = true }: {
  value: string;
  style: StyleProp<TextStyle>;
  /** Disable when the parent already scales the amount and its currency together. */
  shrinkToFit?: boolean;
}) {
  const chars = value.split('');
  const base = StyleSheet.flatten(style)?.fontSize ?? 52;
  const fontSize =
    shrinkToFit && chars.length > DIGITS_BEFORE_SHRINK
      ? (base * DIGITS_BEFORE_SHRINK) / chars.length
      : base;
  return (
    <LayoutAnimationConfig skipEntering>
      <View style={animatedDigitStyles.row}>
        {chars.map((ch, i) => (
          <Animated.View
            key={`${i}-${ch}`}
            entering={digitEntering}
            exiting={digitExiting}
            layout={DIGIT_LAYOUT}
          >
            <Text style={[style, { fontSize }]}>{ch}</Text>
          </Animated.View>
        ))}
      </View>
    </LayoutAnimationConfig>
  );
}

const animatedDigitStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline' },
});
