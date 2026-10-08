import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { GlassContainer, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { router as expoRouter, useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Line as SvgLine, Path as SvgPath } from 'react-native-svg';

import { AssetLogo } from '@/components/asset-logo';
import { AssetShareSheet, type AssetShareSheetRef } from '@/components/asset-share-sheet';
import { MIN_CLOSE_PERCENT, PhoenixClosePad } from '@/components/phoenix-close-pad';
import { ShareIcon } from '@/components/share-icon';
import { SlideToConfirm } from '@/components/trade-amount-sheet';
import { ValueSkeletonLine } from '@/components/value-skeleton';
import { PhoenixAutoClosePad } from '@/components/phoenix-auto-close-pad';
import { PhoenixMarkChart } from '@/components/phoenix-mark-chart';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  applyLiveMark,
  chartWindowChange,
  PHOENIX_RANGE_ORDER,
  PHOENIX_RANGES,
  type PhoenixRange,
  usePhoenixLiveMarket,
} from '@/hooks/use-phoenix-live';
import { signAndSendBase64WithResult } from '@/lib/cash';
import { prebuildPhoenixClose } from '@/lib/phoenix-prebuild';
import { withAlpha } from '@/lib/color-utils';
import {
  buildPhoenixTpSl,
  getPhoenixAccount,
  type PhoenixCandle,
  type PhoenixPosition,
} from '@/lib/phoenix-api';
import { formatTimestamp, type PerpSandwichContext } from '@/lib/perp-sandwich-display';
import { formatLeverage } from '@/lib/phoenix-position-leverage';
import { maxStopLossPctFromLiquidation } from '@/lib/phoenix-risk';
import { CTA } from '@/lib/screen-corners';
import { AddThesisButton } from '@/components/add-thesis-button';
import { takeComposerRoute } from '@/lib/position-takes';
import { perpLogoSources } from '@/lib/stock-logos';
import { useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';
import { PressableScale } from '@/components/pressable-scale';
import { SideGlassButton } from '@/components/side-glass-button';

const F = Fonts.rounded;

const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

// The position card: a raised inner surface on a one-step-darker outer, in
// the theme's own tones. (Sharing renders its own card in AssetShareSheet, so
// nothing here has to stay light for a capture.)
const CARD_POS = '#02ED45';
const CARD_NEG = '#D2042D';


// The pinned actions, on the app's shared CTA geometry: margin and radius come
// off the display's own corner, so the capsules sit the same distance from the
// screen edge on the sides as on the bottom and curve at the same rate.
const { height: ACTION_HEIGHT, inset: ACTION_INSET } = CTA;
// Gap between the two capsules.
const ACTION_GAP = 10;
// What the scroll content has to clear: bar + its own top breathing room.
const ACTION_BAR_HEIGHT = ACTION_HEIGHT + ACTION_INSET + 10;
// The closing bar instead: the order ticket's 68pt slider and the same
// top/bottom padding.
const CLOSE_BAR_HEIGHT = 68 + ACTION_INSET + 10;

/**
 * How often the open position's own row is re-read.
 *
 * Liquidation, collateral and unrealized PnL drift over minutes; `/account` is
 * a heavier call than the 5s price poll and shares Phoenix's ~5 req/s budget.
 */
const POSITION_POLL_MS = 15_000;

export type PhoenixPositionSheetProps = {
  /** The position as it was when the sheet was opened; polling refreshes it. */
  position: PhoenixPosition;
  /**
   * Set only when the open position came from a perp Sandwich.
   *
   * Two jobs: it supplies the podcast provenance the header renders (the
   * speaker's headline and the moment's timestamp), and it routes the SL/TP
   * build at the Sandwich's isolated subaccount instead of the parent cross
   * account, where the leg does not live.
   */
  context?: PerpSandwichContext | null;
  /** Land straight on the auto-close pad instead of the position card. */
  autoClose?: boolean;
  /** Pops the native sheet route hosting this content. */
  dismiss: () => void;
  /** Fired after auto-close is written, so the owner can refetch. */
  onUpdated?: () => void;
  /**
   * Hands the reduce-only order to the owner, with what the user chose on the
   * close pad. The confirmation happened here, in app UI — the owner submits.
   */
  onRequestClosePosition?: (
    position: PhoenixPosition,
    options: {
      fraction: number;
      returnToCash: boolean;
      /**
       * The mark the user is closing against, as shown on this sheet. The exit
       * receipt prints it opposite the entry; without it the owner has only the
       * entry and a PnL, and no price to say what the trade was shut at.
       */
      exitPrice: number | null;
    },
  ) => void;
};

/**
 * Detail sheet for an open Phoenix position, opened from Holdings. Hosted by
 * the `(app)/phoenix-position` route as a native iOS form sheet; open it
 * through {@link usePhoenixPositionSheet}, which carries the position record
 * across the navigation instead of route params.
 *
 * The chart carries the whole state of the trade at once: live candles, a
 * **dashed entry line** for where it was opened, the current mark, any
 * take-profit / stop-loss levels, and the liquidation price. Solid lines are
 * levels that will act; dashed ones are reference points that will not.
 *
 * Editing SL/TP happens on this same screen: the chart stays put and the
 * position card is swapped for the two level editors, so there is no second
 * sheet or drawer to stack (which is unreliable on the New Architecture
 * anyway — see [[bottom-sheet-present-pattern]]).
 */
export function PhoenixPositionSheet({
  position: initialPosition,
  context = null,
  autoClose = false,
  dismiss,
  onUpdated,
  onRequestClosePosition,
}: PhoenixPositionSheetProps) {
    const styles = useThemedStyles(makeStyles);
    const { colors, scheme } = useThemeStore();
    const isDark = scheme === 'dark';
    const toast = useToast();
    const solanaWallet = useEmbeddedSolanaWallet();
    const wallet = solanaWallet.wallets?.[0] ?? null;
    const { width } = useWindowDimensions();

    const navigation = useNavigation();
    const shareRef = useRef<AssetShareSheetRef>(null);

    const [position, setPosition] = useState<PhoenixPosition | null>(initialPosition);
    const [range, setRange] = useState<PhoenixRange>('24H');
    const { timeframe, bars: rangeBars } = PHOENIX_RANGES[range];
    // Polling runs for the life of the route: the sheet unmounts on dismiss,
    // which stops it — Phoenix's ~5 req/s budget is shared with the app.
    const [live] = useState(true);
    // The pad seeds its own rulers, and re-seeds them off the first live mark —
    // which does not exist yet at present-time.
    const [editingLevels, setEditingLevels] = useState(autoClose);
    const [submitting, setSubmitting] = useState(false);
    /** Non-null while the close pad is up; the value is the % being closed. */
    const [closePercent, setClosePercent] = useState<number | null>(null);
    const [returnToCash, setReturnToCash] = useState(false);

    // While editing, the trigger lines are dragged vertically on the chart;
    // the sheet's swipe-to-dismiss would otherwise swallow that.
    useEffect(() => {
      navigation.setOptions({ gestureEnabled: !editingLevels });
    }, [navigation, editingLevels]);

    const symbol = position?.symbol.trim().toUpperCase() ?? null;
    const { detail, candles, error, candlesError, refresh } = usePhoenixLiveMarket(
      symbol,
      timeframe,
      live,
    );

    // Pre-build the close while the pad sits on a settled share, so the slide's
    // completion is only sign + send. Standalone positions only: a Sandwich
    // close goes through its own basket builder. Debounced so dragging the
    // share does not spend Phoenix's shared rate limit on every step.
    useEffect(() => {
      if (context !== null || closePercent === null || !symbol || !wallet) return;
      const fraction = closePercent / 100;
      const timer = setTimeout(
        () => prebuildPhoenixClose(symbol, fraction, position?.subaccountIndex),
        300,
      );
      return () => clearTimeout(timer);
    }, [closePercent, context, position?.subaccountIndex, symbol, wallet]);

    const submitAutoClose = useCallback(
      async (next: { takeProfitPrice: number | null; stopLossPrice: number | null }) => {
        if (!position || !wallet || submitting) return;
        const target = position.symbol.trim().toUpperCase();
        setSubmitting(true);
        const toastId = toast.showToast('Setting auto close…', 'processing', 0);
        try {
          const built = await buildPhoenixTpSl({
            symbol: target,
            takeProfitPrice: next.takeProfitPrice,
            stopLossPrice: next.stopLossPrice,
            // Sends the levels to the Sandwich's isolated child. Omitted for a
            // standalone position, which is in the parent cross account.
            ...(context
              ? { perpSandwichPositionId: context.positionId }
              : position.subaccountIndex
                ? { subaccountIndex: position.subaccountIndex }
                : {}),
          });
          await signAndSendBase64WithResult(wallet, built.transaction, {
            lastValidBlockHeight: built.lastValidBlockHeight,
            requireConfirmed: true,
          });
          // Reflect the accepted levels immediately; the owner's refetch will
          // confirm them from the account payload a moment later.
          setPosition((current) =>
            current === null
              ? current
              : {
                  ...current,
                  takeProfitPrice: built.preview.takeProfitPrice,
                  stopLossPrice: built.preview.stopLossPrice,
                },
          );
          toast.dismissToast(toastId);
          toast.showToast(
            built.preview.takeProfitPrice === null && built.preview.stopLossPrice === null
              ? `${target} auto close cleared`
              : `${target} auto close set`,
            'success',
          );
          setEditingLevels(false);
          onUpdated?.();
        } catch (cause) {
          toast.dismissToast(toastId);
          toast.showToast(
            cause instanceof Error ? cause.message : 'Could not set auto close.',
            'error',
          );
        } finally {
          setSubmitting(false);
        }
      },
      [context, onUpdated, position, submitting, toast, wallet],
    );

    const markPrice = detail?.markPrice ?? null;
    const chartCandles = useMemo(() => applyLiveMark(candles, markPrice), [candles, markPrice]);
    const chartWidth = width - 32;

    const side = position && position.positionSize < 0 ? 'short' : 'long';
    const sideColor = side === 'long' ? colors.positive : colors.negative;
    const size = position ? Math.abs(position.positionSize) : 0;
    const notionalUsd = size * (markPrice ?? position?.entryPrice ?? 0);
    // Move since the position was opened, in the direction of the trade: a
    // short gains as the price falls, so the raw price change would carry the
    // wrong sign (and the wrong colour) half the time.
    const changeSinceEntry =
      position === null || markPrice === null || position.entryPrice <= 0
        ? null
        : (((markPrice - position.entryPrice) / position.entryPrice) * 100) *
          (side === 'long' ? 1 : -1);
    // Follows the chart's timeframe (first bar → live mark); 24h only when the
    // candles failed to load.
    const windowChange = useMemo(() => chartWindowChange(candles, markPrice, rangeBars), [candles, markPrice, rangeBars]);
    const marketChange =
      windowChange?.changePercent ??
      (candlesError ? (detail?.change24h?.changePercent ?? null) : null);

    /**
     * Keep the position row itself fresh while the sheet is open.
     *
     * `open()` is handed a snapshot from Holdings, and the market poll only
     * refreshes the *price* — so liquidation, collateral and unrealized PnL
     * stayed frozen at whatever they were when the list last loaded. That is
     * wrong on any screen, and actively unsafe on Auto Close, where the stop is
     * clamped to the liquidation price: funding and fees move that wall, and a
     * ceiling computed from a stale one lets through a stop the chain will
     * never honour.
     *
     * Slower than the price poll on purpose — `/account` is a heavier read than
     * a quote, and these fields drift over minutes, not seconds.
     */
    useEffect(() => {
      if (!live || !position) return;
      const symbolKey = position.symbol.trim().toUpperCase();
      // A Sandwich leg's child, else a standalone isolated position's own child.
      const subaccountIndex = context?.subaccountIndex ?? position.subaccountIndex ?? null;
      let cancelled = false;

      const tick = async () => {
        try {
          const next = await getPhoenixAccount();
          if (cancelled || !next.account.registered) return;
          // A Sandwich leg lives in its own isolated child; the cross account
          // may well hold a *different* position in the same symbol.
          const holder =
            subaccountIndex === null
              ? next.account.cross
              : (next.account.subaccounts.find(
                  (candidate) => candidate.subaccountIndex === subaccountIndex,
                ) ?? null);
          const fresh = holder?.positions.find(
            (candidate) => candidate.symbol.trim().toUpperCase() === symbolKey,
          );
          // A position that has closed out from under the sheet is left alone
          // rather than blanked — the owner's own refresh decides that.
          if (fresh) setPosition(fresh);
        } catch {
          // A missed refresh keeps the last good row. Phoenix's budget is
          // shared, and a transient failure must not empty the screen.
        }
      };

      void tick();
      const timer = setInterval(() => void tick(), POSITION_POLL_MS);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
      // Keyed on the *symbol*, not the position object: this effect replaces
      // that object on every successful tick, so depending on it would tear the
      // interval down and restart it each time — a poll that never settles.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [context?.subaccountIndex, live, position?.symbol]);

    /**
     * Ceiling for the stop ruler, read off the position's *reported*
     * liquidation price rather than re-derived from leverage.
     *
     * This is what was missing: nothing here bounded the stop, so it could be
     * dragged straight past liquidation — and unlike the entry path, the TP/SL
     * build had no `stopPriceWithSafety` check to catch it. The result was an
     * accepted order that can never fire, because liquidation reaches the price
     * first and closes the position the trigger was waiting on.
     */
    const stopCeilingPercent = useMemo(
      () => maxStopLossPctFromLiquidation(markPrice, position?.liquidationPrice ?? null),
      [markPrice, position?.liquidationPrice],
    );

    const openEditLevels = useCallback(() => {
      setEditingLevels(true);
    }, []);

    const cancelEditLevels = useCallback(() => {
      setEditingLevels(false);
    }, []);

    const changeColor =
      marketChange === null || marketChange === 0
        ? colors.textSecondary
        : marketChange > 0
          ? colors.positive
          : colors.negative;

    // Card figures.
    const pnlPositive = position ? position.unrealizedPnl >= 0 : true;
    const pnlColor = pnlPositive ? CARD_POS : CARD_NEG;
    const returnColor =
      changeSinceEntry === null
        ? colors.textTertiary
        : changeSinceEntry >= 0
          ? CARD_POS
          : CARD_NEG;
    // What the user put in. `marginUsd` is the margin they entered (Bread's
    // ledger, else entry notional ÷ leverage). Phoenix's `initialMargin` is NOT
    // that: it is the venue's minimum requirement at the market's max leverage
    // — a $5 stake at 6.9x read as "$1.75 invested" (the $35 notional ÷ 20x).
    // It only stands in when nothing better is known.
    const collateralUsd =
      position?.marginUsd != null && position.marginUsd > 0
        ? position.marginUsd
        : (position?.initialMargin ?? 0);
    // Holding shown under the size, e.g. "0.0042 LLYX".
    const holdingLabel = position ? `${formatQty(size)} ${symbol ?? ''}`.trim() : '';

    /**
     * Opens Bread's share modal on the card the user is already looking at,
     * rather than the OS text dialog — the position goes out as the same
     * artifact every other share in the app produces.
     *
     * Every figure is handed over explicitly: a perp is not a token, so the
     * wallet store the modal normally reads has no balance, cost basis or
     * price line for it. The mark chart travels with the data for the same
     * reason.
     */
    /**
     * The sheet is a route of its own; dismissing it before the push is what
     * lands the composer on a screen rather than under the sheet.
     */
    const openThesisComposer = () => {
      if (!position) return;
      const sym = symbol ?? position.symbol.trim().toUpperCase();
      const logo = perpLogoSources(position);
      const route = takeComposerRoute(
        context
          ? {
              positionKind: 'perp',
              positionId: context.positionId,
              name: context.title,
              direction: position.positionSize < 0 ? 'SHORT' : 'LONG',
              leverage: position.leverage ?? null,
              pct: changeSinceEntry,
              valueUsd: collateralUsd + position.unrealizedPnl,
              logoUrl: logo.uri,
              logoFallbackUrls: logo.fallbackUris,
            }
          : {
              // Phoenix positions have no Bread row; the symbol is the key,
              // scoped to the trader server-side.
              positionKind: 'phoenix',
              positionId: sym,
              name: position.name?.trim() || sym,
              direction: position.positionSize < 0 ? 'SHORT' : 'LONG',
              leverage: position.leverage ?? null,
              pct: changeSinceEntry,
              valueUsd: collateralUsd + position.unrealizedPnl,
              logoUrl: logo.uri,
              logoFallbackUrls: logo.fallbackUris,
            },
      );
      dismiss();
      expoRouter.push({ pathname: route.pathname as never, params: route.params });
    };

    const sharePosition = () => {
      if (!position) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const sym = symbol ?? position.symbol.trim().toUpperCase();
      const pnl = `${pnlPositive ? '+' : '−'}${formatUsd(Math.abs(position.unrealizedPnl))}`;
      const pct =
        changeSinceEntry === null
          ? ''
          : ` (${changeSinceEntry >= 0 ? '+' : '−'}${Math.abs(changeSinceEntry).toFixed(2)}%)`;
      const leverageLabel = position.leverage ? `${formatLeverage(position.leverage)} ` : '';
      shareRef.current?.open({
        mint: '',
        symbol: sym,
        name: position.name?.trim() || sym,
        // One <Image> with no fallback chain here, unlike the header, so
        // take the best single source: the tokens.xyz artwork joined onto the
        // market, then whatever else resolves.
        icon: perpLogoSources(position).uri,
        price: markPrice,
        change24h: detail?.change24h?.changePercent ?? null,
        position: {
          identityLabel: `My Bread ${leverageLabel}${side}`,
          valueUsd: notionalUsd,
          investedUsd: collateralUsd,
          entryPrice: position.entryPrice,
          pnlUsd: position.unrealizedPnl,
          // The move since entry, in the trade's direction — the same figure
          // the card shows beside the PnL, not a return on margin.
          pnlPct: changeSinceEntry,
          message: `My ${side.toUpperCase()} ${sym} on Bread — ${pnl}${pct} unrealized PnL`,
        },
        chart: (
          <PositionShareChart
            candles={chartCandles}
            entryPrice={position.entryPrice}
            // Card width less the sheet's padding (18 each side), the card's
            // own 4pt frame and the chart well's 12pt gutters.
            width={width - 68}
            height={108}
            positive={pnlPositive}
          />
        ),
      });
    };

    return (
      <>
        <View style={styles.body}>
          <View style={styles.stackedContent}>
          {/* Auto Close takes the whole surface rather than swapping the card
              underneath the chart. It is one decision with its own chart, its
              own rulers and its own confirm — the same pad the order ticket
              opens before a position exists — so entry and management now read
              as the same screen instead of two different editors.

              `submitAutoClose` still owns the transaction; the pad only reports
              the two prices. */}
          {position && editingLevels ? (
            <PhoenixAutoClosePad
              symbol={symbol ?? position.symbol}
              side={side}
              referencePrice={markPrice}
              entryPrice={position.entryPrice}
              // Real PnL at each trigger is measured from the entry, not the
              // mark — the position is already open and already carries a move.
              liquidationPrice={position.liquidationPrice}
              maxStopPercent={stopCeilingPercent}
              candles={chartCandles}
              chartWidth={chartWidth}
              // Same height the sheet's own chart is drawn at, so swapping to
              // the pad moves nothing on screen.
              chartHeight={300}
              notionalUsd={notionalUsd}
              // Units, not notional: notional is quoted at the live mark while
              // the PnL is booked against the entry.
              positionSize={size}
              marginUsd={collateralUsd}
              takeProfitPrice={position.takeProfitPrice}
              stopLossPrice={position.stopLossPrice}
              submitting={submitting}
              confirmLabel="Save"
              onCancel={cancelEditLevels}
              onSubmit={(next) => void submitAutoClose(next)}
            />
          ) : (
            <>
          {position ? (
            <View style={styles.detailHeader}>
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <AssetLogo
                    {...perpLogoSources(position)}
                    size={40}
                    borderRadius={20}
                    backgroundColor="transparent"
                    fallback={
                      <View style={styles.iconFallback}>
                        <Text style={styles.iconFallbackText}>{position.symbol.slice(0, 1)}</Text>
                      </View>
                    }
                  />
                  <View style={styles.headerText}>
                    <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
                      {position.name?.trim() || position.symbol.toUpperCase()}
                    </Text>
                    <Text
                      style={[styles.headerPositionSide, { color: sideColor }]}
                      numberOfLines={1}
                    >
                      {side.toUpperCase()}
                      {position.leverage ? ` ${formatLeverage(position.leverage)}` : ''}
                      {/* Where in the episode the call was made. Rendered only
                          for a Sandwich from a podcast — a source with no
                          timeline has no timestamp to show, and a placeholder
                          would read as "0:00 into nothing". */}
                      {context && formatTimestamp(context.startMs)
                        ? ` · ${formatTimestamp(context.startMs)}`
                        : ''}
                    </Text>
                  </View>
                </View>

                <View style={styles.headerRight}>
                  {/* Both figures come from the same market poll. Until it
                      lands they are unknown rather than absent, so the header
                      holds their shape instead of showing dashes that read as
                      a market with no price. */}
                  {markPrice === null ? (
                    <ValueSkeletonLine
                      lineHeight={34}
                      width={112}
                      accessibilityLabel="Loading mark price"
                    />
                  ) : (
                    <Text style={styles.markValue} numberOfLines={1}>
                      {formatUsd(markPrice)}
                    </Text>
                  )}
                  {marketChange === null ? (
                    <ValueSkeletonLine
                      lineHeight={19}
                      width={58}
                      accessibilityLabel="Loading price change"
                    />
                  ) : (
                    <Text style={[styles.markChange, { color: changeColor }]} numberOfLines={1}>
                      {`${marketChange >= 0 ? '+' : '−'}${Math.abs(marketChange).toFixed(2)}%`}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          ) : null}

          {/* The chart is pinned above the scroll area so its position never
              shifts when the content below swaps between the position card and
              the SL/TP editor.

              Closing is the exception: the pad replaces the chart outright, so
              the whole decision — slice, PnL, what's left — fits on one screen
              with nothing to scroll. A chart cannot be read while choosing a
              size anyway. */}
          {position && closePercent === null ? (
            <View style={styles.chartFixed}>
              {chartCandles.length === 0 ? (
                <View style={[styles.chartLoading, { width: chartWidth }]}>
                  {error ? (
                    <>
                      <Text style={styles.chartError}>Couldn’t load the chart.</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry position chart"
                        onPress={refresh}
                        style={styles.retryButton}
                      >
                        <Text style={styles.retryText}>Try again</Text>
                      </Pressable>
                    </>
                  ) : (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  )}
                </View>
              ) : (
                <PhoenixMarkChart
                  candles={chartCandles}
                  width={chartWidth}
                  height={300}
                  hideAxis
                  priceAxis
                  timeAxis
                  // Zoom/scroll whenever the chart isn't being used to drag
                  // levels — that mode owns the pan.
                  interactive
                  viewportKey={range}
                  initialVisibleCandles={rangeBars}
                  markPrice={markPrice}
                  entryPrice={position.entryPrice}
                  liquidationPrice={position.liquidationPrice}
                  // Read-only here: editing swaps the whole surface for the
                  // Auto Close pad, which brings its own draggable chart.
                  takeProfitPrice={position.takeProfitPrice}
                  stopLossPrice={position.stopLossPrice}
                />
              )}

              <View style={styles.chartControlsWrap}>
                <View style={styles.chartControlSpacer} pointerEvents="none" />
                <View style={styles.tfRow}>
                  {PHOENIX_RANGE_ORDER.map((label) => {
                    const active = range === label;
                    return (
                      <Pressable
                        key={label}
                        accessibilityRole="button"
                        accessibilityLabel={`Show ${label} position chart`}
                        accessibilityState={{ selected: active }}
                        onPress={() => {
                          void Haptics.selectionAsync();
                          setRange(label);
                        }}
                        style={styles.tfChip}
                      >
                        <Text style={[styles.tfText, active && styles.tfTextActive]}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.chartControlSpacer} pointerEvents="none" />
              </View>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={[
              styles.content,
              closePercent !== null && styles.contentClosing,
            ]}
          >
            {position ? (
              <>
                {closePercent !== null ? (
                  /* Closing uses the same trick as editing levels: the chart
                     stays, the card becomes the control. A native alert could
                     only ask yes/no, so every exit was all-or-nothing and the
                     numbers behind it were invisible. */
                  <PhoenixClosePad
                    unrealizedPnl={position.unrealizedPnl}
                    percent={closePercent}
                    onPercentChange={(next) =>
                      setClosePercent(
                        Math.max(MIN_CLOSE_PERCENT, Math.min(100, Math.round(next))),
                      )
                    }
                    // A Sandwich closes its whole PDA atomically; there is no
                    // slice for the user to pick.
                    fullOnly={context !== null}
                    {...(context !== null
                      ? { returnToCash, onReturnToCashChange: setReturnToCash }
                      : {})}
                  />
                ) : (
                <View style={styles.cardOuter}>
                  <View style={styles.cardInner}>
                    {/* Headline: size on the left, unrealized PnL on the right. */}
                    <View style={styles.summaryRow}>
                      <Text
                        style={styles.summaryValue}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.55}
                      >
                        {formatUsd(notionalUsd)}
                      </Text>
                      <Text
                        style={[styles.summaryValue, styles.summaryValueRight, { color: pnlColor }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.55}
                      >
                        {`${pnlPositive ? '+' : '−'}${formatUsd(Math.abs(position.unrealizedPnl))}`}
                      </Text>
                    </View>

                    {/* Sub-headline: holding on the left, PnL % on the right. */}
                    <View style={styles.subRow}>
                      <Text style={styles.subLeft} numberOfLines={1}>
                        {holdingLabel}
                      </Text>
                      {changeSinceEntry === null ? (
                        <ValueSkeletonLine
                          lineHeight={16}
                          width={56}
                          color={colors.border}
                          accessibilityLabel="Loading return since entry"
                        />
                      ) : (
                        <Text style={[styles.subRight, { color: returnColor }]} numberOfLines={1}>
                          {`${changeSinceEntry >= 0 ? '▲' : '▼'} ${Math.abs(changeSinceEntry).toFixed(2)}%`}
                        </Text>
                      )}
                    </View>

                    <View style={styles.cardDivider} />

                    {/* Footer facts: invested (collateral) and average entry. */}
                    <View style={styles.footRow}>
                      <View style={styles.footPair}>
                        <Text style={styles.footLabel}>Invested</Text>
                        <Text style={styles.footValue}>{formatUsd(collateralUsd)}</Text>
                      </View>
                      <View style={styles.footPair}>
                        <Text style={styles.footLabel}>Avg. entry</Text>
                        <Text style={styles.footValue}>{formatUsd(position.entryPrice)}</Text>
                      </View>
                    </View>
                  </View>

                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Share position"
                    onPress={sharePosition}
                    style={styles.shareButton}
                  >
                    <ShareIcon size={16} color={colors.text} />
                    <Text style={styles.shareText}>Share</Text>
                  </PressableScale>
                </View>
                )}

                {closePercent === null ? (
                  <AddThesisButton style={styles.addThesis} onPress={openThesisComposer} />
                ) : null}

              </>
            ) : null}
          </ScrollView>

          {position ? (
            closePercent !== null ? (
              /* Closing confirms the way opening does: one slider, at the same
                 inset and the same height as the order ticket's. A close is a
                 trade, and the deliberate gesture that guards an entry should
                 guard the exit too — two tap targets in a glass tray were a
                 different control for the same weight of decision. The way
                 out is the sheet's own: pan it down. */
              <View style={styles.closeBar}>
                <SlideToConfirm
                  actionLabel={
                    context !== null || closePercent >= 100
                      ? 'Close'
                      : `Close ${Math.round(closePercent)}%`
                  }
                  amountLabel={
                    markPrice === null
                      ? 'Waiting for price'
                      : `${formatUsd(
                          notionalUsd * (context !== null ? 1 : closePercent / 100),
                        )} out`
                  }
                  actionColor={colors.actionSell}
                  trackColor={withAlpha(colors.actionSell, isDark ? 0.2 : 0.24)}
                  trackBorderColor={withAlpha(colors.actionSell, isDark ? 0.48 : 0.42)}
                  canConfirm={markPrice !== null}
                  submitting={false}
                  submittingLabel="Close"
                  onComplete={() => {
                    const target = position;
                    const fraction = context !== null ? 1 : closePercent / 100;
                    setClosePercent(null);
                    dismiss();
                    onRequestClosePosition?.(target, {
                      fraction,
                      returnToCash,
                      exitPrice: markPrice,
                    });
                  }}
                />
              </View>
            ) : (
              /* iOS 26 bar: the actions ARE the surface. Two Liquid Glass
                 capsules float over the content, grouped in a GlassContainer so
                 the system samples and lights them as one set of controls
                 instead of two unrelated views. (Add `spacing={n}` to let them
                 melt into each other as they approach; left off so two
                 differently-tinted capsules never blend into one blob.)
                 Off-glass platforms get the opaque bar underneath. */
              <ActionBar style={styles.bottomBar}>
                <SideGlassButton
                  label="EDIT SL/TP"
                  color={colors.actionPrimary}
                  disabled={markPrice === null}
                  onPress={openEditLevels}
                />
                <SideGlassButton
                  label="CLOSE"
                  color={colors.actionSell}
                  onPress={() => {
                    // Opens the pad in this sheet. Nothing is submitted until
                    // the user confirms an amount there.
                    setClosePercent(100);
                  }}
                />
              </ActionBar>
            )
          ) : null}
            </>
          )}
          </View>
        </View>

      {/* Sibling, not a child. The route hosts its own BottomSheetModalProvider
          so this gorhom modal portals *inside* the native sheet's view
          hierarchy and stacks over it — the app-root provider sits underneath
          the presented sheet. */}
      <AssetShareSheet ref={shareRef} />
      </>
    );
}

/**
 * Groups the bar's capsules for the system's glass pass.
 *
 * `GlassContainer` is a native view on iOS, so it is only mounted where the
 * glass API actually exists; everywhere else the bar is a plain view.
 */
function ActionBar({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  if (!HAS_GLASS) return <View style={style}>{children}</View>;
  return <GlassContainer style={style}>{children}</GlassContainer>;
}

/**
 * The mark line as it goes onto a share card: a plain SVG sparkline with a
 * dashed line at the entry, so the card reads the same as the sheet's chart.
 *
 * Deliberately not `PhoenixMarkChart` — that one is Skia, and the card is
 * captured to a PNG with `react-native-view-shot`, which does not reliably
 * pick up a Skia canvas. SVG snapshots every time.
 */
function PositionShareChart({
  candles,
  entryPrice,
  width,
  height,
  positive,
}: {
  candles: PhoenixCandle[];
  entryPrice: number;
  width: number;
  height: number;
  positive: boolean;
}) {
  const { colors } = useThemeStore();
  const closes = candles.map((candle) => candle.markClose || candle.close).filter(Number.isFinite);
  if (closes.length < 2 || width <= 0) return null;

  const stroke = positive ? CARD_POS : CARD_NEG;
  const hasEntry = Number.isFinite(entryPrice) && entryPrice > 0;
  // The entry belongs inside the range even when price never returned to it,
  // otherwise its line would sit off the top or bottom of the card.
  const range = hasEntry ? [...closes, entryPrice] : closes;
  const min = Math.min(...range);
  const max = Math.max(...range);
  // A flat series would divide by zero; give it a hairline of room instead.
  const span = max - min || Math.abs(max) * 0.01 || 1;
  const padY = 8;
  const plot = Math.max(height - padY * 2, 1);
  const x = (index: number) => (index / (closes.length - 1)) * width;
  const y = (value: number) => padY + (1 - (value - min) / span) * plot;

  const path = closes
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)} ${y(value).toFixed(2)}`)
    .join(' ');

  return (
    <Svg width={width} height={height}>
      {hasEntry ? (
        <SvgLine
          x1={0}
          x2={width}
          y1={y(entryPrice)}
          y2={y(entryPrice)}
          stroke={colors.textTertiary}
          strokeWidth={1}
          strokeDasharray="4 4"
        />
      ) : null}
      <SvgPath
        d={path}
        stroke={stroke}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Contract quantity — two decimals like every other figure on the card; a
// size that rounds to nothing says so rather than printing "0.00".
function formatQty(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.005) return '<0.01';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // One tone darker than the card, so the content scaled down to 0.93 is
    // actually visible at its edges instead of white-on-white.
    body: { flex: 1, backgroundColor: c.backgroundAlt },
    stackedContent: {
      flex: 1,
      overflow: 'hidden',
      backgroundColor: c.background,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
    },
    content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: ACTION_BAR_HEIGHT + 18 },
    // Slider (68) + the bar's own padding.
    // flexGrow lets the close pad stretch to the bar so its keypad sits on
    // the bottom edge rather than floating under the summary tiles.
    contentClosing: { flexGrow: 1, paddingBottom: CLOSE_BAR_HEIGHT + 18 },
    // Pinned chart region — sits between the header and the scrolling content
    // so the graph holds its place regardless of what renders below it.
    chartFixed: { paddingHorizontal: 16, paddingTop: 8 },
    detailHeader: {
      zIndex: 10,
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 4,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 2,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    headerText: { flex: 1, minWidth: 0, paddingRight: 4 },
    iconFallback: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconFallbackText: { color: c.textInverse, fontSize: 16, fontWeight: '700', fontFamily: F },
    title: {
      fontFamily: F,
      color: c.text,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: '800',
      flexShrink: 1,
    },
    headerPositionSide: {
      marginTop: -3,
      fontFamily: Fonts.displayOne,
      fontSize: 14,
      lineHeight: 18,
      letterSpacing: 0.2,
    },

    headerRight: { alignItems: 'flex-end', justifyContent: 'center' },
    markValue: {
      fontFamily: F,
      color: c.text,
      fontSize: 27,
      lineHeight: 34,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    markChange: {
      fontFamily: Fonts.displayMedium,
      marginTop: -6,
      fontSize: 16,
      lineHeight: 19,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },

    chartControlsWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 10,
      paddingHorizontal: 4,
    },
    chartControlSpacer: { width: 34, height: 40 },
    tfRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
    },
    tfChip: {
      minWidth: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tfText: { fontFamily: F, color: c.textTertiary, fontSize: 14, fontWeight: '700' },
    tfTextActive: { color: c.text, fontSize: 15, fontWeight: '900' },
    chartLoading: { height: 300, alignItems: 'center', justifyContent: 'center', gap: 10 },
    chartError: { fontFamily: F, color: c.textSecondary, fontSize: 13, fontWeight: '700' },
    retryButton: {
      minWidth: 88,
      minHeight: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    retryText: { fontFamily: F, color: c.text, fontSize: 13, fontWeight: '800' },

    // Grey outer shell that holds the white stats card and the Share row.
    addThesis: { marginTop: 14, marginBottom: 4 },
    cardOuter: {
      marginTop: 10,
      borderRadius: 18,
      backgroundColor: c.surfaceAlt,
      padding: 4,
    },
    cardInner: {
      borderRadius: 14,
      backgroundColor: c.surface,
      paddingHorizontal: 12,
      paddingTop: 11,
      paddingBottom: 11,
    },
    // Row 1 — the two big numbers.
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 10,
    },
    summaryValue: {
      flexShrink: 1,
      fontFamily: F,
      color: c.text,
      fontSize: 19,
      lineHeight: 23,
      fontWeight: '900',
      letterSpacing: -0.4,
      fontVariant: ['tabular-nums'],
    },
    // PnL amount uses the Rubik One display face for extra punch.
    summaryValueRight: { textAlign: 'right', fontFamily: Fonts.displayOne },
    // Row 2 — muted holding and the PnL %.
    subRow: {
      marginTop: 3,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    subLeft: {
      flexShrink: 1,
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
    subRight: {
      fontFamily: Fonts.displayMedium,
      fontSize: 12,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    cardDivider: {
      marginVertical: 8,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
    },
    // Row 3 — label + value pairs.
    footRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    footPair: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 5,
      flexShrink: 1,
      minWidth: 0,
    },
    footLabel: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 12,
      fontWeight: '700',
    },
    footValue: {
      fontFamily: F,
      color: c.text,
      fontSize: 13,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    // Share affordance on the grey shell, under the white card.
    shareButton: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    shareText: {
      fontFamily: F,
      color: c.text,
      fontSize: 13,
      fontWeight: '800',
    },
    // Pinned actions. No plate on iOS — the glass pills float over the content.
    // Matches the order ticket's own footer inset (18 horizontal, CTA.inset at
    // the bottom) rather than the two-capsule bar's 24 — the slider is the same
    // control in the same place on the open screen and this one.
    closeBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      gap: 8,
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: CTA.inset,
      backgroundColor: c.background,
    },
    bottomBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      // Tight enough to sit inside GlassContainer's merge distance, so the two
      // capsules pull at each other the way system controls do.
      gap: ACTION_GAP,
      // Equal on all three edges, so the bottom corners of the capsules track
      // the corners of the display instead of cutting across them.
      paddingHorizontal: ACTION_INSET,
      paddingTop: 10,
      paddingBottom: ACTION_INSET,
      backgroundColor: HAS_GLASS ? 'transparent' : c.background,
    },
    disabled: { opacity: 0.45 },

    // Takes the position card's slot while editing, so the screen keeps its
    // shape — same chart above, same actions below.
  });
