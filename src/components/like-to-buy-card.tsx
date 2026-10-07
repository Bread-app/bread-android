import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Fonts } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';

const F = Fonts.rounded;

// Promo palette — a bright, standout card in light mode; in dark mode it sits on
// the app's dark surface instead of glaring white, with the X tile as a white outline.
const LIGHT = { bg: '#FFFFFF', border: '#ECEDF1', ink: '#0B0B0F', strong: '#000000', xTile: '#000000', xStroke: 'transparent', xGlyph: '#FFFFFF', cta: '#2563EB' };
const DARK = { bg: '#1a1b1f', border: '#2a2c31', ink: '#FFFFFF', strong: '#FFFFFF', xTile: 'transparent', xStroke: '#FFFFFF', xGlyph: '#FFFFFF', cta: '#38BDF8' };
const PINK = '#FF2E97';

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
  const { scheme } = useThemeStore();
  const p = scheme === 'dark' ? DARK : LIGHT;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Like X posts to buy into their thesis — see how it works"
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: p.bg, borderColor: p.border }, style, pressed && styles.pressed]}
    >
      <View style={styles.headline}>
        <Text style={[styles.word, styles.pink]}>Like</Text>
        <View style={[styles.xLogo, { backgroundColor: p.xTile, borderColor: p.xStroke }]}>
          <Text style={[styles.xGlyph, { color: p.xGlyph }]}>𝕏</Text>
        </View>
        <Text style={[styles.word, { color: p.ink }]}>posts to</Text>
        <Text style={[styles.word, { color: p.strong }]}>buy</Text>
      </View>
      <Text style={[styles.word, styles.line2, { color: p.ink }]}>into their thesis</Text>

      <View style={styles.ctaRow}>
        <Text style={[styles.cta, { color: p.cta }]}>see how it works →</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderWidth: 1,
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
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  line2: { marginTop: 4 },
  pink: { color: PINK },
  xLogo: {
    width: 32,
    height: 32,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  xGlyph: {
    fontFamily: F,
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
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
});
