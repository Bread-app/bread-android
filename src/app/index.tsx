import { usePrivy } from '@privy-io/expo';
import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import { appUserPayloadFromPrivyUser } from '@/lib/api';
import { syncUser } from '@/lib/user-sync';
import { useOnboardingStatus } from '@/lib/onboarding-store';

export default function IndexRoute() {
  const { isReady, user } = usePrivy();
  const privyUserId = user?.id ?? null;
  const { isLoaded, isComplete, currentStep, markCompleteFromServer, reset } = useOnboardingStatus(privyUserId);

  // Track whether the server sync has finished so we don't route prematurely
  const [serverSynced, setServerSynced] = useState(false);

  // Sync with server and reconcile onboarding state in BOTH directions. The
  // server (AppUser.onboardingCompletedAt) is the source of truth — local
  // SecureStore is only a cache. We can't short-circuit on a local "complete"
  // flag: it can be stale (e.g. the account onboarded against a previous
  // backend/DB, then the DB was swapped, so the server row has no username and
  // no completedAt). Trusting local in that case bypasses onboarding and lands
  // the user on home with no profile. So always sync once per sign-in.
  useEffect(() => {
    if (!user || !isLoaded) {
      setServerSynced(false);
      return;
    }

    const payload = appUserPayloadFromPrivyUser(user);
    if (!payload) {
      // No payload means we can't sync — treat as synced to avoid blocking forever
      setServerSynced(true);
      return;
    }

    let cancelled = false;

    syncUser(payload)
      .then((res) => {
        if (cancelled) return;
        if (res?.user?.onboardingCompletedAt) {
          // Server says done → ensure local reflects it.
          return markCompleteFromServer(res.user.onboardingCompletedAt);
        }
        // Server says NOT done. If local is stale-complete (no real profile on
        // this DB), clear it so we re-route into onboarding instead of home.
        if (isComplete) {
          return reset();
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setServerSynced(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user, isLoaded, isComplete, markCompleteFromServer, reset]);

  // Wait for Privy, local store, AND server sync before deciding where to route.
  // Onboarding load + server sync only matter when there's a user; when logged
  // out we must fall through to the sign-in redirect (otherwise the onboarding
  // store forces isLoaded=false and this spins forever after logout).
  if (!isReady || (user && (!isLoaded || !serverSynced))) {
    return (
      // Mirrors the native launch splash (app.json) so a slow start that
      // outlives it looks continuous, just with a spinner added.
      <View style={styles.loadingContainer}>
        <Image source={require('../../assets/images/splash-icon.png')} style={styles.loadingIcon} />
        <ActivityIndicator style={styles.loadingSpinner} size="small" color="#000000" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/sign-in" />;
  }

  if (!isComplete && currentStep) {
    return <Redirect href={`/onboarding/${currentStep}` as any} />;
  }

  return <Redirect href="/home" />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0AFE0B',
  },
  loadingIcon: {
    width: 220,
    height: 220,
    resizeMode: 'contain',
  },
  loadingSpinner: {
    position: 'absolute',
    bottom: 96,
  },
});
