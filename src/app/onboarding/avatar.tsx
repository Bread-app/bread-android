import { usePrivy } from '@privy-io/expo';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { completeOnboarding, uploadAvatar } from '@/lib/api';
import { useOnboardingStatus } from '@/lib/onboarding-store';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

export default function AvatarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const { user } = usePrivy();
  const { markStepComplete, markAllComplete } = useOnboardingStatus(user?.id ?? null);

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const privyUserId = user?.id ?? null;

  async function handlePickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setError(null);
    }
  }

  async function finishOnboarding() {
    await markStepComplete('avatar');
    await markAllComplete();
    if (privyUserId) {
      void completeOnboarding(privyUserId).catch(() => {});
    }
    router.replace('/home');
  }

  async function handleContinue() {
    if (!privyUserId) return;
    setSubmitting(true);
    setError(null);
    try {
      if (imageUri) {
        await uploadAvatar(privyUserId, imageUri);
      }
      await finishOnboarding();
    } catch (err) {
      // Surface the failure instead of silently advancing — otherwise a failed
      // upload looks identical to success and the user's photo is lost without
      // them knowing. They can retry, or use "skip for now" to move on.
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't upload your photo. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    await finishOnboarding();
  }

  return (
    <View style={[styles.page, { paddingTop: Math.max(insets.top, 20) + 16, paddingBottom: Math.max(insets.bottom, 20) + 16 }]}>
      <View style={styles.stepPill}>
        <Text style={styles.stepPillText}>2 of 2</Text>
      </View>

      <Text style={styles.headline}>add a profile pic</Text>
      <Text style={styles.subhead}>help others recognize you. change it anytime.</Text>

      <View style={styles.avatarSection}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Pick a profile picture"
          onPress={() => void handlePickImage()}
          style={styles.avatarCircle}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="camera-outline" size={36} color={colors.iconMuted} />
            </View>
          )}
        </PressableScale>

        <Pressable onPress={() => void handlePickImage()} style={styles.changeButton}>
          <Text style={styles.changeButtonText}>
            {imageUri ? 'change photo' : 'choose from library'}
          </Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }} />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <PressableScale
        accessibilityRole="button"
        disabled={submitting}
        onPress={() => void handleContinue()}
        style={styles.primaryButton}>
        {submitting ? (
          <ActivityIndicator size="small" color={colors.textInverse} />
        ) : (
          <Text style={styles.primaryButtonText}>continue</Text>
        )}
      </PressableScale>

      <Pressable onPress={() => void handleSkip()} style={styles.skipButton}>
        <Text style={styles.skipText}>skip for now</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.background, paddingHorizontal: 24 },
  stepPill: {
    alignSelf: 'flex-start',
    backgroundColor: c.surfaceAlt,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 24,
  },
  stepPillText: { fontSize: 13, fontWeight: '600', color: c.textSecondary, fontFamily: F },
  headline: {
    fontSize: 32,
    fontWeight: '800',
    color: c.text,
    letterSpacing: -0.8,
    fontFamily: F,
    marginBottom: 6,
  },
  subhead: { fontSize: 16, color: c.textSecondary, fontWeight: '500', fontFamily: F, marginBottom: 32 },
  avatarSection: { alignItems: 'center', gap: 20, marginTop: 24 },
  avatarCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: c.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: 140, height: 140, borderRadius: 70 },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  changeButton: { paddingVertical: 6 },
  changeButtonText: { fontSize: 15, fontWeight: '600', color: c.textSecondary, fontFamily: F },
  primaryButton: {
    minHeight: 56,
    borderRadius: 100,
    backgroundColor: c.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: c.textInverse, fontSize: 17, fontWeight: '700', fontFamily: F },
  skipButton: { alignSelf: 'center', paddingVertical: 16 },
  skipText: { fontSize: 15, fontWeight: '600', color: c.iconMuted, fontFamily: F },
  errorText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.negative,
    fontFamily: F,
    textAlign: 'center',
    marginBottom: 12,
  },
});
