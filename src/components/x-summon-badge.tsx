import React from 'react';
import { Linking, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { Sandwich } from '@/lib/api';

/**
 * Tiny 𝕏 icon shown next to the creator name on sandwiches summoned from an X
 * post via the @bread mention bot. Tapping opens the source tweet. Renders
 * nothing for native sandwiches.
 */
export function XSummonBadge({
  sandwich,
  size = 'sm',
}: {
  sandwich: Sandwich;
  size?: 'xs' | 'sm';
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const source = sandwich.source;

  if (source.sourceType !== 'x_summon') return null;

  const url = source.sourceUrl;
  const onPress = url
    ? () => {
        void Linking.openURL(url).catch(() => {});
      }
    : undefined;

  const iconSize = size === 'xs' ? 13 : 15;

  return (
    <Pressable
      accessibilityRole={url ? 'link' : 'image'}
      accessibilityLabel={`Summoned from X post${
        source.authorHandle ? ` by @${source.authorHandle}` : ''
      }`}
      onPress={onPress}
      disabled={!onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.badge, pressed && url ? styles.pressed : null]}
    >
      <Ionicons name="logo-x" size={iconSize} color={colors.text} />
    </Pressable>
  );
}

const makeStyles = (_c: ThemeColors) =>
  StyleSheet.create({
    badge: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.6,
    },
  });
