import { Ionicons } from '@expo/vector-icons';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TextInput,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PhoenixMarkChart, type TriggerLeg } from '@/components/phoenix-mark-chart';
import { ScaleRuler } from '@/components/scale-ruler';
import { SideGlassButton } from '@/components/side-glass-button';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { withAlpha } from '@/lib/color-utils';
import { CTA } from '@/lib/screen-corners';
import { MIN_STOP_LOSS_PCT, triggerOutcome } from '@/lib/phoenix-risk';
import { trackWindow } from '@/lib/ruler-scale';
import { useThemeStore } from '@/lib/theme-store';
import type { PhoenixCandle, PhoenixTradeSide } from '@/lib/phoenix-api';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;
/**
 * Rubik Black — the CTA row's labels.
 *
 * Rubik One ships a single weight, so `fontWeight` is inert against it on iOS.
 * Black is the heaviest face in the family and the one the position sheet's own
 * EDIT SL/TP and CLOSE capsules use, so the two screens now agree.
 */
const F_CTA = Fonts.display;

/**
 * The pad's own side padding, and the gap between the two CTA capsules.
 *
 * The pad replaces the position sheet's whole surface, so its chart and its
 * buttons have to land exactly where that sheet's do — anything else reads as
 * the screen jumping when Edit SL/TP is tapped. The CTA row therefore steps
 * back out to {@link CTA}'s inset, and the header/chart offsets below mirror
 * the sheet's `detailHeader` + `chartFixed` stack.
 */
const PAD_H = 16;
const ACTION_GAP = 10;

const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

/** Both rulers move in 0.1% of price and are labelled every 1%. */
const PERCENT_STEP = 0.1;
const PERCENT_MAJOR = 1;
const PERCENT_PIXELS_PER_STEP = 7;
/** A stop tighter than this is inside the spread; a target beyond it is noise. */
export const MIN_PERCENT = 0.2;
/**
 * Ceiling on the stop ruler when nothing is known about liquidation.
 *
 * This is a *fallback*, not the real limit. The real limit is the liquidation
 * price — a stop set beyond it is a dead order, because the liquidation engine
 * reaches the price first and leaves no position for the trigger to close — and
 * it is passed in as `maxStopPercent`. 50% only applies while the mark or the
 * liquidation price is still loading.
 */
export const MAX_STOP_PERCENT = 50;
/**
 * Span the take-profit track opens at.
 *
 * A stop is bounded by liquidation; a target is bounded only by ambition. But
 * an unbounded ruler still has to fit on a screen, and showing the whole range
 * at once made a single swipe cross four decades — the top of the scale moving
 * in hundreds per pixel. So the track shows this window and steps up (×5) only
 * once the value outgrows it, which on a log scale shifts the needle about a
 * fifth of the width rather than jumping it.
 *
 * The step happens **on release**, never mid-gesture. Resizing under a live
 * finger is a feedback loop — a wider scale reads a larger value at the same
 * finger position, which widens it again — and it is what spiked the number
 * from 70% to 4200% in a few frames.
 */
export const TARGET_BASE_PERCENT = 200;
/** Absolute ceiling for the window, and the clamp for a chart-drag fling. */
export const MAX_TARGET_PERCENT = 25_000;
/** Opening defaults — a tight-ish stop and a target about 3x its size. */
export const DEFAULT_STOP_PERCENT = 1;
export const DEFAULT_TARGET_PERCENT = 3;

export type PhoenixAutoClosePadProps = {
  /**
   * The host cannot paint native Liquid Glass — measured on iOS 26, a
   * `GlassView` inside the Sandwich leg's morph card lays down no fill, so
   * every CTA here would be a white label on a near-white capsule.
   */
  disableGlass?: boolean;
  /** Compact entry-ticket editor; open positions keep the chart-and-ruler layout. */
  layout?: 'full' | 'modal';
  /** Kept for callers/analytics; the pad itself no longer labels with it. */
  symbol: string;
  side: PhoenixTradeSide;
  /** Price the percentages are measured from — the live mark. */
  referencePrice: number | null;
  /**
   * Entry price of an existing position. When set, the footer's dollar figures
   * are PnL against the entry (what the position actually books at the
   * trigger); without it they are measured from the reference.
   */
  entryPrice?: number | null;
  candles: PhoenixCandle[];
  chartWidth: number;
  /** Plot height. 200 keeps the pad on one screen; the position sheet is taller. */
  chartHeight?: number;
  /**
   * Where the position is liquidated. Drawn on the chart as the wall the stop
   * may not cross, and it is what {@link maxStopPercent} is derived from.
   */
  liquidationPrice?: number | null;
  /**
   * Hard ceiling for the stop ruler, as a percentage move from the reference.
   *
   * Callers compute it from liquidation — `maxStopLossPctFromLiquidation` on an
   * open position, or `maxStopLossPct` with tier and maintenance inputs before
   * one exists —
   * so the ruler cannot reach a level the server would reject with
   * `phoenix_stop_safety_failed`, or worse, accept as an order that can never
   * fire. `null` while the inputs are still loading.
   */
  maxStopPercent?: number | null;
  /** Position notional, used to turn a % price move into dollars. */
  notionalUsd: number;
  /**
   * Units held, for a position that already exists.
   *
   * Preferred over `notionalUsd` when present, because notional is quoted at
   * the *live mark* while PnL is booked against the *entry*. Deriving quantity
   * from notional therefore scaled every figure by `mark / entry` — a position
   * 20% in profit overstated its take-profit payout by 20%.
   */
  positionSize?: number | null;
  /**
   * The user's own money behind the position — collateral, not notional.
   *
   * Turns a dollar PnL into the number they actually care about: the return on
   * what they put in. A 1% price move on a 5x position is 5% of their cash, and
   * showing only the price move understates the outcome by the leverage.
   */
  marginUsd?: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  submitting?: boolean;
  /** Verb on the primary button — "Set" when opening, "Update" on a position. */
  confirmLabel?: string;
  onCancel: () => void;
  onSubmit: (next: { takeProfitPrice: number | null; stopLossPrice: number | null }) => void;
};

/**
 * Auto Close — the take-profit / stop-loss screen.
 *
 * Levels are chosen as a **percentage move in the price**, not as an absolute
 * price, and the side decides which way each one points: a long takes profit
 * above the reference and stops out below it, a short is the mirror. That keeps
 * one control layout honest for both directions — the user picks "3% in my
 * favour", and long/short arithmetic is this component's problem, not theirs.
 *
 * The dollar figures in the footer are position PnL at the trigger:
 * `notional × move%`. They already include leverage, because notional is
 * margin × leverage.
 */
export function PhoenixAutoClosePad({
  side,
  referencePrice,
  entryPrice = null,
  candles,
  chartWidth,
  chartHeight = 200,
  liquidationPrice = null,
  maxStopPercent = null,
  notionalUsd,
  positionSize = null,
  marginUsd = null,
  takeProfitPrice,
  stopLossPrice,
  submitting = false,
  confirmLabel = 'Set',
  onCancel,
  onSubmit,
  disableGlass = false,
  layout = 'full',
}: PhoenixAutoClosePadProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors, scheme } = useThemeStore();
  const isDark = scheme === 'dark';
  const useGlass = HAS_GLASS && !disableGlass;

  // Percentages are the working state; prices are derived. Seeded from whatever
  // the caller already had set so reopening the screen is non-destructive.
  const [stopPercent, setStopPercent] = useState<number | null>(() =>
    priceToPercent(stopLossPrice, referencePrice, side, 'stop'),
  );
  const [targetPercent, setTargetPercent] = useState<number | null>(() =>
    priceToPercent(takeProfitPrice, referencePrice, side, 'target'),
  );

  /**
   * How wide the take-profit track currently reads.
   *
   * Held steady for the duration of a ruler drag — `rulerDraggingRef` is set on
   * the first move and cleared on release — so the scale under the finger never
   * changes while the finger is on it. A chart drag never sets the flag, so
   * dragging the line on the plot re-scales the ruler live, which is correct:
   * nothing is touching the ruler.
   */
  const rulerDraggingRef = useRef(false);
  const [targetWindow, setTargetWindow] = useState(TARGET_BASE_PERCENT);
  useEffect(() => {
    if (rulerDraggingRef.current || targetPercent === null) return;
    setTargetWindow(trackWindow(targetPercent, TARGET_BASE_PERCENT, MAX_TARGET_PERCENT));
  }, [targetPercent]);

  /**
   * The stop ruler's real ceiling.
   *
   * `maxStopPercent` is null only while the mark or the liquidation price is
   * still in flight; falling back to the flat {@link MAX_STOP_PERCENT} there is
   * safe because the ruler is re-clamped the moment a real ceiling arrives.
   */
  const stopCeiling = useMemo(() => {
    if (maxStopPercent === null || !Number.isFinite(maxStopPercent)) return MAX_STOP_PERCENT;
    // A percent is only offered at ruler resolution, and offering a level the
    // server's own MIN_STOP_LOSS_PCT floor rejects is the same broken order in
    // the other direction.
    return Math.max(0, Math.min(MAX_STOP_PERCENT, Number(maxStopPercent.toFixed(1))));
  }, [maxStopPercent]);
  /**
   * Past ~16x on a 20x market the safe band closes below the smallest stop the
   * ruler (or the server) will take. Offering a slider there is offering a
   * control whose every value 422s, so the row says why instead.
   */
  const stopAvailable = stopCeiling >= Math.max(MIN_PERCENT, MIN_STOP_LOSS_PCT);

  // The ceiling moves with the mark, and on an open position it also moves with
  // funding and fees. A stop parked at 4% when the wall drops to 3% must come
  // down with it — silently allowing the stale value is how a level that can
  // never fire gets submitted.
  useEffect(() => {
    setStopPercent((current) => {
      if (current === null) return current;
      if (!stopAvailable) return null;
      return current > stopCeiling ? stopCeiling : current;
    });
  }, [stopAvailable, stopCeiling]);

  /**
   * Re-seed off the live mark once it lands.
   *
   * The pad can mount before a price exists (the position sheet presents
   * straight from the tap), and percentages seeded against a null reference are
   * null. Without this the rulers would sit empty on a position that already
   * has levels set. It fires once, on the first real reference — after that the
   * user's edits own the state.
   */
  const seededRef = useRef(referencePrice !== null);
  useEffect(() => {
    if (seededRef.current || referencePrice === null) return;
    seededRef.current = true;
    setStopPercent(priceToPercent(stopLossPrice, referencePrice, side, 'stop'));
    setTargetPercent(priceToPercent(takeProfitPrice, referencePrice, side, 'target'));
  }, [referencePrice, side, stopLossPrice, takeProfitPrice]);

  const stopPrice = useMemo(
    () => percentToPrice(stopPercent, referencePrice, side, 'stop'),
    [referencePrice, side, stopPercent],
  );
  const targetPrice = useMemo(
    () => percentToPrice(targetPercent, referencePrice, side, 'target'),
    [referencePrice, side, targetPercent],
  );

  const [stopPriceDraft, setStopPriceDraft] = useState(() => formatPriceInput(stopLossPrice));
  const [stopPercentDraft, setStopPercentDraft] = useState(() =>
    formatPercentInput(priceToPercent(stopLossPrice, referencePrice, side, 'stop')),
  );
  const [targetPriceDraft, setTargetPriceDraft] = useState(() => formatPriceInput(takeProfitPrice));
  const [targetPercentDraft, setTargetPercentDraft] = useState(() =>
    formatPercentInput(priceToPercent(takeProfitPrice, referencePrice, side, 'target')),
  );
  const stopEditSource = useRef<'price' | 'percent'>('price');
  const targetEditSource = useRef<'price' | 'percent'>('price');
  /**
   * The field the finger is in, if any.
   *
   * The sync effects below rewrite both drafts whenever a level changes, and a
   * level now changes on every keystroke — so without this they reformatted the
   * text under the cursor mid-word ("5." became "5" became "5.0").
   */
  const editingRef = useRef<
    'stopPrice' | 'stopPercent' | 'targetPrice' | 'targetPercent' | null
  >(null);

  useEffect(() => {
    if (editingRef.current !== 'stopPrice') setStopPriceDraft(formatPriceInput(stopPrice));
    if (editingRef.current !== 'stopPercent') setStopPercentDraft(formatPercentInput(stopPercent));
  }, [stopPercent, stopPrice]);
  useEffect(() => {
    if (editingRef.current !== 'targetPrice') setTargetPriceDraft(formatPriceInput(targetPrice));
    if (editingRef.current !== 'targetPercent') {
      setTargetPercentDraft(formatPercentInput(targetPercent));
    }
  }, [targetPercent, targetPrice]);

  /**
   * Units of the underlying the PnL is earned on.
   *
   * An open position reports its own size. A prospective one has none yet, so
   * it is the notional divided by the price it would fill at — which is the
   * reference, since that *is* the fill price for an entry.
   */
  const quantity = useMemo(() => {
    if (positionSize !== null && Number.isFinite(positionSize) && positionSize !== 0) {
      return Math.abs(positionSize);
    }
    if (referencePrice === null || referencePrice <= 0 || notionalUsd <= 0) return null;
    return notionalUsd / referencePrice;
  }, [notionalUsd, positionSize, referencePrice]);

  /**
   * What each leg books. See `triggerOutcome` for why this is units-based and
   * why the percentage is against collateral rather than notional.
   */
  const outcomeAt = useCallback(
    (triggerPrice: number | null) =>
      triggerOutcome({
        side,
        quantity,
        basisPrice: entryPrice ?? referencePrice,
        triggerPrice,
        marginUsd,
      }),
    [entryPrice, marginUsd, quantity, referencePrice, side],
  );
  const targetOutcome = outcomeAt(targetPrice);
  const stopOutcome = outcomeAt(stopPrice);
  const profitUsd = targetOutcome.pnlUsd;
  const lossUsd = stopOutcome.pnlUsd;
  /** Sitting on the wall — worth saying out loud, because the ruler stops moving. */
  const atStopCeiling =
    stopPercent !== null && stopAvailable && stopPercent >= stopCeiling - 0.05;

  // Dragging a line on the chart is the same edit as moving its ruler — both
  // land on the percentage, which stays the single source of truth.
  const lastDetentRef = useRef<number | null>(null);
  const handleDragTrigger = useCallback(
    (leg: TriggerLeg, price: number) => {
      const raw = priceToPercent(
        price,
        referencePrice,
        side,
        leg === 'takeProfit' ? 'target' : 'stop',
      );
      // A drag past the reference reads as "as tight as allowed" rather than
      // flipping the level to the wrong side of the trade. The stop's ceiling is
      // liquidation, so dragging into the liquidation band pins the line at the
      // wall instead of following the finger through it.
      const max = leg === 'takeProfit' ? MAX_TARGET_PERCENT : stopCeiling;
      const next = Number(Math.min(max, Math.max(MIN_PERCENT, raw ?? MIN_PERCENT)).toFixed(1));
      const detent = Math.round(next);
      if (detent !== lastDetentRef.current) {
        lastDetentRef.current = detent;
        void Haptics.selectionAsync();
      }
      if (leg === 'takeProfit') setTargetPercent(next);
      else if (stopAvailable) setStopPercent(next);
    },
    [referencePrice, side, stopAvailable, stopCeiling],
  );

  const handleClearTrigger = useCallback((leg: TriggerLeg) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (leg === 'takeProfit') setTargetPercent(null);
    else setStopPercent(null);
  }, []);

  const toggleStop = useCallback(() => {
    if (!stopAvailable) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // The 1% default is wider than the safe band on a high-leverage position,
    // so "Add" opens at the tightest of the two rather than at an illegal level.
    setStopPercent((current) => (current === null ? Math.min(DEFAULT_STOP_PERCENT, stopCeiling) : null));
  }, [stopAvailable, stopCeiling]);
  const toggleTarget = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTargetPercent((current) => (current === null ? DEFAULT_TARGET_PERCENT : null));
  }, []);

  const canSubmit = !submitting && referencePrice !== null;

  /**
   * Whether the last edit to the stop was pulled back to the liquidation wall.
   *
   * Shown in the row's note: silently rewriting the number someone just typed
   * reads as the field being broken, so the pad says which limit caught it.
   */
  const [stopCapped, setStopCapped] = useState(false);

  /**
   * Applies a keystroke to a leg immediately.
   *
   * Everything used to resolve on blur, and a decimal pad has no return key —
   * so typing "5" into the percentage field left the price empty and the
   * potential loss at "—" until the user tapped elsewhere. The typed field
   * keeps its raw text (so "5." stays editable); its partner and the PnL
   * follow on every keystroke.
   */
  const applyLegInput = useCallback(
    (leg: 'stop' | 'target', source: 'price' | 'percent', text: string) => {
      if (leg === 'stop') {
        stopEditSource.current = source;
        if (source === 'price') setStopPriceDraft(text);
        else setStopPercentDraft(text);
      } else {
        targetEditSource.current = source;
        if (source === 'price') setTargetPriceDraft(text);
        else setTargetPercentDraft(text);
      }

      const typed = parseNumericInput(text);
      let percent =
        source === 'price' ? priceToPercent(typed, referencePrice, side, leg) : typed;
      if (percent === null || percent <= 0) percent = null;
      if (leg === 'stop' && !stopAvailable) percent = null;

      const max = leg === 'stop' ? stopCeiling : MAX_TARGET_PERCENT;
      let capped = false;
      if (percent !== null) {
        // The stop's ceiling IS liquidation: past it the liquidation engine
        // reaches the price first and the trigger closes nothing.
        capped = leg === 'stop' && percent > max;
        percent = Number(Math.min(max, Math.max(MIN_PERCENT, percent)).toFixed(1));
      }
      if (leg === 'stop') {
        setStopCapped(capped);
        setStopPercent(percent);
      } else {
        setTargetPercent(percent);
      }
    },
    [referencePrice, side, stopAvailable, stopCeiling],
  );

  const resolveModalLeg = useCallback(
    (leg: 'stop' | 'target') => {
      const source = leg === 'stop' ? stopEditSource.current : targetEditSource.current;
      const priceDraft = leg === 'stop' ? stopPriceDraft : targetPriceDraft;
      const percentDraft = leg === 'stop' ? stopPercentDraft : targetPercentDraft;
      const max = leg === 'stop' ? stopCeiling : MAX_TARGET_PERCENT;

      let percent: number | null;
      if (source === 'price') {
        const typedPrice = parseNumericInput(priceDraft);
        percent = priceToPercent(typedPrice, referencePrice, side, leg);
      } else {
        percent = parseNumericInput(percentDraft);
      }
      if (percent === null || percent <= 0) percent = null;
      if (leg === 'stop' && !stopAvailable) percent = null;
      if (percent !== null) percent = Number(Math.min(max, Math.max(MIN_PERCENT, percent)).toFixed(1));

      const price = percentToPrice(percent, referencePrice, side, leg);
      if (leg === 'stop') {
        setStopPercent(percent);
        setStopPriceDraft(formatPriceInput(price));
        setStopPercentDraft(formatPercentInput(percent));
      } else {
        setTargetPercent(percent);
        setTargetPriceDraft(formatPriceInput(price));
        setTargetPercentDraft(formatPercentInput(percent));
      }
      return price;
    }, [
      referencePrice,
      side,
      stopAvailable,
      stopCeiling,
      stopPercentDraft,
      stopPriceDraft,
      targetPercentDraft,
      targetPriceDraft,
    ],
  );

  /**
   * The line under each leg when there is nothing to price the outcome against
   * — no amount typed on the ticket yet, so a percentage has no dollars.
   */
  const sizeHint = quantity === null ? 'enter an amount' : null;
  /**
   * Only speaks up when a typed stop was pulled back to the wall.
   *
   * The ceiling used to be stated permanently under the row, which put a line of
   * small print on a sheet that is otherwise two fields — and it answered a
   * question nobody had asked yet. It earns its space at the moment it caught
   * something, and stays quiet otherwise.
   */
  const stopNote =
    stopAvailable && stopCapped
      ? `Max ${stopCeiling.toFixed(1)}%${
          liquidationPrice === null ? '' : ` — liquidation is ${formatUsd(liquidationPrice)}`
        }`
      : null;

  /**
   * Tapping "Add SL/TP" adds them.
   *
   * The editor used to open with two empty fields and no outcome, so the button
   * that says "Add" added nothing — the user had to type both levels from
   * scratch before the sheet showed them anything. It now opens on the house
   * defaults (a tight stop, a target about 3x its size), which are immediately
   * editable and clearable. Seeded once, and only when the caller has nothing
   * set: reopening a ticket that already has levels is non-destructive, and a
   * cleared field stays cleared.
   */
  const seededDefaultsRef = useRef(false);
  useEffect(() => {
    if (layout !== 'modal' || seededDefaultsRef.current || referencePrice === null) return;
    seededDefaultsRef.current = true;
    if (stopLossPrice !== null || takeProfitPrice !== null) return;
    if (stopAvailable) setStopPercent(Math.min(DEFAULT_STOP_PERCENT, stopCeiling));
    setTargetPercent(DEFAULT_TARGET_PERCENT);
  }, [layout, referencePrice, stopAvailable, stopCeiling, stopLossPrice, takeProfitPrice]);

  if (layout === 'modal') {
    return (
      <View style={styles.modalRoot}>
        <Text style={styles.modalTitle}>Stop Loss and Take Profit</Text>
        <Text style={styles.modalSubtitle}>Auto close your position when it hits your price target.</Text>

        <ModalTriggerInput
          label="Stop Loss"
          price={stopPriceDraft}
          percent={stopPercentDraft}
          accent={colors.chartNegative}
          potentialLabel="Potential loss"
          potentialValue={lossUsd === null ? null : formatSignedUsd(lossUsd)}
          hint={sizeHint}
          warning={stopNote}
          disabled={!stopAvailable}
          disabledNote={!stopAvailable ? 'Liquidation is too close at this leverage' : null}
          glass={useGlass}
          onFocusPrice={() => {
            editingRef.current = 'stopPrice';
          }}
          onFocusPercent={() => {
            editingRef.current = 'stopPercent';
          }}
          onChangePrice={(value) => applyLegInput('stop', 'price', value)}
          onChangePercent={(value) => applyLegInput('stop', 'percent', value)}
          onBlur={() => {
            editingRef.current = null;
            resolveModalLeg('stop');
          }}
          onClear={() => {
            setStopPercent(null);
            setStopCapped(false);
            setStopPriceDraft('');
            setStopPercentDraft('');
          }}
        />

        <ModalTriggerInput
          label="Take Profit"
          price={targetPriceDraft}
          percent={targetPercentDraft}
          accent={colors.chartPositive}
          potentialLabel="Potential profit"
          potentialValue={profitUsd === null ? null : formatSignedUsd(profitUsd)}
          hint={sizeHint}
          glass={useGlass}
          onFocusPrice={() => {
            editingRef.current = 'targetPrice';
          }}
          onFocusPercent={() => {
            editingRef.current = 'targetPercent';
          }}
          onChangePrice={(value) => applyLegInput('target', 'price', value)}
          onChangePercent={(value) => applyLegInput('target', 'percent', value)}
          onBlur={() => {
            editingRef.current = null;
            resolveModalLeg('target');
          }}
          onClear={() => {
            setTargetPercent(null);
            setTargetPriceDraft('');
            setTargetPercentDraft('');
          }}
        />

        <View style={styles.modalSaveRow}>
          <SideGlassButton
            glass={useGlass}
            label={confirmLabel.toUpperCase()}
            accessibilityLabel={`${confirmLabel} stop loss and take profit`}
            color={colors.actionBuy}
            disabled={!canSubmit}
            loading={submitting}
            onPress={() => {
              const nextStop = resolveModalLeg('stop');
              const nextTarget = resolveModalLeg('target');
              onSubmit({ takeProfitPrice: nextTarget, stopLossPrice: nextStop });
            }}
          />
        </View>

      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerSide} />
        <Text style={styles.title}>Auto Close</Text>
        <View style={[styles.headerSide, styles.headerSideRight]}>
          <GlassButton
            glass={useGlass}
            accessibilityLabel="Close auto close"
            onPress={onCancel}
            // Translucent, so the chip reads as glass rather than a black disc —
            // same reasoning as the order pad's close button.
            tint={withAlpha(colors.text, isDark ? 0.22 : 0.1)}
            solidColor={withAlpha(colors.text, isDark ? 0.16 : 0.08)}
            style={styles.closeShell}
            fillStyle={styles.closeFill}
          >
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </GlassButton>
        </View>
      </View>

      <View style={styles.chartWrap}>
        <PhoenixMarkChart
          candles={candles}
          width={chartWidth}
          height={chartHeight}
          hideAxis
          priceAxis
          timeAxis
          markPrice={referencePrice}
          entryPrice={entryPrice}
          // The wall the stop is clamped to. Drawn even with no stop set, so
          // the band the user is choosing inside of is visible from the start.
          liquidationPrice={liquidationPrice}
          takeProfitPrice={targetPrice}
          stopLossPrice={stopPrice}
          onDragTrigger={handleDragTrigger}
          onClearTrigger={handleClearTrigger}
        />
        <Text style={styles.chartHint}>
          {!stopAvailable && liquidationPrice !== null
            ? 'Liquidation is too close for a stop at this leverage'
            : atStopCeiling
              ? `Widest stop before liquidation — ${formatPercent(-stopCeiling)}`
              : targetPrice === null && stopPrice === null
                ? 'Add a level below, then drag its line to fine-tune'
                : 'Drag a line to move it'}
        </Text>
      </View>

      <TriggerRow
        label="Stop Loss"
        accent={colors.chartNegative}
        percent={stopPercent}
        signedPercent={stopPercent === null ? null : -stopPercent}
        price={stopPrice}
        pnlUsd={lossUsd}
        min={MIN_PERCENT}
        max={stopCeiling}
        disabled={!stopAvailable}
        // Only the dollars are quoted under the label. The ceiling and the
        // liquidation price are already drawn on the chart above as the band
        // the stop is being dragged inside of, so repeating them here was two
        // more figures on a row that only needs to answer "what does this
        // cost me".
        note={stopAvailable ? null : 'Liquidation too close'}
        onToggle={toggleStop}
        onChange={setStopPercent}
        glass={useGlass}
      />

      <TriggerRow
        label="Take Profit"
        accent={colors.chartPositive}
        percent={targetPercent}
        signedPercent={targetPercent}
        price={targetPrice}
        pnlUsd={profitUsd}
        min={MIN_PERCENT}
        max={targetWindow}
        onToggle={toggleTarget}
        onChange={(next) => {
          rulerDraggingRef.current = true;
          setTargetPercent(next);
        }}
        // Released: the scale may now step up to whatever the value became.
        onCommit={(next) => {
          rulerDraggingRef.current = false;
          setTargetPercent(next);
          setTargetWindow(trackWindow(next, TARGET_BASE_PERCENT, MAX_TARGET_PERCENT));
        }}
        glass={useGlass}
      />

      <View style={styles.actionRow}>
        <SideGlassButton
          glass={useGlass}
          label="CANCEL"
          accessibilityLabel="Cancel auto close"
          color={colors.actionSell}
          onPress={onCancel}
        />

        <SideGlassButton
          glass={useGlass}
          label={confirmLabel.toUpperCase()}
          accessibilityLabel={`${confirmLabel} auto close`}
          color={colors.actionBuy}
          disabled={!canSubmit}
          loading={submitting}
          onPress={() =>
            onSubmit({ takeProfitPrice: targetPrice, stopLossPrice: stopPrice })
          }
        />
      </View>

    </View>
  );
}

/**
 * One leg of the compact editor.
 *
 * Plain RN `TextInput`s, deliberately. gorhom's `BottomSheetTextInput` looks
 * like the right call — this card is raised from inside a BottomSheetModal —
 * but the card is rendered in a subtree the sheet's context does not reach, and
 * it throws `useBottomSheetInternal cannot be used out of the BottomSheet` on
 * render. See [[bottom-sheet-context-loss]]. The pills below focus their field
 * on press instead, which is what actually made them reliable to hit.
 */
function ModalTriggerInput({
  label,
  price,
  percent,
  accent,
  potentialLabel,
  potentialValue,
  hint = null,
  warning = null,
  disabled = false,
  disabledNote = null,
  glass = HAS_GLASS,
  onFocusPrice,
  onFocusPercent,
  onChangePrice,
  onChangePercent,
  onBlur,
  onClear,
}: {
  label: string;
  price: string;
  percent: string;
  accent: string;
  potentialLabel: string;
  potentialValue: string | null;
  /** Shown instead of the outcome when there is no size to price it against. */
  hint?: string | null;
  /**
   * Takes the outcome's place: the level asked for is past a boundary — for a
   * stop, the liquidation wall — and has been pulled back to it.
   */
  warning?: string | null;
  disabled?: boolean;
  disabledNote?: string | null;
  glass?: boolean;
  onFocusPrice?: () => void;
  onFocusPercent?: () => void;
  onChangePrice: (value: string) => void;
  onChangePercent: (value: string) => void;
  onBlur: () => void;
  onClear: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const active = price.length > 0 || percent.length > 0;
  /**
   * The pills focus their field on press rather than leaving it to the input's
   * own hit area. Inside a bottom sheet the gesture recognizers around the card
   * can swallow the touch that would make a field first responder, and a
   * 48pt-tall pill whose caret is at one end is a small target either way.
   */
  // Typed loosely: gorhom re-exports its own TextInput type, and only `focus`
  // is needed here.
  /** A blocked leg explains itself; a clamped one says what caught it. */
  const alert = disabledNote ?? warning;
  const priceRef = useRef<{ focus: () => void } | null>(null);
  const percentRef = useRef<{ focus: () => void } | null>(null);

  return (
    <View style={styles.modalLeg}>
      <View style={styles.modalLegTop}>
        <Text style={[styles.modalLegLabel, disabled && styles.disabled]}>{label}</Text>
        <View style={styles.modalInputs}>
          <Pressable
            accessible={false}
            disabled={disabled}
            onPress={() => priceRef.current?.focus()}
            style={[styles.modalInputShell, active && { borderColor: withAlpha(accent, 0.45) }]}
          >
            <TextInput
              accessibilityLabel={`${label} price`}
              editable={!disabled}
              keyboardType="decimal-pad"
              placeholder={`${label === 'Stop Loss' ? 'SL' : 'TP'} Price`}
              placeholderTextColor={colors.textTertiary}
              value={price}
              onFocus={onFocusPrice}
              onChangeText={onChangePrice}
              onBlur={onBlur}
              style={styles.modalInput}
              ref={priceRef as never}
            />
          </Pressable>
          <Pressable
            accessible={false}
            disabled={disabled}
            onPress={() => percentRef.current?.focus()}
            style={[styles.modalInputShell, active && { borderColor: withAlpha(accent, 0.45) }]}
          >
            <TextInput
              accessibilityLabel={`${label} percentage`}
              editable={!disabled}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
              value={percent}
              onFocus={onFocusPercent}
              onChangeText={onChangePercent}
              onBlur={onBlur}
              style={[styles.modalInput, styles.modalPercentInput]}
              ref={percentRef as never}
            />
            <Text style={styles.modalInputSuffix}>%</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.modalLegMeta}>
        {/* The label stays body text; only the money takes the leg's colour.
            A warning takes the whole slot — a level past liquidation has no
            outcome worth quoting, so it replaces the figure rather than
            crowding in beside it. */}
        <Text style={styles.modalPotential} numberOfLines={1}>
          {alert !== null ? (
            <Text style={{ color: accent }}>{alert}</Text>
          ) : (
            <>
              {potentialLabel}:{' '}
              {potentialValue === null ? (
                active && hint ? hint : ''
              ) : (
                <Text style={[styles.modalPotentialValue, { color: accent }]}>{potentialValue}</Text>
              )}
            </>
          )}
        </Text>
        <GlassButton
          glass={glass}
          accessibilityLabel={`Clear ${label}`}
          disabled={!active}
          onPress={onClear}
          tint={withAlpha(colors.textSecondary, 0.14)}
          style={styles.modalClearShell}
          fillStyle={styles.modalClearFill}
          solidColor={colors.surfaceAlt}
        >
          <Ionicons name="close" size={14} color={colors.textSecondary} />
          <Text style={styles.modalClearText}>Clear</Text>
        </GlassButton>
      </View>
    </View>
  );
}

/**
 * One auto-close leg: label, an Add / percentage pill, and the scale that
 * tunes it. The scale is only mounted once the leg is on — an inert ruler
 * under a greyed-out row invites dragging something that does nothing.
 */
export function TriggerRow({
  label,
  accent,
  percent,
  signedPercent,
  price,
  pnlUsd,
  min,
  max,
  disabled = false,
  note = null,
  onToggle,
  onChange,
  onCommit,
  glass = HAS_GLASS,
}: {
  label: string;
  accent: string;
  percent: number | null;
  /** Percentage as displayed — negative for a stop, positive for a target. */
  signedPercent: number | null;
  price: number | null;
  /** Position PnL if this leg triggers. */
  pnlUsd: number | null;
  min: number;
  max: number;
  /** No legal level exists for this leg — the row explains rather than offers. */
  disabled?: boolean;
  /** Small print under the label: the ceiling, and what sets it. */
  note?: string | null;
  onToggle: () => void;
  onChange: (next: number) => void;
  /** Fires once the drag settles, for a scale that may resize on release. */
  onCommit?: (next: number) => void;
  glass?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <View style={styles.rowLabelCol}>
          <Text style={[styles.rowLabel, disabled && styles.rowLabelDisabled]}>{label}</Text>
          {/* PnL is what this leg books; the note is the boundary it lives
              inside. Both matter on a stop, so they stack rather than compete
              for the one slot under the label. */}
          {/* Dollars, and only dollars — that is the outcome. The percentage
              lives on the pill opposite, which is the control that sets it. */}
          {pnlUsd !== null && !disabled ? (
            <Text style={[styles.rowPnl, { color: accent }]}>
              {pnlUsd >= 0 ? '+' : '−'}
              {formatUsd(pnlUsd)}
            </Text>
          ) : null}
          {note ? <Text style={styles.rowNote}>{note}</Text> : null}
        </View>

        {/* Percentage and the price it lands on, stacked on the right so the
            estimate reads next to the control that sets it. */}
        <View style={styles.rowRightCol}>
          <GlassButton
            glass={glass}
            accessibilityLabel={percent === null ? `Add ${label}` : `Remove ${label}`}
            disabled={disabled}
            onPress={onToggle}
            tint={accent}
            style={styles.rowPill}
            fillStyle={[
              styles.rowPillFill,
              { backgroundColor: accent },
            ]}
          >
            {percent === null ? (
              <Text style={styles.rowPillText}>Add</Text>
            ) : (
              <>
                <Text style={styles.rowPillText}>
                  {signedPercent === null ? '' : formatPercent(signedPercent)}
                </Text>
                <Ionicons name="close" size={13} color="#FFFFFF" />
              </>
            )}
          </GlassButton>
          {price === null ? null : <Text style={styles.rowPrice}>{formatUsd(price)}</Text>}
        </View>
      </View>

      {percent === null || disabled ? (
        <View style={styles.rowRulerPlaceholder} />
      ) : (
        <ScaleRuler
          // Clamped again here: ScaleRuler reports the raw drag position, and a
          // ceiling that tightened mid-gesture must win over the finger.
          value={Math.min(percent, max)}
          min={min}
          max={max}
          step={PERCENT_STEP}
          majorEvery={PERCENT_MAJOR}
          pixelsPerStep={PERCENT_PIXELS_PER_STEP}
          accent={accent}
          // Both legs, so the two rows are the same control at the same
          // resolution — and so neither has to resize while it is being dragged.
          scale="log"
          formatValue={formatPercent}
          onChange={(next) => onChange(Math.min(max, Math.max(min, next)))}
          onCommit={
            onCommit ? (next) => onCommit(Math.min(max, Math.max(min, next))) : undefined
          }
          hideBubble
          hideMajorTicks
          height={30}
        />
      )}
    </View>
  );
}

/**
 * Liquid Glass button shell — the `Pressable` owns sizing and rounding, the
 * `GlassView` inside only paints the fill (it is native, and neither auto-sizes
 * to its children nor clips reliably on its own).
 */
function GlassButton({
  children,
  onPress,
  tint,
  style,
  fillStyle,
  solidColor,
  disabled,
  accessibilityLabel,
  glass = HAS_GLASS,
}: {
  children: React.ReactNode;
  onPress: () => void;
  tint: string;
  style?: StyleProp<ViewStyle>;
  fillStyle?: StyleProp<ViewStyle>;
  solidColor?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Whether this pill may lean on native glass — false inside a host that
   *  cannot paint it (the Sandwich leg's morph card). */
  glass?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { scheme } = useThemeStore();

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={[styles.glassShell, style, disabled && styles.disabled]}
    >
      {/* A disabled pill drops the glass. A low-opacity glass material has no
          body left, so a disabled CTA renders as an empty capsule with a ghost
          label rather than a dimmed button — measured on iOS 26. */}
      {glass && !disabled ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          tintColor={tint}
          colorScheme={scheme === 'dark' ? 'dark' : 'light'}
          style={fillStyle}
        >
          {children}
        </GlassView>
      ) : (
        <View style={[fillStyle, solidColor ? { backgroundColor: solidColor } : null]}>
          {children}
        </View>
      )}
    </PressableScale>
  );
}

/**
 * Percentage move → trigger price.
 *
 * A target is where the trade goes right and a stop is where it goes wrong, so
 * the direction depends on the side: a long's target is above the reference and
 * its stop below, and a short inverts both.
 */
export function percentToPrice(
  percent: number | null,
  reference: number | null,
  side: PhoenixTradeSide,
  leg: 'stop' | 'target',
): number | null {
  if (percent === null || reference === null || !Number.isFinite(reference)) return null;
  const favourable = leg === 'target';
  const up = side === 'long' ? favourable : !favourable;
  const moved = reference * (1 + (up ? percent : -percent) / 100);
  return moved > 0 ? Number(moved.toFixed(4)) : null;
}

/** Inverse of {@link percentToPrice}, for seeding the rulers from saved levels. */
export function priceToPercent(
  price: number | null,
  reference: number | null,
  side: PhoenixTradeSide,
  leg: 'stop' | 'target',
): number | null {
  if (price === null || reference === null || reference <= 0) return null;
  const favourable = leg === 'target';
  const up = side === 'long' ? favourable : !favourable;
  const move = ((price - reference) / reference) * 100;
  const percent = up ? move : -move;
  return percent > 0 ? Number(percent.toFixed(1)) : null;
}

/** One decimal below 10%, none above — the track now spans three decades. */
function formatPercent(value: number): string {
  return `${value > 0 ? '+' : ''}${percentMagnitude(value)}`;
}

/** Unsigned, so a caller that prints its own sign doesn't render "+ +38.6%". */
function percentMagnitude(value: number): string {
  const magnitude = Math.abs(value);
  // The track spans three decades now; a "+420.0%" reads as false precision.
  return `${magnitude.toFixed(magnitude >= 100 ? 0 : 1)}%`;
}

function formatUsd(value: number): string {
  return `$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatSignedUsd(value: number): string {
  return `${value >= 0 ? '+' : '−'}${formatUsd(value)}`;
}

function formatPriceInput(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return value.toLocaleString('en-US', {
    useGrouping: false,
    minimumFractionDigits: 0,
    // Cents on anything priced like a share; sub-dollar assets keep the
    // precision they need. Four decimals on a $92 stop read as noise.
    maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 6,
  });
}

function formatPercentInput(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return value.toFixed(1);
}

function parseNumericInput(value: string): number | null {
  const parsed = Number(value.replace(/[$,%\s]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, paddingHorizontal: PAD_H, paddingTop: 14, paddingBottom: CTA.inset },

    // Content-height: the card that hosts this hugs it, so a flex:1 root would
    // stretch into the dead white band the sheet used to end with.
    modalRoot: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: CTA.inset },
    modalTitle: {
      fontFamily: F,
      color: c.text,
      fontSize: 22,
      fontWeight: '900',
      textAlign: 'center',
    },
    modalSubtitle: {
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      textAlign: 'center',
      marginTop: 4,
      marginBottom: 14,
    },
    modalLeg: { marginTop: 8 },
    modalLegTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    modalLegLabel: { width: 88, fontFamily: F, color: c.text, fontSize: 15, fontWeight: '800' },
    modalInputs: { flex: 1, flexDirection: 'row', gap: 8 },
    modalInputShell: {
      flex: 1,
      height: 48,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: 10,
    },
    modalInput: {
      flex: 1,
      minWidth: 0,
      padding: 0,
      fontFamily: F,
      color: c.text,
      fontSize: 14,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    modalPercentInput: { textAlign: 'right' },
    modalInputSuffix: { fontFamily: F, color: c.textSecondary, fontSize: 14, fontWeight: '700', marginLeft: 2 },
    modalLegMeta: {
      minHeight: 28,
      marginLeft: 100,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    modalPotential: { flex: 1, fontFamily: F, color: c.text, fontSize: 11, fontWeight: '700' },
    modalPotentialValue: { fontFamily: F, fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
    modalClearShell: { borderRadius: 14, marginLeft: 8 },
    modalClearFill: {
      minHeight: 28,
      paddingHorizontal: 8,
      borderRadius: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    modalClearText: { fontFamily: F, color: c.textSecondary, fontSize: 11, fontWeight: '700' },
    modalSaveRow: { flexDirection: 'row', marginTop: 16 },
    modalSaveShell: { borderRadius: 25, marginTop: 16 },
    modalSaveFill: {
      height: 50,
      borderRadius: 25,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(c.actionBuy, 0.16),
    },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      // Matches the height of the sheet's own header row (a 40pt logo), so the
      // chart underneath starts at the same y in both states.
      height: 40,
    },
    headerSide: { width: 40 },
    headerSideRight: { alignItems: 'flex-end' },
    title: { flex: 1, textAlign: 'center', fontFamily: F, color: c.text, fontSize: 17, fontWeight: '800' },
    closeShell: { width: 34, height: 34, borderRadius: 17 },
    closeFill: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

    // Top-anchored: centring inside a flex:1 slot split the slack above and
    // below and pushed the chart ~140pt down from where the sheet draws it.
    // The 12 is the sheet's own 4 + 8 between header and chart.
    chartWrap: { flex: 1, justifyContent: 'flex-start', minHeight: 200, marginTop: 12 },
    chartHint: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 10.5,
      fontWeight: '600',
      textAlign: 'center',
      marginTop: 6,
    },

    row: {
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowLabelCol: { gap: 1 },
    rowRightCol: { alignItems: 'flex-end', gap: 2 },
    rowLabel: { fontFamily: F, color: c.text, fontSize: 15, fontWeight: '800' },
    rowLabelDisabled: { color: c.textTertiary },
    rowNote: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 11,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    rowPnl: {
      fontFamily: F,
      fontSize: 12,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    rowPrice: {
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    rowPill: {
      minWidth: 74,
      height: 30,
      borderRadius: 15,
    },
    rowPillFill: {
      minWidth: 74,
      height: 30,
      paddingHorizontal: 12,
      borderRadius: 15,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    rowPillText: {
      fontFamily: F,
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    // Holds the row height steady whether the ruler is mounted or not, so
    // adding a leg doesn't shove the buttons down the screen.
    rowRulerPlaceholder: { height: 30, marginTop: 2 },

    actionRow: {
      flexDirection: 'row',
      gap: ACTION_GAP,
      marginTop: 4,
      // Out to the CTA inset from the pad's tighter body padding.
      marginHorizontal: CTA.inset - PAD_H,
    },
    glassShell: { borderRadius: 999, overflow: 'hidden' },
    actionShell: { flex: 1, borderRadius: CTA.radius },
    actionFill: {
      // GlassView is native and will not auto-size to its text child.
      height: CTA.height,
      borderRadius: CTA.radius,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    actionText: { fontFamily: F_CTA, color: '#FFFFFF', fontSize: 20, letterSpacing: 0.8, fontWeight: '900' },
    // The modal layout's capsule is 50pt, not 62 — it keeps the smaller label.
    modalSaveText: { fontFamily: F_CTA, color: '#FFFFFF', fontSize: 18, letterSpacing: 0.2, fontWeight: '900' },
    disabled: { opacity: 0.4 },
  });
