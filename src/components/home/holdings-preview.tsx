import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AssetLogo } from '@/components/asset-logo';
import { PressableScale } from '@/components/pressable-scale';
import { SectionHeader } from '@/components/section-header';
import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';
import { computeUnrealizedPnl, type CostBasisLedger } from '@/lib/cost-basis';
import { selectHoldings } from '@/lib/holdings';
import { cleanStockName } from '@/lib/stock-name';
import type { WalletBalanceToken } from '@/lib/api';

const F = Fonts.rounded;
const PREVIEW_COUNT = 5;

type Props = {
  tokens: WalletBalanceToken[];
  costBasis: CostBasisLedger;
  /** Server-authoritative: false means the wallet's SOL row is swap rent, not a
   *  position the user bought. See lib/holdings.ts. */
  solTraded: boolean;
  loading: boolean;
  onSelect: (token: WalletBalanceToken) => void;
  onSeeAll: () => void;
  onExplore: () => void;
};

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function cleanSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (symbol.endsWith('X') && symbol.length > 4) return symbol.slice(0, -1);
  return symbol.replace(/ON$/i, '') || value;
}

export function HoldingsPreview({
  tokens,
  costBasis,
  solTraded,
  loading,
  onSelect,
  onSeeAll,
  onExplore,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  // Cash and un-traded SOL are not holdings — the same rule the Wallet tab and
  // the portfolio headline use, so the three can't disagree.
  const visible = useMemo(
    () => selectHoldings(tokens, { solTraded }),
    [tokens, solTraded],
  );

  return (
    <View style={styles.section}>
      <SectionHeader
        title="Your holdings"
        onSeeAll={visible.length > PREVIEW_COUNT ? onSeeAll : undefined}
      />

      {loading && visible.length === 0 ? (
        <View>
          {Array.from({ length: 4 }).map((_, index) => (
            <View key={index} accessibilityLabel="Loading holdings" style={styles.skeletonRow} />
          ))}
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Nothing in the pantry yet</Text>
          <Text style={styles.emptyBody}>Assets you buy will show up here.</Text>
          <PressableScale
            accessibilityRole="button"
            onPress={onExplore}
            style={styles.emptyActionButton}
          >
            <Text style={styles.emptyAction}>Explore sandwiches</Text>
          </PressableScale>
        </View>
      ) : (
        visible.slice(0, PREVIEW_COUNT).map((token, index) => {
          const rawName = token.name ?? token.symbol ?? 'Asset';
          const name = cleanStockName(rawName) || rawName;
          const symbol = cleanSymbol(token.symbol ?? '');
          const currentPrice =
            token.balance > 0 && token.usdValue !== null ? token.usdValue / token.balance : null;
          const pnl = computeUnrealizedPnl(
            token.mint ? costBasis[token.mint] : undefined,
            token.balance,
            currentPrice,
          );
          const movement = pnl?.pnlUsd ?? token.priceChange24h;
          const movementLabel = pnl
            ? `${pnl.pnlUsd >= 0 ? '+' : '-'}$${Math.abs(pnl.pnlUsd).toFixed(2)}`
            : token.priceChange24h !== null
              ? `${token.priceChange24h >= 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}%`
              : null;
          const openable = Boolean(token.symbol?.trim());

          return (
            <PressableScale
              key={`${token.mint ?? symbol}-${index}`}
              accessibilityRole="button"
              accessibilityLabel={`Open ${name}, ${formatUsd(token.usdValue ?? 0)}`}
              disabled={!openable}
              onPress={() => onSelect(token)}
              scaleTo={openable ? 0.985 : 1}
              style={styles.row}
            >
              <AssetLogo
                uri={token.icon}
                size={42}
                borderRadius={21}
                backgroundColor={colors.surfaceAlt}
                fallback={
                  <View style={styles.logoFallback}>
                    <Text style={styles.logoFallbackText}>{name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                }
              />
              <View style={styles.copy}>
                <Text style={styles.name} numberOfLines={1}>{name}</Text>
                {symbol ? <Text style={styles.symbol}>{symbol}</Text> : null}
              </View>
              <View style={styles.valueColumn}>
                <Text style={styles.value}>{formatUsd(token.usdValue ?? 0)}</Text>
                {movementLabel ? (
                  <Text
                    style={[
                      styles.movement,
                      { color: movement === null ? colors.textTertiary : movement >= 0 ? colors.positive : colors.negative },
                    ]}
                  >
                    {movementLabel}
                  </Text>
                ) : null}
              </View>
            </PressableScale>
          );
        })
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    section: {
      marginTop: 44,
    },
    row: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    logoFallback: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    logoFallbackText: {
      color: c.text,
      fontSize: 13,
      fontWeight: '900',
      fontFamily: F,
    },
    copy: {
      flex: 1,
      minWidth: 0,
    },
    name: {
      color: c.text,
      fontSize: 15,
      lineHeight: 19,
      fontWeight: '800',
      fontFamily: F,
    },
    symbol: {
      marginTop: 2,
      color: c.textTertiary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      fontFamily: F,
    },
    valueColumn: {
      alignItems: 'flex-end',
      gap: 2,
    },
    value: {
      color: c.text,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '800',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
    movement: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '800',
      fontFamily: Fonts.displayMedium,
      fontVariant: ['tabular-nums'],
    },
    skeletonRow: {
      height: 72,
      marginBottom: 1,
      borderRadius: Radius.md,
      backgroundColor: c.surfaceAlt,
    },
    emptyCard: {
      minHeight: 136,
      borderRadius: Radius.xl,
      backgroundColor: c.surfaceAlt,
      padding: 18,
      justifyContent: 'center',
      alignItems: 'flex-start',
    },
    emptyTitle: {
      color: c.text,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '800',
      fontFamily: F,
    },
    emptyBody: {
      marginTop: 4,
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
      fontFamily: F,
    },
    emptyActionButton: {
      minHeight: 44,
      justifyContent: 'center',
    },
    emptyAction: {
      color: c.actionPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
      fontFamily: F,
    },
  });
