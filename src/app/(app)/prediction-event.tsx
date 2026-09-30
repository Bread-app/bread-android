import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  PredictionEventScreen,
  pendingPredictionEvent,
} from "@/screens/prediction-event-screen";
import { useThemeStore } from "@/lib/theme-store";
import { Fonts } from "@/constants/theme";

export default function PredictionEventRoute() {
  const { colors } = useThemeStore();
  const event = pendingPredictionEvent;

  if (!event) {
    return (
      <View style={[styles.fallback, { backgroundColor: colors.background }]}>
        <Text style={[styles.fallbackText, { color: colors.textSecondary }]}>
          Event not found.
        </Text>
      </View>
    );
  }

  return <PredictionEventScreen event={event} />;
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
