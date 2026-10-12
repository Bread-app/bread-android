import React, { useRef } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemeStore } from "@/lib/theme-store";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import {
  PredictionMarketDetailSheet,
  type PredictionMarketDetailSheetRef,
} from "@/components/prediction-market-detail-sheet";
import type { PredictionMarketSearchHit } from "@/lib/api";
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

const YES = "#35F046";
const NO = "#FF1F4B";

/**
 * A prediction EVENT ("Who wins TX-Sen?") with its outcome markets ("John
 * Cornyn", "Colin Allred", …) nested inside. Search renders one row per
 * event; tapping pushes this screen, which lists the markets within.
 */
export type PredictionEventGroup = {
  key: string;
  title: string;
  imageUrl: string | null;
  markets: PredictionMarketSearchHit[];
};

export function groupPredictionEvents(
  hits: PredictionMarketSearchHit[],
): PredictionEventGroup[] {
  const groups = new Map<string, PredictionEventGroup>();
  for (const hit of hits) {
    // Markets without an event id become their own single-market "event" so
    // nothing silently disappears from the list.
    const key = hit.eventId ?? `market:${hit.marketId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.markets.push(hit);
      if (!existing.imageUrl) {
        existing.imageUrl = hit.eventImageUrl ?? hit.imageUrl;
      }
    } else {
      groups.set(key, {
        key,
        title: hit.title,
        // The event's own artwork — never a single outcome's image (which
        // would render e.g. one team's flag as the whole event).
        imageUrl: hit.eventImageUrl ?? hit.imageUrl,
        markets: [hit],
      });
    }
  }
  const list = Array.from(groups.values());
  // Most-likely outcome first, matching how Polymarket orders an event page.
  for (const group of list) {
    group.markets.sort((a, b) => (b.yesPriceUsd ?? 0) - (a.yesPriceUsd ?? 0));
  }
  return list;
}

// The event being pushed is handed off through module state (same pattern as
// `pendingCuratedEntry`) — router params can't carry the market list.
export let pendingPredictionEvent: PredictionEventGroup | null = null;
export function setPendingPredictionEvent(event: PredictionEventGroup | null) {
  pendingPredictionEvent = event;
}

function cents(price: number | null): string {
  return price != null ? `${Math.round(price * 100)}¢` : "—";
}

function compactUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`;
  return `$${abs.toFixed(0)}`;
}

/**
 * Full-screen prediction EVENT detail, pushed over the tab bar (native
 * transparent header supplies the back button). Shows the event's artwork and
 * title, then its outcome markets — each with the market's own Polymarket
 * image and live Yes/No prices. Tapping a market stacks the trade/detail
 * sheet on top of this screen.
 */
export function PredictionEventScreen({ event }: { event: PredictionEventGroup }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const insets = useSafeAreaInsets();
  const marketSheetRef = useRef<PredictionMarketDetailSheetRef>(null);

  const totalVolume = event.markets.reduce(
    (sum, m) => (m.volumeUsd != null ? sum + m.volumeUsd : sum),
    0,
  );

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 52, paddingBottom: insets.bottom + 48 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          {event.imageUrl ? (
            <Image source={{ uri: event.imageUrl }} style={styles.heroIcon} />
          ) : (
            <View style={[styles.heroIcon, styles.heroFallback]}>
              <Ionicons name="stats-chart" size={30} color={colors.textTertiary} />
            </View>
          )}
          <Text style={styles.title}>{event.title}</Text>
          <Text style={styles.meta}>
            {event.markets.length} outcome{event.markets.length !== 1 ? "s" : ""}
            {totalVolume > 0 ? ` · ${compactUsd(totalVolume)} vol` : ""}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>Outcomes</Text>
        {event.markets.map((hit) => (
          <PressableScale
            key={hit.marketId}
            onPress={() => marketSheetRef.current?.open(hit)}
            style={styles.row}
          >
            {hit.imageUrl ? (
              <Image source={{ uri: hit.imageUrl }} style={styles.rowIcon} />
            ) : (
              <View style={[styles.rowIcon, styles.heroFallback]}>
                <Ionicons name="stats-chart" size={18} color={colors.textTertiary} />
              </View>
            )}
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {hit.question}
              </Text>
              <View style={styles.rowPriceLine}>
                <Text style={[styles.rowPrice, { color: YES }]}>
                  Yes {cents(hit.yesPriceUsd)}
                </Text>
                <Text style={[styles.rowPrice, { color: NO }]}>
                  No {cents(hit.noPriceUsd)}
                </Text>
              </View>
            </View>
            <Text style={styles.rowPct}>{cents(hit.yesPriceUsd)}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </PressableScale>
        ))}
      </ScrollView>

      <PredictionMarketDetailSheet ref={marketSheetRef} />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: 20,
    },
    header: {
      alignItems: "center",
      marginBottom: 10,
    },
    heroIcon: {
      width: 84,
      height: 84,
      borderRadius: 22,
      backgroundColor: c.surfaceAlt,
    },
    heroFallback: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
    },
    title: {
      marginTop: 14,
      color: c.text,
      fontSize: 24,
      lineHeight: 29,
      fontWeight: "800",
      fontFamily: F,
      textAlign: "center",
    },
    meta: {
      marginTop: 6,
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: "600",
      fontFamily: F,
    },
    sectionLabel: {
      color: c.textTertiary,
      fontSize: 12,
      fontWeight: "700",
      fontFamily: F,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginTop: 18,
      marginBottom: 4,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
    },
    rowIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: c.surfaceAlt,
    },
    rowInfo: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      color: c.text,
      fontSize: 16,
      fontWeight: "800",
      fontFamily: F,
    },
    rowPriceLine: {
      marginTop: 2,
      flexDirection: "row",
      gap: 10,
    },
    rowPrice: {
      fontSize: 12,
      fontWeight: "700",
      fontFamily: F,
    },
    rowPct: {
      color: c.text,
      fontSize: 16,
      fontWeight: "800",
      fontFamily: F,
    },
  });
