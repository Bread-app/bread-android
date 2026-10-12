import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { completeXRedirect, deliverXOauthRedirect } from '@/lib/x-link';
import { useThemeStore } from '@/lib/theme-store';

function param(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first ? first : null;
}

/**
 * Landing spot for X's OAuth redirect (`bread://x-oauth2?state=…&code=…`).
 *
 * On iOS the auth session swallows the redirect. On Android it arrives as an
 * ordinary deep link that Expo Router also navigates to — with no route here
 * that was an "Unmatched Route" screen, and the link silently never completed.
 *
 * The redirect is handed to the `linkXAccount` call waiting for it (which may
 * have been told the browser was merely closed). If none is waiting — Android
 * killed the app while the browser was open — this finishes the link itself.
 * Either way it then steps back to the flow the user was in.
 */
export default function XOauthRedirect() {
  const router = useRouter();
  const { colors } = useThemeStore();
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const leave = () => {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    };
    const redirect = { code: param(params.code), state: param(params.state), error: param(params.error) };
    if (deliverXOauthRedirect(redirect)) {
      leave();
      return;
    }
    void completeXRedirect(redirect)
      .catch((err) => console.warn('[x-link] completing X redirect failed', err))
      .finally(leave);
  }, [params.code, params.error, params.state, router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.text} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
