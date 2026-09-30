import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useMemo, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AssetLogo } from "@/components/asset-logo";
import { PressableScale } from "@/components/pressable-scale";
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import { getRelatedStocksForNews, type Stock } from "@/lib/api";
import {
  newsRelativeTime,
  newsSourceLabel,
  normalizeNewsUrl,
  type NewsStory,
} from "@/lib/news-feed";
import { formatCompactUsd } from "@/lib/sandwich-feed";
import { CTA, ctaBottomInset } from "@/lib/screen-corners";
import { useStockDetail } from "@/lib/stock-detail-store";
import { useThemeStore } from "@/lib/theme-store";

const F = Fonts.rounded;

function formatChange(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function AssetRow({ stock, onPress }: { stock: Stock; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const change = stock.priceChange24h;
  const changeColor =
    change == null ? colors.textTertiary : change >= 0 ? colors.positive : colors.negative;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Open ${stock.name}, ${formatChange(change)} today`}
      onPress={onPress}
      scaleTo={0.98}
      style={styles.assetRow}
    >
      <AssetLogo
        uri={stock.icon}
        size={40}
        borderRadius={20}
        backgroundColor={colors.surfaceAlt}
        fallback={
          <View style={styles.assetLogoFallback}>
            <Text style={styles.assetLogoFallbackText}>
              {(stock.symbol || "?").slice(0, 1).toUpperCase()}
            </Text>
          </View>
        }
      />
      <View style={styles.assetCopy}>
        <Text style={styles.assetSymbol} numberOfLines={1}>
          {stock.symbol}
        </Text>
        <Text style={styles.assetName} numberOfLines={1}>
          {stock.name}
        </Text>
      </View>
      <View style={styles.assetQuote}>
        <Text style={styles.assetPrice}>{formatCompactUsd(stock.usdPrice) ?? "--"}</Text>
        <Text style={[styles.assetChange, { color: changeColor }]}>{formatChange(change)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textQuaternary} />
    </PressableScale>
  );
}

/**
 * One story, opened. The feed only carries headlines — there is no article
 * body to show — so this is not a fake page of prose: it is the headline, the
 * outlets that ran it, what it moves, and a way out to read it at the source.
 */
export function NewsStoryScreen({ story }: { story: NewsStory }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const imageWidth = windowWidth - 40;
  const stockDetail = useStockDetail();
  const { item } = story;
  const isX = item.feedSource === "x";

  // The feed's catalog match is strict and instant. Only when it found nothing
  // do we ask the wider catalog search — its looser matching is worth a try
  // for a story that would otherwise show no assets at all.
  const [related, setRelated] = useState<Stock[]>(story.related);
  const [searching, setSearching] = useState(story.related.length === 0);
  useEffect(() => {
    if (story.related.length > 0) return;
    let active = true;
    getRelatedStocksForNews(item, { limit: 4 })
      .then((stocks) => {
        if (active) setRelated(stocks);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setSearching(false);
      });
    return () => {
      active = false;
    };
  }, [item, story.related.length]);

  const postedAt = useMemo(() => {
    if (story.postedAtMs == null) return null;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(story.postedAtMs);
  }, [story.postedAtMs]);

  const openUrl = (url: string) => {
    void Haptics.selectionAsync();
    const target = normalizeNewsUrl(url);
    // X links go to the X app when installed; articles open in-app so the
    // reader comes straight back to the story.
    if (isX || /(?:^|\.)(?:x|twitter)\.com\//i.test(target)) {
      void Linking.openURL(target).catch(() => {});
      return;
    }
    void WebBrowser.openBrowserAsync(target, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    }).catch(() => {
      void Linking.openURL(target).catch(() => {});
    });
  };

  const barHeight = CTA.height + ctaBottomInset(insets.bottom) + 16;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 64,
          paddingBottom: barHeight + 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.metaRow}>
            {isX ? (
              <View style={styles.xBadge}>
                <Text style={styles.xBadgeText}>𝕏</Text>
              </View>
            ) : null}
            <Text style={styles.metaSource}>{story.source}</Text>
            {postedAt ? (
              <Text style={styles.metaDim}>
                · {postedAt} ({newsRelativeTime(story.postedAtMs)} ago)
              </Text>
            ) : null}
          </View>
          <Text style={styles.headline} accessibilityRole="header">
            {story.title}
          </Text>
          {item.author && !isX ? <Text style={styles.byline}>By {item.author}</Text> : null}
        </View>

        {story.imageUrl ? (
          <View style={[styles.image, { width: imageWidth, height: (imageWidth * 9) / 16 }]}>
            <Image
              source={{ uri: story.imageUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={200}
              accessible={false}
            />
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>In this story</Text>
          {searching ? (
            <View>
              {Array.from({ length: 2 }).map((_, index) => (
                <View key={index} style={styles.assetSkeleton} />
              ))}
            </View>
          ) : related.length > 0 ? (
            <View style={styles.assetList}>
              {related.map((stock) => (
                <AssetRow
                  key={stock.id}
                  stock={stock}
                  onPress={() => stockDetail.open(stock)}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>
              Nothing tradeable is named in this story yet.
            </Text>
          )}
        </View>

        {story.alsoReportedBy.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Also reported by</Text>
            <View style={styles.sourceList}>
              {story.alsoReportedBy.map((other) => (
                <PressableScale
                  key={other.url}
                  accessibilityRole="link"
                  accessibilityLabel={`Read on ${newsSourceLabel(other)}`}
                  onPress={() => openUrl(other.url)}
                  scaleTo={0.98}
                  style={styles.sourceRow}
                >
                  <Text style={styles.sourceName} numberOfLines={1}>
                    {newsSourceLabel(other)}
                  </Text>
                  <Ionicons name="open-outline" size={14} color={colors.textTertiary} />
                </PressableScale>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.bar,
          {
            paddingBottom: ctaBottomInset(insets.bottom),
            paddingHorizontal: CTA.inset,
          },
        ]}
      >
        <PressableScale
          accessibilityRole="link"
          accessibilityLabel={isX ? "Open the post on X" : `Read on ${story.source}`}
          onPress={() => openUrl(item.url)}
          style={[styles.barButton, styles.barSecondary, { height: CTA.height, borderRadius: CTA.radius }]}
        >
          <Ionicons name={isX ? "logo-twitter" : "reader-outline"} size={18} color={colors.text} />
          <Text style={styles.barSecondaryText}>{isX ? "View post" : "Read"}</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      paddingHorizontal: 20,
      gap: 12,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
    },
    xBadge: {
      width: 18,
      height: 18,
      borderRadius: 5,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.text,
    },
    xBadgeText: {
      color: c.background,
      fontSize: 11,
      fontWeight: "900",
    },
    metaSource: {
      color: c.text,
      fontSize: 14,
      fontWeight: "800",
      fontFamily: F,
    },
    metaDim: {
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: "600",
      fontFamily: F,
    },
    headline: {
      color: c.text,
      fontSize: 28,
      lineHeight: 34,
      fontWeight: "800",
      fontFamily: F,
      letterSpacing: -0.5,
    },
    byline: {
      color: c.textSecondary,
      fontSize: 13,
      fontWeight: "600",
      fontFamily: F,
    },
    image: {
      marginTop: 20,
      marginHorizontal: 20,
      borderRadius: 20,
      overflow: "hidden",
      backgroundColor: c.surfaceAlt,
    },
    section: {
      marginTop: 28,
      paddingHorizontal: 20,
    },
    sectionTitle: {
      color: c.text,
      fontSize: 18,
      fontWeight: "800",
      fontFamily: F,
      marginBottom: 6,
    },
    assetList: {},
    assetRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    assetLogoFallback: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
    },
    assetLogoFallbackText: {
      color: c.text,
      fontSize: 15,
      fontWeight: "900",
      fontFamily: F,
    },
    assetCopy: {
      flex: 1,
      minWidth: 0,
    },
    assetSymbol: {
      color: c.text,
      fontSize: 16,
      fontWeight: "800",
      fontFamily: F,
    },
    assetName: {
      marginTop: 2,
      color: c.textSecondary,
      fontSize: 13,
      fontWeight: "500",
      fontFamily: F,
    },
    assetQuote: {
      alignItems: "flex-end",
    },
    assetPrice: {
      color: c.text,
      fontSize: 15,
      fontWeight: "700",
      fontFamily: F,
      fontVariant: ["tabular-nums"],
    },
    assetChange: {
      marginTop: 2,
      fontSize: 13,
      fontWeight: "800",
      fontFamily: Fonts.displayMedium,
      fontVariant: ["tabular-nums"],
    },
    assetSkeleton: {
      height: 52,
      marginTop: 12,
      borderRadius: 14,
      backgroundColor: c.surfaceAlt,
    },
    empty: {
      marginTop: 4,
      color: c.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      fontFamily: F,
    },
    sourceList: {
      marginTop: 4,
    },
    sourceRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      minHeight: 48,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    sourceName: {
      flex: 1,
      color: c.text,
      fontSize: 15,
      fontWeight: "700",
      fontFamily: F,
    },
    bar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      gap: 10,
      paddingTop: 12,
      backgroundColor: c.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    barButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    barSecondary: {
      flex: 1,
      paddingHorizontal: 22,
      backgroundColor: c.surfaceAlt,
    },
    barSecondaryText: {
      color: c.text,
      fontSize: 16,
      fontWeight: "800",
      fontFamily: F,
    },
  });
