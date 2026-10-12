import { AuthBoundary, useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { Redirect, Stack, useSegments } from 'expo-router';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { LikeBuySheet } from '@/components/like-buy-sheet';
import { useDepositToasts } from '@/hooks/use-deposit-toasts';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useXSummonClaim } from '@/hooks/use-x-summon-claim';
import { appUserPayloadFromPrivyUser } from '@/lib/api';
import { syncUserIfChanged } from '@/lib/user-sync';
import { DepositAddressesProvider } from '@/lib/deposit-addresses-store';
import { PodcastGroupProvider } from '@/lib/podcast-group-store';
import { SandwichDetailProvider } from '@/lib/sandwich-detail-store';
import { StockDetailProvider } from '@/lib/stock-detail-store';
import { PhoenixPositionSheetProvider } from '@/lib/phoenix-position-sheet-store';
import { StockTradeSheetProvider } from '@/lib/stock-trade-sheet-store';
import { SandwichTradeSheetProvider } from '@/lib/sandwich-trade-sheet-store';
import { SandwichComposerProvider } from '@/lib/sandwich-composer-store';
import { ComposerProgressProvider } from '@/lib/composer-progress-store';
import { NotificationsProvider } from '@/lib/notifications-store';
import { SavedStoreProvider } from '@/lib/saved-store';
import { ToastProvider } from '@/lib/toast-store';
import { TradeFxProvider } from '@/lib/trade-fx';
import { WalletStoreProvider } from '@/lib/wallet-store';
import { PUSH_TRANSITION } from '@/lib/screen-transitions';
import { ANDROID_ROUTE_SHEET_OPTIONS, androidNativeSheetOptions, USES_ROUTE_SHEET_FRAME } from '@/components/route-sheet-frame';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/theme';

/**
 * Authenticated app shell. A native Stack wraps the `(tabs)` native-tab
 * navigator so full-screen routes — notably `sandwich-detail` — can push *over*
 * the tab bar while still sitting inside the app-wide wallet / toast / saved /
 * sandwich-detail providers declared here. The tab bar itself lives in
 * `(tabs)/_layout.tsx`.
 */
export default function ProtectedAppLayout() {
  const { user } = usePrivy();
  const { colors } = useThemeStore();
  const solanaWallet = useEmbeddedSolanaWallet();
  const attemptedCreateRef = useRef(false);

  useEffect(() => {
    if (!user || solanaWallet.status !== 'not-created' || attemptedCreateRef.current) {
      return;
    }

    attemptedCreateRef.current = true;
    void solanaWallet.create().catch(() => {
      attemptedCreateRef.current = false;
    });
  }, [solanaWallet, user]);

  useEffect(() => {
    const payload = appUserPayloadFromPrivyUser(user);
    if (!payload) return;

    // Keep-alive only — skips the round-trip unless the identity actually
    // changed (e.g. the embedded wallet address first appears). Failures are
    // retried by API calls that create Sandwich records.
    void syncUserIfChanged(payload).catch(() => {});
  }, [user]);

  return (
    <AuthBoundary
      loading={<FullScreenLoader />}
      error={(error) => <AuthErrorScreen message={error.message} />}
      unauthenticated={<Redirect href="/sign-in" />}>
      <WalletStoreProvider>
        <DepositAddressesProvider>
          <SavedStoreProvider>
            <NotificationsProvider>
            <ToastProvider>
              <TradeFxProvider>
              <SandwichDetailProvider>
                <StockDetailProvider>
                <PhoenixPositionSheetProvider>
                <SandwichTradeSheetProvider>
                <StockTradeSheetProvider>
                <PodcastGroupProvider>
                <SandwichComposerProvider>
                <ComposerProgressProvider>
                <DepositToasts />
                {/* Confirm-mode Like→Buy: sweeps /api/auto-buy/pending on
                    launch + foreground and presents the one-tap buy sheet.
                    Mounted here so its hooks sit inside the wallet/cash/toast
                    providers the buy engine needs. */}
                <LikeBuySheet />
                <PushNotificationRegistration />
                <XSummonClaim />
                <TabHaptics />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.background },
                  }}>
                  <Stack.Screen name="(tabs)" />
                  {/* Full-screen vertical sandwich pager (TikTok-style). Always
                      dark, so it carries its own background and slides up. */}
                  <Stack.Screen
                    name="reels"
                    options={{
                      animation: 'slide_from_bottom',
                      contentStyle: { backgroundColor: '#0b0b0f' },
                    }}
                  />
                  {/* Full-screen thesis detail, pushed over the tab bar with
                      UIKit's zoom when a visible post card opened it. The
                      default side-push remains the no-source fallback. The
                      header is the real native UINavigationBar so the back button
                      picks up iOS 26's Liquid Glass material for free; it's
                      transparent so the chart/content shows through. The title is
                      set dynamically (on scroll) from the screen itself. */}
                  <Stack.Screen
                    name="sandwich-detail"
                    options={{
                      headerShown: true,
                      headerTransparent: true,
                      headerShadowVisible: false,
                      headerBackButtonDisplayMode: 'minimal',
                      headerTintColor: colors.icon,
                      headerTitleStyle: { color: colors.text },
                      headerTitle: '',
                      // Keep the default native animator: the patched screen
                      // stack replaces it with UIKit's zoom only when a tapped
                      // SandwichCard has marked itself as the source. Deep links
                      // with no source retain the normal push.
                      animation: 'default',
                    }}
                  />
                  {/* One YouTube episode and every market it produced. Same
                      native side-push + transparent Liquid Glass header as the
                      thesis detail; the feed card that opens it stays compact. */}
                  <Stack.Screen
                    name="podcast-sandwich"
                    options={{
                      headerShown: true,
                      headerTransparent: true,
                      headerShadowVisible: false,
                      headerBackButtonDisplayMode: 'minimal',
                      headerTintColor: colors.icon,
                      headerTitleStyle: { color: colors.text },
                      headerTitle: '',
                      ...PUSH_TRANSITION,
                    }}
                  />
                  {/* One news story opened from the News tab — same native
                      side-push + transparent Liquid Glass header. */}
                  <Stack.Screen
                    name="news-story"
                    options={{
                      headerShown: true,
                      headerTransparent: true,
                      headerShadowVisible: false,
                      headerBackButtonDisplayMode: 'minimal',
                      headerTintColor: colors.icon,
                      headerTitleStyle: { color: colors.text },
                      headerTitle: '',
                      ...PUSH_TRANSITION,
                    }}
                  />
                  {/* Another user's profile. A real stack screen (it used to be
                      a native Modal) so a position or post opened from it
                      pushes on top and Back returns to the profile. */}
                  <Stack.Screen
                    name="user-profile"
                    options={{
                      headerShown: true,
                      headerTransparent: true,
                      headerShadowVisible: false,
                      headerBackButtonDisplayMode: 'minimal',
                      headerTintColor: colors.icon,
                      headerTitleStyle: { color: colors.text },
                      headerTitle: '',
                      ...PUSH_TRANSITION,
                    }}
                  />
                  {/* "New sandwich" composer — full-screen push (same side-slide as
                      the thesis detail). The screen owns its own cancel/title nav
                      row so the native header stays hidden. */}
                  <Stack.Screen
                    name="sandwich-composer"
                    options={{
                      headerShown: false,
                      ...PUSH_TRANSITION,
                      gestureEnabled: false,
                    }}
                  />
                  {/* Full-screen prediction EVENT detail (outcome markets of
                      one Polymarket event). Same native side-push + transparent
                      Liquid Glass header treatment as the thesis detail. */}
                  <Stack.Screen
                    name="prediction-event"
                    options={{
                      headerShown: true,
                      headerTransparent: true,
                      headerShadowVisible: false,
                      headerBackButtonDisplayMode: 'minimal',
                      headerTintColor: colors.icon,
                      headerTitleStyle: { color: colors.text },
                      headerTitle: '',
                      ...PUSH_TRANSITION,
                    }}
                  />
                  {/* Minimal account editor (avatar / username / bio). Native
                      header for the Liquid Glass back button; the screen renders
                      its own large "Account" title under it. */}
                  <Stack.Screen
                    name="edit-profile"
                    options={{
                      headerShown: true,
                      headerTransparent: true,
                      headerShadowVisible: false,
                      headerBackButtonDisplayMode: 'minimal',
                      headerTintColor: colors.icon,
                      headerTitle: '',
                      ...PUSH_TRANSITION,
                    }}
                  />
                  {/* Holder thesis composer. Same treatment as the account
                      editor: native glass header for the back button, the
                      screen's own large title under it. */}
                  <Stack.Screen
                    name="position-take-composer"
                    options={{
                      headerShown: true,
                      headerTransparent: true,
                      headerShadowVisible: false,
                      headerBackButtonDisplayMode: 'minimal',
                      headerTintColor: colors.icon,
                      headerTitle: '',
                      ...PUSH_TRANSITION,
                    }}
                  />
                  {/* Profile-menu destinations. Both own their compact header
                      row and use the same quick side-push as the account tools. */}
                  <Stack.Screen
                    name="settings"
                    options={{
                      headerShown: false,
                      ...PUSH_TRANSITION,
                    }}
                  />
                  <Stack.Screen
                    name="blocked-users"
                    options={{
                      headerShown: false,
                      ...PUSH_TRANSITION,
                    }}
                  />
                  <Stack.Screen
                    name="activity"
                    options={{
                      headerShown: false,
                      ...PUSH_TRANSITION,
                    }}
                  />
                  {/* Closing leftover accounts from fully-exited positions.
                      Renders its own header row with a back button, like the
                      screens above. */}
                  <Stack.Screen
                    name="cleanup-wallet"
                    options={{
                      headerShown: false,
                      ...PUSH_TRANSITION,
                    }}
                  />
                  {/* The notification inbox and its per-category settings. Both
                      render their own header row (with a back button), so the
                      native header stays hidden — same treatment as the
                      composer. Push targets from a tapped notification resolve
                      to `/notifications` when the payload's route is unknown. */}
                  <Stack.Screen
                    name="notifications"
                    options={{
                      headerShown: false,
                      ...PUSH_TRANSITION,
                    }}
                  />
                  {/* Asset detail, presented with the iOS-18-style zoom: the
                      tapped row's rect grows into the full screen and collapses
                      back into it. The route is a TRANSPARENT modal with no
                      animation of its own — the list underneath has to stay
                      visible behind the growing card, and the transition is
                      owned by <ZoomScreen> (see components/zoom-screen.tsx for
                      why UIKit's real .zoom transition is out of reach here).
                      Native gestures are off so the back-swipe never competes
                      with the card's own drag-to-collapse. */}
                  <Stack.Screen
                    name="stock-detail"
                    options={{
                      headerShown: false,
                      presentation: 'transparentModal',
                      animation: 'none',
                      gestureEnabled: false,
                      contentStyle: { backgroundColor: 'transparent' },
                    }}
                  />
                  {/* A YouTube call's buy drawer on its own (Holdings' Buy on a
                      held YouTube position). Transparent and unanimated for
                      the same reason as stock-detail: the drawer owns its own
                      rise, and whatever opened it stays visible behind. */}
                  <Stack.Screen
                    name="podcast-call"
                    options={{
                      headerShown: false,
                      presentation: 'transparentModal',
                      animation: 'none',
                      gestureEnabled: false,
                      contentStyle: { backgroundColor: 'transparent' },
                    }}
                  />
                  {/* The asset detail, driven by UIKit's own zoom transition
                      (see lib/native-zoom.ts and the RNSScreenStack patch).

                      A PUSH, deliberately: it is a full screen, not a sheet.
                      Presenting it modally is the only way to get the zoom's
                      interactive pull-down dismissal, but every modal style
                      that offers it also renders as a sheet — so this trades
                      pull-down away and dismisses with the edge-swipe back,
                      which zooms out to the row just the same.

                      `animation` must stay 'default': react-native-screens
                      returns a custom animator for every other value, and a
                      custom animator overrides `preferredTransition`. */}
                  <Stack.Screen
                    name="stock-detail-native"
                    options={{
                      headerShown: false,
                      animation: 'default',
                    }}
                  />
                  {/* TRIAL: the deposit flow as a real UISheetPresentationController
                      form sheet (see app/(app)/deposit.tsx). Content is sized by
                      the step, so the sheet fits to it and re-measures as the
                      flow moves between the method list and the amount pad. */}
                  <Stack.Screen
                    name="deposit"
                    options={USES_ROUTE_SHEET_FRAME ? ANDROID_ROUTE_SHEET_OPTIONS : {
                      headerShown: false,
                      presentation: 'formSheet',
                      sheetAllowedDetents: 'fitToContents',
                      sheetGrabberVisible: false,
                      sheetCornerRadius: 40,
                      contentStyle: { backgroundColor: colors.background },
                    }}
                  />
                  {/* The route gives the pad a bounded height; fitToContents
                      keeps that compact layout without the clipping caused by
                      fractional detents with a full-height flex root. */}
                  <Stack.Screen
                    name="sandwich-trade"
                    options={USES_ROUTE_SHEET_FRAME ? androidNativeSheetOptions(0.9, colors.background) : {
                      headerShown: false,
                      presentation: 'formSheet',
                      sheetAllowedDetents: 'fitToContents',
                      sheetGrabberVisible: false,
                      sheetCornerRadius: 28,
                      contentStyle: { backgroundColor: colors.background },
                    }}
                  />
                  <Stack.Screen
                    name="stock-trade"
                    options={USES_ROUTE_SHEET_FRAME ? androidNativeSheetOptions(0.95, colors.background) : {
                      headerShown: false,
                      presentation: 'formSheet',
                      sheetAllowedDetents: [1],
                      sheetGrabberVisible: false,
                      sheetCornerRadius: 28,
                      contentStyle: { bottom: 0, backgroundColor: colors.background },
                    }}
                  />
                  {/* Withdraw as a native form sheet at the large detent: the
                      keypad and address list want a fixed tall sheet, not one
                      that resizes per step. `bottom: 0` pins the content to the
                      sheet's bottom edge (see phoenix-position below). */}
                  <Stack.Screen
                    name="withdraw"
                    options={USES_ROUTE_SHEET_FRAME ? ANDROID_ROUTE_SHEET_OPTIONS : {
                      headerShown: false,
                      presentation: 'formSheet',
                      sheetAllowedDetents: [1],
                      sheetGrabberVisible: false,
                      sheetCornerRadius: 40,
                      contentStyle: { bottom: 0, backgroundColor: colors.background },
                    }}
                  />
                  {/* Open Phoenix position, as a native form sheet at the
                      large detent. Gesture dismissal is toggled by the screen
                      while SL/TP lines are being dragged on the chart.

                      `bottom: 0` matters: on iOS react-native-screens lays a
                      form sheet's content out absolutely with only top/left/
                      right set, so without it the content hugs its children
                      and the action bar floats mid-sheet instead of sitting on
                      the bottom edge. */}
                  <Stack.Screen
                    name="phoenix-position"
                    options={{
                      headerShown: false,
                      presentation: 'formSheet',
                      sheetAllowedDetents: [1],
                      sheetGrabberVisible: false,
                      sheetCornerRadius: 28,
                      contentStyle: { bottom: 0 },
                    }}
                  />
                  <Stack.Screen
                    name="notification-settings"
                    options={{
                      headerShown: false,
                      ...PUSH_TRANSITION,
                    }}
                  />
                </Stack>
                </ComposerProgressProvider>
                </SandwichComposerProvider>
                </PodcastGroupProvider>
                </StockTradeSheetProvider>
                </SandwichTradeSheetProvider>
                </PhoenixPositionSheetProvider>
                </StockDetailProvider>
              </SandwichDetailProvider>
              </TradeFxProvider>
            </ToastProvider>
            </NotificationsProvider>
          </SavedStoreProvider>
        </DepositAddressesProvider>
      </WalletStoreProvider>
    </AuthBoundary>
  );
}

/**
 * Fires a selection haptic whenever the user switches tabs. The tabs now live in
 * a nested `(app)/(tabs)` group, so the tab name is the third segment
 * (`['(app)', '(tabs)', '<tab>']`). Pushed full-screen routes outside the tabs
 * (e.g. `sandwich-detail`) have no third segment — skip those so entering a
 * detail screen doesn't fire an extra tick.
 */
function TabHaptics() {
  const segments = useSegments();
  const activeTab = segments[2] ?? '';
  const prevTab = useRef(activeTab);

  useEffect(() => {
    if (activeTab && activeTab !== prevTab.current) {
      prevTab.current = activeTab;
      void Haptics.selectionAsync();
    }
  }, [activeTab]);

  return null;
}

/**
 * Surfaces a toast when a deposit lands while the app is open, on any screen.
 * Renders nothing — it lives inside the toast provider so the hook can reach it.
 */
function DepositToasts() {
  useDepositToasts();
  return null;
}

/** Registers the signed-in device for native Like→Buy push notifications. */
function PushNotificationRegistration() {
  usePushNotifications();
  return null;
}

/**
 * Mounts the one-shot X-summon claim sweep inside <ToastProvider> so the
 * "Claimed N sandwiches" toast can fire without prop-threading.
 */
function XSummonClaim() {
  useXSummonClaim();
  return null;
}

function FullScreenLoader() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  return (
    <View style={styles.centerContainer}>
      <ActivityIndicator size="large" color={colors.accentBlue} />
    </View>
  );
}

function AuthErrorScreen({ message }: { message: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.centerContainer}>
      <Text style={styles.errorTitle}>Authentication error</Text>
      <Text style={styles.errorBody}>{message}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    centerContainer: {
      flex: 1,
      backgroundColor: c.background,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
    },
    errorTitle: {
      color: c.text,
      fontWeight: '800',
      fontSize: 22,
      textAlign: 'center',
    },
    errorBody: {
      marginTop: 8,
      color: c.textSecondary,
      textAlign: 'center',
      fontSize: 14,
      lineHeight: 20,
    },
  });
