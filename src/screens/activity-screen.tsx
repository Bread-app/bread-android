import Ionicons from '@expo/vector-icons/Ionicons';
import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedRows } from '@/components/animated-rows';
import { LoadErrorState } from '@/components/load-error-state';
import { AssetLogo } from '@/components/asset-logo';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  formatTransactionAmount,
  formatTransactionAsset,
  formatTransactionDate,
  formatUsdcDisplay,
} from '@/lib/activity-format';
import {
  getUserPortfolio,
  getWalletTransactions,
  type WalletTransactionRecord,
} from '@/lib/api';
import {
  getStoredSandwichPositions,
  seedFromBackend,
  type SandwichPosition,
} from '@/lib/sandwich-positions';
import { isDemoBuyMode } from '@/lib/demo-buy-mode';
import { useThemeStore } from '@/lib/theme-store';

const F = Fonts.rounded;

type ActivityItem =
  | { kind: 'transaction'; id: string; sortMs: number; transaction: WalletTransactionRecord }
  | { kind: 'sandwich'; id: string; sortMs: number; position: SandwichPosition };
export function ActivityScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const router = useRouter();
  const { user } = usePrivy();
  const embeddedWallet = useEmbeddedSolanaWallet();
  const walletAddress = embeddedWallet.wallets?.[0]?.address ?? null;

  const [transactions, setTransactions] = useState<WalletTransactionRecord[] | null>(null);
  const [positions, setPositions] = useState<SandwichPosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadActivity = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      setError(null);

      const transactionRequest = getWalletTransactions({ limit: 50 });
      const positionRequest = (async () => {
        if (!walletAddress) return [];
        const cached = await getStoredSandwichPositions(walletAddress);
        if (!user?.id) return cached;

        try {
          const backendPositions = isDemoBuyMode() ? [] : await getUserPortfolio(user.id);
          return await seedFromBackend(walletAddress, backendPositions);
        } catch {
          return cached;
        }
      })();

      const [transactionResult, positionResult] = await Promise.allSettled([
        transactionRequest,
        positionRequest,
      ]);

      if (transactionResult.status === 'fulfilled') {
        setTransactions(transactionResult.value);
      } else {
        setTransactions((current) => current ?? []);
        setError("Some activity couldn't load. Pull down or try again.");
      }

      if (positionResult.status === 'fulfilled') {
        setPositions(positionResult.value);
      } else {
        setPositions((current) => current ?? []);
        setError("Some activity couldn't load. Pull down or try again.");
      }

      setRefreshing(false);
    },
    [user?.id, walletAddress],
  );

  useFocusEffect(
    useCallback(() => {
      void loadActivity();
    }, [loadActivity]),
  );

  const items = useMemo<ActivityItem[]>(
    () =>
      [
        ...(transactions ?? []).map(
          (transaction): ActivityItem => ({
            kind: 'transaction',
            id: `transaction:${transaction.id}`,
            sortMs: new Date(transaction.createdAt).getTime() || 0,
            transaction,
          }),
        ),
        ...(positions ?? []).map(
          (position): ActivityItem => ({
            kind: 'sandwich',
            id: `sandwich:${position.id}`,
            sortMs: new Date(position.createdAt).getTime() || 0,
            position,
          }),
        ),
      ].sort((a, b) => b.sortMs - a.sortMs),
    [positions, transactions],
  );

  const initialLoading = transactions === null || positions === null;

  return (
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}>
          <Ionicons name="chevron-back" size={25} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Activity</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accentBlue}
            onRefresh={() => {
              void Haptics.selectionAsync();
              void loadActivity(true);
            }}
          />
        }>

        {/* Nothing to show and the load failed: just the message, centred.
            A failed refresh over loaded rows keeps the rows. */}
        {error && (initialLoading || items.length === 0) ? (
          <LoadErrorState title="Couldn't load activity" onRetry={() => void loadActivity()} />
        ) : initialLoading ? (
          <View accessibilityLabel="Loading activity" style={styles.listCard}>
            {Array.from({ length: 6 }, (_, index) => (
              <View
                key={`activity-skeleton-${index}`}
                style={[styles.row, index < 5 && styles.rowDivider]}>
                <View style={styles.skeletonIcon} />
                <View style={styles.skeletonCopy}>
                  <View style={styles.skeletonPrimary} />
                  <View style={styles.skeletonSecondary} />
                </View>
                <View style={styles.skeletonAmount} />
              </View>
            ))}
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconShell}>
              <Ionicons name="receipt-outline" size={28} color={colors.icon} />
            </View>
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptyBody}>
              Deposits, withdrawals, buys, and sells will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            <AnimatedRows>
            {items.map((item, index) => (
              <View
                key={item.id}
                style={[styles.row, index < items.length - 1 && styles.rowDivider]}>
                {item.kind === 'sandwich' ? (
                  <SandwichActivityRow position={item.position} styles={styles} colors={colors} />
                ) : (
                  <TransactionActivityRow
                    transaction={item.transaction}
                    styles={styles}
                    colors={colors}
                  />
                )}
              </View>
            ))}
            </AnimatedRows>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

type ActivityStyles = ReturnType<typeof makeStyles>;

function SandwichActivityRow({
  position,
  styles,
  colors,
}: {
  position: SandwichPosition;
  styles: ActivityStyles;
  colors: ThemeColors;
}) {
  const investedUsd =
    position.investedUsd ??
    position.legs.reduce((sum, leg) => sum + (leg.investedUsd ?? 0), 0);
  const imageUri = position.legs.find((leg) => leg.imageUrl)?.imageUrl ?? null;
  const letter = (position.name || '?').slice(0, 1).toUpperCase();

  return (
    <>
      <AssetLogo
        uri={imageUri}
        size={40}
        borderRadius={20}
        backgroundColor={colors.surfaceAlt}
        fallback={
          <View style={styles.logoFallback}>
            <Text style={styles.logoFallbackText}>{letter}</Text>
          </View>
        }
      />
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          Bought {position.name}
        </Text>
        <Text style={styles.rowSubtitle}>Sandwich · {formatTransactionDate(position.createdAt)}</Text>
      </View>
      <Text style={styles.rowAmount}>
        −${investedUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </Text>
    </>
  );
}

function TransactionActivityRow({
  transaction,
  styles,
  colors,
}: {
  transaction: WalletTransactionRecord;
  styles: ActivityStyles;
  colors: ThemeColors;
}) {
  const kind = transaction.direction;
  const isTrade = kind === 'buy' || kind === 'sell';
  const isInflow = kind === 'deposit' || kind === 'sell';
  const sign = isInflow ? '+' : '−';
  const title =
    kind === 'deposit'
      ? 'Deposit'
      : kind === 'withdrawal'
        ? 'Withdrawal'
        : `${kind === 'buy' ? 'Buy' : 'Sell'}${transaction.symbol ? ` ${transaction.symbol}` : ''}`;
  const amount = isTrade
    ? `${sign}${formatUsdcDisplay(transaction.amount)}`
    : `${sign}${formatTransactionAmount(transaction.asset, transaction.amount)} ${formatTransactionAsset(transaction.asset)}`;
  const letter = (transaction.symbol ?? '?').slice(0, 1).toUpperCase();

  return (
    <>
      {isTrade ? (
        <AssetLogo
          uri={transaction.logoUrl}
          size={40}
          borderRadius={20}
          backgroundColor={colors.surfaceAlt}
          fallback={
            <View style={styles.logoFallback}>
              <Text style={styles.logoFallbackText}>{letter}</Text>
            </View>
          }
        />
      ) : (
        <View style={styles.movementIcon}>
          <Ionicons
            name={isInflow ? 'arrow-down' : 'arrow-up'}
            size={19}
            color={isInflow ? colors.positive : colors.negative}
          />
        </View>
      )}
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{formatTransactionDate(transaction.createdAt)}</Text>
      </View>
      <Text style={[styles.rowAmount, isInflow && styles.inflowAmount]}>{amount}</Text>
    </>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
    },
    headerButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 22,
    },
    headerButtonPressed: {
      backgroundColor: c.surfaceAlt,
    },
    headerTitle: {
      color: c.text,
      fontFamily: F,
      fontSize: 18,
      fontWeight: '800',
    },
    content: {
      flexGrow: 1,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 48,
    },
    listCard: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: 18,
      backgroundColor: c.surface,
    },
    row: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    rowTitle: {
      color: c.text,
      fontFamily: F,
      fontSize: 15,
      fontWeight: '800',
    },
    rowSubtitle: {
      color: c.textSecondary,
      fontFamily: F,
      fontSize: 12,
    },
    rowAmount: {
      maxWidth: 126,
      color: c.text,
      fontFamily: F,
      fontSize: 14,
      fontWeight: '800',
      textAlign: 'right',
    },
    inflowAmount: {
      color: c.positive,
    },
    movementIcon: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 20,
      backgroundColor: c.surfaceAlt,
    },
    logoFallback: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 20,
      backgroundColor: c.surfaceAlt,
    },
    logoFallbackText: {
      color: c.text,
      fontFamily: F,
      fontSize: 15,
      fontWeight: '900',
    },
    errorBanner: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 16,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.negative,
      borderRadius: 14,
      backgroundColor: c.surface,
    },
    errorText: {
      flex: 1,
      color: c.text,
      fontFamily: F,
      fontSize: 13,
      lineHeight: 18,
    },
    retryButton: {
      minWidth: 54,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
      backgroundColor: c.surfaceAlt,
    },
    retryButtonPressed: {
      backgroundColor: c.surfaceSelected,
    },
    retryText: {
      color: c.text,
      fontFamily: F,
      fontSize: 13,
      fontWeight: '800',
    },
    emptyState: {
      flex: 1,
      minHeight: 360,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 28,
    },
    emptyIconShell: {
      width: 56,
      height: 56,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
      borderRadius: 18,
      backgroundColor: c.surfaceAlt,
    },
    emptyTitle: {
      color: c.text,
      fontFamily: F,
      fontSize: 20,
      fontWeight: '900',
    },
    emptyBody: {
      maxWidth: 280,
      marginTop: 6,
      color: c.textSecondary,
      fontFamily: F,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
    skeletonIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surfaceAlt,
    },
    skeletonCopy: {
      flex: 1,
      gap: 8,
    },
    skeletonPrimary: {
      width: '62%',
      height: 12,
      borderRadius: 6,
      backgroundColor: c.surfaceAlt,
    },
    skeletonSecondary: {
      width: '42%',
      height: 9,
      borderRadius: 5,
      backgroundColor: c.surfaceAlt,
    },
    skeletonAmount: {
      width: 58,
      height: 12,
      borderRadius: 6,
      backgroundColor: c.surfaceAlt,
    },
  });
