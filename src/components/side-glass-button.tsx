import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import Animated, {
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { MorphText } from '@/components/morph-text';
import { PressableScale } from '@/components/pressable-scale';
import { shadeStops, withAlpha } from '@/lib/color-utils';
import { CTA } from '@/lib/screen-corners';
import { useThemeStore } from '@/lib/theme-store';

// A leaf module on purpose: the perp detail sheet, its position sheet and the
// Auto Close pad all draw this pill, and they import each other — Metro's
// inline requires turn any cycle through here into a runtime crash.
const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

/** The small ActivityIndicator plus the gap before the label. */
const SPINNER_GAP = 10;
const SPINNER_ROOM = 20 + SPINNER_GAP;
const SPINNER_IN = ZoomIn.springify().damping(18).stiffness(260).reduceMotion(ReduceMotion.System);
const SPINNER_OUT = ZoomOut.duration(140).reduceMotion(ReduceMotion.System);
const CONTENT_LAYOUT = LinearTransition.springify().damping(22).stiffness(280).mass(0.6).reduceMotion(ReduceMotion.System);

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
 * The app's one CTA pill — the Sandwich detail BUY is the reference: native
 * Liquid Glass tinted with the action colour, the shared height and radius,
 * and a white Rubik ExtraBold label. Every flow's primary button (Buy, Sell,
 * Continue, Send, Done, Save…) should be this component so they stay one
 * family; only the colour carries meaning.
 *
 * The `PressableScale` shell owns sizing + rounding with `overflow: 'hidden'`;
 * the `GlassView` inside only paints the fill and needs an explicit height
 * because native glass views do not auto-size to their children.
 */
export function CtaButton({
  label,
  color,
  onPress,
  onPressIn,
  disabled,
  loading = false,
  loadingLabel,
  accessibilityLabel,
  glass = HAS_GLASS,
  haptic = true,
  style,
}: {
  label: string;
  color: string;
  onPress: () => void;
  /** Fires on touch-down — for speculative pre-builds before the tap lands. */
  onPressIn?: () => void;
  disabled?: boolean;
  /** Swaps the label for a spinner (plus `loadingLabel`, if given). */
  loading?: boolean;
  loadingLabel?: string | null;
  accessibilityLabel?: string;
  /**
   * Whether this pill may lean on native glass for its fill. False inside a
   * host that cannot paint one — the label is white, so a pill with no fill is
   * an invisible button, not a subtler one.
   */
  glass?: boolean;
  haptic?: boolean;
  /** Outer layout only (flex, margins, width). Height and shape are fixed. */
  style?: StyleProp<ViewStyle>;
}) {
  const { scheme } = useThemeStore();
  const isDark = scheme === 'dark';
  const inert = disabled || loading;
  const [contentWidth, setContentWidth] = useState(0);
  // A disabled pill takes the solid fill even where glass is available:
  // low-opacity glass has no body left, so it would read as an empty white
  // capsule rather than a dimmed button.
  const useGlass = glass && !disabled;

  // Match StockTradeActions exactly: the semantic color changes, while the
  // glass weight, edge, and material treatment stay the same.
  const glassStyle = {
    backgroundColor: withAlpha(color, isDark ? 0.3 : 0.04),
    borderColor: withAlpha(color, isDark ? 0.65 : 0.15),
    borderWidth: 1,
  };

  // The label morphs rather than swaps (CONFIRM BUY → BUYING…: the shared
  // "BUY" glides over while the rest shrinks out), and the spinner grows in
  // beside it — the button visibly turns into its own pending state.
  const shownLabel = (loading ? (loadingLabel ?? '') : label).toUpperCase();
  const spinnerRoom = loading ? SPINNER_ROOM : 0;
  const content = (
    <LayoutAnimationConfig skipEntering skipExiting>
      <View
        style={styles.contentRow}
        onLayout={(event) => {
          const width = event.nativeEvent.layout.width;
          setContentWidth((current) => (Math.abs(current - width) < 0.5 ? current : width));
        }}
      >
        {loading ? (
          <Animated.View entering={SPINNER_IN} exiting={SPINNER_OUT} layout={CONTENT_LAYOUT}>
            <ActivityIndicator size="small" color="#FFFFFF" />
          </Animated.View>
        ) : null}
        <Animated.View
          layout={CONTENT_LAYOUT}
          style={loading && shownLabel ? styles.labelAfterSpinner : null}
        >
          <MorphText
            text={shownLabel}
            accessible={false}
            maxWidth={contentWidth > 0 ? contentWidth - spinnerRoom : undefined}
            minimumScale={0.7}
            style={[styles.sideLabel, useGlass && { textShadowColor: withAlpha(color, 0.4) }]}
          />
        </Animated.View>
      </View>
    </LayoutAnimationConfig>
  );

  return (
    <PressableScale
      scaleTo={useGlass ? CTA_GLASS_SCALE : CTA_SOLID_SCALE}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, busy: loading }}
      disabled={inert}
      onPressIn={onPressIn}
      onPress={() => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={[styles.shell, style, disabled && styles.disabled]}
    >
      {useGlass ? (
        <GlassView
          glassEffectStyle="clear"
          isInteractive
          tintColor={ctaGlassTint(color, isDark)}
          colorScheme={isDark ? 'dark' : 'light'}
          style={[styles.sideFill, glassStyle]}
        >
          {/* Colour wash + top sheen, over the native material. */}
          <CtaGlassFill color={color} isDark={isDark} />
          {content}
        </GlassView>
      ) : (
        <View style={[styles.sideFill, { overflow: 'hidden' }]}>
          <CtaGlassFill color={color} isDark={isDark} glass={false} />
          {content}
        </View>
      )}
    </PressableScale>
  );
}

/** One side of the pinned action bar: a `CtaButton` that shares the row. */
export function SideGlassButton(props: React.ComponentProps<typeof CtaButton>) {
  return <CtaButton {...props} style={[styles.side, props.style]} />;
}

const styles = StyleSheet.create({
  shell: { borderRadius: CTA.radius, overflow: 'hidden' },
  side: { flex: 1 },
  contentRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelAfterSpinner: { marginLeft: SPINNER_GAP },
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
