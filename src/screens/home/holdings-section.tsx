import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AssetLogo } from '@/components/asset-logo';
import { PressableScale } from '@/components/pressable-scale';
import { SectionHeader } from '@/components/section-header';
import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { withAlpha } from '@/lib/color-utils';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';
import { computeUnrealizedPnl } from '@/lib/cost-basis';
import { formatPnlPercentage, pnlPercentageFromBasis } from '@/lib/pnl-percentage';
import { hasLivePerpSandwichExposure } from '@/lib/perp-sandwich-visibility';
import { formatTimestamp } from '@/lib/perp-sandwich-display';
import type { PerpSandwichPosition, WalletBalanceToken } from '@/lib/api';
import type { CostBasisLedger } from '@/lib/cost-basis';
import type { PhoenixPosition } from '@/lib/phoenix-api';
import { equityLogoFallbackUris, perpLogoSources } from '@/lib/stock-logos';

const F = Fonts.rounded;

/**
 * Home previews the largest holdings only; "See all" hands off to the Wallet
 * tab. Without a cap an active account pushes discovery far below the fold.
 */
export const HOLDINGS_PREVIEW_COUNT = 6;

type Props = {
  holdings: WalletBalanceToken[];
  phoenixPositions: PhoenixPosition[];
  perpSandwichPositions: PerpSandwichPosition[];
  costBasis: CostBasisLedger;
  loading: boolean;
  formatUsd: (value: number) => string;
  holdingName: (token: WalletBalanceToken) => string;
  cleanSymbol: (symbol: string) => string;
  onSelect: (token: WalletBalanceToken) => void;
  /**
   * Open the position's detail sheet.
   *
   * Distinct from `onPerpAction` on purpose: the row used to BE the close
   * button, which put an irreversible action under an ordinary list tap. Closing
   * now lives behind the sheet's explicit CLOSE control.
   */
  onPerpSelect: (position: PerpSandwichPosition) => void;
  onPerpAction: (position: PerpSandwichPosition) => void;
  perpActionId: string | null;
  onSeeAll: () => void;
};

/** Flat, hairline-separated holdings list — content, so no glass. */
export function HoldingsSection({
  holdings,
  phoenixPositions,
  perpSandwichPositions,
  costBasis,
  loading,
  formatUsd,
  holdingName,
  cleanSymbol,
  onSelect,
  onPerpSelect,
  onPerpAction,
  perpActionId,
  onSeeAll,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const visiblePhoenixPositions = phoenixPositions.filter(
    (position) => Math.abs(position.positionSize) > 0 && Math.abs(position.positionValue) >= 0.01,
  );
  // Only positions holding real collateral belong in Holdings. Exchange-side
  // exits (`stopped_out`, `liquidated`) no longer exist and must not sit here
  // looking live with a disabled row and no explanation — the user is told by
  // the `perp_position_exited` notification instead — and unsigned quote
  // paperwork (`building`, `*_awaiting_signature`, …) never opened at all.
  const visiblePerpSandwiches = perpSandwichPositions.filter(hasLivePerpSandwichExposure);
  const holdingCount = holdings.length + visiblePhoenixPositions.length + visiblePerpSandwiches.length;
  const remainingAfterSandwiches = Math.max(0, HOLDINGS_PREVIEW_COUNT - visiblePerpSandwiches.length);
  const standalonePhoenixPreview = visiblePhoenixPositions.slice(0, remainingAfterSandwiches);
  const spotPreviewCount = Math.max(0, remainingAfterSandwiches - standalonePhoenixPreview.length);

  return (
    <View style={styles.section}>
      <SectionHeader
        title="Holdings"
        onSeeAll={holdingCount > HOLDINGS_PREVIEW_COUNT ? onSeeAll : undefined}
      />
      {loading ? (
        <View accessibilityLabel="Loading holdings" style={styles.skeleton}>
          {Array.from({ length: 4 }).map((_, index) => (
            <View key={index} style={styles.skeletonRow}>
              <View style={styles.skeletonIcon} />
              <View style={styles.skeletonCopy}>
                <View style={styles.skeletonTitle} />
                <View style={styles.skeletonSubtitle} />
              </View>
              <View style={styles.skeletonValue} />
            </View>
          ))}
        </View>
      ) : holdingCount === 0 ? (
        <View style={styles.stateCard}>
          <Ionicons name="layers-outline" size={34} color={colors.iconMuted} />
          <Text style={styles.stateTitle}>No holdings yet</Text>
          <Text style={styles.stateBody}>Assets you buy will appear here.</Text>
        </View>
      ) : (
        <>
          {visiblePerpSandwiches.slice(0, HOLDINGS_PREVIEW_COUNT).map((position) => {
            const pnlPositive = position.pnlAfterFundingUsd >= 0;
            const pnlPctLabel = formatPnlPercentage(
              pnlPercentageFromBasis(position.pnlAfterFundingUsd, position.marginUsdc),
            );
            const value = position.effectiveCollateralUsd ??
              ((position.marginUsdc ?? 0) + position.pnlAfterFundingUsd);
            const leg = position.legs[0];
            const side = leg?.side === 'short' ? 'Short' : 'Long';
            // The speaker's actual claim, not the generated Sandwich label.
            const title = position.sandwich.headline?.trim() || position.sandwich.name;
            const timestamp = formatTimestamp(leg?.startMs ?? position.sandwich.source.startMs);
            const leverageLabel = position.leverage ? `${position.leverage}x` : null;
            // A closed legacy position still has collateral to move, and there
            // is no detail worth opening for it — that one keeps its direct
            // action. Everything else opens the sheet.
            const legacyMove = position.actionableStatus === 'move_collateral';
            return (
              <PressableScale
                key={`perp-sandwich:${position.id}`}
                style={styles.row}
                disabled={perpActionId !== null}
                onPress={() => (legacyMove ? onPerpAction(position) : onPerpSelect(position))}
                accessibilityRole="button"
                accessibilityLabel={
                  legacyMove
                    ? `Move collateral for ${title}`
                    : `${title}, ${side}${leverageLabel ? ` ${leverageLabel}` : ''}`
                }
              >
                <AssetLogo
                  uri={null}
                  fallbackUris={equityLogoFallbackUris(leg?.symbol ?? '')}
                  size={40}
                  borderRadius={20}
                  backgroundColor="transparent"
                  fallback={
                    <View style={styles.iconFallback}>
                      <Ionicons name="trending-down" size={20} color={colors.text} />
                    </View>
                  }
                />
                <View style={styles.copy}>
                  <View style={styles.positionNameRow}>
                    <Text style={[styles.name, styles.positionName]} numberOfLines={1}>
                      {title}
                    </Text>
                    <View
                      style={[
                        styles.positionSideBadge,
                        side === 'Short' ? styles.shortBadge : styles.perpBadge,
                      ]}
                    >
                      <Text style={[styles.positionSideBadgeText, styles.perpBadgeText]}>
                        {side.toUpperCase()}
                        {leverageLabel ? ` ${leverageLabel}` : ''}
                      </Text>
                    </View>
                  </View>
                  {/* Asset, leverage, and where in the episode the call was
                      made. The timestamp is dropped rather than faked when the
                      source has no timeline. */}
                  <Text style={styles.symbol} numberOfLines={1}>
                    {[leg?.symbol, timestamp].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={styles.valueColumn}>
                  <Text style={styles.value}>{formatUsd(value)}</Text>
                  {pnlPctLabel ? (
                    <Text style={[styles.positionPnl, { color: pnlPositive ? colors.positive : colors.negative }]}>
                      {pnlPctLabel}
                    </Text>
                  ) : null}
                  {legacyMove ? (
                    <Text style={styles.perpActionLabel}>
                      {perpActionId === position.id ? 'Working…' : 'Withdraw all'}
                    </Text>
                  ) : null}
                </View>
              </PressableScale>
            );
          })}
          {standalonePhoenixPreview.map((position) => {
            const symbol = position.symbol.toUpperCase();
            const name = position.name?.trim() || (symbol === 'AAPL' ? 'Apple' : symbol);
            const side = position.positionSize < 0 ? 'Short' : 'Long';
            const sideLabel = `${side.toUpperCase()}${position.leverage ? ` ${position.leverage}x` : ''}`;
            const pnlPositive = position.unrealizedPnl >= 0;
            const entryNotional = Math.abs(position.positionSize * position.entryPrice);
            const pnlBasis = (position.marginUsd ?? 0) > 0
              ? position.marginUsd
              : entryNotional;
            const pnlPctLabel = formatPnlPercentage(
              pnlPercentageFromBasis(
                position.unrealizedPnl,
                pnlBasis,
              ),
            );
            const currentPositionValue =
              position.marginUsd === null || position.marginUsd === undefined
                ? null
                : position.marginUsd + position.unrealizedPnl;
            return (
              <View key={`phoenix:${symbol}`} style={styles.row}>
                <AssetLogo
                  {...perpLogoSources(position)}
                  size={44}
                  borderRadius={22}
                  backgroundColor={colors.surfaceAlt}
                  fallback={
                    <View style={styles.iconFallback}>
                      <Text style={styles.iconFallbackText}>{name.slice(0, 1)}</Text>
                    </View>
                  }
                />
                <View style={styles.copy}>
                  <View style={styles.positionNameRow}>
                    <Text style={[styles.name, styles.positionName]} numberOfLines={1}>{name}</Text>
                    <View
                      style={[
                        styles.positionSideBadge,
                        side === 'Long' ? styles.positionLongBadge : styles.positionShortBadge,
                      ]}
                    >
                      <Text
                        style={[
                          styles.positionSideBadgeText,
                          { color: side === 'Long' ? colors.positive : colors.negative },
                        ]}
                      >
                        {sideLabel}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.valueColumn}>
                  <Text style={styles.value}>
                    {currentPositionValue === null ? '—' : formatUsd(currentPositionValue)}
                  </Text>
                  {pnlPctLabel ? (
                    <Text
                      style={[
                        styles.positionPnl,
                        { color: pnlPositive ? colors.positive : colors.negative },
                      ]}
                    >
                      {pnlPctLabel}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
          {holdings.slice(0, spotPreviewCount).map((token, index) => {
          const name = holdingName(token);
          const symbol = cleanSymbol(token.symbol ?? '');
          const costEntry = token.mint ? costBasis[token.mint] : undefined;
          const currentPrice =
            token.balance > 0 && token.usdValue !== null
              ? token.usdValue / token.balance
              : null;
          const pnl = computeUnrealizedPnl(costEntry, token.balance, currentPrice);
          const detailValue = pnl?.pnlPct ?? null;
          const detailLabel = formatPnlPercentage(detailValue);
          const detailColor =
            detailValue === null || detailValue === undefined
              ? colors.textTertiary
              : detailValue >= 0
                ? colors.positive
                : colors.negative;
          const openable = Boolean(token.symbol?.trim());

            return (
            <PressableScale
              key={`${token.mint ?? symbol}-${index}`}
              accessibilityRole="button"
              accessibilityLabel={`Open ${name} holding`}
              disabled={!openable}
              scaleTo={openable ? 0.97 : 1}
              onPress={() => {
                if (!openable) return;
                void Haptics.selectionAsync();
                onSelect(token);
              }}
              style={styles.row}
            >
              <AssetLogo
                uri={token.icon}
                size={44}
                borderRadius={22}
                backgroundColor={colors.surfaceAlt}
                fallback={
                  <View style={styles.iconFallback}>
                    <Text style={styles.iconFallbackText}>
                      {name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                }
              />
              <View style={styles.copy}>
                <Text style={styles.name} numberOfLines={1}>
                  {name}
                </Text>
                {symbol ? (
                  <Text style={styles.symbol} numberOfLines={1}>
                    {symbol}
                  </Text>
                ) : null}
              </View>
              <View style={styles.valueColumn}>
                <Text style={styles.value}>{formatUsd(token.usdValue ?? 0)}</Text>
                {detailLabel ? (
                  <Text style={[styles.change, { color: detailColor }]}>{detailLabel}</Text>
                ) : null}
              </View>
            </PressableScale>
            );
          })}
        </>
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
    iconFallback: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    iconFallbackText: {
      color: c.text,
      fontSize: 14,
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
      lineHeight: 20,
      fontWeight: '800',
      fontFamily: F,
    },
    positionNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minWidth: 0,
    },
    positionName: {
      flexShrink: 1,
    },
    positionSideBadge: {
      borderRadius: 5,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    positionLongBadge: {
      backgroundColor: withAlpha(c.positive, 0.16),
    },
    positionShortBadge: {
      backgroundColor: withAlpha(c.negative, 0.14),
    },
    perpBadge: { backgroundColor: '#7c3aed' },
    // Shorts get their own colour: direction is the single most important fact
    // about a perp row, and it should be readable without parsing the subtitle.
    shortBadge: { backgroundColor: c.negative },
    perpBadgeText: { color: '#ffffff' },
    perpActionLabel: {
      color: c.actionPrimary,
      fontSize: 10,
      fontWeight: '800',
      fontFamily: F,
      marginTop: 2,
    },
    positionSideBadgeText: {
      fontSize: 10,
      fontWeight: '900',
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
    positionPnl: {
      fontSize: 13,
      fontWeight: '700',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
    valueColumn: {
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: 2,
    },
    value: {
      color: c.text,
      fontSize: 16,
      lineHeight: 20,
      fontWeight: '800',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
    change: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '800',
      fontFamily: Fonts.displayMedium,
      fontVariant: ['tabular-nums'],
    },
    skeleton: {
      gap: 2,
    },
    skeletonRow: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    skeletonIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.surfaceAlt,
    },
    skeletonCopy: {
      flex: 1,
      gap: 7,
    },
    skeletonTitle: {
      width: 104,
      height: 15,
      borderRadius: 6,
      backgroundColor: c.surfaceAlt,
    },
    skeletonSubtitle: {
      width: 54,
      height: 10,
      borderRadius: 5,
      backgroundColor: c.surfaceAlt,
    },
    skeletonValue: {
      width: 72,
      height: 16,
      borderRadius: 6,
      backgroundColor: c.surfaceAlt,
    },
    stateCard: {
      minHeight: 190,
      borderRadius: Radius.xl,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: 24,
      paddingVertical: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stateTitle: {
      marginTop: 12,
      color: c.text,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: '800',
      fontFamily: F,
      textAlign: 'center',
    },
    stateBody: {
      marginTop: 5,
      maxWidth: 260,
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
      fontFamily: F,
      textAlign: 'center',
    },
  });
