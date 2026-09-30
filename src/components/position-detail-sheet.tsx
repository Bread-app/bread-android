import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AssetLogo } from '@/components/asset-logo';
import { HeldPositionActions } from '@/components/held-position-actions';
import { SandwichBasketChart } from '@/components/sandwich-basket-chart';
import { VerifiedBadge } from '@/components/verified-badge';
import { isXPostSource, SourcePostCard } from '@/components/x-post-preview';
import { YouTubeClipPlayer } from '@/components/youtube-clip-player';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { PositionDetail, Sandwich, SandwichProvenance } from '@/lib/api';
import { useThemeStore } from '@/lib/theme-store';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

export type FocusedPositionData = {
  detail: PositionDetail;
  sandwich?: Sandwich | null;
  provenance?: SandwichProvenance | null;
  currentValueUsd?: number | null;
  pnlUsd?: number | null;
  pnlPct?: number | null;
};

/**
 * Open the sheet from the tap itself. On this stack (gorhom v5 + Fabric) a
 * `present()` fired from an effect reacting to `data` can be silently dropped —
 * the sheet never appears — so callers present from the gesture and the effect
 * below is only the fallback for hosts that have not moved over yet.
 */
export type PositionDetailSheetRef = {
  /**
   * Pass the data here and the sheet renders it on the tap's own frame. The
   * host's `data` prop can then follow in a transition: re-rendering a whole
   * profile screen in the frame the sheet starts to rise was the stutter.
   */
  present: (next?: FocusedPositionData) => void;
};

type PositionDetailSheetProps = {
  data: FocusedPositionData | null;
  onDismiss: () => void;
  onShare: (data: FocusedPositionData) => void;
  /** Omitted when the position is not the viewer's: they can't trade it. */
  onBuyMore?: (data: FocusedPositionData) => void;
  onClosePosition?: (data: FocusedPositionData) => void;
  onViewFull: (data: FocusedPositionData) => void;
};

export const PositionDetailSheet = forwardRef<PositionDetailSheetRef, PositionDetailSheetProps>(
function PositionDetailSheet({
  data,
  onDismiss,
  onShare,
  onBuyMore,
  onClosePosition,
  onViewFull,
}, ref) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const sheetRef = useRef<BottomSheetModal>(null);
  /** Real on-screen state, from gorhom's own callbacks. */
  const presentedRef = useRef(false);
  /**
   * Raised once the sheet has finished rising. The chart (candle fetches for
   * every leg) and the video player mount only then: building them inside the
   * present animation is what made the sheet stutter on its way up.
   */
  const [settled, setSettled] = useState(false);

  // What the sheet shows: the data handed to `present`, superseded by the
  // host's prop whenever that carries something newer for the same position.
  const [presented, setPresented] = useState<FocusedPositionData | null>(null);
  const presentedDataRef = useRef<FocusedPositionData | null>(null);
  presentedDataRef.current = presented;
  const settledRef = useRef(false);
  const pendingRef = useRef<FocusedPositionData | null>(null);

  const present = useCallback((next?: FocusedPositionData) => {
    if (next) setPresented(next);
    sheetRef.current?.present();
    // gorhom intermittently swallows present(); a second call while it is
    // already opening is a no-op, so retrying one frame later only ever
    // recovers a dropped one.
    requestAnimationFrame(() => {
      if (!presentedRef.current) sheetRef.current?.present();
    });
  }, []);

  useImperativeHandle(ref, () => ({ present }), [present]);

  // The host clearing `data` still closes the sheet — but only a real clear,
  // after it had data. A null that merely hasn't caught up with `present(next)`
  // yet (its transition is still pending) must not dismiss what just opened.
  const hadDataRef = useRef(false);
  useEffect(() => {
    if (!data) {
      if (hadDataRef.current && presentedRef.current) sheetRef.current?.dismiss();
      hadDataRef.current = false;
      return;
    }
    hadDataRef.current = true;
    // An update that lands while the sheet is still rising (the full detail,
    // the Sandwich) waits for it to settle, so the content doesn't rebuild
    // mid-animation. A first render is never held back.
    if (!settledRef.current && presentedDataRef.current) {
      pendingRef.current = data;
    } else {
      setPresented(data);
    }
    if (!presentedRef.current) present();
  }, [data, present]);


  // A plain dimmed backdrop: a live blur behind a moving sheet is re-rendered
  // every frame of the slide.
  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.45} />
    ),
    [],
  );

  const shown = presented;
  const detail = shown?.detail ?? null;
  const closed = detail?.state === 'closed';
  const pnlUsd = closed ? detail?.realizedPnlUsd : shown?.pnlUsd;
  const pnlPct = closed
    ? detail?.realizedPnlPct == null ? null : detail.realizedPnlPct * 100
    : shown?.pnlPct ?? null;
  const positive = (pnlUsd ?? pnlPct ?? 0) >= 0;
  const resultKnown = pnlUsd != null || pnlPct != null;
  const accent = resultKnown
    ? positive ? colors.positive : colors.negative
    : colors.textSecondary;
  const multiAsset = (detail?.chart.legs.length ?? 0) > 1;
  const youtube = shown?.provenance?.source.sourceType === 'youtube'
    ? shown.provenance
    : null;
  const videoId = youtube?.source.videoId ?? null;
  const sandwich = shown?.sandwich ?? null;
  const xSource = sandwich && isXPostSource(sandwich.source) ? sandwich.source : null;
  const thesis = sandwich?.source.quote?.trim()
    || detail?.sandwich?.thesisText?.trim()
    || detail?.sandwich?.headline?.trim()
    || detail?.sandwich?.summary?.trim()
    || detail?.subtitle
    || detail?.title
    || null;

  // Same byline the detail screen leads with: the Bread creator when there is
  // one (verified), else the cited author.
  const meta = detail?.sandwich ?? null;
  const builder = sandwich?.builder ?? null;
  const builderHandle =
    (builder?.username ?? meta?.builderUsername ?? builder?.name ?? meta?.builderName)
      ?.trim()
      .replace(/^@+/, '') || null;
  const authorHandle = meta?.authorHandle?.trim().replace(/^@+/, '') || null;
  const bylineName = builderHandle
    ? `@${builderHandle}`
    : authorHandle
      ? `@${authorHandle}`
      : meta?.authorName?.trim() || detail?.title || '';
  const avatarUri = builderHandle
    ? builder?.avatarUrl ?? meta?.builderAvatarUrl ?? null
    : meta?.authorAvatarUrl ?? detail?.logoUri ?? null;
  const postedAt = detail?.openedAt ?? detail?.chart.openedAt ?? null;

  // Per-unit prices only when both ends have one; otherwise dollars in and out.
  // Mixing them printed a $3 stake as "Avg. entry" beside a $0.26 unit exit.
  const unitPrices =
    !multiAsset &&
    detail?.avgEntryPriceUsd != null &&
    (closed ? detail.avgExitPriceUsd != null : currentUnitPrice(detail, shown?.currentValueUsd) != null);
  const entryLabel = unitPrices ? 'Avg. entry' : 'Invested';
  const exitLabel = unitPrices
    ? closed ? 'Avg. exit' : 'Current'
    : closed ? 'Returned' : 'Value';
  const entryValue = unitPrices ? price(detail?.avgEntryPriceUsd) : money(detail?.costUsd);
  const exitValue = unitPrices
    ? price(closed ? detail?.avgExitPriceUsd : currentUnitPrice(detail, shown?.currentValueUsd))
    : money(closed ? detail?.proceedsUsd : shown?.currentValueUsd);

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={['88%']}
      enableDynamicSizing={false}
      enablePanDownToClose
      onChange={(index) => {
        if (index >= 0) {
          presentedRef.current = true;
          settledRef.current = true;
          setSettled(true);
          if (pendingRef.current) {
            setPresented(pendingRef.current);
            pendingRef.current = null;
          }
        }
      }}
      onDismiss={() => {
        presentedRef.current = false;
        settledRef.current = false;
        pendingRef.current = null;
        setSettled(false);
        setPresented(null);
        onDismiss();
      }}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.sheetBg}
    >
      <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {detail && shown ? (
          <>
            <View style={styles.header}>
              <AssetLogo
                uri={avatarUri}
                size={36}
                borderRadius={18}
                backgroundColor={colors.surfaceAlt}
                fallback={
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarFallbackText}>
                      {bylineName.replace(/^@/, '').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                }
              />
              <View style={styles.headerCopy}>
                <View style={styles.bylineRow}>
                  <Text style={styles.byline} numberOfLines={1}>{bylineName}</Text>
                  {builderHandle ? <VerifiedBadge size={15} /> : null}
                </View>
                {postedAt ? <Text style={styles.bylineMeta}>{shortDate(postedAt)}</Text> : null}
              </View>
              <Pressable hitSlop={8} onPress={() => onShare(shown)} style={styles.iconButton}>
                <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
              </Pressable>
              <Pressable hitSlop={8} onPress={() => sheetRef.current?.dismiss()} style={styles.iconButton}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            {/* The post itself, as the detail screen shows it: a cited X post is
                its boxed embed (tapping it opens the post on X), a podcast call
                is its clip, anything else is the builder's own words. */}
            {xSource ? (
              <SourcePostCard source={xSource} />
            ) : videoId ? (
              <View style={styles.video}>
                {settled ? (
                  <YouTubeClipPlayer
                    videoId={videoId}
                    initialStartMs={youtube?.source.startMs ?? null}
                    initialEndMs={youtube?.source.endMs ?? null}
                    autoplay={false}
                  />
                ) : null}
              </View>
            ) : thesis ? (
              <Text style={styles.thesis}>{thesis}</Text>
            ) : null}

            <View style={styles.chartBlock}>
              {settled ? (
                <SandwichBasketChart
                  legs={detail.chart.legs}
                  createdAt={detail.chart.openedAt}
                  endedAt={detail.chart.closedAt}
                  markers={detail.fills}
                  targetReturnPct={pnlPct}
                  showReturn={false}
                  hideFooter
                  height={CHART_HEIGHT}
                />
              ) : (
                <View style={{ height: CHART_HEIGHT }} />
              )}
            </View>

            <View style={styles.result}>
              <View style={styles.resultTop}>
                <Text style={[styles.pnl, { color: accent }]} numberOfLines={1}>
                  {pnlUsd == null ? '—' : `${pnlUsd >= 0 ? '+' : '−'}${money(Math.abs(pnlUsd))}`}
                </Text>
                <Text style={[styles.returnPct, { color: accent }]}>
                  {pnlPct == null ? '—' : `${pnlPct > 0 ? '▲ ' : pnlPct < 0 ? '▼ ' : ''}${Math.abs(pnlPct).toFixed(2)}%`}
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Metric label={entryLabel} value={entryValue} styles={styles} />
                <Metric label={exitLabel} value={exitValue} align="right" styles={styles} />
              </View>
            </View>

            {detail.chart.legs.length > 0 ? (
              <View style={styles.legChips}>
                {detail.chart.legs.map((leg, index) => {
                  const symbol = leg.symbol ?? leg.label;
                  return (
                    <View key={leg.id} style={styles.legChip}>
                      <AssetLogo
                        uri={meta?.legIcons[index] ?? null}
                        size={18}
                        borderRadius={9}
                        backgroundColor={colors.surface}
                        fallback={
                          <View style={styles.legChipFallback}>
                            <Text style={styles.legIconText}>{symbol.slice(0, 1).toUpperCase()}</Text>
                          </View>
                        }
                      />
                      <Text style={styles.legChipText} numberOfLines={1}>
                        {leg.type === 'perp' && leg.side ? `${symbol} ${leg.side.toUpperCase()}` : symbol}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {!closed && onBuyMore && onClosePosition ? (
              <HeldPositionActions
                onBuyMore={() => onBuyMore(shown)}
                onClose={() => onClosePosition(shown)}
              />
            ) : null}

            {detail.sandwichId ? (
              <PressableScale onPress={() => onViewFull(shown)} style={styles.viewFull}>
                <Text style={styles.viewFullText}>{youtube ? 'View all from this video' : 'View full Sandwich'}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </PressableScale>
            ) : null}
          </>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

const CHART_HEIGHT = 170;

function Metric({ label, value, align, styles }: {
  label: string;
  value: string;
  align?: 'right';
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={[styles.metric, align === 'right' && styles.metricRight]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function price(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: value < 1 ? 6 : 2 })}`;
}

function currentUnitPrice(
  detail: PositionDetail | null,
  currentValueUsd: number | null | undefined,
): number | null {
  if (!detail || currentValueUsd == null) return null;
  const quantity = detail.fills.reduce(
    (total, fill) =>
      total + (fill.side === 'entry' ? 1 : -1) * (fill.quantity ?? 0),
    0,
  );
  return quantity > 0 ? currentValueUsd / quantity : null;
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheetBg: { backgroundColor: c.background, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  handle: { backgroundColor: c.border, width: 36 },
  content: { paddingHorizontal: 18, paddingTop: 2, paddingBottom: 40, gap: 14 },
  header: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  headerCopy: { flex: 1 },
  bylineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  byline: { color: c.text, fontFamily: F, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  bylineMeta: { color: c.textTertiary, fontFamily: F, fontSize: 12, fontWeight: '600', marginTop: 1 },
  avatarFallback: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceAlt },
  avatarFallbackText: { color: c.textSecondary, fontFamily: F, fontSize: 14, fontWeight: '800' },
  iconButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  video: { aspectRatio: 16 / 9, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000000' },
  thesis: { color: c.text, fontFamily: F, fontSize: 16, lineHeight: 23, fontWeight: '600' },
  chartBlock: {},
  result: { gap: 12 },
  resultTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  pnl: { fontFamily: Fonts.displayMedium, fontSize: 28, fontWeight: '900', flexShrink: 1 },
  returnPct: { fontFamily: F, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  metricRow: { flexDirection: 'row', gap: 16 },
  metric: { flex: 1 },
  metricRight: { alignItems: 'flex-end' },
  metricLabel: { color: c.textTertiary, fontFamily: F, fontSize: 12, fontWeight: '700' },
  metricValue: { color: c.text, fontFamily: F, fontSize: 16, fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] },
  legChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  legChip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingLeft: 5, paddingRight: 9, borderRadius: 14, backgroundColor: c.surfaceAlt },
  legChipFallback: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
  legIconText: { color: c.textSecondary, fontFamily: F, fontSize: 10, fontWeight: '900' },
  legChipText: { color: c.text, fontFamily: F, fontSize: 12.5, fontWeight: '800' },
  viewFull: { height: 46, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.surfaceAlt },
  viewFullText: { color: c.text, fontFamily: F, fontSize: 14, fontWeight: '800' },
});
