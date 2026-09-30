import React, { useMemo, useRef } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { AssetLogo } from '@/components/asset-logo';
import { Fonts, type ThemeColors } from '@/constants/theme';
import type { SandwichLeg } from '@/lib/api';
import { measureZoomSource, type ZoomSourceRect } from '@/lib/zoom-transition';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

/** Corner radius of the hero surface this card is rendered inside. */
const HERO_RADIUS = 26;

/**
 * Detail card for a single sandwich leg: why this asset is in the basket.
 *
 * Rendered as an inline overlay inside SandwichDetailScreen rather than as a
 * BottomSheetModal — nesting modals is broken on this stack, and a portaled
 * child would lose every provider mounted in (app)/_layout. It takes everything
 * as props for the same reason, so it stays safe to reuse from a sheet later.
 *
 * The reasoning is generated at sandwich creation time (SandwichLeg.legRole /
 * legMechanism). Legs created before that shipped — and heuristically-injected
 * ones — carry nulls and fall back to the terse `matchSummary ?? reason`.
 */
type SandwichLegCardProps = {
  leg: SandwichLeg | null;
  /**
   * Display title, computed by the caller with the screen's `getLegTitle`.
   * Passed in rather than derived here: prediction sub-markets are often
   * labelled with just the outcome or a bare date ("December 31, 2026") while
   * the real question lives on the event, and that heuristic already exists.
   */
  title: string;
  colors: ThemeColors;
  /**
   * Opens the asset screen. The card measures itself first so that screen can
   * zoom out of this exact rect — the same transition the search rows use.
   */
  onOpenAsset: (leg: SandwichLeg, source: ZoomSourceRect | null) => void;
  /** The header remains visible through the hero morph; only these secondary
   * details fade while the card is being compressed back into its row. */
  detailsStyle?: StyleProp<ViewStyle>;
};

/** Stagger: the role lands just before the supporting explanation. */
const ROLE_DELAY_MS = 120;
const MECHANISM_DELAY_MS = 180;

function formatPnl(value: number | null) {
  if (value === null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function pnlColor(value: number | null, c: ThemeColors) {
  if (value === null || value === 0) return c.text;
  return value > 0 ? c.positive : c.negative;
}

function legSubtitle(leg: SandwichLeg) {
  if (leg.type === 'prediction_market') {
    return leg.side.trim().toUpperCase() === 'NO' ? 'NO' : 'YES';
  }
  // The ticker is already the headline, so show the company name underneath.
  return leg.label;
}

export function SandwichLegCard({
  leg,
  title,
  colors,
  onOpenAsset,
  detailsStyle,
}: SandwichLegCardProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const cardRef = useRef<View>(null);

  if (!leg) return null;

  const weightPct = Math.round(Math.max(0, leg.weightBps) / 100);
  // legMechanism is the generated prose; getLegDescription's terse string is
  // the fallback so pre-feature legs still say something.
  const mechanism = leg.legMechanism ?? leg.matchSummary ?? leg.reason;
  const isPrediction = leg.type === 'prediction_market';
  // Only stock legs have a full asset sheet to hand off to. Rendering a dead
  // "View asset" row on a prediction leg is worse than rendering nothing.
  const canOpenAsset = leg.type === 'tokenized_stock' && Boolean(leg.mint);
  const displayTitle = title.trim();

  return (
    <View ref={cardRef} style={styles.card}>
      <View style={styles.header}>
        <AssetLogo
          uri={leg.imageUrl}
          size={44}
          borderRadius={isPrediction ? 10 : 22}
          fallback={
            <View style={styles.logoFallback}>
              <Ionicons
                name={isPrediction ? 'ribbon-outline' : 'bar-chart-outline'}
                size={20}
                color={colors.textInverse}
              />
            </View>
          }
        />
        <View style={styles.headerCopy}>
          <Text numberOfLines={isPrediction ? 3 : 1} style={styles.title}>
            {displayTitle}
          </Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {legSubtitle(leg)}
          </Text>
        </View>
        <View style={styles.headerMetrics}>
          <Text style={[styles.pnl, { color: pnlColor(leg.pnlPct, colors) }]}>
            {formatPnl(leg.pnlPct)}
          </Text>
          <View style={styles.weightPill}>
            <Text style={styles.weightText}>{weightPct}%</Text>
          </View>
        </View>
      </View>

      <Animated.View style={[styles.details, detailsStyle]}>
        {leg.legRole ? (
          <Animated.Text
            entering={FadeIn.delay(ROLE_DELAY_MS).reduceMotion(ReduceMotion.System)}
            style={styles.role}
          >
            {leg.legRole.toUpperCase()}
          </Animated.Text>
        ) : null}

        <Animated.Text
          entering={FadeIn.delay(MECHANISM_DELAY_MS).reduceMotion(ReduceMotion.System)}
          style={styles.mechanism}
        >
          {mechanism}
        </Animated.Text>

        {canOpenAsset ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Trade ${displayTitle}`}
            onPress={() => {
              void measureZoomSource(cardRef, HERO_RADIUS).then((source) =>
                onOpenAsset(leg, source),
              );
            }}
            hitSlop={12}
            style={styles.tradeLink}
          >
            <Text style={styles.tradeLinkText}>{`Trade ${displayTitle} →`}</Text>
          </PressableScale>
        ) : null}
      </Animated.View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
      gap: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    logoFallback: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.iconMuted,
    },
    headerCopy: {
      flex: 1,
      gap: 2,
    },
    title: {
      fontFamily: F,
      fontSize: 20,
      fontWeight: '800',
      color: c.text,
    },
    subtitle: {
      fontFamily: F,
      fontSize: 13,
      fontWeight: '600',
      color: c.textSecondary,
    },
    headerMetrics: {
      alignItems: 'flex-end',
      gap: 6,
    },
    pnl: {
      fontFamily: Fonts.displayMedium,
      fontSize: 16,
      fontWeight: '800',
    },
    weightPill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    weightText: {
      fontFamily: F,
      fontSize: 12,
      fontWeight: '700',
      color: c.textSecondary,
    },
    role: {
      fontFamily: F,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1.1,
      color: c.textSecondary,
    },
    mechanism: {
      fontFamily: Fonts.poppins,
      fontSize: 15,
      lineHeight: 22,
      color: c.text,
      // Pull the body up under the role label when both are present.
      marginTop: -6,
    },
    details: {
      gap: 14,
    },
    // A plain text action, not a filled row: the card's job is the reasoning,
    // and a full-width button would compete with it.
    tradeLink: {
      alignSelf: 'flex-end',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingVertical: 2,
    },
    tradeLinkText: {
      fontFamily: F,
      fontSize: 16,
      fontWeight: '700',
      color: c.accentBlue,
    },
  });
