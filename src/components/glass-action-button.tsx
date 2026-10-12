import { Button as SwiftUIButton, Host, Text as SwiftUIText } from '@expo/ui/swift-ui';
import { frame } from '@expo/ui/swift-ui/modifiers';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { HAS_LIQUID_GLASS } from '@/lib/liquid-glass';
import { useThemeStore } from '@/lib/theme-store';

type Weight = 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy';

const RN_WEIGHT: Record<Weight, '400' | '500' | '600' | '700' | '800'> = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
};

export type GlassActionButtonProps = {
  /** Mirrors the SwiftUI button style used on iOS 26. */
  variant: 'glass' | 'glassProminent';
  /** The `.tint` on iOS 26. Doubles as the pre-26 fill when `prominent`. */
  tint: string;
  label: string;
  labelColor?: string;
  labelWeight?: Weight;
  /** `rounded` picks the SF Rounded face on both paths. */
  labelDesign?: 'default' | 'rounded';
  width: number;
  height: number;
  onPress: () => void;
  /**
   * The colour iOS 26's glass actually renders as on this button's backdrop,
   * for the hand-drawn path. White `glassProminent` over Home's blue board
   * comes out cyan (#C8FFFF), not white.
   */
  fallbackFill?: string;
};

/**
 * The app's one capsule action button, with two bodies behind a single API.
 *
 * On iOS 26 it is the real SwiftUI control, so it gets genuine Liquid Glass —
 * refraction, the specular rim, the press morph — none of which can be faked.
 *
 * Below 26 those button styles do not exist. `@expo/ui` resolves them to *no*
 * `buttonStyle` at all (`ios/Button/Button.swift` — the glass cases sit inside
 * `if #available(iOS 26.0)`), so the control silently loses its fill and decays
 * into bare text. Rather than fall back to a stock system style that looks
 * nothing like the design, this draws the same silhouette by hand: a full
 * capsule, the same tint, the same label face. It is not glass, but it is the
 * same button.
 */
export function GlassActionButton({
  variant,
  tint,
  label,
  labelColor,
  labelWeight = 'bold',
  labelDesign = 'default',
  width,
  height,
  onPress,
  fallbackFill,
}: GlassActionButtonProps) {
  const { scheme } = useThemeStore();

  if (HAS_LIQUID_GLASS) {
    return (
      <Host style={{ width, height }}>
        <SwiftUIButton
          variant={variant}
          controlSize="large"
          color={tint}
          modifiers={[frame({ width, height })]}
          onPress={onPress}>
          <SwiftUIText weight={labelWeight} design={labelDesign} color={labelColor}>
            {label}
          </SwiftUIText>
        </SwiftUIButton>
      </Host>
    );
  }

  // `.glassProminent` reads as a solid capsule of its tint; plain `.glass` reads
  // as near-clear, so its tint barely shows and a tinted fill here would be a
  // louder button than iOS 26 draws. Hence: prominent takes the tint, plain
  // takes the neutral translucent chip.
  const isProminent = variant === 'glassProminent';
  const fill = fallbackFill
    ? fallbackFill
    : isProminent
    ? tint
    : scheme === 'dark'
      ? 'rgba(120, 120, 128, 0.36)'
      : '#FFFFFF';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          width,
          height,
          borderRadius: height / 2,
          backgroundColor: fill,
          opacity: pressed ? 0.82 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}>
      {/* Glass separates itself from what is behind it with a specular edge; a
          flat fill has to borrow a hairline instead, or a white capsule on a
          white page (Wallet's "Withdraw") has no visible boundary at all. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rim,
          {
            borderRadius: height / 2,
            borderColor:
              scheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.07)',
          },
        ]}
      />
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          {
            color: labelColor ?? (isProminent ? '#FFFFFF' : '#000000'),
            fontWeight: RN_WEIGHT[labelWeight],
            fontFamily: labelDesign === 'rounded' ? Fonts.rounded : undefined,
          },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
      },
      android: { elevation: 3 },
    }),
  },
  rim: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 17,
    letterSpacing: 0.1,
  },
});
