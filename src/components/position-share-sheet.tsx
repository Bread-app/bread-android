import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { SheetModal } from '@/components/sheet-modal';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import RNShare, { Social } from 'react-native-share';
import { captureRef } from 'react-native-view-shot';

import { BlurBackdrop } from '@/components/blur-backdrop';
import { SandwichBasketChart } from '@/components/sandwich-basket-chart';
import {
  SHARE_CARD_NEGATIVE,
  SHARE_CARD_POSITIVE,
  ShareCardVariantPicker,
  SharePerformanceCard,
  type ShareCardVariant,
} from '@/components/share-performance-card';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { PositionDetail } from '@/lib/api';
import { positionMoney as money, positionShareStats } from '@/lib/position-presentation';
import { useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;
const INSTAGRAM_APP_ID = process.env.EXPO_PUBLIC_INSTAGRAM_APP_ID ?? '';

export type PositionShareSnapshot = {
  detail: PositionDetail;
  currentValueUsd?: number | null;
  pnlUsd?: number | null;
  pnlPct?: number | null;
  iconUri?: string | null;
  publicUrl?: string | null;
};

export type PositionShareSheetRef = {
  open: (snapshot: PositionShareSnapshot) => void;
  dismiss: () => void;
};

export const PositionShareSheet = forwardRef<PositionShareSheetRef, unknown>(
  function PositionShareSheet(_props, ref) {
    const styles = useThemedStyles(makeStyles);
    const { colors } = useThemeStore();
    const toast = useToast();
    const sheetRef = useRef<BottomSheetModal>(null);
    const cardRef = useRef<View>(null);
    const [snapshot, setSnapshot] = useState<PositionShareSnapshot | null>(null);
    const [variant, setVariant] = useState<ShareCardVariant>('classic');

    useImperativeHandle(ref, () => ({
      open: (next) => {
        setSnapshot(next);
        setVariant('classic');
        sheetRef.current?.present();
      },
      dismiss: () => sheetRef.current?.dismiss(),
    }), []);

    const renderBackdrop = useCallback(
      (props: React.ComponentProps<typeof BottomSheetBackdrop>) => <BlurBackdrop {...props} />,
      [],
    );

    const detail = snapshot?.detail ?? null;
    const closed = detail?.state === 'closed';
    const current = closed ? detail?.proceedsUsd : snapshot?.currentValueUsd;
    const pnlUsd = closed ? detail?.realizedPnlUsd : snapshot?.pnlUsd;
    const pnlPct = closed
      ? detail?.realizedPnlPct == null ? null : detail.realizedPnlPct * 100
      : snapshot?.pnlPct ?? null;
    const positive = (pnlUsd ?? pnlPct ?? 0) >= 0;
    const resultKnown = pnlUsd != null || pnlPct != null;
    const returnValue = pnlUsd == null ? '—' : `${pnlUsd >= 0 ? '+' : '−'}${money(Math.abs(pnlUsd))}`;
    const returnDetail = pnlPct == null
      ? null
      : `${positive ? '▲' : '▼'} ${Math.abs(pnlPct).toFixed(2)}%`;
    const dateLabel = detail
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          .format(new Date(detail.closedAt ?? Date.now()))
      : '';
    const stats = detail ? positionShareStats(detail, current) : [];

    const shareMessage = useMemo(() => {
      if (!detail) return '';
      const result = pnlUsd == null ? '' : ` ${pnlUsd >= 0 ? 'made' : 'lost'} ${money(Math.abs(pnlUsd))}${pnlPct == null ? '' : ` (${Math.abs(pnlPct).toFixed(2)}%)`}`;
      return [`My ${closed ? 'closed ' : ''}${detail.title} position on Bread${result}.`, snapshot?.publicUrl]
        .filter(Boolean)
        .join('\n');
    }, [closed, detail, pnlPct, pnlUsd, snapshot?.publicUrl]);

    const capture = useCallback(async () => captureRef(cardRef, {
      format: 'png', quality: 1, result: 'base64',
    }), []);

    const shareX = useCallback(async () => {
      if (!detail) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const base64 = await capture();
        await RNShare.shareSingle({
          social: Social.Twitter,
          url: `data:image/png;base64,${base64}`,
          type: 'image/png',
          filename: `bread-${detail.id}-position.png`,
          message: shareMessage,
          useInternalStorage: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!/cancel|did not share/i.test(message)) toast.showToast("Couldn't open X", 'error');
      }
    }, [capture, detail, shareMessage, toast]);

    const shareInstagram = useCallback(async () => {
      if (!detail) return;
      if (!INSTAGRAM_APP_ID) {
        toast.showToast("Instagram sharing isn't configured yet", 'error');
        return;
      }
      try {
        const base64 = await capture();
        await RNShare.shareSingle({
          social: Social.InstagramStories,
          appId: INSTAGRAM_APP_ID,
          stickerImage: `data:image/png;base64,${base64}`,
          backgroundTopColor: '#FFFFFF',
          backgroundBottomColor: '#FFFFFF',
          ...(snapshot?.publicUrl ? { attributionURL: snapshot.publicUrl } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!/cancel|did not share/i.test(message)) toast.showToast("Couldn't open Instagram", 'error');
      }
    }, [capture, detail, snapshot?.publicUrl, toast]);

    const copyImage = useCallback(async () => {
      if (!detail) return;
      try {
        await Clipboard.setImageAsync(await capture());
        toast.showToast('Image copied', 'success');
      } catch {
        toast.showToast("Couldn't copy image", 'error');
      }
    }, [capture, detail, toast]);

    const shareMore = useCallback(async () => {
      if (!detail) return;
      try {
        const base64 = await capture();
        await RNShare.open({
          title: detail.title,
          message: shareMessage,
          url: `data:image/png;base64,${base64}`,
          type: 'image/png',
          filename: `bread-${detail.id}-position.png`,
          failOnCancel: false,
        });
      } catch {
        // cancelled
      }
    }, [capture, detail, shareMessage]);

    return (
      <SheetModal
        ref={sheetRef}
        snapPoints={['100%']}
        enableDynamicSizing={false}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        handleIndicatorStyle={styles.handleHidden}
        backgroundStyle={styles.sheetBg}
      >
        <BottomSheetScrollView contentContainerStyle={styles.content}>
          {detail ? (
            <>
              <View style={styles.header}>
                <Text style={styles.title}>Share position</Text>
                <Pressable onPress={() => sheetRef.current?.dismiss()} style={styles.close}>
                  <Ionicons name="close" size={20} color={colors.textSecondary} />
                </Pressable>
              </View>
              <ShareCardVariantPicker value={variant} onChange={setVariant} />
              <View ref={cardRef} collapsable={false}>
                <SharePerformanceCard
                  variant={variant}
                  title={detail.title}
                  subtitle={detail.symbols.join(' · ') || detail.kind.replaceAll('_', ' ')}
                  iconUri={snapshot?.iconUri ?? detail.logoUri}
                  iconFallback={detail.title}
                  dateLabel={dateLabel}
                  identityLabel={closed ? 'My closed Bread position' : 'My Bread position'}
                  returnValue={returnValue}
                  returnDetail={returnDetail}
                  positive={positive}
                  returnColorOverride={resultKnown ? undefined : '#6B7280'}
                  stats={stats}
                  chart={
                    <SandwichBasketChart
                      legs={detail.chart.legs}
                      createdAt={detail.chart.openedAt}
                      endedAt={detail.chart.closedAt}
                      markers={detail.fills}
                      targetReturnPct={pnlPct}
                      showReturn={false}
                      variant="spark"
                      height={108}
                      color={
                        resultKnown
                          ? positive ? SHARE_CARD_POSITIVE : SHARE_CARD_NEGATIVE
                          : '#6B7280'
                      }
                      revealBackgroundColor="#FFFFFF"
                    />
                  }
                />
              </View>
              <View style={styles.targets}>
                <Target label="IG Story" icon="logo-instagram" color="#C13584" onPress={() => void shareInstagram()} />
                <Target label="X" glyph="𝕏" color="#000000" onPress={() => void shareX()} />
                <Target label="Copy image" icon="image" color={colors.surfaceAlt} iconColor={colors.text} onPress={() => void copyImage()} />
                <Target label="More" icon="ellipsis-horizontal" color={colors.surfaceAlt} iconColor={colors.text} onPress={() => void shareMore()} />
              </View>
            </>
          ) : null}
        </BottomSheetScrollView>
      </SheetModal>
    );
  },
);

function Target({ label, icon, glyph, color, iconColor = '#FFFFFF', onPress }: {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  glyph?: string;
  color: string;
  iconColor?: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale onPress={onPress} style={styles.target}>
      <View style={[styles.targetCircle, { backgroundColor: color }]}>
        {glyph ? <Text style={[styles.glyph, { color: iconColor }]}>{glyph}</Text> : icon ? <Ionicons name={icon} size={25} color={iconColor} /> : null}
      </View>
      <Text style={styles.targetLabel}>{label}</Text>
    </PressableScale>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheetBg: { backgroundColor: c.background, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handleHidden: { backgroundColor: 'transparent' },
  content: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 4, paddingBottom: 40, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: c.text, fontFamily: F, fontWeight: '800', fontSize: 18 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceAlt },
  targets: { marginTop: 'auto', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  target: { width: 76, alignItems: 'center', gap: 7 },
  targetCircle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  targetLabel: { color: c.textSecondary, fontFamily: F, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  glyph: { fontFamily: F, fontSize: 25, fontWeight: '900' },
});
