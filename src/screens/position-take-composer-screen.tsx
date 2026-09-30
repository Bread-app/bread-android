import Ionicons from "@expo/vector-icons/Ionicons";
import { usePrivy } from "@privy-io/expo";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AssetLogo } from "@/components/asset-logo";
import { PressableScale } from "@/components/pressable-scale";
import { CardAssetIcons } from "@/components/sandwich-card";
import { getSandwichCreatorMeta } from "@/components/sandwich-holding-card";
import { VerifiedBadge } from "@/components/verified-badge";
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import {
  MAX_TAKE_LENGTH,
  appUserPayloadFromPrivyUser,
  createPositionTake,
  getSandwichById,
  getUserProfile,
  type PositionRef,
  type Sandwich,
} from "@/lib/api";
import { formatLeverage } from "@/lib/phoenix-position-leverage";
import { formatSignedPnlPercentage } from "@/lib/pnl-percentage";
import { ageLabel, formatCountdown, signedPct } from "@/lib/position-takes";
import { useThemeStore } from "@/lib/theme-store";

const F = Fonts.rounded;

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Write a thesis on a position you hold (§8.1).
 *
 * Laid out like the New Sandwich composer: your face beside a bare text field,
 * the position you're writing about pinned above the toolbar, Post on the
 * right. Nothing else — a take is a sentence or two, and every extra control
 * on this screen was a reason not to write it.
 *
 * The position arrives as route params rather than being fetched: the holding
 * card already has every value the card shows, and the server re-verifies
 * ownership and openness on write anyway — so a fetch here would only add a
 * spinner in front of a text field.
 */
export function PositionTakeComposerScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = usePrivy();
  // The viewer's Bread profile, for the byline over the field. The OAuth
  // picture wins when there is one, else the one uploaded to Bread — the same
  // two sources the profile header reads, in the same order.
  const oauthAvatarUrl = useMemo(() => appUserPayloadFromPrivyUser(user)?.avatarUrl ?? null, [user]);
  const [viewer, setViewer] = useState<{ username: string | null; avatarUrl: string | null } | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void getUserProfile(user.id, user.id).then((profile) => {
      if (!cancelled) setViewer({ username: profile?.username ?? null, avatarUrl: profile?.avatarUrl ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  const viewerAvatarUrl = oauthAvatarUrl ?? viewer?.avatarUrl ?? null;

  const params = useLocalSearchParams<{
    positionKind?: string;
    positionId?: string;
    name?: string;
    direction?: string;
    leverage?: string;
    pct?: string;
    ageDays?: string;
    valueUsd?: string;
    logoUrl?: string;
    logoFallbackUrls?: string;
  }>();

  const ref = useMemo<PositionRef | null>(() => {
    const id = params.positionId;
    if (!id) return null;
    switch (params.positionKind) {
      case "perp":
        return { kind: "perp", id };
      case "phoenix":
        return { kind: "phoenix", key: id };
      // A spot holding is derived on-device and only knows its SANDWICH; the
      // server resolves the caller's open position for it. Sending this as a
      // `sandwich` ref would look a position row up by a sandwich id and refuse
      // every spot take as "not found".
      case "sandwichId":
        return { kind: "sandwichId", id };
      case "sandwich":
        return { kind: "sandwich", id };
      default:
        return null;
    }
  }, [params.positionId, params.positionKind]);

  const pct = params.pct === undefined ? null : Number(params.pct);
  const livePct = pct !== null && Number.isFinite(pct) ? pct : null;
  const valueUsd = params.valueUsd === undefined ? null : Number(params.valueUsd);
  const liveValue = valueUsd !== null && Number.isFinite(valueUsd) ? valueUsd : null;
  // Empty when the caller does not know when the position opened (perps). The
  // server reads the real age for the stamp either way; this is only the
  // preview, and a guessed "0d" would be a wrong preview.
  const ageDays = params.ageDays ? Number(params.ageDays) : null;
  const leverage = params.leverage ? Number(params.leverage) : null;
  const logoFallbackUrls = useMemo<string[]>(() => {
    try {
      const parsed = JSON.parse(params.logoFallbackUrls ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
    } catch {
      return [];
    }
  }, [params.logoFallbackUrls]);

  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The basket itself, for the card under the field: byline, name, legs. The
  // params carry the numbers; only the sandwich knows who built it and from
  // what. Perp and Phoenix positions have no basket and keep the plain card.
  const [sandwich, setSandwich] = useState<Sandwich | null>(null);
  useEffect(() => {
    if (!ref || ref.kind !== "sandwich") return;
    let cancelled = false;
    void getSandwichById(ref.id)
      .then((loaded) => {
        if (!cancelled) setSandwich(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ref]);

  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, []);

  const canPost = body.trim().length > 0 && !posting && ref !== null;

  async function handlePost() {
    if (!ref || !canPost) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPosting(true);
    setError(null);

    const result = await createPositionTake({
      positionRef: ref,
      body: body.trim(),
      signal: null,
      attachmentUrl: null,
    });

    setPosting(false);
    if (result.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    // Each refusal is a real state, not a generic failure — and the one that
    // matters most is the position closing under them mid-compose.
    setError(
      result.reason === "not_open"
        ? "This position is closed. A take is written while you're holding."
        : result.reason === "not_found"
          ? "We couldn't find that position on your account."
          : result.reason === "cooldown"
            ? `You posted a take on this recently. Try again in ${formatCountdown(result.retryAfterMs)}.`
            : result.message,
    );
  }

  const stampColor = livePct === null ? colors.textSecondary : livePct >= 0 ? colors.positive : colors.negative;
  const sideLabel = params.direction ? params.direction.toUpperCase() : null;
  // A perp reads "SHORT 8x" in the side's colour, the way the position sheet
  // heads it; a spot basket has no side and shows its age instead.
  const isPerp = ref?.kind === "perp" || ref?.kind === "phoenix";
  const sideColor = sideLabel === "SHORT" ? colors.negative : colors.positive;
  const metaLine = isPerp
    ? [sideLabel, leverage && Number.isFinite(leverage) ? formatLeverage(leverage) : null].filter(Boolean).join(" ")
    : [sideLabel, ageDays !== null && Number.isFinite(ageDays) ? ageLabel(ageDays) : null]
        .filter(Boolean)
        .join(" · ");
  const creator = sandwich ? getSandwichCreatorMeta(sandwich) : null;
  const bylineName = creator?.origin?.name ?? creator?.name ?? null;
  const bylineIsHandle = creator?.origin ? creator.origin.isHandle : Boolean(creator?.name);
  const bylineAvatarUrl = creator?.origin ? creator.origin.avatarUrl : creator?.avatarUrl ?? null;
  const builderSubHandle = creator?.origin ? creator.name : null;
  const valueLabel = liveValue === null ? "—" : formatUsd(liveValue);
  const pctLabel = livePct === null ? "—" : signedPct(livePct);

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <SafeAreaView style={styles.page} edges={["top"]}>
        <View style={styles.nav}>
          <View style={styles.navSide}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={12}
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons name="chevron-back" size={21} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.navSide} />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Whose position this is, then the field. Tapping anywhere in the
            (tall) input zone focuses it. */}
        <Pressable style={styles.inputZone} onPress={() => inputRef.current?.focus()}>
          <View style={styles.bylineRow}>
            {viewerAvatarUrl ? (
              <Image source={{ uri: viewerAvatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Ionicons name="person" size={18} color={colors.textTertiary} />
              </View>
            )}
            <Text numberOfLines={1} style={styles.byline}>
              {viewer?.username ? (
                <>
                  <Text style={styles.bylineMuted}>@</Text>
                  {viewer.username}
                  <Text style={styles.bylineMuted}>&rsquo;s position</Text>
                </>
              ) : (
                "Your position"
              )}
            </Text>
          </View>
          <TextInput
            ref={inputRef}
            value={body}
            onChangeText={(next) => {
              setBody(next);
              if (error) setError(null);
            }}
            placeholder="Add a thesis to your trade"
            placeholderTextColor={colors.iconMuted}
            multiline
            maxLength={MAX_TAKE_LENGTH}
            accessibilityLabel="Your thesis"
            textAlignVertical="top"
            autoCapitalize="sentences"
            style={styles.input}
          />
        </Pressable>

        {/* The position this is about, as the reader will see it on the take.
            A basket gets its holding card — byline, take, legs — because that
            is what the reader's feed will show the thesis attached to. */}
        {sandwich ? (
          <View style={styles.sandwichCard}>
            <View style={styles.sandwichMainRow}>
              {bylineAvatarUrl ? (
                <Image source={{ uri: bylineAvatarUrl }} style={styles.sandwichAvatar} />
              ) : (
                <View style={[styles.sandwichAvatar, styles.avatarFallback]}>
                  <Ionicons name="person" size={16} color={colors.textTertiary} />
                </View>
              )}
              <View style={styles.sandwichCopy}>
                {bylineName ? (
                  <View style={styles.sandwichHandleRow}>
                    <Text numberOfLines={1} style={styles.sandwichHandle}>
                      {bylineIsHandle ? `@${bylineName}` : bylineName}
                    </Text>
                    {!creator?.origin ? <VerifiedBadge size={14} /> : null}
                  </View>
                ) : null}
                {builderSubHandle ? (
                  <View style={styles.sandwichHandleRow}>
                    <Text numberOfLines={1} style={styles.sandwichSubHandle}>
                      @{builderSubHandle}
                    </Text>
                    <VerifiedBadge size={12} />
                  </View>
                ) : null}
                <Text numberOfLines={2} style={styles.sandwichName}>
                  {sandwich.name}
                </Text>
              </View>
              <View style={styles.positionMetric}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.positionValue}>
                  {valueLabel}
                </Text>
                <Text style={[styles.positionPct, { color: stampColor }]}>{pctLabel}</Text>
              </View>
            </View>
            <View style={styles.sandwichLegsPill}>
              <CardAssetIcons legs={sandwich.legs} />
              <Text style={[styles.sandwichLegsReturn, { color: stampColor }]}>
                {formatSignedPnlPercentage(livePct) ?? "—"}
              </Text>
            </View>
          </View>
        ) : (
        <View style={styles.positionCard}>
          <AssetLogo
            uri={params.logoUrl || null}
            fallbackUris={logoFallbackUrls}
            size={44}
            borderRadius={22}
            backgroundColor={colors.surfaceAlt}
            fallback={
              <View style={styles.positionLogoFallback}>
                <Ionicons name="layers-outline" size={18} color={colors.icon} />
              </View>
            }
          />
          <View style={styles.positionCopy}>
            <Text numberOfLines={1} style={styles.positionName}>
              {params.name ?? "Your position"}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.positionMeta, isPerp && sideLabel && [styles.positionSide, { color: sideColor }]]}
            >
              {metaLine}
            </Text>
          </View>
          <View style={styles.positionMetric}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.positionValue}>
              {liveValue === null ? "—" : formatUsd(liveValue)}
            </Text>
            <Text style={[styles.positionPct, { color: stampColor }]}>{pctLabel}</Text>
          </View>
        </View>
        )}

        <View style={[styles.toolbar, { paddingBottom: 10 + insets.bottom }]}>
          <View style={styles.toolbarLeft} />
          <Text style={styles.count}>
            {body.length}/{MAX_TAKE_LENGTH}
          </Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Post"
            onPress={() => void handlePost()}
            disabled={!canPost}
            style={[styles.postBtn, !canPost && styles.postBtnDisabled]}
          >
            {posting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.postBtnText}>POST</Text>
            )}
          </PressableScale>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    nav: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 2,
      marginBottom: 14,
    },
    navSide: { minWidth: 56, justifyContent: "center" },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    errorBox: {
      marginHorizontal: 20,
      marginBottom: 8,
      padding: 12,
      borderRadius: 12,
      backgroundColor: c.surfaceAlt,
    },
    errorText: { color: c.negative, fontSize: 13, fontWeight: "600", fontFamily: F },
    inputZone: {
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: 16,
      gap: 14,
    },
    bylineRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    byline: { color: c.text, fontSize: 17, fontWeight: "600", fontFamily: F, flexShrink: 1 },
    bylineMuted: { color: c.textTertiary, fontWeight: "500" },
    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceAlt },
    avatarFallback: { alignItems: "center", justifyContent: "center" },
    input: {
      flex: 1,
      color: c.text,
      fontSize: 17,
      lineHeight: 23,
      fontWeight: "500",
      fontFamily: F,
      paddingTop: 0,
    },
    // Same lift as the basket card: white, floating, not a grey inset.
    positionCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginHorizontal: 20,
      padding: 14,
      borderRadius: 16,
      backgroundColor: c.surface,
      shadowColor: "#0B1220",
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    },
    positionLogoFallback: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
    },
    positionCopy: { flex: 1, gap: 2 },
    positionName: { color: c.text, fontSize: 16, fontWeight: "800", fontFamily: F },
    positionMeta: { color: c.textSecondary, fontSize: 13, fontWeight: "600", fontFamily: F },
    // The sheet header's face for the side label — Rubik One, not rounded.
    positionSide: { fontFamily: Fonts.displayOne, fontWeight: "400", fontSize: 14, lineHeight: 18, letterSpacing: 0.2 },
    positionMetric: { alignItems: "flex-end", gap: 2 },
    positionValue: {
      color: c.text,
      fontSize: 16,
      fontWeight: "800",
      fontFamily: F,
      fontVariant: ["tabular-nums"],
    },
    positionPct: { fontSize: 13, fontWeight: "700", fontFamily: F, fontVariant: ["tabular-nums"] },
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 20,
      paddingTop: 14,
    },
    toolbarLeft: { flex: 1 },
    // A white card lifted off the page — the same treatment the feed gives a
    // sandwich — so the thesis reads as attached to a post, not to a form.
    sandwichCard: {
      marginHorizontal: 20,
      padding: 14,
      borderRadius: 16,
      backgroundColor: c.surface,
      gap: 10,
      shadowColor: "#0B1220",
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    },
    sandwichMainRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    sandwichAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.surfaceAlt },
    sandwichCopy: { flex: 1, gap: 1 },
    sandwichHandleRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    sandwichHandle: { color: c.text, fontSize: 14, fontWeight: "800", fontFamily: F, flexShrink: 1 },
    sandwichSubHandle: { color: c.textSecondary, fontSize: 12, fontWeight: "700", fontFamily: F, flexShrink: 1 },
    sandwichName: { color: c.text, fontSize: 16, fontWeight: "600", fontFamily: F, lineHeight: 21, marginTop: 2 },
    sandwichLegsPill: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingLeft: 6,
      paddingRight: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    sandwichLegsReturn: { fontSize: 13, fontWeight: "800", fontFamily: F, fontVariant: ["tabular-nums"] },
    count: { color: c.textTertiary, fontSize: 14, fontWeight: "600", fontFamily: F, fontVariant: ["tabular-nums"] },
    postBtn: {
      width: 116,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.actionPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
    postBtnDisabled: { opacity: 0.45 },
    postBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900", fontFamily: F, letterSpacing: 0.8 },
  });
