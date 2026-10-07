import React, { useEffect, useMemo, useState } from "react";
import {
  Dimensions,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { useRouter } from "expo-router";
import { usePrivy } from "@privy-io/expo";
import { ShareIcon } from "@/components/share-icon";
import { FollowButton } from "@/components/follow-button";
import { AssetLogo } from "@/components/asset-logo";
import { UserProfileScreen } from "@/screens/user-profile-screen";

import { CTA, ctaBottomInset } from '@/lib/screen-corners';
import { Fonts, type ThemeColors } from "@/constants/theme";
import { HandleText } from "@/components/handle-text";

const DISPLAY_FONT = Fonts.display;
const BUY_GRADIENT = ["#38FF60", "#00E82E"] as const;
const BRAND_GREEN = "#35F046";
const HAS_GLASS = Platform.OS === "ios" && isGlassEffectAPIAvailable();
import { useThemeStore } from "@/lib/theme-store";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import { SandwichBasketChart } from "@/components/sandwich-basket-chart";
import {
  appUserPayloadFromPrivyUser,
  getTopHolderStocks,
  getSandwichShareUrl,
  type CuratedSandwich,
  type SandwichLeg,
} from "@/lib/api";
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;
const { width: SW } = Dimensions.get("window");

// ─── helpers ────────────────────────────────────────────────────────────────

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatLegPrice(leg: SandwichLeg): string {
  const price = leg.currentPriceUsd ?? leg.priceUsd;
  if (price === null) return "—";
  if (leg.type === "prediction_market") return `${Math.round(price * 100)}c`;
  if (price >= 1000) return `$${(price / 1000).toFixed(1)}k`;
  return `$${price.toFixed(2)}`;
}

function formatSocialCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.max(0, value));
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

const AVATAR_PALETTE = ["#35F046", "#1D4ED8", "#FF1AB8", "#F59E0B", "#8B5CF6", "#06B6D4"];
function getAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function getUserThesisText(sandwich: CuratedSandwich["sandwich"]): string {
  const quote = sandwich.source.quote?.trim();
  if (quote) return quote;
  const input = sandwich.source.input.trim();
  if (input && !/^https?:\/\//i.test(input)) return input;
  return sandwich.thesis.summary || sandwich.summary;
}

function getLegSymbol(leg: SandwichLeg): string {
  return (leg.underlyingSymbol ?? leg.symbol ?? leg.label).toUpperCase();
}

function getLegName(leg: SandwichLeg): string {
  if (leg.type === "prediction_market") {
    // Prefer whichever of question/label carries the real market question — a
    // binary sub-market's title is often just the outcome ("Yes"/"No"), which is
    // already shown separately as the side.
    const isBareOutcome = (value?: string | null) =>
      !value || /^(yes|no)$/i.test(value.trim());
    const candidates = [leg.question?.trim(), leg.label?.trim()].filter(
      (value): value is string => !!value && !isBareOutcome(value),
    );
    // Prefer the most descriptive form — grouped-market legs carry both the bare
    // candidate ("Portugal") and the combined "Question — Portugal".
    if (candidates.length > 0) {
      return candidates.sort((a, b) => b.length - a.length)[0];
    }
    return leg.question?.trim() || leg.label?.trim() || "Prediction market";
  }
  return leg.label;
}

// mcap cache shared with the old screen
let mcapCache: Map<string, number> | null = null;
let mcapCachePromise: Promise<Map<string, number>> | null = null;

async function loadMcapByMint(): Promise<Map<string, number>> {
  if (mcapCache) return mcapCache;
  if (!mcapCachePromise) {
    mcapCachePromise = getTopHolderStocks({ limit: 500 })
      .then((stocks) => {
        const map = new Map<string, number>();
        for (const s of stocks) {
          if (typeof s.mcap === "number" && s.mcap > 0) map.set(s.id, s.mcap);
        }
        mcapCache = map;
        return map;
      })
      .catch(() => new Map<string, number>());
  }
  return mcapCachePromise;
}

// ─── handoff store ──────────────────────────────────────────────────────────
// Module-level slot so the search screen can stash the full entry object before
// navigating (route params are strings only).
export let pendingCuratedEntry: CuratedSandwich | null = null;
export function setPendingCuratedEntry(entry: CuratedSandwich | null) {
  pendingCuratedEntry = entry;
}

// ─── component ──────────────────────────────────────────────────────────────

type Props = {
  entry: CuratedSandwich;
  onInvest?: (entry: CuratedSandwich) => void;
};

export function CuratedSandwichDetailScreen({ entry, onInvest }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const { user } = usePrivy();

  const sandwich = entry.sandwich;
  const legs = useMemo(() => sandwich.legs ?? [], [sandwich]);

  const [, setMcapByMint] = useState<Map<string, number>>(() => mcapCache ?? new Map());
  const [chartReturn, setChartReturn] = useState<number | null>(null);
  const [localLiked, setLocalLiked] = useState(sandwich.viewerHasLiked);
  const [likeCount, setLikeCount] = useState(sandwich.likeCount);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadMcapByMint().then((map) => {
      if (alive) setMcapByMint(map);
    });
    return () => { alive = false; };
  }, [entry]);

  const chartStartDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString();
  }, []);

  const chartLegs = useMemo(
    () =>
      legs.map((l) => ({
        legId: l.id,
        type: l.type as "tokenized_stock" | "prediction_market",
        mint: l.mint ?? null,
        marketId: l.marketId ?? null,
        symbol: l.symbol ?? null,
        label: l.label,
        side: l.side,
        weightBps: l.weightBps,
        priceUsd: l.priceUsd ?? null,
        currentPriceUsd: l.currentPriceUsd ?? null,
        pnlPct: l.pnlPct ?? null,
        imageUrl: l.imageUrl ?? null,
      })),
    [legs],
  );

  const thesisText = getUserThesisText(sandwich);
  const source = sandwich.source;
  // A Bread user is credited by their username, never by their display name;
  // only a non-user (cited X account) falls through to the author fields.
  const creatorName = (source.user?.username
    ? `@${source.user.username.replace(/^@+/, "")}`
    : null)
    ?? source.user?.name
    ?? (source.authorHandle ? `@${source.authorHandle}` : null)
    ?? source.authorName
    ?? "Creator";
  const avatarUrl = source.user?.avatarUrl ?? source.authorAvatarUrl ?? null;
  const avatarSeed = creatorName.replace(/^@/, "");
  const creatorPrivyUserId = source.user?.privyUserId ?? null;

  const handleOpenProfile = () => {
    if (!creatorPrivyUserId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setProfileOpen(true);
  };
  const displayReturn = chartReturn ?? sandwich.pnlPct;
  const returnPositive = displayReturn === null ? true : displayReturn >= 0;
  const returnColor = displayReturn === null
    ? colors.positive
    : returnPositive ? colors.positive : colors.negative;

  const handleLike = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLocalLiked((v) => !v);
    setLikeCount((n) => localLiked ? Math.max(0, n - 1) : n + 1);
  };

  const handleShare = async () => {
    const url = getSandwichShareUrl(sandwich.id);
    await Share.share({ url, message: thesisText });
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
        {/* Close */}
        <Pressable onPress={() => router.back()} style={styles.closeBtn} hitSlop={10}>
          <Ionicons name="close" size={18} color={colors.text} />
        </Pressable>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header area ── */}
          <View style={styles.header}>
            {/* Profile row */}
            <View style={styles.profileRow}>
              <Pressable
                style={styles.profileTap}
                onPress={handleOpenProfile}
                disabled={!creatorPrivyUserId}
                hitSlop={6}
              >
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: getAvatarColor(avatarSeed) }]} />
                )}
                <View style={styles.profileMeta}>
                  <View style={styles.nameRow}>
                    <HandleText style={styles.creatorName} numberOfLines={1}>{creatorName}</HandleText>
                    <Ionicons name="checkmark-circle" size={15} color="#1D4ED8" />
                  </View>
                </View>
              </Pressable>
              <FollowButton
                size="sm"
                following={false}
                onPress={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
              />
            </View>

            {/* Thesis text */}
            <Text style={styles.thesisText}>
              &ldquo;{thesisText}&rdquo;
            </Text>

            {/* PnL % */}
            <View style={styles.pnlHeaderRow}>
              <Text style={[styles.pnlValue, { color: returnColor }]}>
                {formatPct(displayReturn)}
              </Text>
            </View>
          </View>

          {/* ── Chart ── */}
          <View style={styles.chartWrap}>
            <SandwichBasketChart
              legs={chartLegs}
              createdAt={chartStartDate}
              targetReturnPct={null}
              showReturn={false}
              showDotGrid
              onScrub={setChartReturn}
            />
          </View>

          {/* ── Actions row (like / share / time) ── */}
          <View style={styles.actionsRow}>
            <Pressable style={styles.actionBtn} onPress={handleLike} hitSlop={8}>
              <Ionicons
                name={localLiked ? "heart" : "heart-outline"}
                size={20}
                color={localLiked ? "#FF1493" : colors.textTertiary}
              />
              {likeCount > 0 && (
                <Text style={[styles.actionCount, localLiked && { color: "#FF1493" }]}>
                  {formatSocialCount(likeCount)}
                </Text>
              )}
            </Pressable>

            <Pressable style={styles.actionBtn} onPress={handleShare} hitSlop={8}>
              <ShareIcon size={20} color={colors.textTertiary} />
            </Pressable>

            <View style={{ flex: 1 }} />
            <Text style={styles.timeAgo}>{timeAgo(sandwich.createdAt)}</Text>
          </View>

          {/* ── Holdings ── */}
          <View style={styles.holdingsSection}>
            {legs.map((leg, i) => {
              const pnlPositive = (leg.pnlPct ?? 0) >= 0;
              const pnlColor = leg.pnlPct === null
                ? colors.textTertiary
                : pnlPositive ? colors.positive : colors.negative;

              return (
                <View key={leg.id} style={[styles.legRow, i < legs.length - 1 && styles.legRowBorder]}>
                  <AssetLogo
                    uri={leg.imageUrl}
                    size={40}
                    borderRadius={20}
                    backgroundColor={colors.border}
                    fallback={
                      <View style={[styles.legIcon, { backgroundColor: getAvatarColor(getLegSymbol(leg)) }]}>
                        <Text style={styles.legIconLetter}>{getLegSymbol(leg).slice(0, 1)}</Text>
                      </View>
                    }
                  />

                  <View style={styles.legMeta}>
                    <Text style={styles.legSymbol} numberOfLines={1}>{getLegSymbol(leg)}</Text>
                    <Text style={styles.legAlloc}>{(leg.weightBps / 100).toFixed(0)}%</Text>
                  </View>

                  <View style={styles.legRight}>
                    <Text style={styles.legPrice}>{formatLegPrice(leg)}</Text>
                    <Text style={[styles.legPnl, { color: pnlColor }]}>{formatPct(leg.pnlPct)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* ── BUY button ── */}
        <View style={[styles.bottomBar, { paddingBottom: ctaBottomInset(insets.bottom) }]}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Buy"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onInvest?.(entry);
            }}
            style={styles.buyBtnWrap}
          >
            {HAS_GLASS ? (
              <GlassView
                glassEffectStyle="clear"
                isInteractive
                tintColor={BRAND_GREEN}
                colorScheme="light"
                style={styles.buyBtn}
              >
                <Text style={styles.buyBtnText}>BUY</Text>
              </GlassView>
            ) : (
              <LinearGradient
                colors={BUY_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.buyBtn}
              >
                <Text style={styles.buyBtnText}>BUY</Text>
              </LinearGradient>
            )}
          </PressableScale>
        </View>

        {creatorPrivyUserId ? (
          <UserProfileScreen
            visible={profileOpen}
            onClose={() => setProfileOpen(false)}
            targetPrivyUserId={creatorPrivyUserId}
            viewerPrivyUserId={user?.id ?? null}
            viewerPayload={user ? appUserPayloadFromPrivyUser(user) : null}
          />
        ) : null}
    </SafeAreaView>
  );
}

// ─── styles ─────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    scroll: { flex: 1 },

    closeBtn: {
      position: "absolute",
      top: 12,
      right: 16,
      zIndex: 10,
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },

    // plain header section (no gradient)
    header: {
      paddingTop: 14,
      paddingHorizontal: 16,
      paddingBottom: 4,
    },

    profileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 10,
    },
    profileTap: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    avatar: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: "#35F046",
    },
    profileMeta: { flex: 1 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    creatorName: {
      fontFamily: F,
      fontSize: 14,
      fontWeight: "700",
      color: c.text,
    },

    thesisText: {
      fontFamily: F,
      fontSize: 17,
      fontWeight: "800",
      color: c.text,
      lineHeight: 24,
      marginBottom: 10,
    },

    actionsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    actionBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    actionCount: {
      fontFamily: F,
      fontSize: 14,
      color: c.textTertiary,
    },
    timeAgo: {
      fontFamily: F,
      fontSize: 13,
      color: c.textTertiary,
    },

    // chart
    chartWrap: {
      marginTop: 8,
      marginBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },

    // PnL % shown in the header (where like/share used to be)
    pnlHeaderRow: {
      paddingBottom: 12,
    },
    pnlValue: {
      fontFamily: Fonts.displayMedium,
      fontSize: 18,
      fontWeight: "900",
      letterSpacing: -0.5,
    },

    // holdings
    holdingsSection: {
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    legRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 14,
    },
    legRowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    legIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.border,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    legIconLetter: {
      fontFamily: F,
      fontSize: 15,
      fontWeight: "800",
      color: "#FFFFFF",
    },
    legMeta: { flex: 1 },
    legSymbol: {
      fontFamily: F,
      fontSize: 15,
      fontWeight: "700",
      color: c.text,
    },
    legAlloc: {
      fontFamily: F,
      fontSize: 12,
      color: c.textTertiary,
      marginTop: 2,
    },
    legRight: { alignItems: "flex-end" },
    legPrice: {
      fontFamily: F,
      fontSize: 15,
      fontWeight: "700",
      color: c.text,
    },
    legPnl: {
      fontFamily: Fonts.displayMedium,
      fontSize: 12,
      fontWeight: "600",
      marginTop: 2,
    },

    // bottom bar
    bottomBar: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      // Side margin equals the bar's bottom padding (set at the call site from
      // `ctaBottomInset`), which is what lets the button's corners run parallel
      // to the display's own.
      paddingHorizontal: CTA.inset,
      paddingTop: 12,
      backgroundColor: c.background,
    },
    buyBtnWrap: { borderRadius: CTA.radius, overflow: "hidden" },
    buyBtn: {
      height: CTA.height,
      alignItems: "center",
      justifyContent: "center",
    },
    buyBtnText: {
      fontFamily: DISPLAY_FONT,
      fontSize: 24,
      color: "#FFFFFF",
      letterSpacing: 1,
    },
  });
