import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AssetLogo } from '@/components/asset-logo';
import { SandwichAvatarStack } from '@/components/sandwich-avatar-stack';
import { symbolLogoSources } from '@/lib/stock-logos';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';
import type { ClosedPosition } from '@/lib/api';
import { formatClosedPositionDate } from '@/lib/closed-position-date';
import { lifetimePnlCopy } from '@/lib/closed-position-lifetime';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

/**
 * How a position left. Only shown when it says something the row does not
 * already: a deliberate exit is the default and needs no chip, while a
 * liquidation or a stop is the whole story of the trade.
 */
const REASON_LABELS: Record<string, string> = {
  liquidation: 'Liquidated',
  stop_loss: 'Stopped out',
  take_profit: 'Take profit',
  horizon: 'Horizon',
};

/** A post's words on one line: link shorteners and line breaks dropped. */
function oneLine(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/https?:\/\/t\.co\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  return `${value < 0 ? '-' : ''}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * One settled position.
 *
 * The right-hand column is the realized result in dollars over the same result
 * as a percentage of what was risked — the two figures answer different
 * questions ("how much did I make" and "was it a good trade") and a row that
 * shows only one of them invites the wrong comparison between a $5 position and
 * a $500 one.
 *
 * A null result renders as `--` in the neutral colour. It means the basis could
 * not be recovered, NOT that the trade broke even, and colouring or zeroing it
 * would state something the data does not support.
 */
export function ClosedPositionRow({
  position,
  onPress,
}: {
  position: ClosedPosition;
  onPress?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();

  const pnl = position.realizedPnlUsd;
  const known = pnl !== null;
  // A result that rounds away to nothing is FLAT, not a loss. Without this a
  // fee-sized negative printed as a red "-$0.00" — a sign and a colour making a
  // claim the number itself does not support. Real closed trades hit this
  // constantly, because most of them are small.
  const flat = known && Math.abs(pnl) < 0.005;
  const pnlColor =
    !known || flat
      ? colors.textTertiary
      : pnl > 0
        ? colors.positive
        : colors.negative;
  const pnlLabel = !known ? '--' : flat ? '$0.00' : `${pnl > 0 ? '+' : ''}${formatUsd(pnl)}`;
  const pct = position.realizedPnlPct;
  const pctFlat = pct !== null && Math.abs(pct) < 0.00005;
  const pctLabel = pct === null ? null : `${Math.abs(pct * 100).toFixed(2)}%`;
  const pctArrow = pctFlat || pct === null ? null : pct > 0 ? '▲' : '▼';
  const pctArrowColor =
    pct === null || pctFlat
      ? colors.textTertiary
      : pct > 0
        ? colors.positive
        : colors.negative;

  const reasonLabel = position.reason ? REASON_LABELS[position.reason] : undefined;
  const leverageLabel = position.leverage ? `${position.leverage.toFixed(0)}x` : null;
  const fallbackInitial = (position.symbols[0] ?? position.title).slice(0, 1).toUpperCase();
  const legIcon = position.sandwich?.legIcons.find((icon): icon is string => Boolean(icon)) ?? null;
  // A settled perp carries no artwork of its own: `PhoenixCloseRecord` stores a
  // ticker, and the close route has no market metadata to join onto it. The open
  // row solves this with `perpLogoSources`, and the closed row must too —
  // otherwise the same position that wore NVDA's face all week becomes an "N"
  // tile the moment it is closed.
  const isPerp = position.kind === 'phoenix_perp' || position.kind === 'sandwich_perp';
  const derived =
    isPerp && !position.logoUri && !legIcon && position.symbols[0]
      ? symbolLogoSources(position.symbols[0])
      : null;
  // Show the rollup once, on the newest close. Older episode rows remain in
  // history but do not repeat the same all-time number down the list.
  const lifetime = lifetimePnlCopy(
    position.lifetime?.latestCloseId === position.id ? position.lifetime : null,
  );
  const lifetimeColor =
    lifetime === null || Math.abs(lifetime.pnlUsd) < 0.005
      ? colors.textTertiary
      : lifetime.pnlUsd > 0
        ? colors.positive
        : colors.negative;

  // A sandwich reads as its thesis: who called it (the cited author, else the
  // Bread builder) as the avatar, the call itself as the title.
  const thesis = position.sandwich;
  const authorHandle = thesis?.authorHandle?.trim().replace(/^@+/, '') || null;
  const builderHandle =
    (thesis?.builderUsername ?? thesis?.builderName)?.trim().replace(/^@+/, '') || null;
  const byline = authorHandle
    ? `@${authorHandle}`
    : thesis?.authorName?.trim() || (builderHandle ? `@${builderHandle}` : null);
  const avatarUri = thesis
    ? (thesis.authorAvatarUrl ?? thesis.builderAvatarUrl ?? null)
    : null;
  const bylineInitial = (byline ?? position.title).replace(/^@/, '').slice(0, 1).toUpperCase();
  const legCount = thesis
    ? Math.max(thesis.legIcons.length, position.symbols.length)
    : 0;
  // Leads with the call itself, as the feed card words it, not the basket name.
  const title = thesis
    ? oneLine(thesis.thesisText) || thesis.headline?.trim() || thesis.summary?.trim() || position.title
    : position.title;

  // The line under the title: who, what closed and when, plus anything unusual
  // about how it ended.
  // A thesis row stays two lines — the call, then when it closed — so the list
  // scans; the rest lives on the detail screen it opens.
  const meta = (thesis
    ? [formatClosedPositionDate(position.closedAt)]
    : [formatClosedPositionDate(position.closedAt), leverageLabel, reasonLabel, position.subtitle])
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <PressableScale
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`${position.title}, closed, ${
        known ? pnlLabel : 'result unknown'
      }`}
      onPress={onPress}
    >
      {thesis ? (
        // The basket's tokens are the face of the row, side by side and
        // colliding — both for a pair, the first and a "+N" beyond that — and
        // the source who made the call rides on the bottom-right.
        <SandwichAvatarStack
          legs={[0, 1]
            .filter((index) => index === 0 || (thesis.legIcons[index] ?? position.symbols[index]))
            .map((index) => ({
              // Each circle wears its own leg's icon so the pair never shows one
              // logo twice; a missing one is looked up by ticker instead.
              iconUri: thesis.legIcons[index] ?? (index === 0 && !position.symbols[0] ? legIcon : null),
              symbol: position.symbols[index] ?? null,
              initial: index === 0
                ? fallbackInitial
                : (position.symbols[index] ?? '?').slice(0, 1).toUpperCase(),
            }))}
          legCount={legCount}
          creatorAvatarUri={avatarUri}
          creatorInitial={avatarUri || byline ? bylineInitial : null}
        />
      ) : (
        <AssetLogo
          // A sandwich has no cover image of its own, so its first leg stands in
          // rather than a letter tile — the row is recognisable as the basket it
          // was, on the profiles that draw settled sandwiches as compact lines.
          uri={position.logoUri ?? legIcon ?? derived?.uri ?? null}
          fallbackUris={derived?.fallbackUris}
          size={40}
          borderRadius={20}
          backgroundColor={colors.surfaceAlt}
          fallback={
            <View style={styles.logoFallback}>
              <Text style={styles.logoFallbackText}>{fallbackInitial}</Text>
            </View>
          }
        />
      )}
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {lifetime && !thesis ? (
          <Text style={styles.lifetime} numberOfLines={1}>
            {lifetime.label} <Text style={{ color: lifetimeColor }}>{lifetime.value}</Text>
          </Text>
        ) : null}
      </View>
      <View style={styles.valueColumn}>
        <Text style={[styles.value, { color: pnlColor }]} numberOfLines={1}>
          {pnlLabel}
        </Text>
        {pctLabel !== null ? (
          <Text style={styles.pct} numberOfLines={1}>
            {pctArrow ? <Text style={{ color: pctArrowColor }}>{pctArrow} </Text> : null}
            {pctLabel}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

// Matches the open Holdings rows exactly — same 40pt logo, same 12pt rhythm, same
// right-aligned value column. The toggle changes what the list contains, not how
// a holding reads.
const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
    },
    logoFallback: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoFallbackText: {
      color: c.textSecondary,
      fontSize: 15,
      fontWeight: '800',
      fontFamily: F,
    },
    textWrap: {
      flex: 1,
    },

    title: {
      color: c.text,
      fontSize: 15,
      fontWeight: '800',
      fontFamily: F,
    },
    meta: {
      color: c.textTertiary,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
      fontFamily: F,
    },
    lifetime: {
      color: c.textTertiary,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: '700',
      marginTop: 2,
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
    valueColumn: {
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: 1,
    },
    value: {
      fontSize: 20,
      lineHeight: 25,
      fontWeight: '700',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    pct: {
      color: c.textSecondary,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '700',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
  });
