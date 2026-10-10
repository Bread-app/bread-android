import * as Haptics from 'expo-haptics';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import {
  CTA_BUTTON_HEIGHT,
  CTA_LABEL_FONT,
  CTA_LABEL_SIZE,
  CtaGlassFill,
  ctaGlassTint,
  CTA_GLASS_SCALE,
  CTA_SOLID_SCALE,
} from '@/components/side-glass-button';
import type { ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { withAlpha } from '@/lib/color-utils';
import { CTA } from '@/lib/screen-corners';
import { useThemeStore } from '@/lib/theme-store';

const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

export function HeldPositionActions({
  onBuyMore,
  onClose,
  buyLabel = 'BUY MORE',
  closeLabel = 'CLOSE',
  fullSizeLabels = false,
}: {
  onBuyMore?: () => void;
  onClose: () => void;
  buyLabel?: string;
  closeLabel?: string;
  /**
   * Keep the full CTA label size even when paired, as the Sandwich screen's
   * pinned BUY MORE / SELL do. Only for a row that spans the screen's width.
   */
  fullSizeLabels?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors, scheme } = useThemeStore();
  const isDark = scheme === 'dark';
  // Two buttons share the row, so each label only gets half the width. At the
  // lone button's 24pt "BUY MORE" wraps onto a second line and spills past the
  // pill — the paired size is the 19pt a sandwich's own held row uses.
  const paired = Boolean(onBuyMore) && !fullSizeLabels;

  return (
    <View style={styles.row}>
      {onBuyMore ? (
        <Action
          label={buyLabel}
          accessibilityLabel={buyLabel.toLowerCase()}
          tint={colors.actionBuy}
          onPress={onBuyMore}
          isDark={isDark}
          paired={paired}
          styles={styles}
        />
      ) : null}
      <Action
        label={closeLabel}
        accessibilityLabel="Close this position"
        tint={colors.actionSell}
        onPress={onClose}
        isDark={isDark}
        paired={paired}
        styles={styles}
      />
    </View>
  );
}

function Action({
  label,
  accessibilityLabel,
  tint,
  onPress,
  isDark,
  paired,
  styles,
}: {
  label: string;
  accessibilityLabel: string;
  tint: string;
  onPress: () => void;
  isDark: boolean;
  paired: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  // Same recipe as the stock trade bar's BUY / SELL: a near-clear fill so
  // the glass does the work, and the colour comes from the tint alone.
  const glassStyle = {
    backgroundColor: withAlpha(tint, isDark ? 0.3 : 0.04),
    borderColor: withAlpha(tint, isDark ? 0.65 : 0.15),
    borderWidth: 1,
  };
  // The paired step-down exists so "BUY MORE" / "SHORT MORE" fit half a row.
  // A one-word label ("BUY", "SELL") has the room, so it keeps the full size.
  const compact = paired && label.trim().length > 5;
  const textStyle = [
    styles.text,
    compact ? styles.textPaired : null,
    {
      textShadowColor: withAlpha(tint, 0.4),
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 6,
    },
  ];

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      scaleTo={HAS_GLASS ? CTA_GLASS_SCALE : CTA_SOLID_SCALE}
      style={styles.wrap}
    >
      {HAS_GLASS ? (
        <GlassView
          glassEffectStyle="clear"
          isInteractive
          tintColor={ctaGlassTint(tint, isDark)}
          colorScheme={isDark ? 'dark' : 'light'}
          style={[styles.button, glassStyle]}
        >
                    <CtaGlassFill color={tint} isDark={isDark} />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={textStyle}
          >
            {label.toUpperCase()}
          </Text>
        </GlassView>
      ) : (
        <View style={[styles.button, { overflow: 'hidden' }]}>
          <CtaGlassFill color={tint} isDark={isDark} glass={false} />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={[styles.text, compact ? styles.textPaired : null]}
          >
            {label.toUpperCase()}
          </Text>
        </View>
      )}
    </PressableScale>
  );
}

const makeStyles = (_c: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wrap: { flex: 1, borderRadius: CTA.radius, overflow: 'hidden' },
  button: {
    minHeight: CTA_BUTTON_HEIGHT,
    borderRadius: CTA.radius,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  text: {
    fontFamily: CTA_LABEL_FONT,
    fontSize: CTA_LABEL_SIZE,
    lineHeight: CTA_LABEL_SIZE + 4,
    letterSpacing: 1,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  // What "BUY MORE" / "SHORT MORE" fit at on half a row — the same 19pt a
  // sandwich detail screen's held pair uses.
  textPaired: { fontSize: 16, lineHeight: 20, letterSpacing: 0.5 },
});
