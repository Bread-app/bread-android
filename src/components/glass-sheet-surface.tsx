import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { HAS_LIQUID_GLASS } from '@/lib/liquid-glass';
import { useThemeStore } from '@/lib/theme-store';

/** iOS 26+ only — everywhere else this file falls back to a blur. */
export const HAS_GLASS_SURFACE = HAS_LIQUID_GLASS;

type GlassSheetSurfaceProps = {
  /** Matches the host sheet's top corner radius so the material clips cleanly. */
  topRadius?: number;
  /**
   * Painted UNDERNEATH the glass. Two jobs: it keeps dark-on-light sheet content
   * legible over whatever is refracting through, and it guarantees the surface is
   * never blank — GlassView is a native layer that paints nothing when the system
   * decides its material is invisible against the host background (the same bug
   * documented on the confirm button in trade-amount-sheet.tsx).
   * Pass a colour WITH alpha (e.g. `${bg}59`); fully opaque defeats the effect.
   */
  scrimColor: string;
  /** `regular` is the frosted material; `clear` refracts more and dims less. */
  glassEffectStyle?: 'regular' | 'clear';
  /**
   * Pins the material's appearance instead of following the app theme. Surfaces
   * whose CONTENT is hardcoded to one palette must pin to match it — dark text on
   * a dark material is unreadable no matter how good the glass looks.
   */
  forceScheme?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
};

/**
 * The Liquid Glass panel behind a sheet's content — a drop-in replacement for a
 * solid `backgroundColor` on a sheet surface. Renders nothing interactive: it is
 * `pointerEvents="none"` throughout so taps fall through to the content above it.
 *
 * The scheme is passed explicitly rather than left on `auto` because the in-app
 * Light/Dark toggle is independent of the OS appearance.
 */
export function GlassSheetSurface({
  topRadius = 0,
  scrimColor,
  glassEffectStyle = 'regular',
  forceScheme,
  style,
}: GlassSheetSurfaceProps) {
  const { scheme } = useThemeStore();
  const tint = forceScheme ?? (scheme === 'dark' ? 'dark' : 'light');
  const radius = {
    borderTopLeftRadius: topRadius,
    borderTopRightRadius: topRadius,
  };

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, radius, styles.clip, style]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }]} />
      {HAS_GLASS_SURFACE ? (
        <GlassView
          glassEffectStyle={glassEffectStyle}
          colorScheme={tint}
          style={[StyleSheet.absoluteFill, radius]}
        />
      ) : (
        <BlurView
          intensity={40}
          tint={tint}
          // Android needs an explicit blur method to render a real blur.
          experimentalBlurMethod="dimezisBlurView"
          style={[StyleSheet.absoluteFill, radius]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
