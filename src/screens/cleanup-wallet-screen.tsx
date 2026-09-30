import Ionicons from '@expo/vector-icons/Ionicons';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  buildRentReclaim,
  getReclaimableRent,
  type ReclaimableRent,
} from '@/lib/api';
import { signAndSendBase64 } from '@/lib/cash';
import { useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;
const LAMPORTS_PER_SOL = 1_000_000_000;

function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(5);
}

/**
 * Close the leftover token accounts from positions this wallet has fully exited.
 *
 * Deliberately NOT framed as a claim. The account deposit was funded by Bread's
 * payer on the gasless buy, and closing returns it there (`RENT_RECIPIENT` in
 * lib/server/rent-reclaim.ts) — so the user gets a tidier wallet, not a payout,
 * and the copy has to say so. Showing the SOL figure as a headline would read
 * as money they are about to receive.
 *
 * Most exits never reach this screen: a full sell now closes its own account in
 * the same transaction (basket/execute/exit-close.ts). What is left here is the
 * backlog from before that shipped, plus accounts emptied some other way.
 *
 * Accounts still being cycled are excluded server-side — an empty token account
 * is free to reuse, so closing one the wallet will re-open achieves nothing.
 * `skippedActive` reports how many were held back, so a small number reads as
 * deliberate rather than broken.
 */
export function CleanupWalletScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const router = useRouter();
  const { showToast } = useToast();

  const embeddedWallet = useEmbeddedSolanaWallet();
  const wallet = embeddedWallet.wallets?.[0] ?? null;

  const [preview, setPreview] = useState<ReclaimableRent | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPreview(await getReclaimableRent());
    } catch {
      setError('Could not read your accounts. Pull to try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCleanup = useCallback(async () => {
    if (!wallet || cleaning) return;
    setCleaning(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const build = await buildRentReclaim();
      // Batched into transactions of ~18 closes; each is signed and submitted
      // in turn. A later batch failing does not undo an earlier one, so the
      // reload below reports whatever actually landed rather than assuming.
      for (const transaction of build.transactions) {
        await signAndSendBase64(wallet, transaction);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(
        `Closed ${build.accounts.length} empty account${build.accounts.length === 1 ? '' : 's'}`,
        'success',
      );
      await load();
    } catch (caught) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast(
        caught instanceof Error ? caught.message : 'Could not close them right now',
        'error',
      );
      await load();
    } finally {
      setCleaning(false);
    }
  }, [wallet, cleaning, showToast, load]);

  const count = preview?.accounts.length ?? 0;
  const canCleanup = count > 0 && !cleaning && !loading && wallet !== null;

  return (
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.headerButton}>
          <Ionicons name="chevron-back" size={25} color={colors.text} />
        </PressableScale>
        <Text style={styles.headerTitle}>Clean up wallet</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          {loading ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <>
              <Text style={styles.heroAmount}>{count}</Text>
              <Text style={styles.heroCaption}>
                {count === 0
                  ? 'No empty accounts to close'
                  : `Empty account${count === 1 ? '' : 's'} from positions you've exited`}
              </Text>
            </>
          )}
        </View>

        <Text style={styles.explainer}>
          Every token you hold needs its own account on Solana. Selling empties the
          account but leaves it open. Closing them tidies up your wallet.
        </Text>
        <Text style={styles.explainer}>
          Bread covers the deposit on these accounts when you buy, so closing them
          returns it to Bread — not to your balance. Nothing you own is affected.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {preview && preview.skippedActive > 0 ? (
          <Text style={styles.note}>
            {preview.skippedActive} account{preview.skippedActive === 1 ? ' is' : 's are'} kept
            open because you have traded {preview.skippedActive === 1 ? 'it' : 'them'} recently —
            reopening one costs the same deposit again.
          </Text>
        ) : null}

        {count > 0 ? (
          <View style={styles.card}>
            {preview!.accounts.map((account, index) => (
              <View
                key={account.address}
                style={[styles.row, index < count - 1 && styles.rowDivider]}>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {account.mint.slice(0, 4)}…{account.mint.slice(-4)}
                  </Text>
                  <Text style={styles.rowHint}>
                    {account.idleDays === null
                      ? 'Idle'
                      : `Idle ${Math.round(account.idleDays)} days`}
                  </Text>
                </View>
                <Text style={styles.rowAmount}>{formatSol(account.lamports)} SOL</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close empty accounts"
          accessibilityState={{ disabled: !canCleanup }}
          disabled={!canCleanup}
          onPress={onCleanup}
          style={({ pressed }) => [
            styles.cta,
            !canCleanup && styles.ctaDisabled,
            pressed && canCleanup && styles.ctaPressed,
          ]}>
          {cleaning ? (
            <ActivityIndicator color={colors.actionPrimaryText} />
          ) : (
            <Text style={styles.ctaLabel}>
              {count === 0
                ? 'Nothing to clean up'
                : `Close ${count} account${count === 1 ? '' : 's'}`}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingBottom: 8,
    },
    headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontFamily: F, fontWeight: '700', fontSize: 17, color: colors.text },
    content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
    hero: { alignItems: 'center', paddingVertical: 28, gap: 6 },
    heroAmount: { fontFamily: F, fontWeight: '800', fontSize: 40, color: colors.text },
    heroCaption: { fontFamily: F, fontWeight: '500', fontSize: 14, color: colors.textSecondary },
    explainer: {
      fontFamily: F, fontWeight: '500',
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    note: {
      fontFamily: F, fontWeight: '500',
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
    },
    error: { fontFamily: F, fontWeight: '500', fontSize: 13, color: colors.negative },
    card: { backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowCopy: { flex: 1, gap: 2 },
    rowLabel: { fontFamily: F, fontWeight: '600', fontSize: 15, color: colors.text },
    rowHint: { fontFamily: F, fontWeight: '500', fontSize: 12, color: colors.textSecondary },
    rowAmount: { fontFamily: F, fontWeight: '600', fontSize: 14, color: colors.textSecondary },
    footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
    cta: {
      height: 54,
      borderRadius: 27,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.actionPrimary,
    },
    ctaDisabled: { opacity: 0.35 },
    ctaPressed: { opacity: 0.85 },
    ctaLabel: { fontFamily: F, fontWeight: '700', fontSize: 16, color: colors.actionPrimaryText },
  });
