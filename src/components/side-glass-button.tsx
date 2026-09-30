import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { shadeStops, withAlpha } from '@/lib/color-utils';
import { CTA } from '@/lib/screen-corners';
import { useThemeStore } from '@/lib/theme-store';

// A leaf module on purpose: the perp detail sheet, its position sheet and the
// Auto Close pad all draw this pill, and they import each other — Metro's
// inline requires turn any cycle through here into a runtime crash.
const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

/**
 * Shared by every big CTA pill (BUY / SELL, LONG / SHORT, EDIT SL/TP, CLOSE,
 * CANCEL / SAVE) so they read as one family. Bold, not Black: the 900 weight
 * shouted louder than the numbers the buttons act on; ExtraBold keeps the
 * label solid on a see-through pill.
 */
export const CTA_LABEL_FONT = 'Rubik_800ExtraBold';

/**
 * Pill height and label size for the same family. A step down from the full
 * `CTA.height` edge geometry: the bar keeps its concentric inset, the pills in
 * it just stop dominating the screen.
 */
export const CTA_BUTTON_HEIGHT = CTA.height - 6;
export const CTA_LABEL_SIZE = 19;

/**
 * Glass tint for a CTA pill. The colour lives in the native material's tint,
 * not in a paint layer over it, so the glass keeps its refraction.
 *
 * Press feedback on a glass CTA is the NATIVE one (`isInteractive`: the
 * material brightens and swells under the finger), never PressableScale's
 * scale-down. A GlassView under a scale transform renders dark — a
 * press-and-hold left the pill dim until the release spring settled. So glass
 * pills pass `scaleTo={CTA_GLASS_SCALE}` (1); only the solid fallback scales.
 */
export const CTA_GLASS_SCALE = 1;
export const CTA_SOLID_SCALE = 0.97;
export function ctaGlassTint(color: string, isDark: boolean): string {
  return withAlpha(color, isDark ? 0.62 : 0.82);
}

/**
 * The top-lit shade over a CTA pill. A touch see-through in both modes: on
 * glass it lets the material read, on the solid fallback the page behind.
 */
export function ctaFillStops(
  color: string,
  { isDark, glass }: { isDark: boolean; glass: boolean },
): [string, string] {
  // Over glass this is only a wash, so the material underneath still shows.
  const alpha = glass ? (isDark ? 0.38 : 0.46) : 0.86;
  // A light top-lit shade: enough to give the pill a face, not a bevel.
  return shadeStops(color, 0.14).map((c) => withAlpha(c, alpha)) as [string, string];
}

/**
 * The inside of every CTA pill: the colour, then a soft light rising from the
 * bottom edge — the glow a native Liquid Glass button carries low on its body.
 *
 * On glass (`glass`, the default) the colour is only a thin wash so the
 * material shows through; off glass it is the pill's whole (slightly
 * see-through) fill. Either way it is pointer-transparent and absolutely
 * filled, so it drops into a GlassView or a plain View alike.
 */
export function CtaGlassFill({
  color,
  isDark,
  glass = true,
}: {
  color: string;
  isDark: boolean;
  glass?: boolean;
}) {
  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={ctaFillStops(color, { isDark, glass })}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0)', `rgba(255,255,255,${isDark ? 0.16 : 0.28})`]}
        start={{ x: 0, y: 0.45 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </>
  );
}

/**
 * One side of the pinned action bar, as an iOS 26 Liquid Glass pill.
 *
 * The `Pressable` shell owns sizing + rounding with `overflow: 'hidden'`; the
 * `GlassView` inside only paints the fill and needs an explicit height because
 * native glass views do not auto-size to their children.
 */
export function SideGlassButton({
  label,
  color,
  onPress,
  disabled,
  loading = false,
  accessibilityLabel,
  glass = HAS_GLASS,
}: {
  label: string;
  /** Swaps the label for a spinner while the action is in flight. */
  loading?: boolean;
  accessibilityLabel?: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  /**
   * Whether this pill may lean on native glass for its fill. False inside a
   * host that cannot paint one — the label is white, so a pill with no fill is
   * an invisible button, not a subtler one.
   */
  glass?: boolean;
}) {
  const { scheme } = useThemeStore();
  const isDark = scheme === 'dark';

  // Match StockTradeActions exactly: the semantic color changes, while the
  // glass weight, edge, and material treatment stay the same.
  const glassStyle = {
    backgroundColor: withAlpha(color, isDark ? 0.3 : 0.04),
    borderColor: withAlpha(color, isDark ? 0.65 : 0.15),
    borderWidth: 1,
  };

  return (
    <PressableScale
      scaleTo={glass && !disabled ? CTA_GLASS_SCALE : CTA_SOLID_SCALE}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={[styles.sideShell, disabled && styles.disabled]}
    >
      {/* A disabled pill takes the solid fill even where glass is available:
          low-opacity glass has no body left, so the ACTIVATE state would read
          as an empty white capsule. Measured on
          iOS 26 — see the LONG / SHORT comment above. */}
      {glass && !disabled ? (
        <GlassView
          glassEffectStyle="clear"
          isInteractive
          tintColor={ctaGlassTint(color, isDark)}
          colorScheme={isDark ? 'dark' : 'light'}
          style={[styles.sideFill, glassStyle]}
        >
          {/* Colour wash + top sheen, over the native material. */}
          <CtaGlassFill color={color} isDark={isDark} />
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text
              style={[styles.sideLabel, { textShadowColor: withAlpha(color, 0.4) }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {label}
            </Text>
          )}
        </GlassView>
      ) : (
        <View style={[styles.sideFill, { overflow: 'hidden' }]}>
          <CtaGlassFill color={color} isDark={isDark} glass={false} />
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.sideLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {label}
            </Text>
          )}
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  sideShell: { flex: 1, borderRadius: CTA.radius, overflow: 'hidden' },
  sideFill: {
    // GlassView is native and will not size itself to its text child.
    // Shared with every CTA pill; see CTA_BUTTON_HEIGHT.
    height: CTA_BUTTON_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: CTA.radius,
    paddingHorizontal: 12,
  },
  sideLabel: {
    fontFamily: CTA_LABEL_FONT,
    color: '#FFFFFF',
    fontSize: CTA_LABEL_SIZE,
    letterSpacing: 1,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  disabled: { opacity: 0.45 },
});
