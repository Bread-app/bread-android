import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { SheetModal } from "@/components/sheet-modal";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { usePrivy } from "@privy-io/expo";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import RNShare, { Social } from "react-native-share";
import { captureRef } from "react-native-view-shot";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BlurBackdrop } from "@/components/blur-backdrop";
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import {
  appUserPayloadFromPrivyUser,
  getSandwichShareUrl,
  getUserProfile,
  type Sandwich,
} from "@/lib/api";
import { useThemeStore } from "@/lib/theme-store";
import { useToast } from "@/lib/toast-store";
import { SandwichBasketChart } from "@/components/sandwich-basket-chart";
import {
  SHARE_CARD_NEGATIVE,
  SHARE_CARD_POSITIVE,
  ShareCardVariantPicker,
  SharePerformanceCard,
  type ShareCardVariant,
} from "@/components/share-performance-card";
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

// Instagram requires a registered Facebook App ID to accept a Stories share
// (Meta's rule, not ours). Set EXPO_PUBLIC_INSTAGRAM_APP_ID to enable the
// Instagram button; without it we tell the user instead of failing silently.
const INSTAGRAM_APP_ID = process.env.EXPO_PUBLIC_INSTAGRAM_APP_ID ?? "";

/** Big headline PnL — "+34%" once double digits, "+3.4%" below. */
function formatPnlBig(value: number | null): string {
  if (value === null) return "--";
  const decimals = Math.abs(value) >= 10 ? 0 : 1;
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

/** The creator's own words — the heart of the share card. */
function getUserThesisText(sandwich: Sandwich): string {
  const quote = sandwich.source.quote?.trim();
  if (quote) return quote;
  const input = sandwich.source.input.trim();
  if (input && !/^https?:\/\//i.test(input)) return input;
  return sandwich.thesis.summary || sandwich.summary;
}

export type SandwichShareSheetRef = {
  open: (sandwich: Sandwich) => void;
  dismiss: () => void;
};

/** Instagram's brand gradient, used to tint its Story/Chat icons. */
const INSTAGRAM_GRADIENT = ["#FEDA75", "#FA7E1E", "#D62976", "#962FBF"] as const;

/** One circular app icon + label in the share row. A
 * `gradient` (e.g. Instagram) takes precedence over the solid `bg`. Pass
 * `glyph` instead of `icon` to render a text mark (e.g. X's 𝕏, which Ionicons
 * has no logo for). */
function ShareTarget({
  label,
  icon,
  glyph,
  iconColor,
  bg,
  gradient,
  onPress,
}: {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  glyph?: string;
  iconColor: string;
  bg: string;
  gradient?: readonly string[];
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const inner = glyph ? (
    <Text style={[styles.targetGlyph, { color: iconColor }]}>{glyph}</Text>
  ) : icon ? (
    <Ionicons name={icon} size={26} color={iconColor} />
  ) : null;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Share via ${label}`}
      onPress={onPress}
      style={styles.target}
    >
      {gradient ? (
        <LinearGradient
          colors={gradient as readonly [string, string, ...string[]]}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
          style={styles.targetCircle}
        >
          {inner}
        </LinearGradient>
      ) : (
        <View style={[styles.targetCircle, { backgroundColor: bg }]}>{inner}</View>
      )}
      <Text style={styles.targetLabel} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

/**
 * A custom, theme-aware share sheet for a sandwich — a designed preview card
 * (the basket's performance line since creation, with the creator's thesis
 * pinned to it as a tilted quote card) plus copy-link and native-share
 * actions. Replaces the bare OS share dialog so what the user sees before
 * sharing matches the app's look. Drive it imperatively from the share tap via
 * the ref — `present()` must run synchronously from the gesture (see
 * [[bottom-sheet-present-pattern]]).
 */
export const SandwichShareSheet = forwardRef<SandwichShareSheetRef, unknown>(
  function SandwichShareSheet(_props, ref) {
    const styles = useThemedStyles(makeStyles);
    const { colors } = useThemeStore();
    const { user } = usePrivy();
    const appUser = useMemo(() => appUserPayloadFromPrivyUser(user), [user]);
    const insets = useSafeAreaInsets();
    const sheetRef = useRef<BottomSheetModal>(null);
    // The preview card view — captured to an image for the Instagram Story share.
    const cardRef = useRef<View>(null);
    const toast = useToast();
    const [sandwich, setSandwich] = useState<Sandwich | null>(null);
    const [loggedInUsername, setLoggedInUsername] = useState<string | null>(null);
    const [cardVariant, setCardVariant] = useState<ShareCardVariant>("classic");

    useEffect(() => {
      const fallbackUsername = appUser?.name?.trim().replace(/^@+/, "") || null;
      setLoggedInUsername(fallbackUsername);
      if (!appUser?.privyUserId) return;

      let cancelled = false;
      void getUserProfile(appUser.privyUserId, appUser.privyUserId)
        .then((profile) => {
          if (cancelled || !profile?.username) return;
          setLoggedInUsername(profile.username.replace(/^@+/, ""));
        })
        .catch(() => {
          // Keep the Privy identity fallback when the profile is unavailable.
        });

      return () => {
        cancelled = true;
      };
    }, [appUser?.name, appUser?.privyUserId]);

    useImperativeHandle(
      ref,
      () => ({
        open: (next: Sandwich) => {
          setSandwich(next);
          setCardVariant("classic");
          sheetRef.current?.present();
        },
        dismiss: () => sheetRef.current?.dismiss(),
      }),
      [],
    );

    const snapPoints = useMemo(() => ["100%"], []);

    const renderBackdrop = useCallback(
      (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
        <BlurBackdrop {...props} />
      ),
      [],
    );

    const shareUrl = sandwich ? getSandwichShareUrl(sandwich.id) : "";

    // The full text payload used by the native "More" share sheet.
    const shareMessage = useMemo(() => {
      if (!sandwich) return "";
      const sourceUrl = sandwich.source.sourceUrl;
      return [
        sandwich.name,
        getUserThesisText(sandwich),
        shareUrl,
        sourceUrl ? `Source: ${sourceUrl}` : null,
      ]
        .filter((part): part is string => !!part && part.trim().length > 0)
        .join("\n\n");
    }, [sandwich, shareUrl]);

    const xShareMessage = useMemo(() => {
      if (!sandwich) return "";
      return `${sandwich.name} on Bread 🥪\n${shareUrl}`;
    }, [sandwich, shareUrl]);

    // Open X's composer with the rendered share card and a compact caption.
    const handleShareToX = useCallback(async () => {
      if (!sandwich) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const base64 = await captureRef(cardRef, {
          format: "png",
          quality: 1,
          result: "base64",
        });
        await RNShare.shareSingle({
          social: Social.Twitter,
          url: `data:image/png;base64,${base64}`,
          type: "image/png",
          filename: `bread-${sandwich.id}.png`,
          message: xShareMessage,
          useInternalStorage: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (!/did not share|cancel/i.test(message)) {
          toast.showToast("Couldn't open X", "error");
        }
      }
    }, [sandwich, xShareMessage, toast]);

    // Real Instagram Story share: render the preview card to an image and hand
    // it to Instagram's Stories composer via react-native-share. We pass the
    // card as a `stickerImage` (centered over a solid background colour) rather
    // than a `backgroundImage` — a background image is stretched full-screen and
    // letterboxed with black, which is the black border the card's rounded
    // corners produced. As a sticker, the transparent area is filled by the
    // background colour instead. Requires a Facebook App ID (Meta's rule).
    const handleShareToInstagramStory = useCallback(async () => {
      if (!sandwich) return;
      if (!INSTAGRAM_APP_ID) {
        toast.showToast("Instagram sharing isn't configured yet", "error");
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const base64 = await captureRef(cardRef, {
          format: "png",
          quality: 1,
          result: "base64",
        });
        await RNShare.shareSingle({
          social: Social.InstagramStories,
          appId: INSTAGRAM_APP_ID,
          stickerImage: `data:image/png;base64,${base64}`,
          backgroundTopColor: "#FFFFFF",
          backgroundBottomColor: "#FFFFFF",
          // Attach the sandwich link to the Story. `attributionURL` is
          // Instagram's official content link; `linkUrl`/`linkText` add a link
          // sticker on versions/accounts that support it. Whether any of these
          // become a *tappable* sticker is decided by Instagram (gated by
          // account eligibility) — we can only attach the URL, not force it.
          attributionURL: shareUrl,
          linkUrl: shareUrl,
          linkText: "Open on Bread",
        });
      } catch (err) {
        // react-native-share throws "User did not share" on cancel — ignore it;
        // surface anything else (Instagram missing, capture failed) as a toast.
        const message = err instanceof Error ? err.message : "";
        if (!/did not share|cancel/i.test(message)) {
          toast.showToast("Couldn't share to Instagram", "error");
        }
      }
    }, [sandwich, shareUrl, toast]);

    // Capture the designed card to a PNG and put it on the clipboard, ready to
    // paste anywhere (iMessage, X, Notes…).
    const handleCopyImage = useCallback(async () => {
      if (!sandwich) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const base64 = await captureRef(cardRef, {
          format: "png",
          quality: 1,
          result: "base64",
        });
        await Clipboard.setImageAsync(base64);
        toast.showToast("Image copied", "success");
      } catch {
        toast.showToast("Couldn't copy image", "error");
      }
    }, [sandwich, toast]);

    const handleNativeShare = useCallback(async () => {
      if (!sandwich) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        await Share.share({
          title: sandwich.name,
          message: shareMessage,
          url: shareUrl,
        });
      } catch {
        // User-cancelled or unavailable — keep the sheet open, no toast needed.
      }
    }, [sandwich, shareMessage, shareUrl]);

    // Who made the call — X author for summoned sandwiches, the app user
    // otherwise; the sandwich name as a last resort so the card never shows an
    // empty identity row.
    const source = sandwich?.source;
    const creatorDisplayName =
      source?.authorName?.trim() ||
      source?.user?.name?.trim() ||
      source?.user?.username?.trim() ||
      sandwich?.name ||
      "";
    const creatorHandle =
      source?.authorHandle?.replace(/^@+/, "") ||
      source?.user?.username ||
      null;

    // Basket PnL snapshot — the live return at the moment of sharing. Hidden
    // when the pipeline can't price it (`unavailable` / null) so the card never
    // shows a misleading 0.00%.
    const pnlPct = sandwich?.pnlPct ?? null;
    const showPnl =
      sandwich != null && sandwich.pnlStatus !== "unavailable" && pnlPct !== null;
    const pnlPositive = (pnlPct ?? 0) >= 0;
    const pnlColor = pnlPositive ? SHARE_CARD_POSITIVE : SHARE_CARD_NEGATIVE;
    const dateLabel = sandwich
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(new Date(sandwich.createdAt))
      : "";
    const firstLeg = sandwich?.legs[0] ?? null;
    const identityLabel = creatorHandle
      ? `@${creatorHandle}'s sandwich`
      : `${creatorDisplayName}'s sandwich`;

    return (
      <SheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        topInset={insets.top}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        // Grab pill hidden app-wide; the handle area still drags.
        handleIndicatorStyle={styles.handleHidden}
        backgroundStyle={styles.sheetBg}
      >
        <BottomSheetScrollView
          contentContainerStyle={[
            styles.container,
            { paddingBottom: Math.max(32, insets.bottom + 16) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {sandwich ? (
            <>
              <View style={styles.headerRow}>
                <Text style={styles.headerTitle}>Share sandwich</Text>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Close share sheet"
                  hitSlop={10}
                  onPress={() => sheetRef.current?.dismiss()}
                  style={styles.closeBtn}
                >
                  <Ionicons name="close" size={20} color={colors.textSecondary} />
                </PressableScale>
              </View>

              <ShareCardVariantPicker value={cardVariant} onChange={setCardVariant} />

              {/* Same fixed-light artifact used by position shares. */}
              <View ref={cardRef} collapsable={false}>
                <SharePerformanceCard
                  variant={cardVariant}
                  title={sandwich.name}
                  subtitle={`${sandwich.legs.length} ${sandwich.legs.length === 1 ? "asset" : "assets"}`}
                  iconUri={firstLeg?.imageUrl}
                  iconFallback={sandwich.name}
                  dateLabel={dateLabel}
                  identityLabel={identityLabel}
                  returnValue={showPnl ? formatPnlBig(pnlPct) : "—"}
                  returnDetail={showPnl ? "basket return" : null}
                  positive={pnlPositive}
                  stats={[
                    { label: "Assets", value: String(sandwich.legs.length) },
                    {
                      label: "Direction",
                      value: sandwich.direction.charAt(0).toUpperCase() + sandwich.direction.slice(1),
                    },
                    { label: "Horizon", value: sandwich.horizon || "—" },
                  ]}
                  footerLabel={`breadapp.fun/${loggedInUsername || "bread"}`}
                  chart={
                    <SandwichBasketChart
                      legs={sandwich.legs}
                      createdAt={sandwich.createdAt}
                      targetReturnPct={pnlPct}
                      showReturn={false}
                      variant="spark"
                      height={108}
                      color={pnlColor}
                      revealBackgroundColor="#FFFFFF"
                    />
                  }
                />
              </View>

              {/* Per-app share targets for the rendered sandwich card. */}
              <View style={styles.targetsRow}>
                <ShareTarget
                  label="IG Story"
                  icon="logo-instagram"
                  iconColor="#ffffff"
                  bg="#C13584"
                  gradient={INSTAGRAM_GRADIENT}
                  onPress={() => void handleShareToInstagramStory()}
                />
                <ShareTarget
                  label="X"
                  glyph="𝕏"
                  iconColor="#ffffff"
                  bg="#000000"
                  onPress={() => void handleShareToX()}
                />
                <ShareTarget
                  label="Copy image"
                  icon="image"
                  iconColor={colors.text}
                  bg={colors.surfaceAlt}
                  onPress={() => void handleCopyImage()}
                />
                <ShareTarget
                  label="More"
                  icon="ellipsis-horizontal"
                  iconColor={colors.text}
                  bg={colors.surfaceAlt}
                  onPress={handleNativeShare}
                />
              </View>
            </>
          ) : null}
        </BottomSheetScrollView>
      </SheetModal>
    );
  },
);

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    sheetBg: {
      backgroundColor: c.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleHidden: { backgroundColor: 'transparent' },
    handle: {
      backgroundColor: c.border,
      width: 36,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: 18,
      paddingBottom: 32,
      paddingTop: 4,
      gap: 16,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headerTitle: {
      color: c.text,
      fontSize: 18,
      fontWeight: "800",
      fontFamily: F,
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
    },
    targetGlyph: {
      fontSize: 26,
      fontWeight: "900",
      fontFamily: F,
      lineHeight: 30,
    },
    targetsRow: {
      marginTop: "auto",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "flex-start",
      rowGap: 18,
      columnGap: 8,
      paddingHorizontal: 4,
    },
    target: {
      alignItems: "center",
      gap: 8,
      width: 72,
    },
    targetCircle: {
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: "center",
      justifyContent: "center",
    },
    targetLabel: {
      color: c.textSecondary,
      fontSize: 12,
      fontWeight: "600",
      fontFamily: F,
      textAlign: "center",
    },
  });
