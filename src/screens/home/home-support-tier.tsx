import * as Haptics from "expo-haptics";
import React from "react";
import { Linking, StyleSheet, View } from "react-native";

import { MarketNewsSection } from "@/components/home/market-news-section";
import type { Stock } from "@/lib/api";
import type { ZoomSourceRect } from "@/lib/zoom-transition";

import type { HomeDiscovery } from "./use-home-discovery";
import { normalizeOpenUrl } from "./helpers";

type Props = {
  discovery: HomeDiscovery;
  onOpenStock: (
    stock: Stock,
    source: ZoomSourceRect | null,
    nativeSourceKey?: string,
  ) => void;
};

/**
 * Tier 3 — support. One rhythm: quiet headers, 32pt between sections, and
 * nothing here competes with the hero or the feed.
 */
export function HomeSupportTier({
  discovery,
  onOpenStock,
}: Props) {
  return (
    <View style={styles.tier}>
      <MarketNewsSection
        stories={discovery.stories}
        loading={discovery.storiesLoading}
        failed={discovery.newsFailed}
        onOpenStory={(item) => {
          void Haptics.selectionAsync();
          void Linking.openURL(normalizeOpenUrl(item.url)).catch(() => {});
        }}
        onOpenStock={onOpenStock}
        onRetry={discovery.reloadNews}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tier: {
    gap: 32,
  },
});
