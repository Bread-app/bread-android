import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Fonts, type ThemeColors } from '@/constants/theme';
import type { TradeQuotePreview } from '@/lib/api';
import { useThemeStore } from '@/lib/theme-store';

/**
 * Estimated USD value the user receives from the live quote.
 *
 * The stock quantity remains available in the Details panel, but the primary
 * dialpad stays focused on the outcome users compare with the amount entered.
 * For buys this independently values the quoted shares at the screen's market
 * price; for sells the venue already quotes the proceeds in USDC.
 *
 * When nothing will fill this renders NOTHING: the reason (most often "the US
 * market is shut", the honest answer for Ondo prestocks whose only liquidity is
 * RFQ makers keeping equity hours) belongs in the dialpad's notice banner down
 * by the confirm button, where the user is looking when the button won't arm.
 */

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  })}`;
}

export function TradeQuotePreviewRow({
  preview,
  loading,
  unitPriceUsd,
}: {
  preview: TradeQuotePreview | null;
  loading: boolean;
  /** Market price per share, used to value the quantity received. */
  unitPriceUsd?: number | null;
}) {
  const { colors } = useThemeStore();
  const styles = makeStyles(colors);

  // Nothing to say: no amount typed, the first quote is still in flight, or the
  // venue refused (the caller's notice banner carries that). The dialpad is not
  // blocked on this, so it stays quiet rather than reserving space for a number
  // that may never come.
  if (!preview?.ok || preview.expectedReceived === null) {
    return loading && !preview?.unavailable ? (
      <View style={styles.wrap}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    ) : null;
  }

  // A buy values the quoted QUANTITY, so `unitPriceUsd` has to be the price of
  // the token the venue is handing over. Hand it a listed-share price for a
  // tokenized equity and the wrapper/share gap (5-18%) prints as instant
  // profit. The caller picks the right price; the cap below is what makes that
  // unmissable if one ever doesn't — at the moment of the buy the spread only
  // runs one way, so a fill can never be worth more than it cost.
  const valueUsd =
    preview.side === 'buy' && unitPriceUsd && unitPriceUsd > 0
      ? preview.spent !== null
        ? Math.min(preview.expectedReceived * unitPriceUsd, preview.spent)
        : preview.expectedReceived * unitPriceUsd
      : preview.side === 'sell'
        ? preview.expectedReceived
        : null;

  if (valueUsd === null) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.headline} numberOfLines={1}>
        {`≈ ${formatUsd(valueUsd)}`}
      </Text>
      {loading ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
    </View>
  );
}

const F = Fonts.rounded;

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 20,
      paddingTop: 4,
    },
    headline: { color: c.textSecondary, fontFamily: F, fontSize: 14, fontWeight: '700' },
  });
