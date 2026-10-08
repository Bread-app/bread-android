import React, { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { AnimatedScrubText } from '@/components/animated-scrub-text';

type Props = {
  /** Return in percent; NaN means "no figure" and reads as `--`. */
  value: SharedValue<number>;
  color: SharedValue<string>;
  /** Style of the figure itself (font, size, tracking). */
  textStyle: StyleProp<TextStyle>;
  /** Width the readout is right-aligned within. */
  width: number;
  /** Arrow glyph size; smaller than the figure so it reads as a marker. */
  arrowSize?: number;
};

const MEASURED_CHARS = ['0', '.', '%', '-'] as const;
type CharWidths = Record<(typeof MEASURED_CHARS)[number], number>;

/**
 * A scrubbable return readout: a small ▲/▼ centred beside `7.15%`.
 *
 * The figure is written from the UI thread, which never re-runs Yoga, so its
 * box can't size itself to the text. Instead each glyph the readout can hold is
 * measured once (tabular figures make every digit the same width) and the box
 * width is computed per frame from the string — which keeps the arrow hugging
 * the number at any length, at its own size, vertically centred.
 */
export function ScrubReturnText({ value, color, textStyle, width, arrowSize = 14 }: Props) {
  const [widths, setWidths] = useState<Partial<CharWidths>>({});
  const measured = MEASURED_CHARS.every((ch) => widths[ch] != null);

  const text = useDerivedValue(() => {
    const v = value.value;
    return Number.isNaN(v) ? '--' : `${Math.abs(v).toFixed(2)}%`;
  });

  const digit = widths['0'] ?? 0;
  const dot = widths['.'] ?? 0;
  const pct = widths['%'] ?? 0;
  const dash = widths['-'] ?? 0;

  const boxStyle = useAnimatedStyle(() => {
    if (!measured) return { width };
    let w = 0;
    const s = text.value;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      w += ch === '.' ? dot : ch === '%' ? pct : ch === '-' ? dash : digit;
    }
    // A hair of slack so rounding never clips the last glyph.
    return { width: Math.ceil(w) + 2 };
  });

  const arrowStyle = useAnimatedStyle(() => {
    const v = value.value;
    const show = !Number.isNaN(v) && v !== 0;
    return {
      opacity: show ? 1 : 0,
      color: color.value,
      transform: [{ rotate: v > 0 ? '180deg' : '0deg' }],
    };
  });

  return (
    <View style={[styles.row, { width }]}>
      <Animated.Text style={[styles.arrow, { fontSize: arrowSize, lineHeight: arrowSize + 2 }, arrowStyle]}>
        ▼
      </Animated.Text>
      <Animated.View style={boxStyle}>
        <AnimatedScrubText text={text} color={color} style={[textStyle, styles.figure]} />
      </Animated.View>
      {/* Off-screen glyph rulers, in the figure's exact style. */}
      <View style={styles.rulers} pointerEvents="none">
        {MEASURED_CHARS.map((ch) => (
          <Text
            key={ch}
            style={textStyle}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              setWidths((prev) => (prev[ch] === w ? prev : { ...prev, [ch]: w }));
            }}
          >
            {ch}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  arrow: {
    includeFontPadding: false,
  },
  figure: {
    width: '100%',
    textAlign: 'right',
  },
  rulers: {
    position: 'absolute',
    opacity: 0,
    left: -10000,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
});
