import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { SheetModal } from '@/components/sheet-modal';
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
  useState,
} from 'react';
import {
  Image,
  Linking,
  Platform,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import RNShare, { Social } from 'react-native-share';
import { captureRef } from 'react-native-view-shot';

import { BlurBackdrop } from '@/components/blur-backdrop';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';
import { withAlpha } from '@/lib/color-utils';
import { useToast } from '@/lib/toast-store';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;
const F_DISPLAY = Fonts.display;

const INSTAGRAM_APP_ID = process.env.EXPO_PUBLIC_INSTAGRAM_APP_ID ?? '';
const INSTAGRAM_GRADIENT = ['#FEDA75', '#FA7E1E', '#D62976', '#962FBF'] as const;

const BRAND_GREEN = '#35F046';
const BRAND_RED = '#FF1F4B';

function formatSignedUsd(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export type TradeShareData = {
  side: 'buy' | 'sell';
  amount: string;
  assetName: string;
  assetSymbol: string;
  assetIcon: string | null;
  realizedPnlUsd: number | null;
  realizedPnlPct: number | null;
  /** For sandwiches — the sandwich name, shown in the card header. */
  sandwichName?: string | null;
  /** For sandwiches — legs summary, e.g. "3 markets". */
  sandwichLegCount?: number | null;
};

export type TradeShareSheetRef = {
  open: (data: TradeShareData) => void;
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

export const TradeShareSheet = forwardRef<
  TradeShareSheetRef,
  { onDismiss?: () => void }
>(
  function TradeShareSheet({ onDismiss }, ref) {
    const styles = useThemedStyles(makeStyles);
    const { colors } = useThemeStore();
    const { height: windowHeight } = useWindowDimensions();
    const sheetRef = useRef<BottomSheetModal>(null);
    const cardRef = useRef<View>(null);
    const toast = useToast();
    const [trade, setTrade] = useState<TradeShareData | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        open: (data: TradeShareData) => {
          setTrade(data);
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

    const isSell = trade?.side === 'sell';
    const isSandwich = !!trade?.sandwichName;
    const actionVerb = isSell ? 'sold' : 'bought';
    const accentColor = isSell ? BRAND_RED : BRAND_GREEN;

    const trimmedAmount = trade?.amount?.trim() ?? '0';
    const amountDisplay = trimmedAmount.startsWith('$')
      ? trimmedAmount
      : `$${trimmedAmount}`;

    const hasPnl = trade?.realizedPnlUsd != null;
    const pnlPositive = (trade?.realizedPnlUsd ?? 0) >= 0;
    const pnlColor = pnlPositive ? colors.positive : colors.negative;

    const shareMessage = useMemo(() => {
      if (!trade) return '';
      const action = isSell ? 'sold' : 'bought';
      const entity = isSandwich
        ? `the "${trade.sandwichName}" sandwich`
        : `${trade.assetName} (${trade.assetSymbol})`;
      let msg = `I just ${action} ${amountDisplay} of ${entity}`;
      if (isSell && trade.realizedPnlUsd != null) {
        const direction = trade.realizedPnlUsd >= 0 ? 'profit' : 'loss';
        msg += ` with a ${direction} of ${formatSignedUsd(trade.realizedPnlUsd)}`;
        if (trade.realizedPnlPct != null) {
          msg += ` (${formatPct(trade.realizedPnlPct)})`;
        }
      }
      msg += ' on Bread 🍞';
      return msg;
    }, [trade, isSell, isSandwich, amountDisplay]);

    const handleCopyLink = useCallback(async () => {
      if (!shareMessage) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Clipboard.setStringAsync(shareMessage);
      toast.showToast('Copied', 'success');
    }, [shareMessage, toast]);

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
      if (!shareMessage) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const encoded = encodeURIComponent(shareMessage);
      try {
        await Linking.openURL(`twitter://post?message=${encoded}`);
      } catch {
        try {
          await Linking.openURL(`https://x.com/intent/tweet?text=${encoded}`);
        } catch {
          toast.showToast("Couldn't open X", 'error');
        }
      }
    }, [shareMessage, toast]);

    const handleShareToInstagramStory = useCallback(async () => {
      if (!trade) return;
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
          backgroundTopColor: colors.background,
          backgroundBottomColor: colors.background,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (!/did not share|cancel/i.test(message)) {
          toast.showToast("Couldn't share to Instagram", 'error');
        }
      }
    }, [trade, colors.background, toast]);

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
      if (!trade) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        await Share.share({
          title: isSandwich ? trade.sandwichName! : trade.assetName,
          message: shareMessage,
        });
      } catch {
        // cancelled
      }
    }, [trade, isSandwich, shareMessage]);

    return (
      <SheetModal
        ref={sheetRef}
        enableDynamicSizing
        maxDynamicContentSize={maxSheetHeight}
        onDismiss={onDismiss}
        backdropComponent={renderBackdrop}
        // Grab pill hidden app-wide; the handle area still drags.
        handleIndicatorStyle={styles.handleHidden}
        backgroundStyle={styles.sheetBg}
      >
        <BottomSheetView style={styles.container}>
          {trade ? (
            <>
              <View style={styles.headerRow}>
                <Text style={styles.headerTitle}>Share trade</Text>
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

              {/* Preview card */}
              <View ref={cardRef} collapsable={false} style={styles.card}>
                <LinearGradient
                  colors={[`${accentColor}22`, 'transparent']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.cardGlow}
                  pointerEvents="none"
                />

                <View style={styles.cardBrandRow}>
                  <Text style={styles.cardBrand}>🍞 Bread</Text>
                  <View style={[styles.sideBadge, { backgroundColor: `${accentColor}22` }]}>
                    <Text style={[styles.sideBadgeText, { color: accentColor }]}>
                      {isSell ? 'SOLD' : 'BOUGHT'}
                    </Text>
                  </View>
                </View>

                {/* Amount hero */}
                <Text
                  style={styles.cardAmount}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                >
                  {amountDisplay}
                </Text>

                {/* Asset row */}
                <View style={styles.assetRow}>
                  {trade.assetIcon ? (
                    <Image source={{ uri: trade.assetIcon }} style={styles.assetIcon} />
                  ) : (
                    <View style={[styles.assetIcon, styles.assetIconFallback]}>
                      <Text style={styles.assetIconInitial}>
                        {(trade.assetSymbol || trade.assetName || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.assetTextCol}>
                    <Text style={styles.assetName} numberOfLines={1}>
                      {trade.assetName}
                    </Text>
                    <Text style={styles.assetSymbol}>{trade.assetSymbol}</Text>
                  </View>
                </View>

                {/* Sandwich context */}
                {isSandwich ? (
                  <View style={styles.sandwichRow}>
                    <Text style={styles.sandwichEmoji}>🥪</Text>
                    <View style={styles.sandwichTextCol}>
                      <Text style={styles.sandwichName} numberOfLines={1}>
                        {trade.sandwichName}
                      </Text>
                      {trade.sandwichLegCount != null && trade.sandwichLegCount > 0 ? (
                        <Text style={styles.sandwichLegs}>
                          {trade.sandwichLegCount} {trade.sandwichLegCount === 1 ? 'market' : 'markets'}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {/* Realized PnL — sell only */}
                {isSell && hasPnl ? (
                  <View style={styles.pnlSection}>
                    <View style={styles.pnlDivider} />
                    <View style={styles.pnlRow}>
                      <Text style={styles.pnlLabel}>Realized P&L</Text>
                      <View style={styles.pnlValues}>
                        <Text style={[styles.pnlAmount, { color: pnlColor }]}>
                          {formatSignedUsd(trade.realizedPnlUsd!)}
                        </Text>
                        {trade.realizedPnlPct != null ? (
                          <Text style={[styles.pnlPct, { color: pnlColor }]}>
                            {formatPct(trade.realizedPnlPct)}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                ) : null}
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
                  label="Copy"
                  icon="link"
                  iconColor={colors.text}
                  bg={colors.surfaceAlt}
                  onPress={handleCopyLink}
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
        </BottomSheetView>
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
    card: {
      borderRadius: 22,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      padding: 18,
      gap: 14,
      overflow: 'hidden',
    },
    cardGlow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 120,
    },
    cardBrandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    cardBrand: {
      color: c.text,
      fontSize: 14,
      fontWeight: '800',
      fontFamily: F,
    },
    sideBadge: {
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 999,
    },
    sideBadgeText: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 0.6,
      fontFamily: F,
    },
    cardAmount: {
      color: c.text,
      fontSize: 42,
      fontWeight: '900',
      fontFamily: F_DISPLAY,
      letterSpacing: -1.5,
      textAlign: 'center',
      marginVertical: 2,
    },
    assetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    assetIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surfaceAlt,
    },
    assetIconFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    assetIconInitial: {
      color: c.textSecondary,
      fontSize: 17,
      fontWeight: '800',
      fontFamily: F,
    },
    assetTextCol: {
      flex: 1,
      gap: 1,
    },
    assetName: {
      color: c.text,
      fontSize: 18,
      fontWeight: '900',
      fontFamily: F_DISPLAY,
    },
    assetSymbol: {
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: '700',
      fontFamily: F,
    },
    sandwichRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: withAlpha(c.accentBlue, 0.06),
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    sandwichEmoji: {
      fontSize: 22,
    },
    sandwichTextCol: {
      flex: 1,
      gap: 1,
    },
    sandwichName: {
      color: c.text,
      fontSize: 15,
      fontWeight: '800',
      fontFamily: F,
    },
    sandwichLegs: {
      color: c.textTertiary,
      fontSize: 12,
      fontWeight: '700',
      fontFamily: F,
    },
    pnlSection: {
      gap: 10,
    },
    pnlDivider: {
      height: 1,
      backgroundColor: c.border,
    },
    pnlRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    pnlLabel: {
      color: c.textSecondary,
      fontSize: 14,
      fontWeight: '700',
      fontFamily: F,
    },
    pnlValues: {
      alignItems: 'flex-end',
      gap: 1,
    },
    pnlAmount: {
      fontSize: 20,
      fontWeight: '900',
      fontFamily: F_DISPLAY,
    },
    pnlPct: {
      fontSize: 13,
      fontWeight: '700',
      fontFamily: Fonts.displayMedium,
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
