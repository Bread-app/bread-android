import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useEffect,
} from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Buffer } from 'buffer';
import * as Haptics from 'expo-haptics';

import {
  CTA_BUTTON_HEIGHT,
  CTA_GLASS_SCALE,
  CTA_LABEL_FONT,
  CTA_LABEL_SIZE,
  CTA_SOLID_SCALE,
  CtaGlassFill,
} from '@/components/side-glass-button';
import { BlurBackdrop } from '@/components/blur-backdrop';
import { PredictionCandlestickChart } from '@/components/prediction-candlestick-chart';
import { CTA, ctaBottomInset } from '@/lib/screen-corners';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useToast } from '@/lib/toast-store';
import { deserializeTransaction, serializeSignedTransaction } from '@/lib/solana-tx';
import {
  createPredictionOrder,
  submitPredictionTransaction,
  fetchPredictionPositions,
  closePredictionPosition,
  type PredictionMarketSearchHit,
} from '@/lib/api';
import { useCash } from '@/hooks/use-cash';
import { TradeAmountPad, type TradeDetailRow } from './trade-amount-sheet';
import { PressableScale } from '@/components/pressable-scale';
import { maxBuyAmount } from '@/lib/max-buy';

const F = Fonts.rounded;

const YES = '#35F046';
const NO = '#EE1E52';

const YES_GRADIENT = ['#38FF60', '#00E82E'] as const;
const NO_GRADIENT = ['#FF4FB8', '#FF0090'] as const;
const SELL_GRADIENT = ['#FF4FB8', '#FF0090'] as const;

const USDC_DECIMALS = 1_000_000;

type BuyState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'success' }
  | { phase: 'error'; message: string };

export type PredictionMarketDetailSheetRef = {
  open: (hit: PredictionMarketSearchHit) => void;
  close: () => void;
};

function cents(price: number | null): string {
  return price != null ? `${Math.round(price * 100)}¢` : '—';
}

function compactUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`;
  return `$${abs.toFixed(0)}`;
}

function formatEndDate(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(t);
}

const BRAND_GREEN = '#35F046';
const BRAND_RED = '#EE1E52';
const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

type PredictionMarketDetailSheetProps = {
  onClose?: () => void;
};

export const PredictionMarketDetailSheet = forwardRef<
  PredictionMarketDetailSheetRef,
  PredictionMarketDetailSheetProps
>(function PredictionMarketDetailSheet({ onClose }, ref) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const toast = useToast();
  const solanaWallet = useEmbeddedSolanaWallet();
  const wallet = solanaWallet.wallets?.[0] ?? null;
  const walletAddress = wallet?.address ?? null;
  const cash = useCash();

  const isDark = colors.background !== '#ffffff';

  const yesGlassStyle = {
    backgroundColor: isDark ? 'rgba(53, 240, 70, 0.08)' : 'rgba(53, 240, 70, 0.04)',
    borderColor: isDark ? 'rgba(53, 240, 70, 0.3)' : 'rgba(53, 240, 70, 0.15)',
    borderWidth: 1,
  };

  const noGlassStyle = {
    backgroundColor: isDark ? 'rgba(238, 30, 82, 0.08)' : 'rgba(238, 30, 82, 0.04)',
    borderColor: isDark ? 'rgba(238, 30, 82, 0.3)' : 'rgba(238, 30, 82, 0.15)',
    borderWidth: 1,
  };

  const yesTextStyle = [
    styles.bottomBarButtonText,
    {
      color: '#ffffff',
      textShadowColor: 'rgba(53, 240, 70, 0.4)',
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 6,
    },
  ];

  const noTextStyle = [
    styles.bottomBarButtonText,
    {
      color: '#ffffff',
      textShadowColor: 'rgba(238, 30, 82, 0.4)',
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 6,
    },
  ];

  const sheetRef = useRef<BottomSheetModal>(null);
  const [hit, setHit] = useState<PredictionMarketSearchHit | null>(null);
  const isOpenRef = useRef(false);

  // YES/NO active selection side.
  const [sideToggle, setSideToggle] = useState<'YES' | 'NO'>('YES');
  const [chartMode, setChartMode] = useState<'line' | 'candle'>('line');
  const [positions, setPositions] = useState<any[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(false);

  // Trade dialpad overlay state
  const [tradeSheetOpen, setTradeSheetOpen] = useState(false);
  const [tradeSide, setTradeSide] = useState<'buy' | 'sell'>('buy');
  const [tradeAmount, setTradeAmount] = useState('10');
  const [tradeState, setTradeState] = useState<BuyState>({ phase: 'idle' });

  // Reanimated slide-up values
  const tradeSheetIndex = useSharedValue(-1);
  const tradeDragY = useSharedValue(0);

  // Latest / scrubbed close from the chart, shown in the header.
  const [scrubPrice, setScrubPrice] = useState<number | null>(null);

  const snapPoints = useMemo(() => ['92%'], []);

  const loadPositions = useCallback(async (owner: string, mId: string) => {
    setLoadingPositions(true);
    try {
      const data = await fetchPredictionPositions(owner, mId);
      if (Array.isArray(data)) {
        setPositions(data);
      } else {
        setPositions([]);
      }
    } catch (err) {
      console.warn('Failed to load prediction positions', err);
      setPositions([]);
    } finally {
      setLoadingPositions(false);
    }
  }, []);

  const resetTradeState = useCallback(() => {
    setSideToggle('YES');
    setChartMode('line');
    setPositions([]);
    setTradeSheetOpen(false);
    setTradeSide('buy');
    setTradeAmount('10');
    setTradeState({ phase: 'idle' });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      open(next: PredictionMarketSearchHit) {
        setHit(next);
        setScrubPrice(next.yesPriceUsd ?? null);
        resetTradeState();
        if (walletAddress) {
          void loadPositions(walletAddress, next.marketId);
        }
        isOpenRef.current = true;
        sheetRef.current?.present();
      },
      close() {
        if (!isOpenRef.current) return;
        sheetRef.current?.dismiss();
      },
    }),
    [resetTradeState, walletAddress, loadPositions],
  );

  useEffect(() => {
    if (walletAddress && hit) {
      void loadPositions(walletAddress, hit.marketId);
    } else {
      setPositions([]);
    }
  }, [walletAddress, hit, loadPositions]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BlurBackdrop {...props} />
    ),
    [],
  );

  const handleScrub = useCallback((close: number | null) => {
    setScrubPrice(close);
  }, []);

  /**
   * Terms for the pad's drop-up panel.
   *
   * A prediction order has no venue quote to ask — Jupiter fills these at the
   * book's posted price — so every row here is derived from prices already on
   * screen, and nothing is asserted that the app has not been told. The $5
   * floor is Jupiter's own undocumented per-order minimum, and it is the term
   * users hit most often.
   */
  const tradeDetailRows = useMemo((): TradeDetailRow[] => {
    if (!hit || tradeSide === 'sell') return [];
    const priceUsd = sideToggle === 'YES' ? hit.yesPriceUsd : hit.noPriceUsd;
    const spend = Number(tradeAmount);
    const rows: TradeDetailRow[] = [];
    if (Number.isFinite(spend) && spend > 0) {
      rows.push({ label: 'You pay', value: `$${spend.toFixed(2)}` });
    }
    if (priceUsd != null && priceUsd > 0) {
      rows.push({ label: `${sideToggle} price`, value: cents(priceUsd) });
      if (Number.isFinite(spend) && spend > 0) {
        rows.push({
          label: 'Est. contracts',
          value: (spend / priceUsd).toLocaleString('en-US', { maximumFractionDigits: 1 }),
        });
        // Each contract settles at $1 if the outcome resolves this way, so this
        // is the payout, not a projection of likelihood.
        rows.push({ label: 'If it resolves ' + sideToggle, value: `$${(spend / priceUsd).toFixed(2)}` });
      }
    }
    rows.push({ label: 'Minimum order', value: '$5.00' });
    return rows;
  }, [hit, sideToggle, tradeAmount, tradeSide]);

  const activePosition = useMemo(() => {
    return (
      positions.find(
        (pos) =>
          pos.marketId === hit?.marketId &&
          pos.side?.toUpperCase() === sideToggle &&
          Number(pos.contracts ?? pos.amount ?? 0) > 0,
      ) ?? null
    );
  }, [positions, hit, sideToggle]);

  const hasPosition = useMemo(() => {
    return activePosition !== null;
  }, [activePosition]);

  const closeTradeSheet = useCallback(() => {
    tradeSheetIndex.value = withTiming(-1, { duration: 180 }, (finished) => {
      if (finished) {
        runOnJS(setTradeSheetOpen)(false);
      }
    });
  }, [tradeSheetIndex]);

  const openTradeSheet = useCallback(
    (side: 'buy' | 'sell') => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      toast.showToast('Tradable through only sandwich', 'info');
    },
    [toast],
  );

  const handleTapDigit = useCallback(
    (digit: string) => {
      if (tradeSide === 'sell') return; // Typing is disabled for sells (full close only)

      setTradeAmount((prev) => {
        if (digit === '⌫') {
          return prev.slice(0, -1) || '0';
        }
        if (digit === '.') {
          if (prev.includes('.')) return prev;
          return prev + '.';
        }
        if (prev === '0') return digit;
        return prev + digit;
      });
    },
    [tradeSide],
  );

  const handleTapPreset = useCallback(
    (preset: string) => {
      if (preset === 'Max') {
        if (tradeSide === 'sell') {
          if (activePosition) {
            setTradeAmount(Number(activePosition.contracts ?? 0).toFixed(1));
          }
        } else {
          // Whole dollars, floored under a little headroom — `toFixed(0)`
          // rounded $5.70 up to $6, more than the wallet holds.
          setTradeAmount(String(maxBuyAmount(cash.totalCash, 0)));
        }
      } else {
        if (tradeSide === 'buy') {
          setTradeAmount(preset);
        }
      }
    },
    [tradeSide, activePosition, cash.totalCash],
  );

  const executeBuy = useCallback(async () => {
    if (!hit) return;
    if (!wallet || !walletAddress) {
      toast.showToast('Connect a wallet to trade.', 'error');
      return;
    }

    setTradeState({ phase: 'submitting' });
    const depositAmount = String(BigInt(Math.round(Number(tradeAmount) * USDC_DECIMALS)));
    const isYes = sideToggle === 'YES';

    try {
      const order = await createPredictionOrder({
        ownerPubkey: walletAddress,
        marketId: hit.marketId,
        isYes,
        isBuy: true,
        depositAmount,
      });

      const provider = await wallet.getProvider();
      const unsigned = deserializeTransaction(order.transaction);
      const signedPayload = await provider.request({
        method: 'signTransaction',
        params: { transaction: unsigned },
      });
      const signedTransaction = serializeSignedTransaction(
        signedPayload.signedTransaction,
      );

      const submission = await submitPredictionTransaction({
        signedTransaction,
        ...(order.blockhash ? { blockhash: order.blockhash } : {}),
        ...(order.lastValidBlockHeight !== null
          ? { lastValidBlockHeight: order.lastValidBlockHeight }
          : {}),
      });

      if (submission.errorMessage) {
        throw new Error(submission.errorMessage);
      }
      if (submission.status && submission.status !== 'Success') {
        throw new Error(`Prediction order ${submission.status}.`);
      }
      if (submission.code !== null && submission.code !== 0) {
        throw new Error(`Prediction error ${submission.code}.`);
      }

      // Silent on the way in — the sheet's own success phase is the receipt.
      setTradeState({ phase: 'success' });

      // Refresh positions
      void loadPositions(walletAddress, hit.marketId);
      closeTradeSheet();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Order failed to land.';
      setTradeState({ phase: 'error', message });
      toast.showToast(message, 'error');
    }
  }, [hit, sideToggle, wallet, walletAddress, tradeAmount, toast, loadPositions, closeTradeSheet]);

  const executeSell = useCallback(async () => {
    if (!hit || !wallet || !walletAddress) return;
    if (!activePosition) return;

    const positionPubkey =
      activePosition.positionPubkey ??
      activePosition.positionAddress ??
      activePosition.pubkey ??
      activePosition.address;

    if (!positionPubkey) {
      toast.showToast('No valid position pubkey to sell.', 'error');
      return;
    }

    setTradeState({ phase: 'submitting' });

    try {
      const provider = await wallet.getProvider();

      const closeOrder = await closePredictionPosition({
        positionPubkey,
        ownerPubkey: walletAddress,
      });

      const closeTx = deserializeTransaction(closeOrder.transaction);
      const signedClose = await provider.request({
        method: 'signTransaction',
        params: { transaction: closeTx },
      });
      const closeSigned = serializeSignedTransaction(
        signedClose.signedTransaction,
      );
      const closeSignedB64 = Buffer.from(closeSigned).toString('base64');

      const submission = await submitPredictionTransaction({
        signedTransaction: closeSignedB64,
        ...(closeOrder.blockhash ? { blockhash: closeOrder.blockhash } : {}),
        ...(closeOrder.lastValidBlockHeight !== null
          ? { lastValidBlockHeight: closeOrder.lastValidBlockHeight }
          : {}),
      });

      if (
        submission.errorMessage ||
        (submission.status && submission.status !== 'Success')
      ) {
        throw new Error(submission.errorMessage ?? `Transaction status: ${submission.status}`);
      }

      setTradeState({ phase: 'success' });

      // Refresh positions
      void loadPositions(walletAddress, hit.marketId);
      closeTradeSheet();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sell failed to land.';
      setTradeState({ phase: 'error', message });
      toast.showToast(message, 'error');
    }
  }, [hit, wallet, walletAddress, activePosition, toast, loadPositions, closeTradeSheet]);

  // Reanimated slide gestures
  const tradeDismissPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(12)
        .onUpdate((e) => {
          'worklet';
          tradeDragY.value = Math.max(0, e.translationY);
        })
        .onEnd((e) => {
          'worklet';
          if (e.translationY > 80 || e.velocityY > 600) {
            runOnJS(closeTradeSheet)();
          } else {
            tradeDragY.value = withTiming(0, { duration: 160 });
          }
        }),
    [closeTradeSheet, tradeDragY],
  );

  const tradeBackdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tradeSheetIndex.value, [-1, 0], [0, 1], Extrapolation.CLAMP),
  }));

  const tradeOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tradeSheetIndex.value, [-1, 0], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY:
          interpolate(tradeSheetIndex.value, [-1, 0], [72, 0], Extrapolation.CLAMP) +
          tradeDragY.value,
      },
    ],
  }));

  const outcome =
    hit && hit.question && hit.question !== hit.title ? hit.question : null;

  const currentProb =
    scrubPrice != null
      ? Math.max(0, Math.min(1, scrubPrice))
      : sideToggle === 'YES'
        ? hit?.yesPriceUsd != null
          ? Math.max(0, Math.min(1, hit.yesPriceUsd))
          : null
        : hit?.noPriceUsd != null
          ? Math.max(0, Math.min(1, hit.noPriceUsd))
          : null;

  const renderBuyButton = (shellStyle: any) => (
    <PressableScale
      onPress={() => openTradeSheet('buy')}
      scaleTo={HAS_GLASS ? CTA_GLASS_SCALE : CTA_SOLID_SCALE}
      style={[styles.bottomBarButtonShell, shellStyle]}
    >
      {HAS_GLASS ? (
        sideToggle === 'YES' ? (
          <GlassView
            glassEffectStyle="clear"
            isInteractive
            tintColor={isDark ? 'rgba(53, 240, 70, 0.25)' : BRAND_GREEN}
            colorScheme={isDark ? 'dark' : 'light'}
            style={[styles.bottomBarButtonFill, yesGlassStyle]}
          >
            <CtaGlassFill color={BRAND_GREEN} isDark={isDark} />
            <Text style={yesTextStyle}>BUY {sideToggle}</Text>
          </GlassView>
        ) : (
          <GlassView
            glassEffectStyle="clear"
            isInteractive
            tintColor={isDark ? 'rgba(238, 30, 82, 0.25)' : BRAND_RED}
            colorScheme={isDark ? 'dark' : 'light'}
            style={[styles.bottomBarButtonFill, noGlassStyle]}
          >
            <CtaGlassFill color={BRAND_RED} isDark={isDark} />
            <Text style={noTextStyle}>BUY {sideToggle}</Text>
          </GlassView>
        )
      ) : (
        <LinearGradient
          colors={sideToggle === 'YES' ? YES_GRADIENT : NO_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.bottomBarButtonFill}
        >
          <Text style={[styles.bottomBarButtonText, { color: sideToggle === 'YES' ? '#04140a' : '#ffffff' }]}>
            BUY {sideToggle}
          </Text>
        </LinearGradient>
      )}
    </PressableScale>
  );

  const renderSellButton = (shellStyle: any) => (
    <PressableScale
      onPress={() => openTradeSheet('sell')}
      scaleTo={HAS_GLASS ? CTA_GLASS_SCALE : CTA_SOLID_SCALE}
      style={[styles.bottomBarButtonShell, shellStyle]}
    >
      {HAS_GLASS ? (
        <GlassView
          glassEffectStyle="clear"
          isInteractive
          tintColor={isDark ? 'rgba(238, 30, 82, 0.25)' : BRAND_RED}
          colorScheme={isDark ? 'dark' : 'light'}
          style={[styles.bottomBarButtonFill, noGlassStyle]}
        >
          <CtaGlassFill color={BRAND_RED} isDark={isDark} />
          <Text style={noTextStyle}>SELL</Text>
        </GlassView>
      ) : (
        <LinearGradient
          colors={SELL_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.bottomBarButtonFill}
        >
          <Text style={[styles.bottomBarButtonText, { color: '#ffffff' }]}>SELL</Text>
        </LinearGradient>
      )}
    </PressableScale>
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      name="prediction-market-detail-sheet"
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      animateOnMount
      enablePanDownToClose={!tradeSheetOpen}
      backdropComponent={renderBackdrop}
      handleComponent={null}
      style={styles.sheetSurface}
      backgroundStyle={styles.sheetBackground}
      onChange={(index) => {
        isOpenRef.current = index >= 0;
      }}
      onDismiss={() => {
        isOpenRef.current = false;
        setHit(null);
        resetTradeState();
        onClose?.();
      }}
    >
      <View style={styles.sheetBody}>
        <BottomSheetScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {hit ? (
            <>
              {/* Header with Grabber and YES/NO Toggle */}
              <View style={styles.topRow}>
                <View style={styles.grabberPlaceholder} />
                <View style={styles.toggleContainer}>
                  <Pressable
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setSideToggle('YES');
                    }}
                    style={[
                      styles.toggleButton,
                      sideToggle === 'YES' ? styles.toggleButtonYesActive : null,
                    ]}
                  >
                    <Text style={[styles.toggleText, sideToggle === 'YES' ? styles.toggleTextActive : null]}>YES</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setSideToggle('NO');
                    }}
                    style={[
                      styles.toggleButton,
                      sideToggle === 'NO' ? styles.toggleButtonNoActive : null,
                    ]}
                  >
                    <Text style={[styles.toggleText, sideToggle === 'NO' ? styles.toggleTextActive : null]}>NO</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.header}>
                {hit.imageUrl ? (
                  <Image source={{ uri: hit.imageUrl }} style={styles.heroIcon} />
                ) : (
                  <View style={[styles.heroIcon, styles.heroFallback]}>
                    <Ionicons name="stats-chart" size={28} color={colors.textTertiary} />
                  </View>
                )}
                <View style={styles.headerText}>
                  <Text style={styles.title}>{hit.title}</Text>
                  {outcome ? (
                    <Text style={styles.outcomeText} numberOfLines={2}>
                      {outcome}
                    </Text>
                  ) : null}
                </View>
              </View>

              {/* Big current selection probability */}
              <View style={styles.priceBlock}>
                <Text style={styles.priceValue}>{cents(currentProb)}</Text>
                <Text style={styles.priceCaption}>{sideToggle} probability</Text>
              </View>

              {/* Polymarket CLOB candlestick / line history */}
              <PredictionCandlestickChart
                marketId={hit.marketId}
                side={sideToggle.toLowerCase() as 'yes' | 'no'}
                mode={chartMode}
                onScrub={handleScrub}
              />

              {/* Controls below chart */}
              <View style={styles.chartControlRow}>
                <View style={{ flex: 1 }} />
                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setChartMode((prev) => (prev === 'line' ? 'candle' : 'line'));
                  }}
                  style={styles.chartModeBtn}
                >
                  <Ionicons
                    name={chartMode === 'line' ? 'trending-up-outline' : 'stats-chart-outline'}
                    size={15}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.chartModeBtnText}>
                    {chartMode === 'line' ? 'Line' : 'Candle'}
                  </Text>
                </Pressable>
              </View>

              {/* Probability bar */}
              {hit.yesPriceUsd != null && hit.noPriceUsd != null ? (
                <View style={styles.probWrap}>
                  <View style={styles.probTrack}>
                    <View
                      style={[
                        styles.probFill,
                        { width: `${(hit.yesPriceUsd / (hit.yesPriceUsd + hit.noPriceUsd)) * 100}%` },
                      ]}
                    />
                  </View>
                  <View style={styles.probLabels}>
                    <Text style={[styles.probLabel, { color: YES }]}>
                      Yes {cents(hit.yesPriceUsd)}
                    </Text>
                    <Text style={[styles.probLabel, { color: NO }]}>
                      No {cents(hit.noPriceUsd)}
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* Stats list */}
              <View style={styles.statList}>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Volume</Text>
                  <View style={styles.statDots} />
                  <Text style={styles.statValue}>{compactUsd(hit.volumeUsd)}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Liquidity</Text>
                  <View style={styles.statDots} />
                  <Text style={styles.statValue}>{compactUsd(hit.liquidityUsd)}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Closes</Text>
                  <View style={styles.statDots} />
                  <Text style={styles.statValue}>{formatEndDate(hit.endDate)}</Text>
                </View>
              </View>
            </>
          ) : null}
        </BottomSheetScrollView>

        {/* Floating bottom bar panel */}
        {hit ? (
          <View style={styles.bottomPanelContainer}>
            {hasPosition ? (
              <View style={styles.bottomBarRow}>
                {renderBuyButton(styles.bottomBarHalfButtonShell)}
                {renderSellButton(styles.bottomBarHalfButtonShell)}
              </View>
            ) : (
              <View style={styles.bottomBarRow}>
                {renderBuyButton(styles.bottomBarFullButtonShell)}
              </View>
            )}
          </View>
        ) : null}

        {/* Trade keypad overlay */}
        {tradeSheetOpen && hit ? (
          <>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closeTradeSheet}
            >
              <Animated.View style={[StyleSheet.absoluteFill, styles.tradeBackdrop, tradeBackdropStyle]} />
            </Pressable>

            <GestureDetector gesture={tradeDismissPan}>
              <View style={styles.tradeSheetOverlayContainer}>
                <Animated.View style={[styles.tradeSheetOverlay, tradeOverlayStyle]}>
                  <TradeAmountPad
                    side={tradeSide}
                    detailRows={tradeDetailRows}
                    symbol={sideToggle}
                    icon={hit.imageUrl}
                    subtitleLabel={outcome ? `${outcome}` : hit.title}
                    priceLabel={cents(sideToggle === 'YES' ? hit.yesPriceUsd : hit.noPriceUsd)}
                    changeLabel={null}
                    changePositive={true}
                    presets={tradeSide === 'sell' ? ['Max'] : ['10', '25', '50', 'Max']}
                    amountUnitSymbol={tradeSide === 'sell' ? '' : '$'}
                    amountUnitLabel={tradeSide === 'sell' ? 'contracts' : 'USD'}
                    availableLabel={
                      tradeSide === 'sell'
                        ? `Available: ${activePosition ? Number(activePosition.contracts ?? 0).toFixed(1) : '0'} contracts`
                        : `Available: $${cash.totalCash.toFixed(2)}`
                    }
                    amount={tradeAmount}
                    message={tradeState.phase === 'error' ? tradeState.message : null}
                    submitting={tradeState.phase === 'submitting'}
                    canConfirm={
                      tradeSide === 'sell'
                        ? activePosition !== null
                        : Number(tradeAmount) >= 5 && Number(tradeAmount) <= cash.totalCash
                    }
                    confirmLabel={
                      tradeState.phase === 'success'
                        ? 'Done'
                        : tradeSide === 'sell'
                          ? `Sell ${sideToggle} (full close)`
                          : `Buy ${sideToggle} · $${Number(tradeAmount).toFixed(0)}`
                    }
                    onSubmit={tradeSide === 'sell' ? executeSell : executeBuy}
                    onTapDigit={handleTapDigit}
                    onTapPreset={handleTapPreset}
                    scrollEnabled={false}
                  />
                </Animated.View>
              </View>
            </GestureDetector>
          </>
        ) : null}
      </View>
    </BottomSheetModal>
  );
});

const makeStyles = (c: ThemeColors) => {
  const isDark = c.background !== '#ffffff';
  const sheetBg = isDark ? '#0c0f0d' : '#f7fcf8';
  return StyleSheet.create({
    sheetSurface: {
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      overflow: 'hidden',
    },
    sheetBackground: {
      backgroundColor: sheetBg,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      overflow: 'hidden',
    },
    sheetBody: {
      flex: 1,
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 110, // Added padding to not be obscured by the floating bottom bar
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    grabberPlaceholder: {
      width: 90,
      height: 1,
    },

    toggleContainer: {
      flexDirection: 'row',
      backgroundColor: c.surfaceAlt,
      borderRadius: 999,
      padding: 3,
      width: 90,
    },
    toggleButton: {
      flex: 1,
      paddingVertical: 5,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toggleButtonYesActive: {
      backgroundColor: YES,
    },
    toggleButtonNoActive: {
      backgroundColor: NO,
    },
    toggleText: {
      fontSize: 11,
      fontWeight: '900',
      color: c.textQuaternary,
      fontFamily: F,
    },
    toggleTextActive: {
      color: '#04140a',
    },
    header: {
      flexDirection: 'row',
      gap: 14,
      alignItems: 'flex-start',
    },
    heroIcon: {
      width: 56,
      height: 56,
      borderRadius: 16,
      backgroundColor: c.surfaceAlt,
    },
    heroFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      color: c.text,
      fontSize: 20,
      fontWeight: '800',
      fontFamily: F,
      lineHeight: 25,
    },
    outcomeText: {
      marginTop: 6,
      color: c.textSecondary,
      fontSize: 14,
      fontWeight: '700',
      fontFamily: F,
    },
    priceBlock: {
      marginTop: 20,
    },
    priceValue: {
      color: c.text,
      fontSize: 34,
      fontWeight: '800',
      fontFamily: F,
    },
    priceCaption: {
      marginTop: 2,
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: '600',
      fontFamily: F,
    },
    chartControlRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      marginTop: 12,
    },
    chartModeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
    },
    chartModeBtnText: {
      fontSize: 12,
      fontWeight: '800',
      color: c.textSecondary,
      fontFamily: F,
    },
    probWrap: {
      marginTop: 20,
      gap: 10,
    },
    probTrack: {
      height: 12,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(238, 30, 82,0.22)' : 'rgba(238, 30, 82,0.14)',
      overflow: 'hidden',
    },
    probFill: {
      height: '100%',
      borderRadius: 6,
      backgroundColor: YES,
    },
    probLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    probLabel: {
      fontSize: 14,
      fontWeight: '800',
      fontFamily: F,
    },
    statList: {
      marginTop: 28,
    },
    statRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
    },
    statLabel: {
      color: c.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      fontFamily: F,
    },
    statDots: {
      flex: 1,
      marginHorizontal: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      borderStyle: 'dashed',
      height: 1,
      alignSelf: 'flex-end',
      marginBottom: 5,
    },
    statValue: {
      color: c.text,
      fontSize: 14,
      fontWeight: '800',
      fontFamily: F,
    },
    bottomPanelContainer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: sheetBg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: 12,
      paddingBottom: ctaBottomInset(),
    },
    bottomBarRow: {
      flexDirection: 'row',
      gap: 12,
      // Matches the bar's bottom padding: the buttons' corners then nest inside
      // the display's own corner instead of crossing it.
      paddingHorizontal: CTA.inset,
    },
    bottomBarButtonShell: {
      borderRadius: CTA.radius,
      overflow: 'hidden',
    },
    bottomBarHalfButtonShell: {
      flex: 1,
    },
    bottomBarFullButtonShell: {
      width: '100%',
    },
    bottomBarButtonFill: {
      alignItems: 'center',
      justifyContent: 'center',
      height: CTA_BUTTON_HEIGHT,
    },
    bottomBarButtonText: {
      color: '#04140a',
      // Scaled to the capsule it sits in, like the other CTAs.
      fontSize: CTA_LABEL_SIZE,
      fontFamily: CTA_LABEL_FONT,
      letterSpacing: 1,
    },
    tradeBackdrop: {
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    tradeSheetOverlayContainer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'flex-end',
    },
    tradeSheetOverlay: {
      backgroundColor: sheetBg,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      overflow: 'hidden',
    },
  });
};
