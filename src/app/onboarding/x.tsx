import Ionicons from '@expo/vector-icons/Ionicons';
import { usePrivy } from '@privy-io/expo';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { Fonts } from '@/constants/theme';
import { humanizeErrorMessage } from '@/lib/api';
import { useOnboardingStatus } from '@/lib/onboarding-store';
import { linkXAccount } from '@/lib/x-link';
import { AtmosphericBackground } from '@/screens/login-screen';

const F = Fonts.rounded;

const PERKS: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; body: string }[] = [
  {
    icon: 'heart',
    title: 'Like to Buy',
    body: 'Like a post with a trade idea on X and Bread can buy into it. Off until you set an amount.',
  },
  {
    icon: 'people',
    title: 'Your feed, from day one',
    body: "We bring in the people you follow on X, so your feed isn't empty.",
  },
];

// Continuation of sign-in: same sky as the login screen, shown right after
// Apple/Google so linking X feels like part of logging in, not a settings chore.
export default function LinkXScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = usePrivy();
  const { markStepComplete } = useOnboardingStatus(user?.id ?? null);

  const [busy, setBusy] = useState<'link' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function advance() {
    const next = await markStepComplete('x');
    router.replace(next ? (`/onboarding/${next}` as any) : '/home');
  }

  async function handleLink() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBusy('link');
    setError(null);
    try {
      const outcome = await linkXAccount();
      if (!outcome) return; // dismissed the browser — stay here
      if (!outcome.connected) throw new Error("Couldn't link your X account.");
      // A missing like subscription isn't fatal here: the account is linked and
      // the following import is running. The Like to Buy screen surfaces it.
      await advance();
    } catch (err) {
      setError(humanizeErrorMessage(err, "Couldn't link your X account."));
    } finally {
      setBusy(null);
    }
  }

  async function handleSkip() {
    void Haptics.selectionAsync();
    setBusy('skip');
    try {
      await advance();
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.page}>
      <StatusBar style="light" />
      <AtmosphericBackground />

      <View style={[styles.content, { paddingTop: Math.max(insets.top, 20) + 24 }]}>
        <Image
          source={require('../../../assets/images/breadtext.png')}
          style={styles.wordmark}
          resizeMode="contain"
        />
        <Text style={styles.headline}>Link your 𝕏</Text>
        <Text style={styles.subhead}>One tap, and Bread starts working for you.</Text>

        <View style={styles.perks}>
          {PERKS.map((perk) => (
            <View key={perk.title} style={styles.perk}>
              <View style={styles.perkIcon}>
                <Ionicons name={perk.icon} size={18} color="#0b0b0f" />
              </View>
              <View style={styles.perkText}>
                <Text style={styles.perkTitle}>{perk.title}</Text>
                <Text style={styles.perkBody}>{perk.body}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Link X account"
          disabled={busy !== null}
          onPress={() => void handleLink()}
          scaleTo={0.975}
          style={styles.linkButton}>
          {busy === 'link' ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.linkButtonText}>Link 𝕏</Text>
          )}
        </PressableScale>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip linking X"
          disabled={busy !== null}
          hitSlop={8}
          onPress={() => void handleSkip()}
          style={styles.skipButton}>
          <Text style={styles.skipText}>Not now</Text>
        </Pressable>

        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.errorText}>
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#69b7fb' },
  content: { flex: 1, paddingHorizontal: 28 },
  wordmark: {
    width: 120,
    aspectRatio: 2560 / 1088,
    marginBottom: 28,
  },
  headline: {
    color: '#ffffff',
    fontFamily: F,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginBottom: 6,
  },
  subhead: {
    color: 'rgba(255,255,255,0.9)',
    fontFamily: F,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 28,
  },
  perks: { gap: 12 },
  perk: {
    flexDirection: 'row',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  perkIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkText: { flex: 1, gap: 3 },
  perkTitle: { color: '#0b0b0f', fontFamily: F, fontSize: 16, fontWeight: '700' },
  perkBody: { color: '#3b3f4a', fontFamily: F, fontSize: 14, fontWeight: '500', lineHeight: 19 },
  bottomDock: { paddingHorizontal: 24, gap: 14 },
  linkButton: {
    minHeight: 66,
    marginHorizontal: 12,
    borderRadius: 18,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#06378f',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 5,
  },
  linkButtonText: { color: '#ffffff', fontFamily: F, fontSize: 18, fontWeight: '700' },
  skipButton: { alignSelf: 'center', paddingVertical: 6 },
  skipText: { color: '#0b3a6b', fontFamily: F, fontSize: 15, fontWeight: '700' },
  errorText: {
    color: '#b00020',
    fontFamily: F,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    textAlign: 'center',
  },
});
