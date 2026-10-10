import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "react-native";

import type { UseCashValue } from "@/hooks/use-cash";
import { usePerpSandwichRisk } from "@/hooks/use-perp-sandwich-risk";
import { useBasketQuotePreview } from "@/hooks/use-trade-quote-preview";
import {
  buildSandwichBuyPlan,
  createAtomicBuyTransaction,
  createJupiterOrder,
  createPredictionOrder,
  describeTradeUnavailable,
  executeJupiterOrder,
  getMarkPricesForMints,
  getMintDecimals,
  humanizeErrorMessage,
  minSandwichBuyUsdcNative,
  preflightTradeLegs,
  settlePerpSandwichRun,
  startPerpSandwichBuy,
  startSandwichBasketBuy,
  submitPredictionTransaction,
  submitSignedBasketBuy,
  type BasketBuyStart,
  type BasketSlippage,
  type LegSlippage,
  type Sandwich,
} from "@/lib/api";
import { basketQuotedValueUsd } from "@/lib/basket-quote-value";
import { DemoInsufficientCashError, demoBuySpot, demoOpenPerp } from "@/lib/demo-account";
import { DEMO_BUY_DELAY_MS, useDemoBuyMode } from "@/lib/demo-buy-mode";
import { signAndSendBase64, signAndSendBase64WithResult } from "@/lib/cash";
import {
  entryQuoteAfterRegistration,
  freshPerpQuote,
  type TimedPerpQuote,
} from "@/lib/perp-sandwich-open";
import { momentReceiptLine } from "@/lib/moment";
import { MAX_MARGIN_USD, MIN_MARGIN_USD, MIN_STOP_LOSS_PCT } from "@/lib/phoenix-risk";
import {
  getStoredSandwichPositions,
  recordSandwichBuy,
  type ExecutedSandwichLeg,
  type SandwichPosition,
} from "@/lib/sandwich-positions";
import type { SandwichFxEvent } from "@/lib/trade-fx";
import {
  SOLANA_USDC_MINT,
  isPositiveSmallestUnitAmount,
  isValidDisplayAmount,
  toSmallestUnits,
} from "@/lib/trading";
import type { useWalletStore } from "@/lib/wallet-store";
import type { TradeDetailRow } from "@/components/trade-amount-sheet";

/** Opening leverage on a perp Sandwich — clamped down if the market allows less. */
const DEFAULT_PERP_LEVERAGE = 2;
/**
 * Stop distance placed with every perp Sandwich entry. Not exposed on the pad —
 * the backend refuses an order without a stop, but its legal ceiling collapses
 * as leverage rises, so it's held here and clamped under that ceiling rather
 * than handed to the user mid-keypad. The single-market Phoenix pad still lets
 * a stop be tuned directly.
 */
const DEFAULT_PERP_STOP_PCT = 10;
/**
 * Idle time before the pad warms a perp quote in the background. One 3-leg quote
 * is ~9 Phoenix calls behind a process-wide ~4.5 req/s pacer plus a build and an
 * on-chain simulate, so quoting more eagerly only queues quotes behind each other.
 */
const PERP_QUOTE_DEBOUNCE_MS = 700;
/**
 * Quiet time after the last amount change before a spot Sandwich is pre-built.
 *
 * Deliberately NOT sequenced after the live preview any more. Chained, it was
 * debounce (650ms) → preview quotes (~0.7-1.5s) → 500ms settle → build
 * (~0.5-1.8s): 2.3-4.5s after the last keystroke, and people tap sooner — only
 * 2 of 30 live buys (2026-09-26) ever used a pre-build. Just under the
 * preview's own debounce, so the build reaches the shared Jupiter bucket first
 * (the server refuses a speculative build as `busy` once the pacer queues).
 */
const SPOT_PREBUILD_SETTLE_MS = 600;
/**
 * How long a pre-built spot Sandwich may wait for its tap. Matches the single
 * stock pre-build: well inside the blockhash window, and short enough that the
 * quoted terms are still the terms. Past it the tap builds fresh — there is
 * deliberately NO background refresh, because an idle pad re-quoting every
 * leg every 20s is exactly the traffic the shared Jupiter bucket cannot pay for.
 */
const SPOT_PREBUILD_TTL_MS = 20_000;

type PerpQuote = Extract<BasketBuyStart, { status: "needs_signature" }>;

/**
 * Identity of the inputs a perp quote was built for. A quote whose key no longer
 * matches the pad is not the order on screen and must never be signed.
 */
function perpQuoteKey(marginUsd: number, leverage: number, stopLossPct: number): string {
  return `${marginUsd}|${leverage}|${stopLossPct}`;
}

function getErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "Something went wrong.";
  return humanizeErrorMessage(raw);
}

function deserializeJupiterTransaction(
  base64Transaction: string,
): Transaction | VersionedTransaction {
  const bytes = Buffer.from(base64Transaction, "base64");
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

function serializeSignedTransaction(
  signedTransaction: Transaction | VersionedTransaction,
): Uint8Array {
  return signedTransaction instanceof VersionedTransaction
    ? signedTransaction.serialize()
    : new Uint8Array(signedTransaction.serialize({ requireAllSignatures: false }));
}

/** What a toast host needs to raise one; matches the sandwich screen's shape. */
export type SandwichBuyToast = { text: string; tone: "processing" | "success" | "error" };

export type UseSandwichBuyOptions = {
  sandwich: Sandwich | null;
  /** Tear the surface down once the trade is a receipt rather than a form. */
  onClose: () => void;
  onToast: (toast: SandwichBuyToast, duration?: number) => void;
  onCelebrate?: (event: SandwichFxEvent) => void;
  /**
   * Cash + wallet store are passed IN rather than read here: this hook runs
   * inside surfaces that are portalled above `WalletStoreProvider`, where the
   * hooks read back an empty store. See [[bottom-sheet-context-loss]].
   */
  cash: UseCashValue;
  walletStore: ReturnType<typeof useWalletStore>;
  onRequestAddCash?: () => void;
  onPositionUpdated?: (position: SandwichPosition | null) => void;
  /**
   * An amount the pad opens already holding — Copy trade on a take, pre-filled
   * from the taker's size band. Read once, at mount: the reader's own typing
   * must never be overwritten by a prop that happens to re-render.
   */
  initialAmount?: string | null;
};

/**
 * The Sandwich buy engine: one basket, one entry, whatever venue it routes to.
 *
 * Everything about *executing* a Sandwich lives here — amount + keypad, the
 * balance and minimum gates, live venue terms, the perp risk readout with its
 * leverage and stop, and the buy itself (atomic bundle first, per-leg fallback
 * for the baskets that cannot bundle; a Phoenix entry when the sandwich routes
 * to perps). Only the chrome around it belongs to the caller.
 *
 * It is a hook rather than a component because two very different surfaces need
 * the identical behaviour: the sandwich detail pad, and the podcast call sheet,
 * where a call IS a sandwich and buying one used to buy a single leg as if it
 * were a lone stock.
 */
export function useSandwichBuy({
  sandwich,
  onClose,
  onToast,
  onCelebrate,
  cash,
  walletStore,
  onRequestAddCash,
  onPositionUpdated,
  initialAmount,
}: UseSandwichBuyOptions) {
  // Inline pad — no modal ref needed.
  const solanaWallet = useEmbeddedSolanaWallet();
  // Empty, not a pre-filled figure: the pad renders "0" at a quarter opacity
  // when nothing is typed, which reads as a prompt rather than as an amount the
  // user has already chosen and merely has to confirm. The one exception is a
  // Copy trade, where the amount IS the thing being copied.
  const [buyAmount, setBuyAmount] = useState(() => initialAmount ?? "");
  const [buying, setBuying] = useState(false);
  const [buyMessage, setBuyMessage] = useState<string | null>(null);
  // Settings → Demo buys: the pad runs as usual, but nothing is built or signed.
  const [demoBuys] = useDemoBuyMode();
  /**
   * Build started on touch-down, so the tap itself is only the wallet prompt.
   *
   * The build is the slow half of a spot buy — eight legs fanned out to Jupiter
   * plus a simulation — and it does not need the finger to have lifted. Keyed by
   * amount because a quote is only valid for the amount it was built at, so any
   * keypad change discards it.
   */
  const warmedBuyRef = useRef<{
    amount: string;
    /** When the build was requested — a conservative age for its quote. */
    at: number;
    /**
     * Resolves to null when a SPECULATIVE pre-build did not produce a signable
     * run (declined as `busy`, or refused). The tap then builds fresh, so the
     * authoritative answer always comes from a build made at the tap.
     */
    started: Promise<Awaited<ReturnType<typeof startSandwichBasketBuy>> | null>;
  } | null>(null);
  /**
   * One speculative pre-build per amount. Cleared by a buy attempt and re-armed
   * only when the amount changes, so finishing a buy never kicks off another
   * build of the same basket that nobody is going to sign.
   */
  const prebuildArmedRef = useRef(true);
  const [leverage, setLeverage] = useState(DEFAULT_PERP_LEVERAGE);
  const [stopLossPct, setStopLossPct] = useState(DEFAULT_PERP_STOP_PCT);
  const isPerp = sandwich?.venue === "perp";
  const perpSide: "long" | "short" = sandwich?.legs[0]?.side === "long" ? "long" : "short";
  const wallet = solanaWallet.wallets?.[0] ?? null;
  const walletAddress = wallet?.address ?? null;
  const buyAmountSmallest = useMemo(
    () => toSmallestUnits(buyAmount, 6),
    [buyAmount],
  );
  // A sandwich buy spends USDC, so block it when the amount exceeds total cash
  // (liquid USDC). Skipped while cash is still loading so it doesn't flash
  // "insufficient" before the balance resolves.
  //
  // Spot spends the typed amount, but a perp entry does not: it deposits
  // `margin + fees` and spends Phoenix collateral first, so the wallet debit is
  // `perpRisk.cashMovedUsd`. Comparing the raw margin instead let a $100.00
  // balance pass a $100.34 requirement and fail with `phoenix_insufficient_cash`
  // after the tap — and refused entries the user's posted collateral covered.
  const numericBuyAmount = Number(buyAmount);
  // Live liquidation/stop numbers computed the way the backend computes them, so
  // the pad shows the real risk of the entry before the server quote lands. It
  // sits above the balance check because that check gates on its `cashMovedUsd`.
  const perpRisk = usePerpSandwichRisk({
    sandwich,
    marginUsd: numericBuyAmount,
    leverage,
    enabled: isPerp,
  });
  const spendUsd = isPerp ? perpRisk.cashMovedUsd : numericBuyAmount;
  // In demo mode `cash` is the paper account's, so this gate still applies.
  const insufficientBalance =
    !cash.loading &&
    Number.isFinite(numericBuyAmount) &&
    numericBuyAmount > 0 &&
    Number.isFinite(spendUsd) &&
    spendUsd > cash.totalCash + Math.max(cash.totalCash * 1e-6, 1e-6);
  // Demo cash can't be topped up; the account is reset from Settings instead.
  const needsCash = insufficientBalance && !!onRequestAddCash && !demoBuys;
  const buyPlan = useMemo(
    () =>
      sandwich && sandwich.venue === "spot" && buyAmountSmallest
        ? buildSandwichBuyPlan(sandwich, buyAmountSmallest)
        : null,
    [buyAmountSmallest, sandwich],
  );
  const executableCount = isPerp ? sandwich?.legs.length ?? 0 : buyPlan?.executableLegs.length ?? 0;
  const skippedCount = buyPlan?.skippedLegs.length ?? 0;
  // Venue-aware total minimum: prediction legs need $5, normal spot legs keep a
  // small dust floor, and Ondo/RFQ legs need $3 because ~$1 maker requests often
  // return no route. At or above the total, buildSandwichBuyPlan rebalances the
  // other legs so every slice reaches its own floor before quoting.
  const minBuyNative = useMemo(
    () => (sandwich?.venue === "spot" ? minSandwichBuyUsdcNative(sandwich) : null),
    [sandwich],
  );
  const minBuyUsd =
    minBuyNative !== null ? Math.ceil(Number(minBuyNative) / 10_000) / 100 : null;
  const minBuyDisplay =
    minBuyUsd !== null
      ? minBuyUsd % 1 === 0
        ? String(minBuyUsd)
        : minBuyUsd.toFixed(2)
      : null;
  // A demo buy reaches no venue, so no venue minimum applies to it.
  const belowMin =
    !demoBuys &&
    minBuyNative !== null &&
    !!buyAmountSmallest &&
    isPositiveSmallestUnitAmount(buyAmountSmallest) &&
    BigInt(buyAmountSmallest) < minBuyNative;
  // Phoenix bounds the margin on a perp entry. Gate the button on it so the
  // floor reads as a disabled Open rather than a 422 after the tap.
  const outsidePerpMarginBounds =
    !demoBuys &&
    isPerp &&
    Number.isFinite(numericBuyAmount) &&
    numericBuyAmount > 0 &&
    (numericBuyAmount < MIN_MARGIN_USD || numericBuyAmount > MAX_MARGIN_USD);
  const buyInputsValid =
    !!sandwich &&
    !!walletAddress &&
    !!wallet &&
    isValidDisplayAmount(buyAmount) &&
    isPositiveSmallestUnitAmount(buyAmountSmallest) &&
    // Prediction legs under their $5 floor drop out of the plan, but a demo buy
    // never executes the plan, so any basket with legs is buyable.
    (executableCount > 0 || (demoBuys && (sandwich?.legs.length ?? 0) > 0)) &&
    !insufficientBalance &&
    !belowMin &&
    !outsidePerpMarginBounds &&
    !buying;

  // Actual USDC that lands in prediction legs for the current buy (summed from
  // the real plan, so it always matches what executes), and whether that slice
  // was raised to Jupiter's $5 floor — i.e. the prediction leg is holding more
  // than its weight because its natural share was under $5.
  let predictionBuyNative = 0n;
  for (const leg of buyPlan?.executableLegs ?? []) {
    if (leg.kind === "prediction") predictionBuyNative += BigInt(leg.inputAmount);
  }
  let predictionFloored = false;
  if (
    sandwich &&
    predictionBuyNative > 0n &&
    !!buyAmountSmallest &&
    isPositiveSmallestUnitAmount(buyAmountSmallest)
  ) {
    let totalWeightBps = 0n;
    let predictionWeightBps = 0n;
    for (const leg of sandwich.legs) {
      const weightBps = Math.max(0, Math.trunc(leg.weightBps));
      if (weightBps <= 0) continue;
      totalWeightBps += BigInt(weightBps);
      if (leg.type === "prediction_market" && leg.marketId) {
        predictionWeightBps += BigInt(weightBps);
      }
    }
    if (totalWeightBps > 0n) {
      const naturalPredictionNative =
        (BigInt(buyAmountSmallest) * predictionWeightBps) / totalWeightBps;
      predictionFloored = predictionBuyNative > naturalPredictionNative;
    }
  }
  const predictionBuyUsd = Number(predictionBuyNative) / 1_000_000;

  // ── Perp quote plumbing ─────────────────────────────────────────────────
  // The quote is the server's built-and-simulated Phoenix transaction. It is
  // warmed in the background (and on the confirm button's touch-down) so the
  // tap itself is just sign + send — the same shape as the spot buy.
  const quoteTokenRef = useRef(0);
  const readyQuoteRef = useRef<TimedPerpQuote<PerpQuote> | null>(null);
  const inFlightQuoteRef = useRef<{ key: string; promise: Promise<PerpQuote> } | null>(null);
  const quoteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Signature of the last perp transaction this screen submitted.
   *
   * Kept because the app now broadcasts perp entries itself: the server's
   * settle call is fire-and-forget, so this is the only place the signature is
   * in hand for the success toast and for a retry of the bookkeeping.
   */
  const lastPerpSignatureRef = useRef<string | null>(null);

  const perpKey = perpQuoteKey(numericBuyAmount, leverage, stopLossPct);

  /**
   * Drop every quote in play. Called whenever an input moves: a quote built for
   * a different margin/leverage/stop is not the order the user is looking at.
   *
   * Abandoning an `awaiting_signature` run is safe — `reservePerpSandwichPosition`
   * is idempotent per (user, sandwich), so the next quote drops the stale run and
   * preserves the same isolated child leases. No leaked accounts or duplicate runs.
   */
  const invalidatePerpQuote = useCallback(() => {
    quoteTokenRef.current += 1;
    readyQuoteRef.current = null;
    inFlightQuoteRef.current = null;
    if (quoteDebounceRef.current) {
      clearTimeout(quoteDebounceRef.current);
      quoteDebounceRef.current = null;
    }
  }, []);

  const ensurePerpQuote = useCallback(
    async (key: string, margin: number, lev: number, stop: number): Promise<PerpQuote> => {
      if (!sandwich) throw new Error("No sandwich to buy.");
      const ready = freshPerpQuote(readyQuoteRef.current, key);
      if (ready) return ready;
      // Never sign a transaction that sat in the pad until its blockhash was
      // near expiry. A fresh build also drops the old awaiting-signature run.
      if (readyQuoteRef.current?.key === key) readyQuoteRef.current = null;
      const inFlight = inFlightQuoteRef.current;
      if (inFlight?.key === key) return inFlight.promise;

      const token = ++quoteTokenRef.current;
      const promise = startPerpSandwichBuy(sandwich.id, margin, lev, stop).then((started) => {
        if (started.status !== "needs_signature") {
          throw new Error(started.reason || "Perp order could not be built.");
        }
        // A quote that resolved after the inputs moved is still handed to its
        // own awaiter (it asked for this key) but must not be cached as current.
        if (token === quoteTokenRef.current) {
          readyQuoteRef.current = { key, quote: started, receivedAtMs: Date.now() };
        }
        return started;
      });
      inFlightQuoteRef.current = { key, promise };
      try {
        return await promise;
      } finally {
        if (inFlightQuoteRef.current?.promise === promise) inFlightQuoteRef.current = null;
      }
    },
    [sandwich],
  );

  // Background warm-up. 700ms of idle, because one 3-leg quote is ~9 Phoenix
  // calls behind a process-wide ~4.5 req/s pacer plus a build and a simulate —
  // quoting more eagerly just queues quotes behind each other.
  useEffect(() => {
    // A perp quote reserves a server-side run; a demo buy must never create one.
    if (!isPerp || buying || demoBuys) return;
    if (!(numericBuyAmount >= MIN_MARGIN_USD && numericBuyAmount <= MAX_MARGIN_USD)) return;
    if (freshPerpQuote(readyQuoteRef.current, perpKey)) return;

    const timer = setTimeout(() => {
      void ensurePerpQuote(perpKey, numericBuyAmount, leverage, stopLossPct).catch(() => {
        // A warm-up failure is not a user-facing error — the tap re-quotes and
        // surfaces whatever goes wrong then.
      });
    }, PERP_QUOTE_DEBOUNCE_MS);
    quoteDebounceRef.current = timer;
    return () => clearTimeout(timer);
  }, [buying, demoBuys, ensurePerpQuote, isPerp, leverage, numericBuyAmount, perpKey, stopLossPct]);

  useEffect(() => () => invalidatePerpQuote(), [invalidatePerpQuote]);

  // Leverage can only go as high as the *lowest* tier ceiling across the legs,
  // and that ceiling moves with the size — so re-clamp whenever it drops.
  useEffect(() => {
    if (!isPerp) return;
    setLeverage((current) => Math.min(current, Math.max(1, perpRisk.selectableMaxLeverage)));
  }, [isPerp, perpRisk.selectableMaxLeverage]);

  // The legal stop shrinks as leverage rises (it must leave 20% of the
  // mark→liquidation gap). Follow it down, or every entry above ~6x would be
  // rejected server-side with `phoenix_stop_safety_failed`.
  useEffect(() => {
    if (!isPerp) return;
    const ceiling = perpRisk.maxStopLossPct;
    if (!(ceiling > 0)) return;
    setStopLossPct((current) =>
      current > ceiling ? Math.max(MIN_STOP_LOSS_PCT, Math.floor(ceiling * 10) / 10) : current,
    );
  }, [isPerp, perpRisk.maxStopLossPct]);

  useEffect(() => {
    setBuyAmount("");
    setBuyMessage(null);
    setBuying(false);
    setLeverage(DEFAULT_PERP_LEVERAGE);
    setStopLossPct(DEFAULT_PERP_STOP_PCT);
    invalidatePerpQuote();
    warmedBuyRef.current = null;
    prebuildArmedRef.current = true;
  }, [invalidatePerpQuote, sandwich?.id]);

  const setAmountAndReset = useCallback(
    (value: string) => {
      setBuyAmount(value);
      setBuyMessage(null);
      invalidatePerpQuote();
      warmedBuyRef.current = null;
      prebuildArmedRef.current = true;
    },
    [invalidatePerpQuote],
  );

  const changeLeverage = useCallback(
    (next: number) => {
      // The slider runs on the UI thread and reports back asynchronously. Keep
      // its controlled value finite, tenth-stepped, and inside the current
      // cross-leg ceiling so the label, slider marker, quote, and order always
      // describe the same leverage.
      const max = Math.max(1, perpRisk.selectableMaxLeverage);
      const normalized = Number.isFinite(next)
        ? Math.min(max, Math.max(1, Math.round(next * 10) / 10))
        : 1;
      setLeverage(normalized);
      setBuyMessage(null);
      invalidatePerpQuote();
    },
    [invalidatePerpQuote, perpRisk.selectableMaxLeverage],
  );

  /** Warm the quote on touch-down so the tap is only sign + send. */
  const warmPerpQuote = useCallback(() => {
    if (!isPerp || buying || demoBuys) return;
    if (!(numericBuyAmount >= MIN_MARGIN_USD && numericBuyAmount <= MAX_MARGIN_USD)) return;
    if (freshPerpQuote(readyQuoteRef.current, perpKey)) return;
    if (quoteDebounceRef.current) {
      clearTimeout(quoteDebounceRef.current);
      quoteDebounceRef.current = null;
    }
    void ensurePerpQuote(perpKey, numericBuyAmount, leverage, stopLossPct).catch(() => {});
  }, [buying, demoBuys, ensurePerpQuote, isPerp, leverage, numericBuyAmount, perpKey, stopLossPct]);

  const tapPreset = useCallback(
    (value: string) => {
      setAmountAndReset(value);
    },
    [setAmountAndReset],
  );

  const tapKey = useCallback((key: string) => {
    setBuyMessage(null);
    invalidatePerpQuote();
    // A build is only valid for the amount it was made at.
    warmedBuyRef.current = null;
    prebuildArmedRef.current = true;

    setBuyAmount((current) => {
      if (key === "del") {
        return current.length <= 1 ? "0" : current.slice(0, -1);
      }

      if (key === ".") {
        return current.includes(".") ? current : `${current || "0"}.`;
      }

      if (current === "0") return key;
      return `${current}${key}`;
    });
  }, [invalidatePerpQuote]);

  async function buySandwich() {
    if (!sandwich) return;

    if (!walletAddress || !wallet) {
      setBuyMessage("Connect an embedded Solana wallet before buying.");
      return;
    }

    if (
      !buyAmountSmallest ||
      !isPositiveSmallestUnitAmount(buyAmountSmallest)
    ) {
      setBuyMessage("Enter a valid USDC amount.");
      return;
    }

    // Demo buys: everything the pad validates has run. Instead of building and
    // signing, the legs fill against the on-device paper account at live
    // prices, and the position is recorded exactly as a real buy records it —
    // so it shows up in Holdings, values live, and can be sold.
    if (demoBuys) {
      Keyboard.dismiss();
      setBuying(true);
      setBuyMessage(null);
      try {
        await new Promise((resolve) => setTimeout(resolve, DEMO_BUY_DELAY_MS));
        if (isPerp) {
          // A perp Sandwich opens one position per leg, sized off its weight.
          const legs = perpRisk.legs.filter((leg) => leg.marginUsd > 0);
          if (legs.length === 0) throw new Error("This sandwich has no legs that can be opened.");
          for (const leg of legs) {
            if (!leg.markPrice) throw new Error(`No mark price for ${leg.label} right now.`);
          }
          for (const leg of legs) {
            await demoOpenPerp({
              symbol: leg.symbol,
              name: leg.label,
              iconUri: leg.imageUrl,
              side: leg.side,
              leverage,
              marginUsd: leg.marginUsd,
              entryPrice: leg.markPrice!,
            });
          }
        } else {
          const spotLegs = sandwich.legs.filter(
            (leg): leg is typeof leg & { mint: string } =>
              leg.type !== "prediction_market" && !!leg.mint && leg.weightBps > 0,
          );
          const totalWeight = spotLegs.reduce((sum, leg) => sum + leg.weightBps, 0);
          if (spotLegs.length === 0 || totalWeight <= 0) {
            throw new Error("This sandwich has no legs that can be bought yet.");
          }
          if (numericBuyAmount > cash.totalCash + 1e-6) throw new DemoInsufficientCashError();
          const marks = await getMarkPricesForMints(spotLegs.map((leg) => leg.mint));
          const priced = await Promise.all(
            spotLegs.map(async (leg) => ({
              leg,
              usd: (numericBuyAmount * leg.weightBps) / totalWeight,
              price: marks[leg.mint] ?? leg.onchainPriceUsd ?? leg.currentPriceUsd ?? leg.priceUsd,
              decimals: (await getMintDecimals(leg.mint)) ?? 6,
            })),
          );
          const unpriced = priced.find((entry) => !entry.price || entry.price <= 0);
          if (unpriced) throw new Error(`No price for ${unpriced.leg.symbol ?? unpriced.leg.label} right now.`);
          const executedLegs: ExecutedSandwichLeg[] = [];
          for (const { leg, usd, price, decimals } of priced) {
            const qty = await demoBuySpot({
              mint: leg.mint,
              usd,
              priceUsd: price!,
              decimals,
              sandwichId: sandwich.id,
            });
            executedLegs.push({
              kind: "swap",
              legId: leg.id,
              mint: leg.mint,
              inputAmount: String(Math.round(usd * 1_000_000)),
              outputAmount: BigInt(Math.floor(qty * 10 ** decimals)).toString(),
              decimals,
            });
          }
          await recordSandwichBuy(walletAddress, sandwich, executedLegs);
          const updatedPositions = await getStoredSandwichPositions(walletAddress);
          onPositionUpdated?.(
            updatedPositions.find((row) => row.sandwichId === sandwich.id) ?? null,
          );
        }
      } catch (error) {
        setBuying(false);
        setBuyMessage(getErrorMessage(error));
        onToast({ text: "Buy stopped", tone: "error" });
        return;
      }
      setBuying(false);
      void walletStore.refresh();
      void walletStore.reloadCostBasis();
      onCelebrate?.({
        action: "buy",
        icons: sandwich.legs.map((leg) => leg.imageUrl),
        label: sandwich.name,
        amountUsd: numericBuyAmount,
        sincePnlPct: sandwich.pnlPct,
        source: sandwich.source,
        caption: momentReceiptLine(sandwich),
      });
      onClose();
      return;
    }

    // Ondo/RFQ availability is already checked while the amount is being
    // entered. Do not start the much slower build -> preflight -> fallback chain
    // when that read-only quote has already given us a terminal answer.
    if (availabilityPending) {
      setBuyMessage("Still checking whether this order can be filled.");
      return;
    }
    if (quoteBlocksBuy) {
      setBuyMessage(null);
      return;
    }

    if (sandwich.venue === "perp") {
      // Margin/leverage/stop as they were on screen at the moment of the tap.
      // Everything below is checked against these, so a slider that moves
      // mid-flight can never be what gets signed.
      const marginValue = numericBuyAmount;
      const leverageValue = leverage;
      const stopValue = stopLossPct;
      if (!(marginValue >= MIN_MARGIN_USD) || marginValue > MAX_MARGIN_USD) {
        setBuyMessage(`Margin must be between $${MIN_MARGIN_USD} and $${MAX_MARGIN_USD.toLocaleString("en-US")}.`);
        return;
      }
      if (!Number.isFinite(leverageValue) || leverageValue < 1) {
        setBuyMessage("Leverage must be at least 1x.");
        return;
      }
      if (!Number.isFinite(stopValue) || stopValue < MIN_STOP_LOSS_PCT) {
        setBuyMessage(`Stop loss must be at least ${MIN_STOP_LOSS_PCT}% from the mark.`);
        return;
      }

      Keyboard.dismiss();
      setBuying(true);
      setBuyMessage(null);

      const key = perpQuoteKey(marginValue, leverageValue, stopValue);
      // Sign, submit, done — the bookkeeping call is NOT waited on.
      //
      // A Phoenix transaction leaves the build already signed by Bread's payer,
      // so nothing between here and the chain needs the server. It used to go
      // through /basket-runs/[id]/submit anyway, which re-verified the bytes,
      // rebroadcast them and then held the request open confirming for up to
      // 30 seconds before the app was allowed to say the trade worked. All of
      // that sat between the user's approval and their fill.
      //
      // Now it takes the same route as the single-order path behind the stock
      // detail sheet: straight to /api/solana/send with `fastConfirm`, which
      // returns as soon as the transaction is in a block. `settlePerpSandwichRun`
      // then records the outcome in the background — it is idempotent, and a
      // call that never lands is picked up by the backend's reconciler, so
      // awaiting it would only put the old latency back for no extra safety.
      const signAndSubmit = async (quote: PerpQuote) => {
        const result = await signAndSendBase64WithResult(wallet, quote.transactions[0], {
          lastValidBlockHeight: quote.lastValidBlockHeight,
          // The entry is one atomic transaction the backend has already
          // validated; a second simulation here is pure latency.
          skipSimulation: true,
          fastConfirm: true,
          requireConfirmed: true,
        });
        void settlePerpSandwichRun(quote.basketRunId).catch(() => {});
        lastPerpSignatureRef.current = result.signature;
      };

      try {
        // Opening a position is silent. `buying` already spins the pad's own
        // button, and the receipt below reports the fill — narrating each step
        // on top of that is the same news three times.
        const initialQuote = await ensurePerpQuote(key, marginValue, leverageValue, stopValue);
        const quote = await entryQuoteAfterRegistration({
          initialQuote,
          signAndSubmit,
          beforeRetry: invalidatePerpQuote,
          requestFreshQuote: () =>
            ensurePerpQuote(key, marginValue, leverageValue, stopValue),
        });

        // The preview echoes the user's stated intent back. If it disagrees, the
        // quote is not the order on screen and must not be signed. Prices, fees
        // and funding are deliberately NOT checked — those legitimately drift
        // between quote and signature, and the fill is already bounded by the
        // server's 1% slippage cap on a fill-or-kill packet.
        const preview = quote.preview;
        if (preview && !("setupRequired" in preview)) {
          if (
            Math.abs(preview.marginUsd - marginValue) > 0.01 ||
            preview.leverage !== leverageValue ||
            Math.abs(preview.stopLossPct - stopValue) > 1e-6
          ) {
            invalidatePerpQuote();
            throw new Error("The order changed while you were confirming — tap again to review it.");
          }
        }

        await signAndSubmit(quote);
        invalidatePerpQuote();
        setBuyMessage(null);
        onCelebrate?.({
          action: "buy",
          icons: sandwich.legs.map((leg) => leg.imageUrl),
          label: sandwich.name,
          amountUsd: marginValue,
          sincePnlPct: sandwich.pnlPct,
          source: sandwich.source,
          caption: momentReceiptLine(sandwich),
        });
        // The success screen is a full-screen receipt now, not a burst that
        // plays over the pad — so the pad goes away underneath it rather than
        // waiting behind with a stale amount still typed in. Matches how a
        // stock trade tears its dialpad down (`onAfterSubmit`), and how the
        // sell pad below already behaves.
        onClose();
        void walletStore.refresh();
      } catch (error) {
        const message = getErrorMessage(error);
        invalidatePerpQuote();
        setBuyMessage(message);
        onToast({ text: "Perp buy stopped", tone: "error" });
      } finally {
        setBuying(false);
      }
      return;
    }

    const plan = buildSandwichBuyPlan(sandwich, buyAmountSmallest);
    if (plan.executableLegs.length === 0) {
      setBuyMessage(
        plan.skippedLegs.some((leg) => leg.reason === "prediction_min_order")
          ? "Prediction market legs require at least $5 allocation."
          : "This sandwich has no legs that can be bought yet.",
      );
      return;
    }

    Keyboard.dismiss();
    // Same as the perp entry above: silent until something goes wrong.
    setBuying(true);
    setBuyMessage(null);

    // Track legs that actually landed on-chain and the first failure (if any), so
    // a partial/failed run still records what executed and never strands the USDC
    // we freed up front.
    const executed: ExecutedSandwichLeg[] = [];
    let stopMessage: string | null = null;
    // Reason the atomic bundle couldn't start (feature off, unroutable/RFQ leg,
    // closed market), kept as a fallback message when the per-leg path also
    // executes nothing.
    let bundleFailureReason: string | null = null;

    try {
      // Optimistically deduct the buy amount from the cash balance
      const buyAmountNum = Number(buyAmount);
      if (buyAmountNum > 0) {
        const idleDeduction = Math.min(cash.idleUsdc, buyAmountNum);
        if (idleDeduction > 0) {
          walletStore.optimisticAdjust(SOLANA_USDC_MINT, -idleDeduction, -idleDeduction);
        }
      }

      const provider = await wallet.getProvider();

      // ── Fast path: the server-side basket engine ─────────────────────────
      // The per-leg loop below costs a full build → sign → confirm round trip
      // for EVERY leg, serially. The basket engine instead builds all legs
      // concurrently server-side and packs them into as few transactions as
      // they fit — usually one — so a 3-leg sandwich costs roughly what one leg
      // used to.
      //
      // NOT a Jito bundle, despite what this comment said for months: buys have
      // gone over plain RPC since the bundle auction started dropping valid
      // trades as `Invalid` after competing for 45s. Legs are independent USDC
      // swaps, so they need no all-or-nothing guarantee, and a PARTIAL FILL is a
      // settled terminal outcome — which is exactly why the result handling
      // below has a `partial` branch that records only the legs that landed.
      //
      // It only handles spot swaps: the engine rejects prediction-market legs
      // outright (different venue, $5 minimums, geo restrictions), so those
      // sandwiches stay on the loop. Anything that fails BEFORE a signature
      // also falls through to the loop, which is safe precisely because
      // nothing has been signed or submitted at that point.
      const bundleable = plan.executableLegs.every((leg) => leg.kind === "swap");
      const strictTimestamp = sandwich.source?.sourceType === "youtube";
      let bundleSettled = strictTimestamp && !bundleable;
      if (bundleSettled) {
        stopMessage = "This timestamp basket contains a leg that cannot execute atomically.";
      }
      if (bundleable) {
        // Reuse the build that touch-down already kicked off, when it was for
        // this exact amount. Consumed either way: a build is single-use, and
        // re-awaiting a settled one would resurrect a stale quote.
        const warmed = warmedBuyRef.current;
        warmedBuyRef.current = null;
        prebuildArmedRef.current = false;
        const buildNow = () => startSandwichBasketBuy(sandwich.id, Number(buyAmount));
        const startPromise =
          warmed &&
          warmed.amount === buyAmount &&
          Date.now() - warmed.at < SPOT_PREBUILD_TTL_MS
            ? warmed.started.then((ready) => ready ?? buildNow())
            : buildNow();
        const started = await startPromise.catch(
          (error: unknown) => {
            // The reason is now legible (the backend echoes it under `error`);
            // keep it so the per-leg path below, or the no-legs fallback, can
            // surface it instead of a bare "nothing executed".
            const reason = getErrorMessage(error);
            console.log("[sandwich-buy] bundle start failed", { reason, strictTimestamp });
            bundleFailureReason = reason;
            return null;
          },
        );

        if (started && started.status === "needs_signature") {
          // One tap buys. This used to stop here on the first tap to show the
          // built slippage and ask for a second — because slippage was not
          // knowable until the legs were built. It is now: the pad quotes every
          // leg against the same venues while the amount is being typed and
          // renders the identical slippage card from it (livePreviewSlippage),
          // so the terms are already on screen when the tap happens. A second
          // tap would confirm what the user just read rather than reveal it.
          //
          // What still protects the fill is server-side and unchanged: the
          // execution-price guard runs at build time and refuses with
          // `execution_price_unsafe`, which no amount of tapping overrides.

          // Past this point the transactions exist and may reach the chain, so
          // failures are reported rather than retried down the other path.
          // Signed together, not one after another. Privy exposes no batch
          // method, but these are local signatures over independent messages
          // with no user prompt between them, so serializing them only added a
          // round trip per extra transaction. `Promise.all` preserves order,
          // which matters: the server replays this list positionally.
          const signedTransactions = await Promise.all(
            started.transactions.map(async (unsigned) => {
              const signedPayload = await provider.request({
                method: "signTransaction",
                params: { transaction: deserializeJupiterTransaction(unsigned) },
              });
              return Buffer.from(
                serializeSignedTransaction(signedPayload.signedTransaction),
              ).toString("base64");
            }),
          );

          const result = await submitSignedBasketBuy(started.basketRunId, signedTransactions);
          if (result.status === "confirmed" || result.status === "partial") {
            // A partial fill is settled, not failed — the legs that landed are
            // real positions. Only those are recorded; the rest cost nothing.
            const landed =
              result.status === "partial"
                ? new Set(result.landedLegIds)
                : null;
            for (const leg of started.legs) {
              if (landed && !landed.has(leg.legId)) continue;
              executed.push({
                kind: "swap",
                legId: leg.legId,
                mint: leg.mint,
                inputAmount: leg.amountUsdc,
                outputAmount: leg.quotedOutRaw ?? null,
                decimals: leg.decimals ?? null,
              });
            }
            if (result.status === "partial") {
              stopMessage = `Bought ${result.landedLegIds.length} of ${
                result.landedLegIds.length + result.failedLegIds.length
              } layers — the rest didn't make it, and you weren't charged for them.`;
            }
          } else {
            // Nothing landed, so the cash is untouched.
            stopMessage = result.reason || "The buy did not land. Please try again.";
          }
          bundleSettled = true;
        } else if (started) {
          if (strictTimestamp) {
            stopMessage = started.reason || "This timestamp basket cannot execute atomically right now.";
            bundleSettled = true;
          } else if (
            started.code === "market_closed" ||
            started.code === "leg_build_failed" ||
            started.code === "simulation_failed"
          ) {
            // All or nothing: the server already checked EVERY leg and one
            // can't execute right now ("AAOI can't trade right now — opens
            // Sun 8 PM ET. Nothing was spent."). Retrying leg by leg here would
            // buy the others alone — the partial fill the server refused.
            stopMessage = started.reason || "One of this Sandwich's picks can't be bought right now. Nothing was spent.";
            bundleSettled = true;
          } else if (started.code === "payer_underfunded") {
            // The one code that must NOT fall through. Every path below is
            // sponsored by the same integrator wallet, so retrying leg by leg
            // cannot succeed — it just re-fails twice and surfaces whichever
            // leg spoke last, which is how an empty payer got reported to a
            // user as "TAO has almost no liquidity".
            stopMessage =
              started.reason ||
              "Buys are paused for a few minutes. Nothing was spent — please try again shortly.";
            bundleSettled = true;
          }
          // Falling through to the per-leg path is CORRECT here, including for
          // `rfq_leg_unroutable` and `execution_price_unsafe`. The bundle is
          // Metis-only by construction (a Jito bundle self-submits, so it can't
          // carry an RFQ fill that needs the maker's counter-signature), while
          // the per-leg path ends at /api/jupiter/order, which also reaches
          // Ultra/JupiterZ. Ondo prestocks quote ~$460 there and nowhere else,
          // so treating a Metis miss as terminal would make them unbuyable.
          //
          // What makes the fall-through safe now is that every venue it can
          // reach runs the execution guard on its own build. The $4 → $1.50 AMD
          // loss happened because the per-leg path was unguarded, not because
          // it ran at all.
          console.log("[sandwich-buy] bundle unavailable, using per-leg path", {
            code: started.code,
            reason: started.reason,
          });
        } else if (strictTimestamp) {
          stopMessage = bundleFailureReason || "This timestamp basket cannot execute atomically right now.";
          bundleSettled = true;
        }
      }

      // Empty once the bundle settled — the legs are already bought or the run
      // failed atomically, and either way there is nothing left to execute.
      const legsNeedingSequentialPath = bundleSettled ? [] : plan.executableLegs;

      // Pre-flight the sequential path. Unlike a Jito bundle, the per-leg loop
      // below is NOT atomic: it buys leg by leg, so a leg that fails partway
      // (e.g. one stock's market is closed while another's is open) leaves the
      // earlier legs already bought — a partial fill the user didn't ask for.
      // These tokenized-equity legs are exactly the ones that can't bundle, so
      // this is their only guard. Probe every spot leg's routability with a
      // read-only quote FIRST; if any can't route, abort before spending a cent.
      // (Prediction legs are a separate venue and aren't quotable this way, so
      // they're left to the loop's own per-leg error handling.)
      const spotLegsToProbe = legsNeedingSequentialPath.filter(
        (leg): leg is Extract<typeof leg, { kind: "swap" }> => leg.kind === "swap",
      );
      // The live sandwich preview now runs this same execution-price guard for
      // the exact leg amounts. Repeating it after the swipe only burns another
      // forward + reverse quote per leg. Builders still guard their own fresh
      // terms, so skipping this duplicate check does not weaken execution.
      const previewAlreadyGuarded =
        livePreview.ready &&
        spotLegsToProbe.every((leg) => livePreview.previews.get(leg.legId)?.ok === true);
      // Runs for a SINGLE leg too. The old `> 1` gate reasoned that one leg
      // can't fill partially so there was nothing to protect — but that only
      // held while the probe tested routability. Now it also tests price, and a
      // one-leg sandwich is exactly the shape that lost 62% on an AMD buy.
      if (spotLegsToProbe.length > 0 && !stopMessage && !previewAlreadyGuarded) {
        const preflight = await preflightTradeLegs(
          spotLegsToProbe.map((leg) => ({
            mint: leg.mint,
            amount: leg.inputAmount,
            label: leg.symbol ?? leg.label,
          })),
          walletAddress,
        ).catch((error: unknown) => {
          // The check itself failing must not block a legitimate buy; the
          // builders run the same guard server-side and remain the backstop.
          console.log("[sandwich-buy] preflight unavailable, relying on build-time guard", {
            reason: getErrorMessage(error),
          });
          return null;
        });

        const failed = preflight?.legs.filter((leg) => !leg.ok) ?? [];
        // Price rejections block on their own — a single badly-priced leg is
        // the whole problem, whether or not its siblings are fine. Routing
        // failures keep the old rule: block only on a PARTIAL failure (the
        // genuine partial-fill trap), and otherwise fall through so the loop
        // surfaces the clearer per-leg error.
        const priceRejected = failed.filter((leg) => leg.code !== "unroutable");
        const unroutable = failed.filter((leg) => leg.code === "unroutable");

        if (priceRejected.length > 0) {
          stopMessage =
            priceRejected[0].reason ??
            "These prices look wrong right now. No cash was spent.";
        } else if (unroutable.length > 0 && unroutable.length < spotLegsToProbe.length) {
          const byMint = new Map(spotLegsToProbe.map((leg) => [leg.mint, leg]));
          const names = unroutable
            .map((leg) => {
              const match = byMint.get(leg.mint);
              return match?.symbol ?? match?.label;
            })
            .filter(Boolean)
            .join(", ");
          stopMessage =
            describeTradeUnavailable(unroutable[0].reason) ??
            `${names} can't be traded right now, so this basket can't be completed. No cash was spent — try again when its market is open.`;
        }
      }

      for (const leg of stopMessage ? [] : legsNeedingSequentialPath) {
        if (leg.kind === "prediction") {
          const order = await createPredictionOrder({
            ownerPubkey: walletAddress,
            marketId: leg.marketId,
            isYes: leg.isYes,
            isBuy: true,
            depositAmount: leg.inputAmount,
          });
          const unsignedTransaction = deserializeJupiterTransaction(
            order.transaction,
          );
          const signedPayload = await provider.request({
            method: "signTransaction",
            params: {
              transaction: unsignedTransaction,
            },
          });
          const signedBytes = serializeSignedTransaction(
            signedPayload.signedTransaction,
          );
          const signedTransaction = Buffer.from(signedBytes).toString("base64");

          const submission = await submitPredictionTransaction({
            signedTransaction,
            ...(order.blockhash ? { blockhash: order.blockhash } : {}),
            ...(order.lastValidBlockHeight !== null
              ? { lastValidBlockHeight: order.lastValidBlockHeight }
              : {}),
          });

          if (submission.errorMessage) {
            stopMessage = `Stopped at ${leg.symbol ?? leg.label}: ${submission.errorMessage}`;
            break;
          }

          if (submission.status && submission.status !== "Success") {
            stopMessage = `Stopped at ${leg.symbol ?? leg.label}: prediction order ${submission.status}.`;
            break;
          }

          if (submission.code !== null && submission.code !== 0) {
            stopMessage = `Stopped at ${leg.symbol ?? leg.label}: prediction error ${submission.code}.`;
            break;
          }

          executed.push({
            kind: "prediction",
            legId: leg.legId,
            marketId: leg.marketId,
            positionPubkey: order.positionPubkey,
            isYes: leg.isYes,
            inputAmount: leg.inputAmount,
          });
          continue;
        }

        // Spot swap leg. Try the ATOMIC path first — one Jupiter `/build`
        // call via /api/solana/send (skipSimulation), the same path the stock
        // detail buy uses — a plain composable swap spending liquid USDC. Halves the Jupiter calls per leg (build only, vs
        // order+execute) and avoids the slow Ultra execute round trip. Only the
        // RFQ-only / oversized legs fall back to order→execute below.
        const atomic = await createAtomicBuyTransaction({
          taker: walletAddress,
          outputMint: leg.mint,
          amountInUsdc: leg.inputAmount,
        });
        if (atomic.rejected) {
          // The guard refused Metis's price for this leg. That is a verdict on
          // the venue, not the token — order/execute below reaches Ultra's RFQ
          // makers too, and it runs the same guard on whatever it builds. So
          // skip the atomic path and let the next venue try.
          console.log("[sandwich-buy] atomic price rejected, trying order/execute", {
            symbol: leg.symbol ?? leg.label,
            reason: atomic.rejectionReason,
          });
        } else if (!atomic.fallback && atomic.transaction) {
          // No try/catch fallback here: if the send throws it may already be
          // in-flight, so we must not re-submit via order→execute (double-buy).
          // Let it propagate to the outer catch like the stock detail buy.
          await signAndSendBase64(wallet, atomic.transaction, {
            skipSimulation: true,
            fastConfirm: true,
            requireConfirmed: true,
          });
          executed.push({
            kind: "swap" as const,
            legId: leg.legId,
            mint: leg.mint,
            inputAmount: leg.inputAmount,
          });
          continue;
        }

        const order = await createJupiterOrder({
          inputMint: SOLANA_USDC_MINT,
          outputMint: leg.mint,
          amount: leg.inputAmount,
          taker: walletAddress,
        });
        const unsignedTransaction = deserializeJupiterTransaction(
          order.transaction,
        );
        const signedPayload = await provider.request({
          method: "signTransaction",
          params: {
            transaction: unsignedTransaction,
          },
        });
        const signedBytes = serializeSignedTransaction(
          signedPayload.signedTransaction,
        );
        const signedTransaction = Buffer.from(signedBytes).toString("base64");

        const execution = await executeJupiterOrder({
          signedTransaction,
          requestId: order.requestId,
          ...(order.lastValidBlockHeight
            ? { lastValidBlockHeight: order.lastValidBlockHeight }
            : {}),
        });

        if (execution.errorMessage) {
          stopMessage = `Stopped at ${leg.symbol ?? leg.label}: ${execution.errorMessage}`;
          break;
        }

        if (execution.status && execution.status !== "Success") {
          stopMessage = `Stopped at ${leg.symbol ?? leg.label}: Jupiter returned ${execution.status}.`;
          break;
        }

        if (execution.code !== null && execution.code !== 0) {
          stopMessage = `Stopped at ${leg.symbol ?? leg.label}: Jupiter error ${execution.code}.`;
          break;
        }

        executed.push({
          kind: "swap" as const,
          legId: leg.legId,
          mint: leg.mint,
          inputAmount: leg.inputAmount,
        });
      }
    } catch (error) {
      // The atomic swap send can throw mid-flight (and must not be re-submitted);
      // treat it as the stop reason and fall through to the shared recovery below.
      stopMessage = getErrorMessage(error);
    }

    // --- Shared finalize / recovery: runs on success, partial, and failure ---

    // Persist every leg that actually landed on-chain — even on a partial run —
    // so the position reflects reality and a paid-for leg is never lost.
    if (executed.length > 0) {
      try {
        await recordSandwichBuy(walletAddress, sandwich, executed);
        const updatedPositions = await getStoredSandwichPositions(walletAddress);
        onPositionUpdated?.(
          updatedPositions.find((row) => row.sandwichId === sandwich.id) ?? null,
        );
      } catch {
        // Local persistence only; the on-chain buy already happened.
      }
      void walletStore.refresh();
    }

    // Any USDC freed up front but not spent (failed or partial buy) simply
    // stays liquid in the wallet as spendable cash.
    setBuying(false);

    if (stopMessage) {
      // Rewrite the common untradeable-asset failures (chiefly tokenized stocks
      // outside Ondo's secondary-market window) into plain copy; keep the raw reason otherwise.
      const friendly = describeTradeUnavailable(stopMessage) ?? stopMessage;
      setBuyMessage(friendly);
      onToast({
        text: executed.length > 0 ? "Stopped — partial buy" : "Buy stopped",
        tone: "error",
      });
      void walletStore.refresh();
      return;
    }

    if (executed.length === 0) {
      const friendly =
        describeTradeUnavailable(bundleFailureReason) ??
        bundleFailureReason ??
        "No sandwich legs were executed.";
      setBuyMessage(friendly);
      onToast({ text: "No executable legs", tone: "error" });
      void walletStore.refresh();
      return;
    }

    setBuyMessage(null);
    // Stack the legs into a sandwich, then rain every logo the basket holds.
    onCelebrate?.({
      action: "buy",
      icons: sandwich.legs.map((leg) => leg.imageUrl),
      label: sandwich.name,
      amountUsd: Number(buyAmount),
      sincePnlPct: sandwich.pnlPct,
      source: sandwich.source,
      caption: momentReceiptLine(sandwich),
    });
    onClose();
  }

  const formatUsdShort = (n: number) =>
    Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
  // Cool pill under the amount: when a prediction leg's slice was raised to its
  // $5 floor, show exactly how much of the buy lands in the prediction market so
  // the $5 minimum is visible against the entered amount. Hidden below the buy
  // minimum (the button shows "Minimum $X" there) and when there's no flooring.
  const predictionNote =
    !demoBuys && !belowMin && predictionFloored
      ? `${formatUsdShort(predictionBuyUsd)} of ${formatUsdShort(Number(buyAmount))} → prediction market · $5 min`
      : null;
  // `message` stays near the confirm button for wallet/status/skip states.
  const sheetMessage = !walletAddress
    ? "Connect an embedded Solana wallet to buy."
    : belowMin
      ? null
      : outsidePerpMarginBounds
        ? `Margin must be between $${MIN_MARGIN_USD} and $${MAX_MARGIN_USD.toLocaleString("en-US")}.`
        : buyMessage
          ? buyMessage
          : skippedCount > 0
            ? "Some legs were skipped (missing mint/market)."
            : null;
  /**
   * Live venue terms for the amount on the keypad.
   *
   * Gated on `enabled`, and the gate is the safety property: while a buy is
   * warming or in flight the trade owns the Jupiter bucket outright, because a
   * rate-limited reverse quote makes the execution-price guard fail OPEN. A
   * preview must never be the reason the guard stops running. Everything else
   * that keeps this affordable — debounce, abort, cache, and the server's own
   * 8 rps pacing — lives in useBasketQuotePreview and jupiter-rate-limit.ts.
   */
  const basketQuoteLegs = useMemo(() => {
    if (isPerp || !sandwich) return [];
    return (buyPlan?.executableLegs ?? []).flatMap((planned) => {
      if (planned.kind !== "swap" || !planned.mint) return [];
      return [{
        legId: planned.legId,
        mint: planned.mint,
        amountRaw: String(planned.inputAmount),
        label: planned.symbol ?? planned.label,
      }];
    });
  }, [buyPlan, isPerp, sandwich]);

  const livePreview = useBasketQuotePreview({
    // Once the buy has built its own terms they are strictly better than a
    // preview — they are what the trade will actually execute at.
    enabled: !isPerp && !buying && Boolean(walletAddress) && !needsCash && !belowMin,
    side: "buy",
    legs: basketQuoteLegs,
    // Slippage is taker-specific, so the quote is asked as this wallet.
    taker: walletAddress,
  });

  /**
   * A venue refusal known before the gesture. This is the missing bridge that
   * made Ondo buys feel hung: quote-preview already returned `market_closed`,
   * but only slippage rows consumed the response, so the enabled slider went on
   * to repeat up to ~10s of build/preflight work to discover the same refusal.
   */
  const quotedUnavailable = useMemo(() => {
    if (!livePreview.ready) return null;
    for (const planned of buyPlan?.executableLegs ?? []) {
      if (planned.kind !== "swap") continue;
      const unavailable = livePreview.previews.get(planned.legId)?.unavailable;
      if (unavailable) {
        return {
          label: planned.symbol ?? planned.label,
          ...unavailable,
        };
      }
    }
    return null;
  }, [buyPlan, livePreview.previews, livePreview.ready]);

  const tradeNotice = quotedUnavailable
    ? `${quotedUnavailable.label}: ${
        describeTradeUnavailable(quotedUnavailable.reason) ?? quotedUnavailable.message
      }`
    : null;
  // Closed markets and amount floors cannot recover without time or a new
  // amount. A generic no-route result stays advisory because RFQ liquidity can
  // reappear between preview and execution.
  const quoteBlocksBuy =
    quotedUnavailable?.code === "market_closed" ||
    quotedUnavailable?.code === "min_trade_size" ||
    quotedUnavailable?.code === "unsafe_price";
  const hasOndoLeg = basketQuoteLegs.some((leg) => /ondo$/i.test(leg.mint));
  // Only Ondo is held for the live answer: it is predictably RFQ/session-bound.
  // Other assets stay instant and let the server-side guard make the final call.
  const availabilityPending =
    !isPerp &&
    hasOndoLeg &&
    buyInputsValid &&
    !livePreview.ready &&
    !livePreview.error;
  // A demo buy never reaches a venue, so a venue refusal can't block it.
  const canBuy =
    needsCash || (buyInputsValid && (demoBuys || (!quoteBlocksBuy && !availabilityPending)));

  /** What one leg receives, at the venue terms currently quoted for it. */
  const quotedLegQuantity = (legId: string): number | null =>
    livePreview.previews.get(legId)?.expectedReceived ?? null;

  /**
   * The live quote in the shape the slippage card already renders.
   *
   * This is what retired the quote-then-confirm step. That step existed because
   * "slippage is only knowable once the legs are built", so the first tap built
   * and the second signed; the terms it revealed come from the same venues this
   * preview asks, so they can now be on screen BEFORE the tap instead of
   * between two of them. One tap is only safe because this is showing.
   */
  const livePreviewSlippage = useMemo((): BasketSlippage | null => {
    if (isPerp || livePreview.previews.size === 0) return null;
    const legs: LegSlippage[] = [];
    let totalUsdc = 0;
    let weightedSlippage = 0;
    let maxPriceImpactPct: number | null = null;
    let unpricedLegs = 0;

    for (const planned of buyPlan?.executableLegs ?? []) {
      if (planned.kind !== "swap") continue;
      const preview = livePreview.previews.get(planned.legId);
      const amountUsdc = Number(planned.inputAmount) / 1_000_000;
      totalUsdc += amountUsdc;
      if (!preview || preview.expectedReceived === null) {
        unpricedLegs += 1;
        continue;
      }
      legs.push({
        legId: planned.legId,
        symbol: planned.symbol,
        mint: planned.mint,
        amountUsdc,
        expectedReceived: preview.expectedReceived,
        minReceived: preview.minReceived,
        slippageBps: preview.slippageBps,
        priceImpactPct: preview.priceImpactPct,
        maxSlippagePct: preview.maxSlippagePct,
        firmQuote: preview.firmQuote,
      });
      weightedSlippage += (preview.maxSlippagePct ?? 0) * amountUsdc;
      if (preview.priceImpactPct !== null) {
        maxPriceImpactPct = Math.max(maxPriceImpactPct ?? 0, preview.priceImpactPct);
      }
    }

    if (legs.length === 0) return null;
    return {
      legs,
      totalUsdc,
      // Weighted by each leg's share of the spend, matching how the server
      // computes it for the built run — a 5% band on a $1 leg is not the same
      // risk as a 5% band on a $90 one.
      worstCaseSlippagePct: totalUsdc > 0 ? weightedSlippage / totalUsdc : null,
      maxPriceImpactPct,
      unpricedLegs,
    };
  }, [buyPlan, isPerp, livePreview.previews]);

  /**
   * Capital the plan actually deploys at the amount currently on the keypad —
   * no network, so it tracks every tap.
   *
   * This is the sum of the legs' own slices, NOT the amount typed. The two part
   * company whenever the plan cannot spend everything: a leg with no mint or no
   * price is dropped, a prediction leg is floored to its venue minimum and the
   * others rebalanced down, and each slice is rounded to whole USDC units. So
   * $5 across five legs deploys $4.98, and the gap is the point — it is the
   * difference between what the user typed and what the basket will hold.
   *
   * An estimate either way: cached marks, so no spread and no route impact.
   * Real terms replace it on the first tap (see basketValueUsd).
   */
  const plannedSpendUsd = useMemo(() => {
    if (isPerp || !sandwich) return null;
    const legs = buyPlan?.executableLegs ?? [];
    if (legs.length === 0) return null;
    const total = legs.reduce((sum, planned) => sum + Number(planned.inputAmount) / 1_000_000, 0);
    return total > 0 ? total : null;
  }, [buyPlan, isPerp, sandwich]);

  /**
   * Start the build while the finger is still down.
   *
   * Only for the first tap of a spot buy: past that the run is already built and
   * the second tap goes straight to the wallet. Guarded on everything
   * `buySandwich` would refuse anyway, so touch-down never starts a build the
   * tap would then reject — and never for perps, which warm through Phoenix.
   */
  const warmSpotBuy = () => {
    if (
      isPerp ||
      demoBuys ||
      buying ||
      needsCash ||
      belowMin ||
      availabilityPending ||
      quoteBlocksBuy ||
      !sandwich ||
      !walletAddress
    ) return;
    const legs = buyPlan?.executableLegs ?? [];
    if (legs.length === 0 || !legs.every((leg) => leg.kind === "swap")) return;
    const current = warmedBuyRef.current;
    if (current?.amount === buyAmount && Date.now() - current.at < SPOT_PREBUILD_TTL_MS) return;

    const started = startSandwichBasketBuy(sandwich.id, Number(buyAmount));
    // The tap re-attaches the real handler; this only stops an early rejection
    // from surfacing as an unhandled promise before then.
    started.catch(() => {});
    warmedBuyRef.current = { amount: buyAmount, at: Date.now(), started };
  };

  /**
   * Pre-build the basket once the amount has settled, so the tap is only the
   * signature. Touch-down alone started the build ~100ms early; the build is
   * ~1.5s, so nearly all of it still sat between the tap and the wallet.
   *
   * Jupiter budget — the bucket is shared by every user, so this is the part
   * that has to be right:
   *  - it starts on its own short settle, alongside (just ahead of) the live
   *    preview, and is abandoned or skipped once that preview refuses a leg
   *    for this amount. Only Ondo baskets still wait for the preview: their
   *    legs are session-bound RFQ and are refused often enough that building
   *    before the answer would mostly be waste;
   *  - one build per settled amount, never refreshed on a timer. A build the
   *    tap uses costs nothing extra (the tap would have paid it anyway); one
   *    the user walks away from costs a single request per leg, which is half
   *    of one preview;
   *  - the server declines it outright (`busy`) when the pacer is already
   *    queueing, so it can only ever use spare capacity.
   */
  const spotPrebuildReady =
    !isPerp &&
    !demoBuys &&
    buyInputsValid &&
    !needsCash &&
    !quoteBlocksBuy &&
    !availabilityPending &&
    !quotedUnavailable &&
    // A preview that already failed for THIS amount means its build would too.
    !(livePreview.ready && livePreview.error) &&
    (!hasOndoLeg || livePreview.ready) &&
    (buyPlan?.executableLegs ?? []).length > 0 &&
    (buyPlan?.executableLegs ?? []).every((leg) => leg.kind === "swap");

  useEffect(() => {
    if (!spotPrebuildReady || !sandwich || !prebuildArmedRef.current) return;
    const current = warmedBuyRef.current;
    if (current?.amount === buyAmount && Date.now() - current.at < SPOT_PREBUILD_TTL_MS) return;

    const sandwichId = sandwich.id;
    const amount = buyAmount;
    const timer = setTimeout(() => {
      if (!prebuildArmedRef.current) return;
      prebuildArmedRef.current = false;
      const started = startSandwichBasketBuy(sandwichId, Number(amount), undefined, {
        speculative: true,
      }).then(
        (result) => (result.status === "needs_signature" ? result : null),
        () => null,
      );
      warmedBuyRef.current = { amount, at: Date.now(), started };
      // An Ondo basket only gets here once its preview resolved, which already
      // means the amount sat through the preview's debounce — waiting again
      // would just put the settle back in front of the tap.
    }, hasOndoLeg ? 0 : SPOT_PREBUILD_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [buyAmount, hasOndoLeg, sandwich, spotPrebuildReady]);

  /**
   * What the whole basket is worth once bought: every leg's quoted quantity
   * valued at that leg's market price.
   *
   * Deliberately not the amount typed. The two differ by the spread and fees,
   * and that difference is the only thing this line can tell the user that the
   * amount above doesn't already — which is also why it cannot be derived from
   * the cached price: `spend / price × price` is the amount typed, so a
   * price-derived version of this line would say nothing at all.
   *
   * Available while typing now that `quotedLegQuantity` falls back to the live
   * venue preview; before that it existed only after the first tap. It still
   * reports null until at least one leg has REAL quoted terms, so the line
   * never shows a cached-price figure dressed up as a quote.
   *
   * The quantity and the price must share a BASIS — see `basketQuotedValueUsd`,
   * which owns that rule and the arithmetic with it.
   */
  const basketValueUsd =
    isPerp || !sandwich
      ? null
      : basketQuotedValueUsd(sandwich.legs, buyPlan?.executableLegs ?? [], quotedLegQuantity);

  /**
   * What the buy gets you: the assets, and what they are worth.
   *
   * Renders only once there is something to say — an amount typed AND its legs
   * quoted. Before that the pad shows nothing here rather than a card
   * scaffolding a "$0.00" nobody asked for, and there is no panel chrome around
   * it: the amount above is the subject, this is a caption under it.
   */
  const previewValueUsd = basketValueUsd ?? plannedSpendUsd;

  /**
   * The essential terms, for the footer's drop-up panel.
   *
   * Five rows, capped deliberately: this is the summary a buyer checks before
   * committing, not a per-leg blotter. Per-leg numbers stay in the slippage
   * card, which already renders them.
   *
   * Every row is omitted rather than zero-filled when its input is missing, so
   * the panel never asserts a term the venue did not actually quote.
   */
  const buyDetailRows = useMemo((): TradeDetailRow[] => {
    if (isPerp) return [];
    const rows: TradeDetailRow[] = [];
    if (previewValueUsd !== null) {
      rows.push({
        // Named for what it is: a quote when the venues answered, an estimate
        // from cached marks while the first one is still in flight.
        label: basketValueUsd !== null ? "Est. value" : "Est. value (indicative)",
        value: `≈ $${previewValueUsd.toFixed(2)}`,
      });
    }
    const worst = livePreviewSlippage?.worstCaseSlippagePct ?? null;
    if (worst !== null) {
      rows.push({
        label: "Max slippage",
        value: `${worst.toFixed(2)}%`,
        // Past a couple of percent the band is worth a second look before
        // tapping, which is the whole reason this panel exists.
        tone: worst >= 2 ? "warn" : "default",
      });
    }
    const impact = livePreviewSlippage?.maxPriceImpactPct ?? null;
    if (impact !== null) {
      rows.push({
        label: "Price impact",
        value: `${impact.toFixed(2)}%`,
        tone: impact >= 1 ? "warn" : "default",
      });
    }
    return rows;
  }, [basketValueUsd, isPerp, livePreviewSlippage, previewValueUsd]);

  return {
    /** Typed amount — USDC for spot, margin for a perp entry. */
    buyAmount,
    buying,
    /** Wallet/status/skip line shown next to the confirm control. */
    sheetMessage,
    /** Prediction-leg $5-floor note, when one applies. */
    predictionNote,
    canBuy,
    needsCash,
    belowMin,
    minBuyDisplay,
    detailRows: buyDetailRows,
    /** Pre-gesture venue refusal, revealed from the warning control on the pad. */
    tradeNotice,
    /** Holds an Ondo slider for the live maker/session answer, usually <1s. */
    availabilityPending,
    isPerp,
    perpSide,
    perpRisk,
    leverage,
    changeLeverage,
    tapKey,
    tapPreset,
    setAmount: setAmountAndReset,
    buySandwich,
    /** Touch-down warm-up, so the tap itself is only sign + send. */
    warmBuy: isPerp ? warmPerpQuote : warmSpotBuy,
    onRequestAddCash,
  };
}
