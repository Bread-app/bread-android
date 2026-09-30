import { useEmbeddedSolanaWallet, useLoginWithOAuth, usePrivy } from '@privy-io/expo';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { PressableScale } from '@/components/pressable-scale';
import {
  isNoWalletInstalled,
  isWalletCancellation,
  useSolanaWalletLogin,
} from '@/hooks/use-solana-wallet-login';
import { isSeekerDevice } from '@/lib/solana-mobile/seeker';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { appUserPayloadFromPrivyUser } from '@/lib/api';
import { syncUser } from '@/lib/user-sync';

const F = Fonts.rounded;

const OAUTH_CANCELLATION_CODES = new Set([
  'ERR_REQUEST_CANCELED',
  'login_with_oauth_was_cancelled_by_user',
  'link_with_oauth_was_cancelled_by_user',
]);

function oauthErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

// Seeker ships Seed Vault as its system wallet, so there the wallet button
// leads and names it; elsewhere it reads as any installed Solana wallet.
const IS_SEEKER = isSeekerDevice();
const WALLET_LOGIN_LABEL = IS_SEEKER ? 'Seed Vault' : 'Solana wallet';

function walletErrorMessage(error: unknown): string {
  if (isNoWalletInstalled(error)) {
    return 'No Solana wallet found on this phone. Install Phantom or Solflare, or continue with Google.';
  }
  if (error instanceof Error && /network|fetch|timed?\s*out/i.test(error.message)) {
    return 'Could not reach the sign-in service. Check your connection and try again.';
  }
  return 'Could not sign in with your wallet. Please try again.';
}

function oauthErrorMessage(provider: 'google', error: unknown): string {
  const providerName = 'Google';
  const code = oauthErrorCode(error);

  if (code === 'invalid_native_app_id' || code === 'invalid_origin') {
    return `${providerName} sign-in is not enabled for this version of Bread.`;
  }

  if (error instanceof Error && /network|fetch|timed?\s*out/i.test(error.message)) {
    return 'Could not reach the sign-in service. Check your connection and try again.';
  }

  return `Could not sign in with ${providerName}. Please try again.`;
}

function AtmosphericBackground() {
  return (
    <View pointerEvents="none" style={backgroundStyles.container}>
      <LinearGradient
        colors={['#53a9f8', '#69b7fb', '#82c7ff', '#a8dcff', '#eefaff']}
        locations={[0, 0.18, 0.45, 0.73, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[backgroundStyles.cloud, backgroundStyles.cloudTopLeft]} />
      <View style={[backgroundStyles.cloud, backgroundStyles.cloudTopRight]} />
      <View style={[backgroundStyles.cloud, backgroundStyles.cloudMiddleLeft]} />
      <View style={[backgroundStyles.cloud, backgroundStyles.cloudMiddleRight]} />
      <View style={[backgroundStyles.cloud, backgroundStyles.cloudLowLeft]} />
      <View style={[backgroundStyles.cloud, backgroundStyles.cloudLowRight]} />
      <View style={[backgroundStyles.cloud, backgroundStyles.cloudBottomLeft]} />
      <View style={[backgroundStyles.cloud, backgroundStyles.cloudBottomCenter]} />
      <View style={[backgroundStyles.cloud, backgroundStyles.cloudBottomRight]} />

      <BlurView
        blurReductionFactor={2.5}
        experimentalBlurMethod="dimezisBlurView"
        intensity={58}
        style={StyleSheet.absoluteFillObject}
        tint="light"
      />

      <LinearGradient
        colors={['rgba(48,148,239,0.16)', 'rgba(100,188,255,0.03)', 'rgba(241,251,255,0.38)']}
        locations={[0, 0.58, 1]}
        style={StyleSheet.absoluteFillObject}
      />
    </View>
  );
}

export function LoginScreen() {
  const styles = useThemedStyles(makeStyles);
  const { isReady, user } = usePrivy();
  const { login: loginWithOAuth } = useLoginWithOAuth();
  const solanaWallet = useEmbeddedSolanaWallet();

  const loginWithSolanaWallet = useSolanaWalletLogin();

  const [activeProvider, setActiveProvider] = useState<'google' | 'wallet' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const buttonsDisabled = useMemo(
    () => !isReady || activeProvider !== null,
    [activeProvider, isReady],
  );

  const wiggle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(wiggle, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: -1, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  }, [wiggle]);

  const rotate = wiggle.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-1.5deg', '0deg', '1.5deg'] });

  useEffect(() => {
    if (user) {
      const payload = appUserPayloadFromPrivyUser(user);
      if (payload) {
        void syncUser(payload).catch(() => {});
      }
    }

    if (solanaWallet.status === 'not-created') {
      void solanaWallet.create().catch(() => {});
    }
  }, [solanaWallet, user]);

  async function handleWalletLogin(): Promise<void> {
    setErrorMessage(null);
    setActiveProvider('wallet');
    try {
      await loginWithSolanaWallet();
    } catch (error) {
      if (!isWalletCancellation(error)) {
        console.error('[auth] Solana wallet (MWA) login failed', error);
        setErrorMessage(walletErrorMessage(error));
      }
    } finally {
      setActiveProvider(null);
    }
  }

  async function handleOAuth(provider: 'google'): Promise<void> {
    setErrorMessage(null);
    setActiveProvider(provider);
    try {
      await loginWithOAuth({ provider });
    } catch (error) {
      const code = oauthErrorCode(error);
      if (!code || !OAUTH_CANCELLATION_CODES.has(code)) {
        console.error(`[auth] ${provider} OAuth failed`, error);
        setErrorMessage(oauthErrorMessage(provider, error));
      }
    } finally {
      setActiveProvider(null);
    }
  }

  function handleButtonPressIn(): void {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  if (!isReady) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <AtmosphericBackground />
        <ActivityIndicator size="small" color="#ffffff" />
      </View>
    );
  }

  if (user) {
    return <Redirect href="/" />;
  }

  const walletButton = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Continue with ${WALLET_LOGIN_LABEL}`}
      disabled={buttonsDisabled}
      onPress={() => void handleWalletLogin()}
      onPressIn={handleButtonPressIn}
      scaleTo={0.975}
      style={styles.appleButton}>
      {activeProvider === 'wallet' ? (
        <ActivityIndicator size="small" color="#ffffff" />
      ) : (
        <View style={styles.buttonContent}>
          <Text style={styles.appleButtonText}>Continue with {WALLET_LOGIN_LABEL}</Text>
          <Ionicons accessible={false} name="wallet" size={24} color="#ffffff" />
        </View>
      )}
    </PressableScale>
  );

  const googleButton = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      disabled={buttonsDisabled}
      onPress={() => void handleOAuth('google')}
      onPressIn={handleButtonPressIn}
      scaleTo={0.975}
      style={styles.googleButton}>
      {activeProvider === 'google' ? (
        <ActivityIndicator size="small" color="#0b0b0f" />
      ) : (
        <View style={styles.buttonContent}>
          <Text style={styles.googleButtonText}>Continue with</Text>
          <Image
            accessible={false}
            source={require('../../assets/images/google-icon.png')}
            style={styles.googleIcon}
            resizeMode="contain"
          />
        </View>
      )}
    </PressableScale>
  );

  return (
    <View style={styles.page}>
      <StatusBar style="light" />
      <AtmosphericBackground />

      <View style={styles.hero}>
        <Animated.View style={[styles.wordmarkWrap, { transform: [{ rotate }] }]}>
          <Image
            source={require('../../assets/images/breadtext.png')}
            style={styles.wordmark}
            resizeMode="contain"
          />
        </Animated.View>
      </View>

      <View style={styles.bottomDock}>
        {IS_SEEKER ? walletButton : googleButton}
        {IS_SEEKER ? googleButton : walletButton}

        {errorMessage ? (
          <Text accessibilityLiveRegion="polite" style={styles.errorText}>
            {errorMessage}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#69b7fb',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#69b7fb',
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  wordmarkWrap: {
    width: '100%',
    alignItems: 'center',
  },
  wordmark: {
    width: '76%',
    maxWidth: 340,
    aspectRatio: 2560 / 1088,
    alignSelf: 'center',
  },
  bottomDock: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    gap: 14,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  appleButton: {
    minHeight: 66,
    marginHorizontal: 12,
    borderRadius: 18,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#000000',
    shadowColor: '#06378f',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 5,
    overflow: 'hidden',
  },
  appleButtonText: {
    color: '#ffffff',
    fontFamily: F,
    fontSize: 18,
    fontWeight: '700',
  },
  googleButton: {
    minHeight: 66,
    marginHorizontal: 12,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ffffff',
    shadowColor: '#06378f',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 14,
    elevation: 5,
    overflow: 'hidden',
  },
  googleButtonText: {
    color: '#0b0b0f',
    fontFamily: F,
    fontSize: 18,
    fontWeight: '700',
  },
  googleIcon: { width: 28, height: 28 },
  errorText: {
    color: c.negative,
    fontFamily: F,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    paddingHorizontal: 8,
    textAlign: 'center',
  },
});

const backgroundStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  cloud: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(238,248,255,0.58)',
  },
  cloudTopLeft: {
    top: '4%',
    left: '-30%',
    width: '104%',
    height: 94,
    opacity: 0.72,
    transform: [{ rotate: '-7deg' }],
  },
  cloudTopRight: {
    top: '10%',
    right: '-30%',
    width: '92%',
    height: 128,
    opacity: 0.48,
    transform: [{ rotate: '8deg' }],
  },
  cloudMiddleLeft: {
    top: '23%',
    left: '-42%',
    width: '115%',
    height: 136,
    opacity: 0.38,
    transform: [{ rotate: '5deg' }],
  },
  cloudMiddleRight: {
    top: '35%',
    right: '-38%',
    width: '110%',
    height: 112,
    opacity: 0.32,
    transform: [{ rotate: '-5deg' }],
  },
  cloudLowLeft: {
    bottom: '26%',
    left: '-35%',
    width: '105%',
    height: 150,
    opacity: 0.3,
    transform: [{ rotate: '-7deg' }],
  },
  cloudLowRight: {
    right: '-38%',
    bottom: '18%',
    width: '112%',
    height: 178,
    opacity: 0.38,
    transform: [{ rotate: '6deg' }],
  },
  cloudBottomLeft: {
    bottom: -132,
    left: -124,
    width: 340,
    height: 290,
    opacity: 0.9,
  },
  cloudBottomCenter: {
    bottom: -156,
    left: '14%',
    width: 360,
    height: 310,
    opacity: 0.82,
  },
  cloudBottomRight: {
    right: -150,
    bottom: -116,
    width: 360,
    height: 280,
    opacity: 0.96,
  },
});
