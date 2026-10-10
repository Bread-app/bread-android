import React, { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// A leaf module on purpose (no app imports): CtaButton draws this, and the
// sheets that draw CtaButton import each other — see inline-requires notes.

const SPRING = { damping: 20, stiffness: 300, mass: 0.6, reduceMotion: ReduceMotion.System };
const LAYOUT = LinearTransition.springify().damping(22).stiffness(280).mass(0.6).reduceMotion(ReduceMotion.System);
/** How far a rolling digit travels in or out, in points. */
const ROLL = 16;

// ── letters: a character that leaves shrinks away, one that arrives grows in ──
function letterEntering() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 6 }, { scale: 0.7 }] },
    animations: {
      opacity: withTiming(1, { duration: 160, reduceMotion: ReduceMotion.System }),
      transform: [{ translateY: withSpring(0, SPRING) }, { scale: withSpring(1, SPRING) }],
    },
  };
}

function letterExiting() {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 110, reduceMotion: ReduceMotion.System }),
      transform: [
        { translateY: withTiming(-6, { duration: 140, reduceMotion: ReduceMotion.System }) },
        { scale: withTiming(0.7, { duration: 140, reduceMotion: ReduceMotion.System }) },
      ],
    },
  };
}

// ── digits: an odometer — up rolls new digits in from below, down from above ──
function rollInFromBelow() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: ROLL }] },
    animations: {
      opacity: withTiming(1, { duration: 140, reduceMotion: ReduceMotion.System }),
      transform: [{ translateY: withSpring(0, SPRING) }],
    },
  };
}

function rollInFromAbove() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -ROLL }] },
    animations: {
      opacity: withTiming(1, { duration: 140, reduceMotion: ReduceMotion.System }),
      transform: [{ translateY: withSpring(0, SPRING) }],
    },
  };
}

function rollOutUp() {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: {
      opacity: withTiming(0, { duration: 120, reduceMotion: ReduceMotion.System }),
      transform: [{ translateY: withTiming(-ROLL, { duration: 160, reduceMotion: ReduceMotion.System }) }],
    },
  };
}

function rollOutDown() {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: {
      opacity: withTiming(0, { duration: 120, reduceMotion: ReduceMotion.System }),
      transform: [{ translateY: withTiming(ROLL, { duration: 160, reduceMotion: ReduceMotion.System }) }],
    },
  };
}

/**
 * Keys decide what survives a change.
 *
 * `letters` keys each character by its occurrence (the 2nd "O" is `O:1`), so
 * letters two labels share — the "CON" in CONTINUE → CONFIRM, the "BUY" in
 * CONFIRM BUY → BUYING… — stay mounted and glide to their new spot while the
 * rest shrink out and grow in.
 *
 * `digits` keys by position counted from the RIGHT, so the units digit keeps
 * its identity when the figure gains a digit; a changed digit remounts and
 * rolls.
 */
function keyChars(chars: string[], mode: 'letters' | 'digits'): string[] {
  if (mode === 'digits') return chars.map((ch, i) => `${chars.length - i}:${ch}`);
  const seen = new Map<string, number>();
  return chars.map((ch) => {
    const n = seen.get(ch) ?? 0;
    seen.set(ch, n + 1);
    return `${ch}:${n}`;
  });
}

/**
 * Text that animates between values instead of swapping them: one view per
 * character, Family-style. Stands in for `adjustsFontSizeToFit` (which
 * per-character Text can't use) by measuring the string once at full size and
 * shrinking the font when it would overflow `maxWidth`.
 *
 * The first render never animates; Reduce Motion makes every change a cut.
 */
export function MorphText({
  text,
  style,
  mode = 'letters',
  direction = 'up',
  maxWidth,
  minimumScale = 0.7,
  align = 'center',
  accessible = true,
  accessibilityLabel,
  containerStyle,
}: {
  text: string;
  style: StyleProp<TextStyle>;
  mode?: 'letters' | 'digits';
  /** digits mode: which way changed digits roll ('up' = the value grew). */
  direction?: 'up' | 'down';
  /** Shrink the font (down to `minimumScale`) when the text is wider than this. */
  maxWidth?: number;
  minimumScale?: number;
  align?: 'left' | 'center' | 'right';
  /** False when a parent (a button) already speaks for this text. */
  accessible?: boolean;
  accessibilityLabel?: string;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const [naturalWidth, setNaturalWidth] = useState(0);
  const flat = StyleSheet.flatten(style) ?? {};
  const baseSize = flat.fontSize ?? 16;
  const scale =
    maxWidth && maxWidth > 0 && naturalWidth > maxWidth
      ? Math.max(minimumScale, maxWidth / naturalWidth)
      : 1;
  const sized = scale === 1 ? null : { fontSize: baseSize * scale };

  const chars = text.split('');
  const keys = keyChars(chars, mode);
  const entering =
    mode === 'digits' ? (direction === 'up' ? rollInFromBelow : rollInFromAbove) : letterEntering;
  const exiting = mode === 'digits' ? (direction === 'up' ? rollOutUp : rollOutDown) : letterExiting;

  return (
    <View
      style={containerStyle}
      accessible={accessible}
      accessibilityRole={accessible ? 'text' : undefined}
      accessibilityLabel={accessible ? (accessibilityLabel ?? text) : undefined}
    >
      {/* Off-screen ruler: the whole string at full size, unconstrained. */}
      <View style={styles.ruler} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text
          style={[style, styles.rulerText]}
          numberOfLines={1}
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            setNaturalWidth((current) => (Math.abs(current - width) < 0.5 ? current : width));
          }}
        >
          {text}
        </Text>
      </View>

      <LayoutAnimationConfig skipEntering skipExiting>
        <View
          style={[
            styles.row,
            { justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' },
          ]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {chars.map((ch, i) => (
            <Animated.View key={keys[i]} entering={entering} exiting={exiting} layout={LAYOUT}>
              <Text style={[style, styles.charText, sized]}>
                {ch === ' ' ? ' ' : ch}
              </Text>
            </Animated.View>
          ))}
        </View>
      </LayoutAnimationConfig>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  ruler: { position: 'absolute', top: 0, left: 0, width: 10000, opacity: 0, flexDirection: 'row' },
  rulerText: { flex: 0, minWidth: 0, alignSelf: 'flex-start' },
  // A caller's text style may carry its old layout role (flex: 1); one glyph must not.
  charText: { flex: 0, minWidth: 0 },
});

/**
 * Which way a number moved since the last render that changed it — feed it to
 * `MorphText`'s `direction` so a rising value rolls up and a falling one down.
 * Holds the last direction while the value is unchanged (or unknown).
 */
export function useRollDirection(value: number | null): 'up' | 'down' {
  const [previous, setPrevious] = useState(value);
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  if (value !== previous) {
    setPrevious(value);
    if (value !== null && previous !== null && Number.isFinite(value) && Number.isFinite(previous)) {
      setDirection(value > previous ? 'up' : 'down');
    }
  }
  return direction;
}

/** The number inside a formatted label ("$1,234.56" → 1234.56), or null. */
export function parseLabelNumber(label: string): number | null {
  const n = Number.parseFloat(label.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
