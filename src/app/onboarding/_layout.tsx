import { Stack } from 'expo-router';
import React from 'react';

import { PUSH_TRANSITION } from '@/lib/screen-transitions';
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
        ...PUSH_TRANSITION,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
