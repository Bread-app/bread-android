import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Fonts } from '@/constants/theme';

const F = Fonts.rounded;

// Fixed promo palette — this card is a bright, deliberately-standout surface
// (white in either theme), so its colours don't come from the theme tokens.
const CARD_BG = '#FFFFFF';
const CARD_BORDER = '#ECEDF1';
const INK = '#0B0B0F';
const PINK = '#FF2E97';
const BLUE = '#2563EB';

type Props = {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Marketing card for the Like-to-Buy feature: "Like [𝕏] posts to buy into their
 * thesis", with a "see how it works →" call to action. Tapping anywhere opens
 * the flow the caller wires up.
 */
export function LikeToBuyCard({ onPress, style }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Like X posts to buy into their thesis — see how it works"
      onPress={onPress}
      style={({ pressed }) => [styles.card, style, pressed && styles.pressed]}
    >
      <View style={styles.headline}>
        <Text style={[styles.word, styles.pink]}>Like</Text>
        <View style={styles.xLogo}>
          <Text style={styles.xGlyph}>𝕏</Text>
        </View>
        <Text style={styles.word}>posts to</Text>
        <Text style={[styles.word, styles.black]}>buy</Text>
      </View>
      <Text style={[styles.word, styles.line2]}>into their thesis</Text>

      <View style={styles.ctaRow}>
        <Text style={styles.cta}>see how it works →</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    marginHorizontal: 6,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  headline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 4,
  },
  word: {
    fontFamily: F,
    color: INK,
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  line2: { marginTop: 4 },
  pink: { color: PINK },
  black: { color: '#000000' },
  xLogo: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  xGlyph: {
    fontFamily: F,
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
    marginTop: -1,
  },
  ctaRow: {
    marginTop: 14,
    alignItems: 'flex-end',
  },
  cta: {
    fontFamily: F,
    color: BLUE,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
});
