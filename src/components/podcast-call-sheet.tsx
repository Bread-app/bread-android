import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, ReduceMotion } from 'react-native-reanimated';

import { AssetLogo } from '@/components/asset-logo';
import { PressableScale } from '@/components/pressable-scale';
import { SandwichPerpPanel } from '@/components/sandwich-perp-panel';
import { TradeAmountPad } from '@/components/trade-amount-sheet';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useCash } from '@/hooks/use-cash';
import { useSandwichBuy } from '@/hooks/use-sandwich-buy';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { Sandwich, SandwichLeg } from '@/lib/api';
import { withAlpha } from '@/lib/color-utils';
import { getSourceVideo } from '@/lib/sandwich-feed';
import { resolveLegVenue } from '@/lib/sandwich-leg-venue';
import type { SandwichPosition } from '@/lib/sandwich-positions';
import type { PhoenixMarket } from '@/lib/phoenix-api';
import { useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';
import { useTradeFx } from '@/lib/trade-fx';
import { useWalletStore } from '@/lib/wallet-store';
import { RotatingChevron } from '@/components/rotating-chevron';

const F = Fonts.rounded;

/** Where the sheet is: reading the call, or sizing a trade on it. */
type Stage = 'read' | 'trade';

/** The three things this sheet can do, whatever the call routed to. */
type TradeSide = 'buy' | 'long' | 'short';

/** Lines of the quote shown before it is worth offering the rest. */
const CAPTION_LINES = 3;

function formatUsd(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits,
  }).format(value);
}

function formatPnl(value: number | null): string {
  if (value === null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function legSubtitle(leg: SandwichLeg): string {
  if (leg.type === 'prediction_market') {
    return leg.side.trim().toUpperCase() === 'NO' ? 'NO' : 'YES';
  }
  return leg.label;
}

function tickerFor(leg: SandwichLeg): string {
  return (leg.underlyingSymbol ?? leg.symbol ?? leg.label).toUpperCase();
}

/**
 * A call, end to end, without leaving the episode.
 *
 * The rows used to carry their own Buy button and the card that opened beside
 * it only explained — so the thing you were reading and the thing you acted on
 * were two different surfaces, and the reasoning was never in front of you at
 * the moment you sized the trade. This is one sheet with two stages: what was
 * said and why it matters, then the pad, with the caption still overhead.
 *
 * **A call is a Sandwich, and it is bought as one.** The pad runs on the shared
 * `useSandwichBuy` engine — the same one behind the sandwich detail pad — so a
 * spot call buys every leg at its stored weight in one atomic bundle, and a perp
 * call opens a perp Sandwich position (leverage ruler, protective stop, and the
 * provenance that makes it show up in Holdings as the call it came from). It
 * used to run the single-asset spot engine on whichever leg the row led with,
 * which bought one stock and silently dropped the rest of the basket, and it
 * opened perps through the raw Phoenix order builder, which produced a bare
 * position with no tie back to the sandwich at all.
 *
 * Rendered inline by the screen rather than as a modal: nesting modals is
 * broken on this stack, and a portaled child loses every provider mounted in
 * (app)/_layout — which is exactly what execution needs (wallet, cash, toast).
 */
export function PodcastCallSheet({
  sandwich,
  initialLeg,
  markets,
  initialSide = null,
  caption,
  timestampLabel,
  onReplayMoment,
  onPositionUpdated,
  onClose,
}: {
  sandwich: Sandwich;
  /** The instrument the call leads with — where the sheet opens. */
  initialLeg: SandwichLeg;
  /**
   * Live Phoenix markets, for resolving each leg's venue. An empty list while
   * they load degrades a perp leg to "no market yet" and recovers on its own
   * when they land, because the target is derived rather than stored.
   */
  markets: readonly PhoenixMarket[];
  /**
   * The side the action that opened this sheet named. The pad opens straight on
   * it — the button already said "Long", so asking again would be re-asking an
   * answered question. The back chevron still leads to the reasoning.
   */
  initialSide?: TradeSide | null;
  /** The episode's own words at this moment — the row's grey line, in full. */
  caption: string;
  /** `mm:ss` for the moment, or null when the call carries no window. */
  timestampLabel: string | null;
  /** Replay the moment. Null when the call has no window to seek to. */
  onReplayMoment: (() => void) | null;
  /**
   * The position this call now holds, once a buy lands. The episode screen is
   * where a held call is shown and closed from, so it has to hear about the buy
   * that created the position rather than waiting for the next screen open.
   */
  onPositionUpdated?: (position: SandwichPosition | null) => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const toast = useToast();
  const tradeFx = useTradeFx();
  const cash = useCash({ autoRefresh: false });
  const walletStore = useWalletStore();

  const legs = useMemo(
    () => [...sandwich.legs].sort((a, b) => a.order - b.order),
    [sandwich.legs],
  );
  // Which instrument is being READ. A call can carry three, and the row's "+N"
  // promises they exist — this is where that promise is kept. It no longer
  // decides what gets bought: the buy is the whole basket either way.
  const [legId, setLegId] = useState(initialLeg.id);
  const leg = legs.find((candidate) => candidate.id === legId) ?? initialLeg;

  // Venue is a property of the SANDWICH, not of a leg: a basket is homogeneous
  // by construction (see lib/server/basket/venue.ts), and a perp Sandwich holds
  // exactly one leg. Resolving per leg would let the sheet offer a spot Buy on a
  // basket the engine is going to open on Phoenix.
  const target = useMemo(
    () => resolveLegVenue({ leg: legs[0] ?? leg, sandwichVenue: sandwich.venue, markets }),
    [leg, legs, markets, sandwich.venue],
  );
  const isPerp = sandwich.venue === 'perp';
  const ticker = tickerFor(leg);

  const [stage, setStage] = useState<Stage>(initialSide ? 'trade' : 'read');
  // The caption runs to 300 characters. Clamped, it stays a quote you can take
  // in at a glance; expanded, it is the whole thing. `captionOverflows` is set
  // from the first unclamped layout pass, so the control only appears when
  // there is actually something more to show.
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [captionOverflows, setCaptionOverflows] = useState(false);

  // The direction the call was recorded with. Read off the leg, never inferred
  // from the sandwich: `resolveLegVenue`'s `side` is fixed at 'long' on the
  // spot branch, where it means nothing (see sandwich-leg-venue).
  const callSide = (legs[0] ?? leg).side.trim().toLowerCase() === 'short' ? 'short' : 'long';
  // What the pad will actually do. A perp Sandwich opens the side the speaker
  // took — `startPerpSandwichBuy` derives direction from the stored legs and
  // takes no side argument, so offering the opposite here would be a button
  // that cannot be honoured.
  const side: TradeSide = isPerp ? callSide : 'buy';
  const accent = side === 'short' ? colors.actionSell : colors.actionBuy;

  // Spot legs the bundle can actually execute. Prediction legs and legacy legs
  // with no mint have no swap behind them; a call with none of them gets the
  // notice rather than a dead button.
  const executableSpotLegs = legs.filter(
    (candidate) => candidate.type === 'tokenized_stock' && Boolean(candidate.mint),
  ).length;
  const tradable = isPerp ? target.venue === 'perp' && target.market !== null : executableSpotLegs > 0;

  // ------------------------------------------------------------- execution ---
  // The app's own Sandwich engine, so a buy from a call settles exactly as a buy
  // from the sandwich detail pad does — same bundle, same guards, same
  // bookkeeping. Everything specific to a call rides in `thesisContent`.
  const buy = useSandwichBuy({
    sandwich,
    onClose,
    onToast: useCallback(
      (next: { text: string; tone: 'processing' | 'success' | 'error' }, duration?: number) => {
        toast.showToast(next.text, next.tone, duration);
      },
      [toast],
    ),
    onCelebrate: tradeFx.playSandwich,
    cash,
    walletStore,
    onPositionUpdated,
  });

  const openPad = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStage('trade');
  }, []);

  const tapDigit = useCallback(
    (key: string) => {
      void Haptics.selectionAsync();
      buy.tapKey(key);
    },
    [buy],
  );

  // Switching the instrument being read drops back to the reasoning for it. The
  // amount is NOT reset any more: every leg of a spot call is bought by the same
  // amount, so there is nothing leg-specific left in the pad to invalidate.
  const previousLegId = useRef(legId);
  useEffect(() => {
    if (previousLegId.current === legId) return;
    previousLegId.current = legId;
    setStage('read');
    setCaptionExpanded(false);
  }, [legId]);

  // The reasoning, generated at creation time. Pre-feature legs carry nulls, so
  // the terse match summary is the fallback rather than an empty block.
  const mechanism = leg.legMechanism ?? leg.matchSummary ?? leg.reason;
  const weightPct = Math.round(Math.max(0, leg.weightBps) / 100);
  const isBasket = legs.length > 1;
  // The verb the pad's slider states. A perp opens a Long or a Short; "Buy" is
  // the spot word and would read as backwards on a short.
  const sideLabel = side === 'buy' ? 'Buy' : side === 'long' ? 'Long' : 'Short';

  return (
    <Animated.View
      layout={LinearTransition.springify().damping(26).stiffness(240)}
      style={[styles.sheet, stage === 'trade' && styles.sheetFill]}
    >
      <View style={styles.handle} />

      {stage === 'read' ? (
        <Animated.View
          entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(90).reduceMotion(ReduceMotion.System)}
          style={styles.readStage}
        >
          <View style={styles.header}>
            <AssetLogo
              uri={leg.imageUrl}
              size={44}
              borderRadius={leg.type === 'prediction_market' ? 10 : 22}
              fallback={
                <View style={styles.logoFallback}>
                  <Text style={styles.logoFallbackText}>{ticker.slice(0, 1)}</Text>
                </View>
              }
            />
            <View style={styles.headerCopy}>
              <View style={styles.headerTitleRow}>
                <Text numberOfLines={1} style={styles.title}>
                  {ticker}
                </Text>
                {/* A prediction leg's direction is YES/NO, which the subtitle
                    already says — LONG over it would be a second, wrong answer. */}
                {leg.type === 'prediction_market' ? null : (
                  <Text
                    style={[
                      styles.headerSide,
                      { color: callSide === 'short' ? colors.negative : colors.positive },
                    ]}
                  >
                    {callSide === 'short' ? 'SHORT' : 'LONG'}
                  </Text>
                )}
              </View>
              <Text numberOfLines={1} style={styles.subtitle}>
                {legSubtitle(leg)}
              </Text>
            </View>
            <View style={styles.headerMetrics}>
              <Text
                style={[
                  styles.pnl,
                  {
                    color:
                      leg.pnlPct === null || leg.pnlPct === 0
                        ? colors.text
                        : leg.pnlPct > 0
                          ? colors.positive
                          : colors.negative,
                  },
                ]}
              >
                {formatPnl(leg.pnlPct)}
              </Text>
              {/* Only a basket has a weight worth stating — "100%" on a
                  single-asset call is noise dressed as a fact. */}
              {isBasket ? (
                <View style={styles.weightPill}>
                  <Text style={styles.weightText}>{weightPct}%</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Every instrument the call resolved to. One asset means one thing
              to look at and no picker; a basket gets a row, because the "+N"
              on the row promised these exist. */}
          {legs.length > 1 ? (
            <ScrollView
              contentContainerStyle={styles.legChips}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {legs.map((candidate) => {
                const active = candidate.id === leg.id;
                return (
                  <PressableScale
                    key={candidate.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${tickerFor(candidate)}`}
                    accessibilityState={{ selected: active }}
                    onPress={() => setLegId(candidate.id)}
                    style={[styles.legChip, active && styles.legChipActive]}
                  >
                    <AssetLogo
                      uri={candidate.imageUrl}
                      size={16}
                      fallback={
                        <View style={styles.legChipLogoFallback}>
                          <Text style={styles.legChipLogoFallbackText}>
                            {tickerFor(candidate).slice(0, 1)}
                          </Text>
                        </View>
                      }
                    />
                    <Text style={[styles.legChipText, active && styles.legChipTextActive]}>
                      {tickerFor(candidate)}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          ) : null}

          {/* What was actually said, and the way back to hearing it. The whole
              block is the play target: the words ARE the timestamp. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={
              timestampLabel ? `Play this call from ${timestampLabel}` : 'Play this call'
            }
            disabled={!onReplayMoment}
            onPress={() => onReplayMoment?.()}
            style={styles.captionBlock}
          >
            {timestampLabel ? (
              <View style={styles.captionMeta}>
                <Ionicons name="play" size={11} color={colors.accentBlue} />
                <Text style={styles.captionTimestamp}>{timestampLabel}</Text>
              </View>
            ) : null}
            <Text
              numberOfLines={captionExpanded ? undefined : CAPTION_LINES}
              onTextLayout={(event) => {
                // Only meaningful while unclamped — a clamped Text reports the
                // capped count, which would clear the flag on the first
                // collapse and take the control away with it.
                if (captionExpanded) return;
                setCaptionOverflows(event.nativeEvent.lines.length > CAPTION_LINES);
              }}
              style={styles.captionText}
            >
              {caption}
            </Text>
            {captionOverflows ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={captionExpanded ? 'Show less of the quote' : 'Show the full quote'}
                hitSlop={8}
                onPress={() => setCaptionExpanded((current) => !current)}
                style={styles.captionMore}
              >
                <Text style={styles.captionMoreText}>
                  {captionExpanded ? 'Show less' : 'Show more'}
                </Text>
                <RotatingChevron up={captionExpanded} size={12} color={colors.accentBlue} />
              </PressableScale>
            ) : null}
          </PressableScale>

          <ScrollView
            contentContainerStyle={styles.reasoningContent}
            showsVerticalScrollIndicator={false}
            style={styles.reasoning}
          >
            {leg.legRole ? <Text style={styles.role}>{leg.legRole.toUpperCase()}</Text> : null}
            <Text style={styles.mechanism}>{mechanism}</Text>
          </ScrollView>

          {/* One action, because there is one thing to buy: the call. A basket
              says so on the button rather than leaving the lone ticker beside it
              to imply the buy is that leg alone — which is exactly what it used
              to be. */}
          {tradable ? (
            <View style={styles.sideRow}>
              <SideButton
                // A perp is one instrument, so it can be named. A spot basket
                // is not: the faces say what is being bought, and they say it
                // better than "all 3" does.
                label={isPerp ? `${sideLabel} ${ticker}` : 'Buy'}
                faces={isPerp ? [] : legs}
                color={accent}
                lead
                onPress={openPad}
              />
            </View>
          ) : (
            <View style={styles.unavailable}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.unavailableText}>
                {isPerp
                  ? `No perp market for ${ticker} yet — this call can’t be traded here.`
                  : `${ticker} isn’t tradeable from a call yet.`}
              </Text>
            </View>
          )}
        </Animated.View>
      ) : (
        <Animated.View
          entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(90).reduceMotion(ReduceMotion.System)}
          style={styles.tradeStage}
        >
          {/* The app's own pad, not a second one built beside it: a buy from a
              call should look and behave exactly like a buy from anywhere else
              — same amount type, same keypad, same terms panel, same slide to
              confirm. */}
          <TradeAmountPad
            side="buy"
            // Perp calls need an explicit direction in the header; spot calls
            // remain compact because their caption names the basket below.
            title={isPerp ? `${sideLabel} Perps` : ""}
            actionLabel={buy.availabilityPending ? 'Checking' : sideLabel}
            accentColor={accent}
            symbol=""
            // What the amount actually buys. The pad no longer executes one
            // instrument, so this states the basket rather than picking a leg
            // out of it.
            subtitleLabel={
              isBasket ? `${legs.length} assets in this call` : null
            }
            icon={null}
            amount={buy.buyAmount}
            amountNote={buy.predictionNote}
            message={buy.sheetMessage}
            submitting={buy.buying}
            canConfirm={buy.canBuy}
            confirmLabel={
              buy.belowMin && buy.minBuyDisplay !== null
                ? `Minimum $${buy.minBuyDisplay}`
                : undefined
            }
            availableLabel={`Cash balance: ${formatUsd(cash.totalCash)}`}
            detailRows={buy.detailRows}
            noticeText={buy.tradeNotice}
            noticeCollapsible
            noticeLabel="Check this trade"
            presets={[]}
            scrollEnabled={false}
            slideToConfirm
            submittingLabel={isPerp ? 'Opening...' : 'Buying...'}
            onSubmit={buy.buySandwich}
            onSubmitPressIn={buy.warmBuy}
            onTapDigit={tapDigit}
            onTapPreset={buy.tapPreset}
            thesisContent={
              <View style={styles.padContext}>
                <PodcastCallCaption
                  caption={caption}
                  timestampLabel={timestampLabel}
                  avatarUrl={getSourceVideo(sandwich)?.channelAvatarUrl ?? null}
                  lines={isPerp ? 1 : 2}
                />

                {/* Leverage, the size it implies, and what the entry debits —
                    the same panel the sandwich detail pad shows, so a leveraged
                    call is sized against the identical numbers wherever it is
                    opened from. */}
                {isPerp ? (
                  <SandwichPerpPanel
                    side={buy.perpSide}
                    risk={buy.perpRisk}
                    leverage={buy.leverage}
                    onChangeLeverage={buy.changeLeverage}
                  />
                ) : null}
              </View>
            }
          />
        </Animated.View>
      )}
    </Animated.View>
  );
}

/**
 * The call's own words, over a trade pad.
 *
 * The context a trade on this screen is sized against: the moment it was made
 * and what was said there. Shared by the buy pad and the close pad, so both
 * sides of a call are read the same way — and so the close pad does not fall
 * back to the generic thesis card, which re-renders the episode's YouTube
 * embed inches below the player already showing it.
 */
export function PodcastCallCaption({
  caption,
  timestampLabel,
  avatarUrl = null,
  lines = 2,
}: {
  caption: string;
  /** `mm:ss` for the moment, or null when the call carries no window. */
  timestampLabel: string | null;
  /** The channel's picture — who said it — leading the quote. */
  avatarUrl?: string | null;
  /**
   * One line on a perp: the risk panel under it holds the leverage ruler, which
   * is an input and has to stay reachable, and the slot they share does not
   * scroll — a second line pushed it out of view rather than making the pad
   * taller.
   */
  lines?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const quote = (
    <Text numberOfLines={lines} style={[styles.padCaption, avatarUrl ? styles.padCaptionLed : null]}>
      {timestampLabel ? <Text style={styles.padCaptionStamp}>{timestampLabel} </Text> : null}
      {`“${caption}”`}
    </Text>
  );
  if (!avatarUrl) return quote;
  return (
    <View style={styles.padCaptionRow}>
      <Image source={{ uri: avatarUrl }} style={styles.padCaptionAvatar} accessible={false} />
      {quote}
    </View>
  );
}

/**
 * The call's action. Filled, always: there is one side to take now — the one the
 * speaker took — because a perp Sandwich opens the direction its legs were
 * stored with and a spot basket is only ever a buy.
 *
 * A basket carries its assets' faces beside the verb rather than a count of
 * them. It is the same shape the screen's pinned action bar uses, and it is what
 * a Sandwich looks like everywhere else in the app: the thing being bought,
 * shown, not described.
 */
function SideButton({
  label,
  faces = [],
  color,
  lead,
  onPress,
}: {
  label: string;
  /** Assets to show after the verb. Trimmed to three — past that they stop
   *  reading as distinct logos and start reading as a smear. */
  faces?: SandwichLeg[];
  color: string;
  lead: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const shown = faces.slice(0, 3);
  return (
    <PressableScale
      accessibilityRole="button"
      // The faces are decoration to a screen reader, so the label has to carry
      // what they show: "Buy" alone would not say what is being bought.
      accessibilityLabel={
        shown.length > 1
          ? `${label} ${shown.map(tickerFor).join(', ')}`
          : shown.length === 1
            ? `${label} ${tickerFor(shown[0])}`
            : label
      }
      onPress={onPress}
      scaleTo={0.97}
      style={[
        styles.sideButton,
        lead ? { backgroundColor: color } : { borderWidth: 1.5, borderColor: withAlpha(color, 0.5) },
      ]}
    >
      <View style={styles.sideButtonRow}>
        <Text style={[styles.sideButtonText, !lead && { color }]}>{label}</Text>
        {shown.length > 0 ? (
          <View style={styles.sideButtonFaces}>
            {shown.map((face, index) => (
              <View
                key={face.id}
                style={[
                  styles.sideButtonFace,
                  // Ringed in the button's own fill so overlapping faces stay
                  // separable against a saturated tint.
                  { borderColor: lead ? '#FFFFFF' : withAlpha(color, 0.5) },
                  index > 0 && styles.sideButtonFaceOverlap,
                ]}
              >
                <AssetLogo
                  uri={face.imageUrl}
                  size={26}
                  borderRadius={face.type === 'prediction_market' ? 7 : 13}
                  fallback={
                    <View style={styles.sideButtonFaceFallback}>
                      <Text style={styles.sideButtonFaceFallbackText}>
                        {tickerFor(face).slice(0, 1)}
                      </Text>
                    </View>
                  }
                />
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    sheet: { paddingHorizontal: 18, paddingTop: 8, gap: 14 },
    sheetFill: { flex: 1 },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 5,
      borderRadius: 999,
      backgroundColor: c.border,
    },

    // Read stage
    readStage: { gap: 14 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    logoFallback: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    logoFallbackText: { fontFamily: F, fontWeight: '800', fontSize: 17, color: c.textSecondary },
    headerCopy: { flex: 1, minWidth: 0, gap: 2 },
    headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    title: { fontFamily: F, fontSize: 20, fontWeight: '800', color: c.text, flexShrink: 1 },
    headerSide: { fontFamily: Fonts.displayOne, fontSize: 12, letterSpacing: 0.3 },
    subtitle: { fontFamily: F, fontSize: 13, fontWeight: '600', color: c.textSecondary },
    headerMetrics: { alignItems: 'flex-end', gap: 5 },
    pnl: { fontFamily: Fonts.displayMedium, fontSize: 16, fontWeight: '800' },
    weightPill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    weightText: { fontFamily: F, fontSize: 12, fontWeight: '700', color: c.textSecondary },

    // The words, set apart from the generated prose under them — a quote is
    // evidence, and it should not read as more of the app's own writing.
    captionBlock: {
      gap: 5,
      paddingHorizontal: 13,
      paddingVertical: 11,
      borderRadius: 14,
      backgroundColor: c.backgroundAlt,
      borderLeftWidth: 3,
      borderLeftColor: c.accentBlue,
    },
    captionMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    captionTimestamp: {
      fontFamily: Fonts.displayOne,
      fontSize: 12,
      letterSpacing: 0.2,
      color: c.accentBlue,
    },
    captionText: { fontFamily: Fonts.poppins, fontSize: 14, lineHeight: 21, color: c.text },
    captionMore: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingTop: 2 },
    captionMoreText: { fontFamily: F, fontSize: 12, fontWeight: '800', color: c.accentBlue },

    // Capped so a long argument scrolls inside the sheet rather than pushing
    // the sides off the bottom of it.
    reasoning: { maxHeight: 168 },
    reasoningContent: { gap: 6 },
    role: {
      fontFamily: F,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1.1,
      color: c.textSecondary,
    },
    mechanism: { fontFamily: Fonts.poppins, fontSize: 15, lineHeight: 22, color: c.text },

    legChips: { gap: 6, paddingRight: 4 },
    legChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingLeft: 6,
      paddingRight: 11,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.backgroundAlt,
    },
    legChipActive: { borderColor: c.accentBlue, backgroundColor: c.surfaceSelected },
    legChipLogoFallback: {
      width: 16,
      height: 16,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    legChipLogoFallbackText: { fontFamily: F, fontSize: 8, fontWeight: '800', color: c.textSecondary },
    legChipText: { fontFamily: F, fontSize: 12, fontWeight: '800', color: c.textSecondary },
    legChipTextActive: { color: c.text },

    sideRow: { flexDirection: 'row', gap: 10 },
    sideButton: {
      flex: 1,
      minHeight: 52,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
    },
    sideButtonText: { fontFamily: F, fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
    sideButtonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sideButtonFaces: { flexDirection: 'row', alignItems: 'center' },
    sideButtonFaceOverlap: { marginLeft: -7 },
    sideButtonFace: { borderWidth: 2, borderRadius: 15 },
    sideButtonFaceFallback: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.24)',
    },
    sideButtonFaceFallbackText: {
      fontFamily: F,
      fontSize: 11,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    unavailable: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 14,
      backgroundColor: c.surfaceAlt,
    },
    unavailableText: {
      flex: 1,
      fontFamily: F,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      color: c.textSecondary,
    },

    // Trade stage
    tradeStage: { flex: 1 },
    // What the pad shows above its keypad: the words the call was made in, and
    // the leverage it will open at.
    padContext: { alignSelf: 'stretch', gap: 8, paddingHorizontal: 16, paddingTop: 4 },
    padCaption: {
      fontFamily: Fonts.poppins,
      fontSize: 15,
      lineHeight: 22,
      color: c.text,
      textAlign: 'center',
    },
    // With the speaker's face leading, the quote reads as a line of dialogue:
    // left-aligned beside the avatar rather than centred under nothing.
    // The pad centres this slot's children instead of stretching them, so
    // nothing here can rely on a parent's width: the text keeps its natural
    // width and only *shrinks* to fit, which is what wraps it beside the
    // avatar. (A flex:1 text in a content-sized row measured as zero wide.)
    padCaptionRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    padCaptionLed: { flexShrink: 1, textAlign: 'left' },
    padCaptionAvatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.surfaceAlt,
      // Sits on the first line's x-height rather than the line box's top.
      marginTop: 2,
    },
    // The moment, in the accent it carries everywhere else on this screen.
    padCaptionStamp: {
      fontFamily: Fonts.displayOne,
      color: c.accentBlue,
    },
  });
