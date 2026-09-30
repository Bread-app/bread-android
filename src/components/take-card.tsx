import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PressableScale } from "@/components/pressable-scale";
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import type { PositionTake, Sandwich } from "@/lib/api";
import { TAKE_SIGNAL_LABEL, copyTradeAmount, stampLabel, visibleSizeBand } from "@/lib/position-takes";
import { useSandwichDetail } from "@/lib/sandwich-detail-store";
import { useThemeStore } from "@/lib/theme-store";

const F = Fonts.rounded;

/**
 * A holder thesis as a feed card (§8.1).
 *
 * Lives in its own leaf module rather than beside the other feed cards in
 * `sandwich-screen`: Metro runs with `inlineRequires`, so a new import cycle
 * between screens is a runtime crash, not a lint warning.
 *
 * The card carries **Copy trade**: the same sandwich's buy pad, opened with the
 * taker's size band already entered (§8.1). A take is about a position, and one
 * you cannot act on is just text. It opens through the shared detail store
 * itself rather than asking each feed to plumb a handler, so every surface that
 * renders a take gets the identical behaviour.
 */
export const TakeCard = React.memo(function TakeCard({
  take,
  sandwich,
  onPress,
}: {
  take: PositionTake;
  sandwich: Sandwich;
  onPress: (sandwich: Sandwich) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const sandwichDetail = useSandwichDetail();
  const handle = take.author.username ? `@${take.author.username}` : take.author.name ?? "Someone";
  const positive = take.stamp.pct >= 0;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${handle} on ${sandwich.name}`}
      onPress={() => onPress(sandwich)}
      style={styles.card}
    >
      <View style={styles.headerRow}>
        {take.author.avatarUrl ? (
          <Image source={{ uri: take.author.avatarUrl }} style={styles.avatar} cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Ionicons name="person" size={15} color={colors.textTertiary} />
          </View>
        )}
        <View style={styles.headerCopy}>
          <Text numberOfLines={1} style={styles.handle}>
            {handle}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.stamp, { color: positive ? colors.positive : colors.negative }]}>
              {stampLabel(take)}
            </Text>
            {visibleSizeBand(take.sizeBand) ? (
              <Text style={styles.sizeBand}>· {visibleSizeBand(take.sizeBand)}</Text>
            ) : null}
          </View>
        </View>
        {take.signal ? (
          <Text style={styles.signalChip}>{TAKE_SIGNAL_LABEL[take.signal] ?? take.signal}</Text>
        ) : null}
      </View>

      <Text style={styles.body}>{take.body}</Text>

      <Text numberOfLines={1} style={styles.basket}>
        {sandwich.name}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copy this trade on ${sandwich.name}`}
        onPress={(event) => {
          event.stopPropagation();
          void Haptics.selectionAsync();
          sandwichDetail.open(sandwich, { showBuy: true, buyAmount: copyTradeAmount(take.sizeBand) });
        }}
        style={({ pressed }) => [styles.copyButton, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="repeat" size={15} color={colors.background} />
        <Text style={styles.copyButtonText}>Copy trade</Text>
      </Pressable>
    </PressableScale>
  );
});

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: { paddingHorizontal: 20, paddingVertical: 16, gap: 10 },
    headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.surfaceAlt },
    avatarFallback: { alignItems: "center", justifyContent: "center" },
    headerCopy: { flex: 1, gap: 2 },
    handle: { color: c.text, fontSize: 15, fontWeight: "800", fontFamily: F },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    stamp: { fontSize: 12, fontWeight: "700", fontFamily: F },
    sizeBand: { color: c.textTertiary, fontSize: 12, fontFamily: F },
    signalChip: {
      color: c.textSecondary,
      fontSize: 11,
      fontWeight: "700",
      fontFamily: F,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      overflow: "hidden",
    },
    body: { color: c.text, fontSize: 15, fontFamily: F, lineHeight: 21 },
    basket: { color: c.textSecondary, fontSize: 13, fontWeight: "700", fontFamily: F },
    copyButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      alignSelf: "flex-start",
      backgroundColor: c.text,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 999,
    },
    copyButtonText: { color: c.background, fontSize: 13, fontWeight: "800", fontFamily: F },
  });
