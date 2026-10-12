import { usePrivy } from '@privy-io/expo';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { checkUsername, updateUserProfile } from '@/lib/api';
import { useOnboardingStatus } from '@/lib/onboarding-store';
import { HandleText } from '@/components/handle-text';

const F = Fonts.rounded;

export default function UsernameScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const { user } = usePrivy();
  const { markStepComplete } = useOnboardingStatus(user?.id ?? null);

  const [username, setUsername] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every keystroke starts a check and none are cancelled, so answers can land
  // out of order; only the latest one may touch the screen.
  const checkSeq = useRef(0);

  const privyUserId = user?.id ?? null;

  // One quiet retry: a single dropped request on mobile data used to leave
  // "could not check" and a dead continue button until the user retyped.
  const runCheck = useCallback(async (name: string) => {
    const seq = ++checkSeq.current;
    setChecking(true);
    setCheckFailed(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await checkUsername(name);
        if (seq !== checkSeq.current) return;
        setAvailable(res.available);
        setValidationError(res.available ? null : 'already taken');
        setChecking(false);
        return;
      } catch {
        if (seq !== checkSeq.current) return;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
    if (seq !== checkSeq.current) return;
    setCheckFailed(true);
    setChecking(false);
  }, []);

  const handleChange = useCallback((text: string) => {
    const cleaned = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(cleaned);
    setAvailable(null);
    setValidationError(null);
    setCheckFailed(false);
    // Invalidates any check still in flight for the previous text.
    checkSeq.current++;
    setChecking(false);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (cleaned.length < 3) {
      if (cleaned.length > 0) setValidationError('at least 3 characters');
      return;
    }
    if (cleaned.length > 20) {
      setValidationError('max 20 characters');
      return;
    }
    if (cleaned.startsWith('_') || cleaned.endsWith('_')) {
      setValidationError("can't start or end with _");
      return;
    }

    setChecking(true);
    debounceRef.current = setTimeout(() => void runCheck(cleaned), 300);
  }, [runCheck]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const canContinue = available === true && !checking && !submitting && username.length >= 3;

  async function handleContinue() {
    if (!canContinue || !privyUserId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      await updateUserProfile(privyUserId, { username });
      await markStepComplete('username');
      router.push('/onboarding/avatar');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save username';
      setValidationError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      // With autoFocus the keyboard is up immediately; without this the bottom
      // "continue" button sits BEHIND the keyboard and can't be tapped until the
      // keyboard is dismissed. Padding behavior lifts it just above the keyboard.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.page, { paddingTop: Math.max(insets.top, 20) + 16, paddingBottom: Math.max(insets.bottom, 20) + 16 }]}>
      <View style={styles.stepPill}>
        <Text style={styles.stepPillText}>1 of 2</Text>
      </View>

      <Text style={styles.headline}>pick a username</Text>
      <Text style={styles.subhead}>this is how others will find you.</Text>

      <View style={styles.inputWrap}>
        <Text style={styles.atPrefix}>@</Text>
        <TextInput
          value={username}
          onChangeText={handleChange}
          placeholder="coolname"
          placeholderTextColor={colors.iconMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          maxLength={20}
          style={styles.input}
        />
        {checking ? (
          <ActivityIndicator size="small" color={colors.iconMuted} />
        ) : available === true ? (
          <Text style={styles.checkmark}>&#10003;</Text>
        ) : null}
      </View>

      {validationError ? (
        <Text style={styles.errorText}>{validationError}</Text>
      ) : checkFailed ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void runCheck(username)}>
          <Text style={styles.errorText}>{"couldn't check, tap to retry"}</Text>
        </Pressable>
      ) : username.length >= 3 && available === true ? (
        <HandleText style={styles.successText}>{`@${username} is available`}</HandleText>
      ) : null}

      <View style={{ flex: 1 }} />

      <Pressable
        accessibilityRole="button"
        disabled={!canContinue}
        onPress={() => void handleContinue()}
        style={({ pressed }) => [
          styles.primaryButton,
          !canContinue && styles.primaryButtonDisabled,
          pressed && canContinue && styles.primaryButtonPressed,
        ]}>
        {submitting ? (
          <ActivityIndicator size="small" color={colors.textInverse} />
        ) : (
          <Text style={styles.primaryButtonText}>continue</Text>
        )}
      </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.background },
  page: { flex: 1, backgroundColor: c.background, paddingHorizontal: 24 },
  stepPill: {
    alignSelf: 'flex-start',
    backgroundColor: c.surfaceAlt,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 24,
  },
  stepPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.textSecondary,
    fontFamily: F,
  },
  headline: {
    fontSize: 32,
    fontWeight: '800',
    color: c.text,
    letterSpacing: -0.8,
    fontFamily: F,
    marginBottom: 6,
  },
  subhead: {
    fontSize: 16,
    color: c.textSecondary,
    fontWeight: '500',
    fontFamily: F,
    marginBottom: 32,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.backgroundAlt,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  atPrefix: {
    fontSize: 22,
    fontWeight: '700',
    color: c.iconMuted,
    fontFamily: F,
  },
  input: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: c.text,
    fontFamily: F,
    padding: 0,
  },
  checkmark: {
    fontSize: 18,
    fontWeight: '800',
    color: c.positive,
  },
  errorText: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: c.negative,
    fontFamily: F,
    paddingHorizontal: 4,
  },
  successText: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: c.positive,
    fontFamily: F,
    paddingHorizontal: 4,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 100,
    backgroundColor: c.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: { opacity: 0.25 },
  primaryButtonPressed: { opacity: 0.82 },
  primaryButtonText: { color: c.textInverse, fontSize: 17, fontWeight: '700', fontFamily: F },
});
