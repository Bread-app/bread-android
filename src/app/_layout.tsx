import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { Baloo2_800ExtraBold } from '@expo-google-fonts/baloo-2';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins';
import { Rubik_700Bold, Rubik_800ExtraBold, Rubik_900Black, useFonts } from '@expo-google-fonts/rubik';
import { Sancreek_400Regular } from '@expo-google-fonts/sancreek';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter';
import {
  PlayfairDisplay_800ExtraBold,
  PlayfairDisplay_900Black,
} from '@expo-google-fonts/playfair-display';
import { UnifrakturCook_700Bold } from '@expo-google-fonts/unifrakturcook';
import { VT323_400Regular } from '@expo-google-fonts/vt323';
import { PTSerif_400Regular, PTSerif_700Bold } from '@expo-google-fonts/pt-serif';
import { PrivyProvider, usePrivy } from '@privy-io/expo';
import { PrivyElements } from '@privy-io/expo/ui';
import * as Haptics from 'expo-haptics';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { SolanaMobileProvider } from '@/components/solana-mobile-provider';
import { setAuthTokenProvider } from '@/lib/api';
import { hideLaunchSplash, LAUNCH_SPLASH_MAX_MS } from '@/lib/launch-splash';
import { privyConfig } from '@/lib/privy';
import { ThemeProvider, useThemeStore } from '@/lib/theme-store';

/**
 * Bridges the Privy access token into the plain `requestJson` API client so
 * every backend call carries `Authorization: Bearer <token>`. Must live inside
 * PrivyProvider. Renders nothing.
 */
function ApiAuthBridge() {
  const { getAccessToken } = usePrivy();

  useEffect(() => {
    setAuthTokenProvider(() => getAccessToken());
    return () => setAuthTokenProvider(null);
  }, [getAccessToken]);

  return null;
}

export default function RootLayout() {
  const hasSecureRandom = typeof globalThis.crypto?.getRandomValues === 'function';

  // Never let the launch splash outlive a slow/hung startup.
  useEffect(() => {
    const timer = setTimeout(hideLaunchSplash, LAUNCH_SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);
  // Bundle the heavy Rubik display face + the rounded Baloo 2 bubble face used
  // by the detail-screen tabs. Keep rendering while they load (system font shows
  // first); never block the app on a font, so a slow/failed load can't trap the
  // user on a blank screen.
  useFonts({
    RubikOne_400Regular: require('../../assets/fonts/RubikOne-Regular.ttf'),
    Rubik_900Black,
    Rubik_700Bold,
    Rubik_800ExtraBold,
    Baloo2_800ExtraBold,
    Poppins_600SemiBold,
    Sancreek_400Regular,
    Inter_800ExtraBold,
    PlayfairDisplay_900Black,
    PlayfairDisplay_800ExtraBold,
    UnifrakturCook_700Bold,
    VT323_400Regular,
    PTSerif_400Regular,
    PTSerif_700Bold,
  });

  if (!hasSecureRandom || !privyConfig.appId || !privyConfig.clientId) {
    hideLaunchSplash();
  }

  if (!hasSecureRandom) {
    return (
      <View style={styles.missingConfigContainer}>
        <ActivityIndicator size="large" color="#0284c7" />
        <Text style={styles.missingConfigTitle}>Initializing secure random source</Text>
        <Text style={styles.missingConfigBody}>Reload the app if this message persists.</Text>
      </View>
    );
  }

  if (!privyConfig.appId || !privyConfig.clientId) {
    return (
      <View style={styles.missingConfigContainer}>
        <ActivityIndicator size="large" color="#0284c7" />
        <Text style={styles.missingConfigTitle}>Privy configuration is required</Text>
        <Text style={styles.missingConfigBody}>
          Set EXPO_PUBLIC_PRIVY_APP_ID and EXPO_PUBLIC_PRIVY_CLIENT_ID in your environment.
        </Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider>
        <PrivyProvider appId={privyConfig.appId} clientId={privyConfig.clientId}>
          <ApiAuthBridge />
          <SolanaMobileProvider>
            <BottomSheetModalProvider>
              <ThemedRoot />
            </BottomSheetModalProvider>
          </SolanaMobileProvider>
          <PrivyElements />
        </PrivyProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Lives inside ThemeProvider so the status bar and the navigator's scene
 * background follow the active Light / Dark / System theme.
 */
function ThemedRoot() {
  const { scheme, colors } = useThemeStore();
  return (
    <>
      <NavigationHaptics />
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          // Cross-fade between the top-level surfaces (sign-in ↔ app ↔
          // onboarding) instead of a hard cut. Redirect chains stay unobtrusive
          // because every scene shares the same themed background.
          animation: 'fade',
          animationDuration: 220,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </>
  );
}

/**
 * One selection tick whenever the visible route changes — a push, a pop, a tab
 * switch — so moving between screens is felt, not only seen. The first route
 * (app launch) is silent, and redirect chains that settle within a beat
 * collapse into a single tick.
 */
function NavigationHaptics() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);
  const lastTickAt = useRef(0);
  useEffect(() => {
    // `/` is the index route deciding where to go (Privy + user sync). Once
    // the path moves on — the redirect landed, or a deep link opened straight
    // into a screen — the first real screen is up, so drop the launch splash.
    if (pathname !== '/') hideLaunchSplash();

    const from = previous.current;
    previous.current = pathname;
    if (from === null || from === pathname) return;
    const now = Date.now();
    if (now - lastTickAt.current < 250) return;
    lastTickAt.current = now;
    void Haptics.selectionAsync();
  }, [pathname]);
  return null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  missingConfigContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#f8fafc',
    gap: 14,
  },
  missingConfigTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  missingConfigBody: {
    fontSize: 15,
    color: '#334155',
    textAlign: 'center',
    lineHeight: 22,
  },
});
