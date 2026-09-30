import { Stack } from 'expo-router';
import React from 'react';

import { useThemeStore } from '@/lib/theme-store';

export default function OnboardingLayout() {
  const { colors } = useThemeStore();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Onboarding is a linear multi-step flow — the native side-push makes
        // each step read as forward progress (and swipe-back as going back)
        // instead of a hard cut between screens.
        animation: 'slide_from_right',
        animationDuration: 250,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
