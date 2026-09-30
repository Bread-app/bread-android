import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Fonts } from "@/constants/theme";
import { getActiveNewsStory } from "@/lib/news-feed";
import { useThemeStore } from "@/lib/theme-store";
import { NewsStoryScreen } from "@/screens/news-story-screen";

export default function NewsStoryRoute() {
  const { colors } = useThemeStore();
  // Read once: the feed sets the story right before it pushes this route.
  const [story] = React.useState(getActiveNewsStory);

  if (!story) {
    return (
      <View style={[styles.fallback, { backgroundColor: colors.background }]}>
        <Text style={[styles.fallbackText, { color: colors.textSecondary }]}>
          Story not found.
        </Text>
      </View>
    );
  }

  return <NewsStoryScreen story={story} />;
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: Fonts.rounded,
  },
});
