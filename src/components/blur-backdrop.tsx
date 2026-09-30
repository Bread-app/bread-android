import { BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { BlurView } from 'expo-blur';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useThemeStore } from '@/lib/theme-store';

type BlurBackdropProps = React.ComponentProps<typeof BottomSheetBackdrop> & {
  /** Blur strength of the backdrop. Defaults to a clear, soft 20. */
  intensity?: number;
  /**
   * Overrides the theme's `overlay` dim. Sheets with a Liquid Glass surface pass
   * something much lighter here: glass refracts what is behind it, and the default
   * blur + 40–60% black leaves it nothing to bend, so the material reads as flat grey.
   */
  dimColor?: string;
};

type DrawerBackdropSurfaceProps = {
  intensity?: number;
  dimColor?: string;
};

/**
 * The visual layer shared by gorhom sheets and custom drawer implementations.
 * Blur keeps the previous screen legible as context; the theme overlay token
 * pushes it back far enough that the open drawer is always the active surface.
 */
export function DrawerBackdropSurface({ intensity = 20, dimColor }: DrawerBackdropSurfaceProps) {
  const { colors } = useThemeStore();

  return (
    <>
      <BlurView
        intensity={intensity}
        tint="dark"
        // Android needs an explicit blur method to render a real blur.
        experimentalBlurMethod="dimezisBlurView"
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: dimColor ?? colors.overlay }]}
      />
    </>
  );
}

/**
 * Shared backdrop for every @gorhom bottom-sheet drawer (add cash, withdraw,
 * trade, menus, etc.). Blurs the screen behind the sheet instead of just
 * dimming it, fading in/out with the sheet and closing it on tap.
 *
 * Use as: `backdropComponent={BlurBackdrop}` on a BottomSheetModal.
 */
export function BlurBackdrop({ intensity = 20, dimColor, style, ...props }: BlurBackdropProps) {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="close"
      // gorhom dims the WHOLE backdrop container (blur child included) to this
      // opacity, and its default container background is solid black. Setting a
      // low opacity therefore made the blur itself nearly invisible. Instead fade
      // the backdrop fully in (0→1) with the sheet and keep its background
      // transparent, so only the BlurView shows — exactly like the menu sheet.
      opacity={1}
      style={[style, styles.transparent]}>
      <DrawerBackdropSurface intensity={intensity} dimColor={dimColor} />
    </BottomSheetBackdrop>
  );
}

const styles = StyleSheet.create({
  transparent: { backgroundColor: 'transparent' },
});
