import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { withAlpha } from '@/lib/color-utils';
import {
  NUMERIC_KEYPAD_FONT_SIZE,
  NUMERIC_KEYPAD_GAP,
  NUMERIC_KEYPAD_HEIGHT,
  NUMERIC_KEYPAD_ROWS,
} from '@/lib/numeric-keypad-layout';
import { useThemeStore } from '@/lib/theme-store';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

/** The one-tap slices. Anything between them comes off the ruler. */
const QUICK_PERCENTS = [25, 50, 75, 100] as const;
/** Below this the order is usually under Phoenix's minimum lot anyway. */
export const MIN_CLOSE_PERCENT = 1;

export type PhoenixClosePadProps = {
  /** PnL the whole position is carrying right now. */
  unrealizedPnl: number;
  /** 1–100. Controlled by the host so the confirm button can label itself. */
  percent: number;
  onPercentChange: (next: number) => void;
  /**
   * Sandwich legs exit whole — the backend closes the whole PDA in one atomic
   * transaction, so there is no slice to choose. The control is replaced by a
   * line saying so rather than being shown disabled.
   */
  fullOnly?: boolean;
  /**
   * Where the freed collateral lands. Only a Sandwich has this choice: closing
   * releases margin to the Phoenix account, and moving it back to spendable
   * cash is a second transaction. See [[perps-collateral-manual-only]].
   */
  returnToCash?: boolean;
  onReturnToCashChange?: (next: boolean) => void;
};

/**
 * Close pad — the in-app replacement for the native confirm alert.
 *
 * A close is a trade, and it deserves the same treatment as an entry: pick how
 * much, see what it books, then confirm. The alert could only ask yes/no, which
 * meant every exit was all-or-nothing and the numbers behind it were invisible.
 *
 * Everything here is derived from `percent`, including the PnL — a partial close
 * realizes its share of what the position is carrying, and leaves the rest
 * riding.
 *
 * Deliberately short: one big number, the slice controls, and two lines saying
 * what leaves and what stays. The host hides the chart while this is up and
 * owns the confirm button, so the whole decision fits one screen with nothing
 * to scroll. The mark price is already in the sheet header, and freed
 * collateral follows from the slice — neither earned a row.
 */
export function PhoenixClosePad({
  unrealizedPnl,
  percent,
  onPercentChange,
  fullOnly = false,
  returnToCash,
  onReturnToCashChange,
}: PhoenixClosePadProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();

  /**
   * What the keypad has typed so far, as a string — "1" on the way to "100"
   * parses to a legal 1% on its own, so the committed number can follow every
   * keystroke and the two never disagree. The pad is mounted fresh each time
   * the host opens it, so seeding from the prop is enough.
   */
  const [draft, setDraft] = useState(() => String(Math.round(percent)));

  const fraction = fullOnly ? 1 : Math.max(0, Math.min(100, percent)) / 100;
  const realizedPnl = unrealizedPnl * fraction;
  const pnlColor = realizedPnl >= 0 ? colors.chartPositive : colors.chartNegative;
  const accent = colors.actionSell;

  // Two facts, not five. What leaves, and what stays — the collateral and the
  // mark are already implied by those and only crowded the screen.
  const commit = useCallback(
    (next: string) => {
      setDraft(next);
      const parsed = Number(next);
      if (!Number.isFinite(parsed)) return;
      onPercentChange(Math.max(MIN_CLOSE_PERCENT, Math.min(100, Math.round(parsed))));
    },
    [onPercentChange],
  );

  const onKey = useCallback(
    (key: string) => {
      if (key === 'del') {
        commit(draft.slice(0, -1));
        return;
      }
      // A slice is a whole percent — the host rounds anyway, so a decimal key
      // that typed a figure the rows below would immediately contradict is
      // better left inert than left lying.
      if (key === '.') return;
      const next = draft === '0' || draft === '' ? key : `${draft}${key}`;
      // Nothing above 100% exists to close.
      if (Number(next) > 100) return;
      commit(next);
    },
    [commit, draft],
  );


  return (
    <View style={styles.card}>
      {/* The number being chosen, with the PnL it books directly under it —
          the two figures that decide whether to tap Close. Everything else on
          this pad is one line tall. */}
      <View style={styles.readout}>
        <Text style={styles.readoutValue}>{fullOnly ? '100%' : `${draft || '0'}%`}</Text>
        <Text style={[styles.readoutPnl, { color: pnlColor }]}>
          {`${realizedPnl >= 0 ? '+' : '−'}${formatUsd(Math.abs(realizedPnl))} realized`}
        </Text>
      </View>

      {fullOnly ? (
        <Text style={styles.fullOnlyNote}>
          A Sandwich exits whole, in one transaction.
        </Text>
      ) : null}

      {/* Everything below the readout is pinned to the bottom edge, so the
          big number gets the room and the working parts sit under the thumb:
          the preset pills, then the keypad. */}
      <View style={styles.input}>
        {fullOnly ? null : (
          /* The preset pills sit directly above the same twelve-key grid the
             order ticket types its margin on, so a thumb reaches both without
             leaving the keypad. A close is a trade: the amount is typed, not
             dragged. The keys are deliberately not glass — twelve stacked
             native glass views blur into a mush and cost real frame time. */
          <>
            <View style={styles.quickRow}>
              {QUICK_PERCENTS.map((value) => {
                const active = Number(draft) === value;
                return (
                  <PressableScale
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={`Close ${value === 100 ? 'the whole position' : `${value} percent`}`}
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      commit(String(value));
                    }}
                    style={[styles.quickChip, active && styles.quickChipActive]}
                  >
                    <Text style={[styles.quickText, active && styles.quickTextActive]}>
                      {value === 100 ? 'All' : `${value}%`}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
            <View style={styles.keypad}>
              {NUMERIC_KEYPAD_ROWS.map((row) => (
                <View key={row.join('')} style={styles.keyRow}>
                  {row.map((key) => (
                    <Pressable
                      key={key}
                      accessibilityRole="button"
                      accessibilityLabel={key === 'del' ? 'Delete digit' : `Enter ${key}`}
                      disabled={key === '.'}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        onKey(key);
                      }}
                      style={({ pressed }) => [
                        styles.key,
                        pressed && { backgroundColor: withAlpha(accent, 0.14) },
                      ]}
                    >
                      {key === 'del' ? (
                        <Ionicons name="backspace-outline" size={26} color={colors.text} />
                      ) : (
                        <Text style={[styles.keyText, key === '.' && styles.keyInert]}>{key}</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          </>
        )}
      </View>

      {onReturnToCashChange ? (
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchLabel}>Return collateral to cash</Text>
            <Text style={styles.switchHint}>
              Off keeps it on your perps account, ready for the next trade.
            </Text>
          </View>
          <Switch
            value={returnToCash ?? false}
            onValueChange={(next) => {
              void Haptics.selectionAsync();
              onReturnToCashChange(next);
            }}
            trackColor={{ true: accent, false: colors.border }}
          />
        </View>
      ) : null}
    </View>
  );
}

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  return `$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Fills the space the host gives it so the keypad can sit on the bottom
    // edge, above Cancel, instead of floating wherever the rows above end.
    card: {
      flex: 1,
      marginTop: 18,
      gap: 16,
    },
    readout: {
      alignItems: 'center',
      gap: 2,
    },
    readoutValue: {
      fontFamily: F,
      color: c.text,
      fontSize: 64,
      lineHeight: 70,
      fontWeight: '900',
      letterSpacing: -2,
      fontVariant: ['tabular-nums'],
    },
    readoutPnl: {
      fontFamily: F,
      fontSize: 15,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    fullOnlyNote: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 12,
      fontWeight: '600',
      textAlign: 'center',
    },
    quickRow: {
      flexDirection: 'row',
      gap: 8,
    },
    quickChip: {
      flex: 1,
      height: 38,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    // Selected is solid ink on paper — the one chip that is "on" reads at a
    // glance without a tinted outline competing with the sell accent below.
    quickChipActive: { backgroundColor: c.text },
    quickText: {
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 13,
      fontWeight: '800',
    },
    quickTextActive: { color: c.background },
    pressed: { opacity: 0.7 },
    // Pushed to the bottom of the card, tiles included; the readout keeps
    // the room above.
    input: {
      flexGrow: 0,
      flexShrink: 0,
      marginTop: 'auto',
      gap: 12,
    },
    keypad: {
      height: NUMERIC_KEYPAD_HEIGHT + 8,
      paddingTop: 8,
      gap: NUMERIC_KEYPAD_GAP,
    },
    keyRow: { flex: 1, flexDirection: 'row', gap: 8 },
    key: {
      flex: 1,
      alignSelf: 'stretch',
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyText: {
      fontFamily: F,
      color: c.text,
      fontSize: NUMERIC_KEYPAD_FONT_SIZE,
      fontWeight: '600',
    },
    keyInert: { opacity: 0 },
    tiles: {
      flexDirection: 'row',
      alignItems: 'stretch',
      backgroundColor: c.surfaceAlt,
      borderRadius: 16,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    tile: {
      flex: 1,
      gap: 2,
    },
    tileDivider: {
      width: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
      marginHorizontal: 14,
    },
    tileLabel: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 11.5,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    tileValue: {
      fontFamily: F,
      color: c.text,
      fontSize: 17,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    tileValueMuted: { color: c.textTertiary },
    tileSub: {
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 12.5,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingTop: 2,
    },
    switchText: { flex: 1, gap: 1 },
    switchLabel: {
      fontFamily: F,
      color: c.text,
      fontSize: 13.5,
      fontWeight: '800',
    },
    switchHint: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 11.5,
      fontWeight: '600',
    },
  });
