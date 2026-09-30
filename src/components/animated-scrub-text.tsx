import React from 'react';
import { Platform, StyleSheet, TextInput, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

type AnimatedScrubTextProps = {
  /** Label content, written from the UI thread. */
  text: SharedValue<string>;
  /** Optional colour, also written from the UI thread. */
  color?: SharedValue<string>;
  style?: StyleProp<TextStyle>;
};

/**
 * A read-only label whose content is driven entirely from the UI thread.
 *
 * Chart scrub readouts used to be React state, so every sample the finger
 * crossed queued a render — and in Fabric that commit lands on the main thread,
 * stalling the very gesture it was reporting on. Reanimated can only write
 * `text` onto a TextInput, so this is a TextInput styled to read as a Text.
 */
export function AnimatedScrubText({ text, color, style }: AnimatedScrubTextProps) {
  const animatedProps = useAnimatedProps(
    () => ({ text: text.value, defaultValue: text.value }) as { text: string; defaultValue: string },
  );

  const colorStyle = useAnimatedStyle(() => (color ? { color: color.value } : {}));

  return (
    <AnimatedTextInput
      editable={false}
      pointerEvents="none"
      scrollEnabled={false}
      numberOfLines={1}
      caretHidden
      contextMenuHidden
      selectTextOnFocus={false}
      accessibilityRole="text"
      underlineColorAndroid="transparent"
      // Reanimated writes `text`; `value` stays uncontrolled so React never
      // re-renders this node.
      defaultValue={text.value}
      animatedProps={animatedProps}
      style={[styles.base, style, colorStyle]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    padding: 0,
    margin: 0,
    // A TextInput reserves descender room a Text does not; zeroing these keeps
    // the label on the same baseline as the static text around it.
    ...Platform.select({
      android: { includeFontPadding: false, textAlignVertical: 'center' },
      default: {},
    }),
  },
});
