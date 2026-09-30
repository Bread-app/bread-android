import { Stack } from 'expo-router';
import React from 'react';

import { useThemeStore } from '@/lib/theme-store';

/** The homepage owns its compact logo/action header inside the safe area. */
export default function HomeStackLayout() {
  const { colors } = useThemeStore();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
