import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  CuratedSandwichDetailScreen,
  pendingCuratedEntry,
} from "@/screens/curated-sandwich-detail-screen";
import { useThemeStore } from "@/lib/theme-store";
import { Fonts } from "@/constants/theme";

export default function CuratedSandwichRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useThemeStore();

  const entry = pendingCuratedEntry;

  if (!entry || entry.id !== id) {
    return (
      <View style={[styles.fallback, { backgroundColor: colors.background }]}>
        <Text style={[styles.fallbackText, { color: colors.textSecondary }]}>
          Sandwich not found.
        </Text>
      </View>
    );
  }

  return (
    <CuratedSandwichDetailScreen
      entry={entry}
      onInvest={() => {
        router.replace("/sandwich");
      }}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackText: {
    fontFamily: Fonts.rounded,
    fontSize: 15,
  },
});
