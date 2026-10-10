import {
  BottomSheetBackdrop,
  BottomSheetFooter,
  type BottomSheetFooterProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { SheetModal } from '@/components/sheet-modal';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAnimatedReaction, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AssetLogo } from '@/components/asset-logo';
import { HeldPositionActions } from '@/components/held-position-actions';
import { CTA_BUTTON_HEIGHT } from '@/components/side-glass-button';
import { SandwichBasketChart, type SandwichChartRange } from '@/components/sandwich-basket-chart';
import { SandwichPositionCard } from '@/components/sandwich-position-card';
import { VerifiedBadge } from '@/components/verified-badge';
import { isXPostSource, SourcePostCard } from '@/components/x-post-preview';
import { YouTubeClipPlayer } from '@/components/youtube-clip-player';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { PositionDetail, Sandwich, SandwichProvenance } from '@/lib/api';
import type { SandwichPosition } from '@/lib/sandwich-positions';
import { useThemeStore } from '@/lib/theme-store';
import { CTA, ctaBottomInset } from '@/lib/screen-corners';
import { symbolLogoSources } from '@/lib/stock-logos';
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
  /**
   * The viewer's own Sandwich only: "Add thesis" on the position card. Called
   * once the sheet is down, so the composer lands on a screen, not under it.
   */
  onAddThesis?: (open: () => void) => void;
};

export const PositionDetailSheet = forwardRef<PositionDetailSheetRef, PositionDetailSheetProps>(
function PositionDetailSheet({
  data,
  onDismiss,
  onShare,
  onBuyMore,
  onClosePosition,
  onViewFull,
  onAddThesis,
}, ref) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheetModal>(null);
  /** Real on-screen state, from gorhom's own callbacks. */
  const presentedRef = useRef(false);
  /**
   * Raised once the sheet has finished rising. The chart (candle fetches for
   * every leg) and the video player mount only then: building them inside the
   * present animation is what made the sheet stutter on its way up.
   */
  const [settled, setSettled] = useState(false);
  // Opens on ALL, like the Sandwich screen: the curve spans the whole thesis.
  const [chartRange, setChartRange] = useState<SandwichChartRange>('ALL');
  // Scrubbing the chart drives the share card: it shows what the position was
  // worth under the finger, scaled by the basket's move relative to now. The
  // chart writes the return under the finger; its resting value (what it holds
  // whenever no finger is down) is the "now" that move is measured against.
  // All UI-thread.
  const scrubReturn = useSharedValue(Number.NaN);
  const scrubReturnActive = useSharedValue(0);
  const scrubbing = useSharedValue(0);
  const restReturn = useSharedValue(Number.NaN);
  useAnimatedReaction(
    () => (scrubbing.value === 0 ? scrubReturn.value : null),
    (rest) => {
      if (rest !== null) restReturn.value = rest;
    },
  );
  const scrubRatio = useDerivedValue(() => {
    const at = scrubReturn.value;
    const now = restReturn.value;
    if (Number.isNaN(at) || Number.isNaN(now) || 1 + now / 100 <= 0) return 1;
    return (1 + at / 100) / (1 + now / 100);
  });
  const cardScrub = useMemo(() => ({ active: scrubbing, ratio: scrubRatio }), [scrubbing, scrubRatio]);

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

  // The chart is the Sandwich's own — the same curve its screen draws, from
  // when it was created — with the viewer's fills pinned on it ("+" where they
  // aped in). Without the Sandwich loaded it falls back to the position's
  // window. Memoised: a new legs array refetches every leg's candles.
  const sandwichLegs = useMemo(
    () => (sandwich?.legs.length ? [...sandwich.legs].sort((a, b) => a.order - b.order) : null),
    [sandwich],
  );
  const chartLegs = sandwichLegs ?? detail?.chart.legs ?? [];
  const chartStart = sandwichLegs ? sandwich?.createdAt ?? null : detail?.chart.openedAt ?? null;
  const chartReturnPct = sandwichLegs
    ? sandwich && sandwich.pnlStatus !== 'unavailable' && sandwich.pnlPct !== null && Math.abs(sandwich.pnlPct) > 0.05
      ? sandwich.pnlPct
      : null
    : pnlPct;
  // Under a day old there's only ALL, so no row at all.
  const rangePills = sandwichLegs && !closed ? chartRangePills(chartStart) : [];

  // Per-unit prices only when both ends have one; otherwise dollars in and out.
  // Mixing them printed a $3 stake as "Avg. entry" beside a $0.26 unit exit.
  const unitPrices =
    !multiAsset &&
    detail?.avgEntryPriceUsd != null &&
    (closed ? detail.avgExitPriceUsd != null : currentUnitPrice(detail, shown?.currentValueUsd) != null);
  // The viewer's own Sandwich only — the composer needs a Sandwich to attach to.
  const canAddThesis = !!onAddThesis && !!detail?.sandwichId;
  const entryLabel = unitPrices ? 'Avg. entry' : 'Invested';
  const exitLabel = unitPrices
    ? closed ? 'Avg. exit' : 'Current'
    : closed ? 'Returned' : 'Value';
  const entryValue = unitPrices ? price(detail?.avgEntryPriceUsd) : money(detail?.costUsd);
  const exitValue = unitPrices
    ? price(closed ? detail?.avgExitPriceUsd : currentUnitPrice(detail, shown?.currentValueUsd))
    : money(closed ? detail?.proceedsUsd : shown?.currentValueUsd);

  // BUY MORE / SELL stay pinned to the sheet's bottom edge, as on the
  // Sandwich screen, instead of scrolling away mid-content.
  const showActions = !!shown && !closed && !!onBuyMore && !!onClosePosition;
  const footerBottom = ctaBottomInset(insets.bottom);
  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) =>
      showActions && shown ? (
        <BottomSheetFooter {...props}>
          <View style={[styles.footer, { paddingBottom: footerBottom }]}>
            <HeldPositionActions
              onBuyMore={() => onBuyMore?.(shown)}
              onClose={() => onClosePosition?.(shown)}
              closeLabel="SELL"
              fullSizeLabels
            />
          </View>
        </BottomSheetFooter>
      ) : null,
    [footerBottom, onBuyMore, onClosePosition, showActions, shown, styles.footer],
  );

  return (
    <SheetModal
      ref={sheetRef}
      footerComponent={renderFooter}
      snapPoints={['88%']}
      enableDynamicSizing={false}
      enablePanDownToClose
      // A sideways drag is the chart's scrub, never the sheet's pull-down: let
      // the sheet's own pan fail on it so the chart's gesture can take over.
      failOffsetX={SHEET_FAIL_OFFSET_X}
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
        setChartRange('ALL');
        setPresented(null);
        onDismiss();
      }}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.sheetBg}
    >
      <BottomSheetScrollView
        contentContainerStyle={[
          styles.content,
          // Room for the pinned actions, so the last row can scroll clear of them.
          showActions && { paddingBottom: CTA_BUTTON_HEIGHT + footerBottom + 28 },
        ]}
        showsVerticalScrollIndicator={false}
      >
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
              {/* An open position shares from its card's own Share. */}
              {closed ? (
                <Pressable hitSlop={8} onPress={() => onShare(shown)} style={styles.iconButton}>
                  <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
                </Pressable>
              ) : null}
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

            {/* A closed position leads with what it realized; an open one's
                money lives on the share card below the chart. */}
            {closed ? (
              <View style={styles.hero}>
                <Text style={styles.heroLabel}>Realized</Text>
                <Text style={[styles.heroValue, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {pnlUsd == null ? '—' : `${pnlUsd >= 0 ? '+' : '−'}${money(Math.abs(pnlUsd))}`}
                </Text>
                <View style={styles.heroDeltaRow}>
                  {pnlPct != null && pnlPct !== 0 ? (
                    <Ionicons name={positive ? 'caret-up' : 'caret-down'} size={13} color={accent} />
                  ) : null}
                  <Text style={[styles.heroDelta, { color: accent }]} numberOfLines={1}>
                    {pnlPct == null ? '—' : `${Math.abs(pnlPct).toFixed(2)}%`}
                  </Text>
                  <Text style={styles.heroDeltaMeta}>return</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.chartBlock}>
              {settled ? (
                <SandwichBasketChart
                  legs={chartLegs}
                  createdAt={chartStart}
                  endedAt={detail.chart.closedAt}
                  markers={detail.fills}
                  targetReturnPct={chartRange === 'ALL' ? chartReturnPct : null}
                  window={rangePills.length > 1 ? chartRange : undefined}
                  showDotGrid
                  showReturn={false}
                  insetX={CHART_INSET_X}
                  height={CHART_HEIGHT}
                  scrubValue={scrubReturn}
                  scrubValueActive={scrubReturnActive}
                  scrubbing={scrubbing}
                />
              ) : (
                <View style={{ height: CHART_HEIGHT }} />
              )}
              {rangePills.length > 1 ? (
                <View style={styles.chartRangeRow}>
                  {rangePills.map(({ label, range }) => {
                    const active = chartRange === range;
                    return (
                      <Pressable
                        key={range}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`Show ${label} chart`}
                        hitSlop={8}
                        onPress={() => {
                          if (active) return;
                          void Haptics.selectionAsync();
                          setChartRange(range);
                        }}
                        style={styles.chartRangePill}
                      >
                        <Text style={[styles.chartRangePillText, active && styles.chartRangePillTextActive]}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>

            {closed ? (
              <View style={styles.statsCard}>
                <View style={styles.metricRow}>
                  <Metric label={entryLabel} value={entryValue} styles={styles} />
                  <Metric label={exitLabel} value={exitValue} align="right" styles={styles} />
                </View>
              </View>
            ) : (
              // The same share card the Sandwich screen shows: value and PnL,
              // invested and opened, Share on the grey footer. The figures are
              // always passed in — this sheet is portalled above the wallet
              // provider, so the card can't value it itself.
              <View style={styles.positionCard}>
                <SandwichPositionCard
                  position={positionFromDetail(detail)}
                  valuationOverride={{
                    costUsd: detail.costUsd,
                    valueUsd: shown.currentValueUsd ?? null,
                    pnlUsd: pnlUsd ?? null,
                    returnPct: pnlPct,
                  }}
                  onShare={() => onShare(shown)}
                  scrub={cardScrub}
                  onAddThesis={
                    canAddThesis
                      ? (open) => {
                          sheetRef.current?.dismiss();
                          onAddThesis?.(open);
                        }
                      : null
                  }
                />
              </View>
            )}

            {detail.chart.legs.length > 0 ? (
              <View style={styles.legChips}>
                {detail.chart.legs.map((leg, index) => {
                  const symbol = leg.symbol ?? leg.label;
                  const asset = sandwich?.legs.find((candidate) => candidate.id === leg.id);
                  const derived = leg.type === 'prediction_market'
                    ? { uri: null, fallbackUris: [] }
                    : symbolLogoSources(asset?.underlyingSymbol ?? symbol);
                  return (
                    <View key={leg.id} style={styles.legChip}>
                      <AssetLogo
                        uri={asset?.imageUrl ?? meta?.legIcons[index] ?? null}
                        fallbackUris={[
                          meta?.legIcons[index],
                          detail.chart.legs.length === 1 ? detail.logoUri : null,
                          derived.uri,
                          ...derived.fallbackUris,
                        ]}
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

            {detail.sandwichId ? (
              <PressableScale onPress={() => onViewFull(shown)} style={styles.viewFull}>
                <Text style={styles.viewFullText}>{youtube ? 'View all from this video' : 'View full Sandwich'}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </PressableScale>
            ) : null}
          </>
        ) : null}
      </BottomSheetScrollView>
    </SheetModal>
  );
});

const CHART_HEIGHT = 130;
const SHEET_FAIL_OFFSET_X: [number, number] = [-8, 8];

// The Sandwich screen's range pills, kept local: importing them from
// sandwich-screen would make an inline-require cycle.
const CHART_RANGE_PILLS: { label: string; range: SandwichChartRange; seconds: number }[] = [
  { label: '24H', range: '24H', seconds: 24 * 60 * 60 },
  { label: '1W', range: '1W', seconds: 7 * 24 * 60 * 60 },
  { label: '1M', range: '1M', seconds: 30 * 24 * 60 * 60 },
  { label: '3M', range: '3M', seconds: 90 * 24 * 60 * 60 },
  { label: 'ALL', range: 'ALL', seconds: Number.POSITIVE_INFINITY },
];

/** Only windows shorter than the Sandwich's life, plus ALL. */
function chartRangePills(createdAt: string | null) {
  const age = createdAt ? (Date.now() - new Date(createdAt).getTime()) / 1000 : Number.NaN;
  if (!Number.isFinite(age)) return CHART_RANGE_PILLS;
  return CHART_RANGE_PILLS.filter((pill) => pill.range === 'ALL' || pill.seconds < age);
}
/** Room for the entry marker and the live dot, which sit on the line's ends. */
const CHART_INSET_X = 10;

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

/** The card's position shape, from what the sheet holds. */
function positionFromDetail(detail: PositionDetail): SandwichPosition {
  return {
    id: detail.id,
    sandwichId: detail.sandwichId ?? detail.id,
    name: detail.title,
    summary: detail.sandwich?.summary ?? detail.title,
    investedUsd: detail.costUsd,
    createdAt: detail.openedAt ?? '',
    updatedAt: detail.openedAt ?? '',
    pendingSync: false,
    strictAtomic: false,
    legs: [],
  };
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
  hero: { marginTop: 4 },
  heroLabel: { color: c.textTertiary, fontFamily: F, fontSize: 13, fontWeight: '700' },
  heroValue: { color: c.text, fontFamily: Fonts.displayMedium, fontSize: 34, lineHeight: 40, fontVariant: ['tabular-nums'], marginTop: 2 },
  heroDeltaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  heroDelta: { fontFamily: Fonts.displayMedium, fontSize: 15, fontVariant: ['tabular-nums'], flexShrink: 1 },
  heroDeltaMeta: { color: c.textTertiary, fontFamily: F, fontSize: 13, fontWeight: '600', marginLeft: 3 },
  // Bleeds past the content gutter so the line uses the sheet's full width.
  chartBlock: { marginHorizontal: -8 },
  chartRangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, marginTop: 6 },
  chartRangePill: { paddingVertical: 6, paddingHorizontal: 4 },
  chartRangePillText: { color: c.textTertiary, fontFamily: F, fontSize: 14, fontWeight: '700' },
  chartRangePillTextActive: { color: c.text, fontSize: 15, fontWeight: '900' },
  // The card carries its own 12pt side margin for the detail screen; cancel
  // it so the card lines up with the rest of this sheet's content.
  positionCard: { marginHorizontal: -12 },
  statsCard: { borderRadius: 16, backgroundColor: c.surfaceAlt, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 },
  metricRow: { flexDirection: 'row', gap: 12, paddingBottom: 10 },
  metric: { flex: 1 },
  metricRight: { alignItems: 'flex-end' },
  metricLabel: { color: c.textTertiary, fontFamily: F, fontSize: 12, fontWeight: '700' },
  metricValue: { color: c.text, fontFamily: F, fontSize: 15, fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] },
  footer: { paddingHorizontal: CTA.inset, paddingTop: 12 },
  legChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  legChip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingLeft: 5, paddingRight: 9, borderRadius: 14, backgroundColor: c.surfaceAlt },
  legChipFallback: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
  legIconText: { color: c.textSecondary, fontFamily: F, fontSize: 10, fontWeight: '900' },
  legChipText: { color: c.text, fontFamily: F, fontSize: 12.5, fontWeight: '800' },
  viewFull: { height: 46, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.surfaceAlt },
  viewFullText: { color: c.text, fontFamily: F, fontSize: 14, fontWeight: '800' },
});
