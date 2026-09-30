import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import RNShare, { Social } from 'react-native-share';
import { captureRef } from 'react-native-view-shot';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { BlurBackdrop } from '@/components/blur-backdrop';
import { LineChart } from '@/components/line-chart';
import {
  SHARE_CARD_NEGATIVE,
  SHARE_CARD_POSITIVE,
  ShareCardVariantPicker,
  SharePerformanceCard,
  type ShareCardVariant,
} from '@/components/share-performance-card';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';
import { useWalletStore } from '@/lib/wallet-store';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

const INSTAGRAM_APP_ID = process.env.EXPO_PUBLIC_INSTAGRAM_APP_ID ?? '';

const INSTAGRAM_GRADIENT = ['#FEDA75', '#FA7E1E', '#D62976', '#962FBF'] as const;

function formatPrice(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value);
}

function formatSignedUsd(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/**
 * Position figures handed in by the caller, for a holding the wallet store
 * cannot price on its own — a perp lives on Phoenix, not in the token list, so
 * there is no balance or cost basis to derive any of this from. When this is
 * set the token lookup is skipped and these numbers are used verbatim.
 */
export type AssetSharePosition = {
  /** Replaces "My Bread position" on the card, e.g. "My Bread 5x long". */
  identityLabel?: string | null;
  /** What the position is worth now — notional for a perp. */
  valueUsd: number | null;
  /** Capital behind it — collateral for a perp. */
  investedUsd: number | null;
  entryPrice: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  /** Sentence for the text-only targets, e.g. "My LONG SOL on Bread". */
  message?: string | null;
};

export type AssetShareData = {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  price: number | null;
  change24h: number | null;
  /** Set to draw the card from the caller's numbers instead of the wallet. */
  position?: AssetSharePosition | null;
  /**
   * Chart drawn on the card. Defaults to this mint's price line; pass a node
   * for an asset that line cannot resolve — a perp market has no mint.
   */
  chart?: React.ReactNode;
};

export type AssetShareSheetRef = {
  open: (data: AssetShareData) => void;
  dismiss: () => void;
};

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
  icon?: React.ComponentProps<typeof Ionicons>['name'];
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

export const AssetShareSheet = forwardRef<AssetShareSheetRef, unknown>(
  function AssetShareSheet(_props, ref) {
    const styles = useThemedStyles(makeStyles);
    const { colors } = useThemeStore();
    const { height: windowHeight } = useWindowDimensions();
    const sheetRef = useRef<BottomSheetModal>(null);
    const cardRef = useRef<View>(null);
    const toast = useToast();
    const walletStore = useWalletStore();
    const [asset, setAsset] = React.useState<AssetShareData | null>(null);
    const [cardVariant, setCardVariant] = React.useState<ShareCardVariant>('classic');

    useImperativeHandle(
      ref,
      () => ({
        open: (data: AssetShareData) => {
          setAsset(data);
          setCardVariant('classic');
          sheetRef.current?.present();
        },
        dismiss: () => sheetRef.current?.dismiss(),
      }),
      [],
    );

    const maxSheetHeight = Math.round(windowHeight * 0.92);

    const renderBackdrop = useCallback(
      (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
        <BlurBackdrop {...props} />
      ),
      [],
    );

    // Position data. A caller-supplied position wins outright — the wallet has
    // nothing to say about a holding it does not custody.
    const supplied = asset?.position ?? null;
    const token =
      asset && !supplied ? walletStore.tokens.find((t) => t.mint === asset.mint) : null;
    const costEntry = asset && !supplied ? walletStore.costBasis[asset.mint] ?? null : null;
    const qty = token?.balance ?? 0;
    const hasPosition = supplied ? true : qty > 0;
    const pricedPositionValue =
      asset?.price != null && Number.isFinite(asset.price) && asset.price > 0
        ? qty * asset.price
        : null;
    const positionValue = supplied
      ? supplied.valueUsd
      : token?.usdValue != null && Number.isFinite(token.usdValue) && token.usdValue > 0
        ? token.usdValue
        : pricedPositionValue;
    const avgCost = supplied ? supplied.entryPrice : costEntry?.avgPriceUsd ?? null;
    const totalCost = supplied
      ? supplied.investedUsd
      : avgCost != null
        ? avgCost * qty
        : null;
    const unrealizedPnl = supplied
      ? supplied.pnlUsd
      : totalCost != null && positionValue != null
        ? positionValue - totalCost
        : null;
    const unrealizedPct = supplied
      ? supplied.pnlPct
      : totalCost != null && totalCost > 0 && positionValue != null
        ? ((positionValue - totalCost) / totalCost) * 100
        : null;

    const pnlColor =
      unrealizedPnl == null || unrealizedPnl === 0
        ? SHARE_CARD_POSITIVE
        : unrealizedPnl > 0
          ? SHARE_CARD_POSITIVE
          : SHARE_CARD_NEGATIVE;
    const pnlPositive = (unrealizedPnl ?? 0) >= 0;
    const currentPrice =
      asset?.price ?? (positionValue != null && qty > 0 ? positionValue / qty : null);
    const dateLabel = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date());

    const shareMessage = useMemo(() => {
      if (!asset) return '';
      if (asset.position?.message) return asset.position.message;
      let msg = `Check out ${asset.name} (${asset.symbol}) on Bread 🍞`;
      if (hasPosition) {
        msg =
          positionValue == null
            ? `I'm holding ${asset.name} (${asset.symbol})`
            : `I'm holding ${formatPrice(positionValue)} of ${asset.name} (${asset.symbol})`;
        if (unrealizedPnl != null) {
          msg += ` — ${unrealizedPnl >= 0 ? 'up' : 'down'} ${formatSignedUsd(unrealizedPnl)}`;
          if (unrealizedPct != null) msg += ` (${formatPct(unrealizedPct)})`;
        }
        msg += ' on Bread 🍞';
      }
      return msg;
    }, [asset, hasPosition, positionValue, unrealizedPnl, unrealizedPct]);

    const handleCopyImage = useCallback(async () => {
      if (!asset) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const base64 = await captureRef(cardRef, {
          format: 'png',
          quality: 1,
          result: 'base64',
        });
        await Clipboard.setImageAsync(base64);
        toast.showToast('Image copied', 'success');
      } catch {
        toast.showToast("Couldn't copy image", 'error');
      }
    }, [asset, toast]);

    const openShareUrl = useCallback(
      async (url: string, appLabel: string) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        try {
          await Linking.openURL(url);
        } catch {
          toast.showToast(`Couldn't open ${appLabel}`, 'error');
        }
      },
      [toast],
    );

    const handleShareToMessages = useCallback(() => {
      if (!shareMessage) return;
      const separator = Platform.OS === 'ios' ? '&' : '?';
      void openShareUrl(
        `sms:${separator}body=${encodeURIComponent(shareMessage)}`,
        'Messages',
      );
    }, [shareMessage, openShareUrl]);

    const handleShareToWhatsApp = useCallback(() => {
      if (!shareMessage) return;
      void openShareUrl(
        `whatsapp://send?text=${encodeURIComponent(shareMessage)}`,
        'WhatsApp',
      );
    }, [shareMessage, openShareUrl]);

    const handleShareToX = useCallback(async () => {
      if (!asset || !shareMessage) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const base64 = await captureRef(cardRef, {
          format: 'png',
          quality: 1,
          result: 'base64',
        });
        await RNShare.shareSingle({
          social: Social.Twitter,
          url: `data:image/png;base64,${base64}`,
          type: 'image/png',
          filename: `bread-${asset.symbol}-position.png`,
          message: shareMessage,
          useInternalStorage: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!/did not share|cancel/i.test(message)) {
          toast.showToast("Couldn't open X", 'error');
        }
      }
    }, [asset, shareMessage, toast]);

    const handleShareToInstagramStory = useCallback(async () => {
      if (!asset) return;
      if (!INSTAGRAM_APP_ID) {
        toast.showToast("Instagram sharing isn't configured yet", 'error');
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const base64 = await captureRef(cardRef, {
          format: 'png',
          quality: 1,
          result: 'base64',
        });
        await RNShare.shareSingle({
          social: Social.InstagramStories,
          appId: INSTAGRAM_APP_ID,
          stickerImage: `data:image/png;base64,${base64}`,
          backgroundTopColor: '#FFFFFF',
          backgroundBottomColor: '#FFFFFF',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (!/did not share|cancel/i.test(message)) {
          toast.showToast("Couldn't share to Instagram", 'error');
        }
      }
    }, [asset, toast]);

    const handleShareToInstagramChat = useCallback(async () => {
      if (!shareMessage) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        await RNShare.shareSingle({
          social: Social.Instagram,
          message: encodeURIComponent(shareMessage),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (!/did not share|cancel/i.test(message)) {
          toast.showToast("Couldn't open Instagram", 'error');
        }
      }
    }, [shareMessage, toast]);

    const handleNativeShare = useCallback(async () => {
      if (!asset) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const base64 = await captureRef(cardRef, {
          format: 'png',
          quality: 1,
          result: 'base64',
        });
        await RNShare.open({
          title: asset.name,
          message: shareMessage,
          url: `data:image/png;base64,${base64}`,
          type: 'image/png',
          filename: `bread-${asset.symbol}-position.png`,
          failOnCancel: false,
        });
      } catch {
        // cancelled
      }
    }, [asset, shareMessage]);

    return (
      <BottomSheetModal
        ref={sheetRef}
        enableDynamicSizing
        maxDynamicContentSize={maxSheetHeight}
        backdropComponent={renderBackdrop}
        // Grab pill hidden app-wide; the handle area still drags.
        handleIndicatorStyle={styles.handleHidden}
        backgroundStyle={styles.sheetBg}
      >
        <BottomSheetScrollView contentContainerStyle={styles.container}>
          {asset ? (
            <>
              <View style={styles.headerRow}>
                <Text style={styles.headerTitle}>Share asset</Text>
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

              {/* Fixed light artifact — independent of the app theme. */}
              <View ref={cardRef} collapsable={false}>
                <SharePerformanceCard
                  variant={cardVariant}
                  title={asset.name}
                  subtitle={asset.symbol}
                  iconUri={asset.icon}
                  iconFallback={asset.name}
                  dateLabel={dateLabel}
                  identityLabel={supplied?.identityLabel || 'My Bread position'}
                  returnValue={
                    unrealizedPnl == null ? formatPrice(positionValue) : formatSignedUsd(unrealizedPnl)
                  }
                  returnDetail={
                    unrealizedPct == null
                      ? null
                      : `${pnlPositive ? '▲' : '▼'} ${Math.abs(unrealizedPct).toFixed(2)}%`
                  }
                  positive={pnlPositive}
                  stats={[
                    { label: 'Invested', value: formatPrice(totalCost) },
                    { label: 'Entry', value: formatPrice(avgCost) },
                    { label: 'Current', value: formatPrice(currentPrice) },
                  ]}
                  chart={
                    asset.chart !== undefined ? (
                      asset.chart
                    ) : (
                      <LineChart
                        mint={asset.mint}
                        activeWindow="1M"
                        height={108}
                        anchorPrice={currentPrice}
                        color={pnlColor}
                        // The share card is a fixed white surface in either
                        // app theme, so the chart's overlays cannot fall back
                        // to the themed background here.
                        surfaceColor="#FFFFFF"
                      />
                    )
                  }
                />
              </View>

              {/* Share targets */}
              <View style={styles.targetsRow}>
                <ShareTarget
                  label="Messages"
                  icon="chatbubble-ellipses"
                  iconColor="#ffffff"
                  bg="#34DA50"
                  onPress={handleShareToMessages}
                />
                <ShareTarget
                  label="IG Story"
                  icon="logo-instagram"
                  iconColor="#ffffff"
                  bg="#C13584"
                  gradient={INSTAGRAM_GRADIENT}
                  onPress={() => void handleShareToInstagramStory()}
                />
                <ShareTarget
                  label="IG Chat"
                  icon="paper-plane"
                  iconColor="#ffffff"
                  bg="#C13584"
                  gradient={INSTAGRAM_GRADIENT}
                  onPress={() => void handleShareToInstagramChat()}
                />
                <ShareTarget
                  label="WhatsApp"
                  icon="logo-whatsapp"
                  iconColor="#ffffff"
                  bg="#25D366"
                  onPress={handleShareToWhatsApp}
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
      </BottomSheetModal>
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
      paddingHorizontal: 18,
      paddingBottom: 32,
      paddingTop: 4,
      gap: 16,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerTitle: {
      color: c.text,
      fontSize: 18,
      fontWeight: '800',
      fontFamily: F,
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    targetsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      rowGap: 18,
      columnGap: 8,
      paddingHorizontal: 4,
    },
    target: {
      alignItems: 'center',
      gap: 8,
      width: 72,
    },
    targetCircle: {
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    targetLabel: {
      color: c.textSecondary,
      fontSize: 12,
      fontWeight: '600',
      fontFamily: F,
      textAlign: 'center',
    },
    targetGlyph: {
      fontSize: 26,
      fontWeight: '900',
      fontFamily: F,
      lineHeight: 30,
    },
  });
