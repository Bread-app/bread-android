import Ionicons from '@expo/vector-icons/Ionicons';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useThemeStore } from '@/lib/theme-store';

const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();
const SIZE = 64;

/**
 * The floating "New sandwich" button — on Home and on the Sandwich feed.
 *
 * On iOS 26 it is native Liquid Glass, tinted the app's action blue and
 * interactive (the system press-bloom). Elsewhere it falls back to the solid
 * blue circle with its soft glow.
 */
export function ComposeFab({
  onPress,
  bottom,
  right,
}: {
  onPress: () => void;
  bottom: number;
  right: number;
}) {
  const { colors, scheme } = useThemeStore();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New sandwich"
      hitSlop={12}
      onPress={onPress}
      style={[styles.fab, { bottom, right }, !HAS_GLASS && { shadowColor: colors.actionPrimary }, !HAS_GLASS && styles.glow]}
    >
      {HAS_GLASS ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          tintColor={colors.actionPrimary}
          // The in-app Light/Dark toggle is independent of the OS appearance.
          colorScheme={scheme === 'dark' ? 'dark' : 'light'}
          style={styles.face}
        >
          <Ionicons name="add" size={34} color="#FFFFFF" />
        </GlassView>
      ) : (
        <View style={[styles.face, { backgroundColor: colors.actionPrimary }]}>
          <Ionicons name="add" size={36} color="#FFFFFF" />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    zIndex: 40,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
  },
  glow: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 18,
    elevation: 12,
  },
  // GlassView is a native view and won't auto-size to its children.
  face: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
