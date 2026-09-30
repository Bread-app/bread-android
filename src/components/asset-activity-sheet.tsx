import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import React, {
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { AssetLogo } from '@/components/asset-logo';
import { BlurBackdrop } from '@/components/blur-backdrop';
import { Fonts, Motion, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { getClosedPositions, type ClosedPosition } from '@/lib/api';
import { useThemeStore } from '@/lib/theme-store';

const F = Fonts.rounded;

/** One page is plenty: the drawer is a recent-history glance, not the ledger. */
const FETCH_LIMIT = 100;

export type AssetActivitySheetRef = {
  /** Opens the drawer and refetches. Call straight from the tap gesture. */
  open: () => void;
  close: () => void;
};

export type AssetActivitySheetProps = {
  /** The asset whose closed trades this drawer lists. Matched case-insensitively. */
  symbol: string;
  /** Mint is the strongest identity when the closed row provides it. */
  mint?: string | null;
  /** Display name for the drawer header; falls back to the symbol. */
  name?: string | null;
  /** Used on each closed-trade row when the history record has no logo. */
  logoUrl?: string | null;
};

/**
 * Closed trades OF one asset, newest first, with the realized result of each.
 *
 * Deliberately scoped to *this* asset. The full Activity screen already answers
 * "what have I been doing"; the question worth answering on a stock page is the
 * narrower "how have my closed trades done here?". So: spot round trips in the
 * asset and standalone perps on it. A Sandwich that held the asset is not one
 * of its trades — that result is the Sandwich's, shown on the Sandwich.
 *
 * A close whose cost was never recorded (tokens that arrived by transfer) is
 * still listed — the sale happened — with its result shown as unknown rather
 * than dropped or faked as a zero.
 */
export const AssetActivitySheet = React.forwardRef<
  AssetActivitySheetRef,
  AssetActivitySheetProps
>(function AssetActivitySheet({ symbol, mint, name, logoUrl }, ref) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const { height } = useWindowDimensions();
  const sheetRef = useRef<BottomSheetModal>(null);

  const [rows, setRows] = useState<ClosedPosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const page = await getClosedPositions({
        limit: FETCH_LIMIT,
        asset: { mint: mint ?? null, symbol },
      });
      // The server already filtered; this re-check keeps an older backend that
      // ignores the filter from filling the drawer with other assets.
      const wanted = normalizeTicker(symbol);
      setRows(
        page.positions.filter(
          (position) =>
            (position.kind === 'token' || position.kind === 'phoenix_perp') &&
            ((position.kind === 'token' && mint != null && position.mint === mint) ||
              (wanted.length > 0 &&
                position.symbols.some((entry) => normalizeTicker(entry) === wanted))),
        ),
      );
    } catch {
      // Keep whatever was already on screen — a failed refresh should not
      // replace real history with an empty state.
      setRows((current) => current ?? []);
      setError("Couldn't load closed trades. Try again.");
    }
  }, [mint, symbol]);

  useImperativeHandle(
    ref,
    () => ({
      open() {
        // Presented straight from the tap gesture, matching the other sheets:
        // an isOpen effect drops the first open.
        sheetRef.current?.present();
        void load();
      },
      close() {
        sheetRef.current?.dismiss();
      },
    }),
    [load],
  );

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => <BlurBackdrop {...props} />,
    [],
  );
  const snapPoints = useMemo(() => ['70%'], []);

  const title = name?.trim() || symbol;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBg}
    >
      <BottomSheetScrollView
        style={{ height: height * 0.7 }}
        contentContainerStyle={styles.sheetContent}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Closed trades
            </Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {title}
            </Text>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {rows && rows.length > 0 ? (
          <ClosedTradesSummary rows={rows} styles={styles} colors={colors} />
        ) : null}

        {rows === null ? (
          <View style={styles.centered}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="receipt-outline" size={26} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>No closed trades yet</Text>
            <Text style={styles.emptyBody}>
              Trades you close in {symbol} show up here. Sandwiches that hold{' '}
              {symbol} report on the Sandwich.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {rows.map((position, i) => (
              <Animated.View
                key={position.id}
                // Staggered only for the first handful — past that the delay
                // outruns the user's patience and the list reads as sluggish.
                entering={FadeInDown.duration(Motion.duration.fast).delay(
                  Math.min(i, 6) * 24,
                )}
                style={styles.row}
              >
                <ClosedTradeRow
                  position={position}
                  symbol={symbol}
                  fallbackLogoUrl={logoUrl}
                  styles={styles}
                  colors={colors}
                />
              </Animated.View>
            ))}
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

type SheetStyles = ReturnType<typeof makeStyles>;

function formatRealizedPnl(value: number): string {
  if (Math.abs(value) < 0.005) return '$0.00';
  const amount = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value > 0 ? '+' : '−'}$${amount}`;
}

function formatClosedTradeDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "ZECx" / "ZEC-PERP" / "zec" → "ZEC", matching the server's asset filter. */
function normalizeTicker(value: string): string {
  const base = value.trim().toUpperCase().replace(/-PERP$/, '');
  const stripped = base.replace(/(X|ON)$/, '');
  return stripped.length >= 2 ? stripped : base;
}

function formatUsd(value: number): string {
  return `$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "3d", "5h", "12m" — how long the position was open. */
function formatHeldFor(openedAt: string | null, closedAt: string): string | null {
  if (!openedAt) return null;
  const ms = new Date(closedAt).getTime() - new Date(openedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * The asset's track record in one line: total realized, and how many of the
 * closes made money. Totals only what is knowable, and says so when a close
 * had no recorded cost, rather than counting it as break-even.
 */
function ClosedTradesSummary({
  rows,
  styles,
  colors,
}: {
  rows: ClosedPosition[];
  styles: SheetStyles;
  colors: ThemeColors;
}) {
  const known = rows.filter(
    (row): row is ClosedPosition & { realizedPnlUsd: number } => row.realizedPnlUsd !== null,
  );
  const total = known.reduce((sum, row) => sum + row.realizedPnlUsd, 0);
  const wins = known.filter((row) => row.realizedPnlUsd > 0.005).length;
  const unknown = rows.length - known.length;
  const flat = Math.abs(total) < 0.005;
  const color =
    known.length === 0 || flat ? colors.textTertiary : total > 0 ? colors.positive : colors.negative;

  return (
    <View style={styles.summary}>
      <View style={styles.summaryCell}>
        <Text style={styles.summaryLabel}>Realized P&L</Text>
        <Text style={[styles.summaryValue, { color }]}>
          {known.length === 0 ? '—' : formatRealizedPnl(total)}
        </Text>
      </View>
      <View style={[styles.summaryCell, styles.summaryCellRight]}>
        <Text style={styles.summaryLabel}>
          {rows.length === 1 ? '1 trade' : `${rows.length} trades`}
        </Text>
        <Text style={styles.summaryValue}>
          {known.length === 0 ? '—' : `${wins}/${known.length} won`}
        </Text>
        {unknown > 0 ? (
          <Text style={styles.summaryNote}>
            {unknown === 1 ? '1 without cost basis' : `${unknown} without cost basis`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ClosedTradeRow({
  position,
  symbol,
  fallbackLogoUrl,
  styles,
  colors,
}: {
  position: ClosedPosition;
  symbol: string;
  fallbackLogoUrl?: string | null;
  styles: SheetStyles;
  colors: ThemeColors;
}) {
  const pnl = position.realizedPnlUsd;
  const flat = pnl !== null && Math.abs(pnl) < 0.005;
  const pnlColor = pnl === null || flat
    ? colors.textTertiary
    : pnl > 0
      ? colors.positive
      : colors.negative;
  const pct = position.realizedPnlPct;
  const pctLabel =
    pct === null
      ? null
      : `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct * 100).toFixed(2)}%`;
  const initial = (symbol || '?').slice(0, 1).toUpperCase();
  const isPerp = position.kind === 'phoenix_perp';

  const title = isPerp
    ? `${position.subtitle ?? 'Perp'}${
        position.leverage ? ` ${Number(position.leverage.toFixed(1))}x` : ''
      } closed`
    : 'Sold';
  const heldFor = formatHeldFor(position.openedAt, position.closedAt);
  const when = [formatClosedTradeDateTime(position.closedAt), heldFor ? `held ${heldFor}` : null]
    .filter(Boolean)
    .join(' · ');
  // Cost → proceeds says what the result was made of. A perp's cost is its
  // margin, which is what the return is measured against.
  const flow =
    position.costUsd !== null && position.proceedsUsd !== null
      ? `${formatUsd(position.costUsd)} → ${formatUsd(position.proceedsUsd)}`
      : position.proceedsUsd !== null && !isPerp
        ? `Sold for ${formatUsd(position.proceedsUsd)}`
        : null;

  return (
    <>
      <AssetLogo
        uri={position.logoUri ?? fallbackLogoUrl ?? null}
        size={36}
        borderRadius={18}
        backgroundColor={colors.surfaceAlt}
        fallback={
          <View style={styles.logoFallback}>
            <Text style={styles.logoFallbackText}>{initial}</Text>
          </View>
        }
      />
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {when}
        </Text>
        {flow ? (
          <Text style={styles.rowFlow} numberOfLines={1}>
            {flow}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowResult}>
        <Text style={[styles.rowAmount, { color: pnlColor }]}>
          {pnl !== null ? formatRealizedPnl(pnl) : '—'}
        </Text>
        {pctLabel ? (
          <Text style={[styles.rowPnlPct, { color: pnlColor }]}>{pctLabel}</Text>
        ) : pnl === null ? (
          <Text style={styles.rowPnlPct}>Cost unknown</Text>
        ) : null}
      </View>
    </>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    handleIndicator: { backgroundColor: c.textQuaternary },
    sheetBg: {
      backgroundColor: c.background,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
    },
    sheetContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 36 },

    header: {
      paddingBottom: 14,
    },
    headerCopy: { flex: 1 },
    headerTitle: {
      color: c.text,
      fontFamily: F,
      fontSize: 18,
      fontWeight: '800',
    },
    headerSubtitle: {
      color: c.textTertiary,
      fontFamily: F,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 1,
    },
    logoFallback: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoFallbackText: {
      color: c.textSecondary,
      fontFamily: F,
      fontSize: 14,
      fontWeight: '800',
    },

    error: {
      color: c.negative,
      fontFamily: F,
      fontSize: 12,
      fontWeight: '600',
      paddingBottom: 10,
    },

    centered: { alignItems: 'center', justifyContent: 'center', paddingTop: 64, gap: 6 },
    emptyTitle: {
      color: c.text,
      fontFamily: F,
      fontSize: 15,
      fontWeight: '800',
      marginTop: 4,
    },
    emptyBody: {
      color: c.textTertiary,
      fontFamily: F,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },

    summary: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 14,
      paddingHorizontal: 16,
      marginBottom: 8,
      borderRadius: 18,
      backgroundColor: c.surfaceAlt,
    },
    summaryCell: { flex: 1 },
    summaryCellRight: { alignItems: 'flex-end' },
    summaryLabel: {
      color: c.textTertiary,
      fontFamily: F,
      fontSize: 12,
      fontWeight: '600',
    },
    summaryValue: {
      color: c.text,
      fontFamily: F,
      fontSize: 18,
      fontWeight: '800',
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },
    summaryNote: {
      color: c.textTertiary,
      fontFamily: F,
      fontSize: 11,
      fontWeight: '600',
      marginTop: 2,
    },

    list: { gap: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 11,
    },
    rowCopy: { flex: 1 },
    rowTitle: {
      color: c.text,
      fontFamily: F,
      fontSize: 15,
      fontWeight: '700',
    },
    rowSubtitle: {
      color: c.textTertiary,
      fontFamily: F,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 1,
    },
    rowFlow: {
      color: c.textSecondary,
      fontFamily: F,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },
    rowAmount: {
      fontFamily: F,
      fontSize: 15,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    rowResult: {
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    rowPnlPct: {
      color: c.textTertiary,
      marginTop: 1,
      fontFamily: F,
      fontSize: 12,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
  });
