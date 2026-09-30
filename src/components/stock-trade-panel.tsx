import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  createAtomicBuyTransaction,
  createAtomicSellTransaction,
  createJupiterOrder,
  executeJupiterOrder,
  getJupiterQuote,
  getOnchainTokenBalance,
  isLandedTxStatus,
} from '@/lib/api';
import { signAndSendBase64WithResult } from '@/lib/cash';
import {
  SOLANA_USDC_MINT,
  fromSmallestUnits,
  hasValidMint,
  isPositiveSmallestUnitAmount,
  isValidDisplayAmount,
  toSmallestUnits,
} from '@/lib/trading';
import { useToast } from '@/lib/toast-store';
import { useWalletStore } from '@/lib/wallet-store';
import { useCash } from '@/hooks/use-cash';

type TradeSide = 'buy' | 'sell';

type StockTradePanelProps = {
  stockMint: string | null;
  stockSymbol: string;
  stockDecimals: number;
};

function formatAmount(value: number | null, symbol: string): string {
  if (value === null) {
    return 'N/A';
  }

  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)} ${symbol}`;
}

const NO_ROUTE_MESSAGE =
  "This token can't be traded right now — no swap route available.";

// ── Speculative atomic-buy pre-build ────────────────────────────────────────
// The atomic-buy `/build` is the slowest leg of a buy (Jupiter HTTP build + RPC
// + a server-side simulate), and it sits *before* the user's signature on the
// critical path. We hide that latency by building it speculatively once the
// amount settles, so the tap collapses to just sign + send.
//
// This MUST stay neutral on Jupiter's shared 60s rate-limit bucket, which is
// reserved for trade execution (see the Jupiter-bucket note). The guards that
// keep it neutral:
//   - PREBUILD_DEBOUNCE_MS: never build while the user is actively typing.
//   - dedupe by exact amount key (below) + TTL: one build per settled amount,
//     so an actual buy still costs exactly ONE /build — the tap reuses the
//     pre-built tx and never calls /build again.
//   - the in-flight promise is reused by the tap, so a tap mid-build never
//     starts a second build.
// Net: pre-building does not add a /build to the common type→buy path; it only
// moves the existing one earlier. The only extra bucket cost is typed-but-
// abandoned amounts, which the debounce + dedupe bound.
// Pre-build the moment the amount settles (debounced). This builds for users
// who type but never buy, so it only pays off on a plan with rate-limit
// headroom. On Jupiter's Free tier the limit is ~1 req/s shared PER ACCOUNT
// across the whole userbase, so a speculative build for a non-buyer can 429 a
// real buyer in the same second — net-harmful. Keep this OFF until we're on a
// Developer+ plan (10 RPS), then flip it on. The intent-proven onPressIn
// pre-build below stays on regardless (it only builds for actual buyers).
const PREBUILD_ON_SETTLE = false;
// Sells get settle-prebuild even though buys don't. The buy gate is off because
// buys are low-intent — people type buy amounts while browsing and never buy, so
// a speculative /build for them can 429 a real trader on the shared ~1 RPS
// bucket. A sell is the opposite: the user already HOLDS this position and has
// opened its sell panel and typed an amount — they're about to sell. Building the
// moment that amount settles takes the ~2s Jupiter build fully off the tap, so
// the sell collapses to sign + send. The same debounce + amount-key dedup + TTL
// guards bound the bucket cost to one build per settled amount.
const PREBUILD_SELL_ON_SETTLE = true;
const PREBUILD_DEBOUNCE_MS = 700;
// A built tx carries a fixed recentBlockhash (~60s of validity). Discard a
// cached build older than this so we never sign a near-expired blockhash; the
// tap then rebuilds inline. Worst-case age at send ≈ build(~2s) + this + sign
// ≈ ~25s, comfortably inside the blockhash window.
const PREBUILD_TTL_MS = 20_000;

type AtomicBuyBuildResult = Awaited<ReturnType<typeof createAtomicBuyTransaction>>;

type PrebuiltAtomicBuy = {
  key: string;
  builtAt: number;
  promise: Promise<AtomicBuyBuildResult>;
};

// Identity of an atomic-buy build. Two builds with the same key are
// interchangeable, so the cache dedupes on it and the tap reuses a match.
function atomicBuyKey(taker: string, outputMint: string, amountInUsdc: string): string {
  return `${taker}:${outputMint}:${amountInUsdc}`;
}

type AtomicSellBuildResult = Awaited<ReturnType<typeof createAtomicSellTransaction>>;

// A pre-built sell carries the clamped on-chain amount it was built for (and the
// raw `held` balance) alongside the build, so onExecute can sign+send without
// re-running the balance clamp or rebuilding. See clampSellSmallestAmount.
type PrebuiltAtomicSell = {
  key: string;
  builtAt: number;
  promise: Promise<{ build: AtomicSellBuildResult; smallest: string; held: bigint | null }>;
};

// Identity of an atomic-sell pre-build. Keyed on the *typed* amount (what the
// user entered) — NOT the clamped amount — so the tap reliably reuses the build
// the touch-down kicked off, even for "sell all" where the clamp shaves a few
// raw units off the displayed balance.
function atomicSellKey(taker: string, inputMint: string, amount: string): string {
  return `${taker}:${inputMint}:${amount}`;
}

// Clamp a sell amount to the wallet's *exact* on-chain balance. The displayed
// balance comes from a float-based indexer and can sit a few raw units above
// what's actually transferable (these xStocks are Token-2022), so selling the
// shown amount overshoots and Jupiter rejects with "Insufficient funds". We also
// re-derive the amount using the token's real on-chain decimals — the cached
// prop defaults to 6 when token detail is missing decimals, which would send a
// mis-scaled amount. Retries the lookup a couple of times; on a genuine failure
// (held === null) the caller proceeds unclamped. `held === 0n` means nothing to
// sell. Read-only (Helius, not Jupiter's bucket), so safe to run on touch-down.
async function clampSellSmallestAmount(
  taker: string,
  inputMint: string,
  displayAmount: string,
  requestedSmallest: string,
  declaredDecimals: number,
): Promise<{ smallest: string; held: bigint | null }> {
  let held: bigint | null = null;
  let onchainDecimals: number | null = null;
  for (let attempt = 0; attempt < 3 && held === null; attempt += 1) {
    try {
      const { amount: onchainRaw, decimals } = await getOnchainTokenBalance(taker, inputMint);
      held = BigInt(onchainRaw);
      onchainDecimals = decimals;
    } catch {
      // transient — retry a couple of times before giving up on the clamp
    }
  }

  let smallest = requestedSmallest;
  if (held !== null && held > 0n) {
    if (onchainDecimals !== null && onchainDecimals !== declaredDecimals) {
      const corrected = toSmallestUnits(displayAmount, onchainDecimals);
      if (corrected && isPositiveSmallestUnitAmount(corrected)) {
        smallest = corrected;
      }
    }
    if (BigInt(smallest) > held) {
      smallest = held.toString();
    }
  }
  return { smallest, held };
}

// Jupiter returns these when a token can be priced but not swapped for a taker
// (e.g. NVDAx and some other restricted xStocks / Ondo / pre-stock mints).
function isNoRouteError(error: unknown): boolean {
  const message =
    error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : '';
  return /failed to get quotes|could not find any route|no routes? found/i.test(message);
}

function getErrorMessage(error: unknown): string {
  if (isNoRouteError(error)) {
    return NO_ROUTE_MESSAGE;
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return 'Trade request failed. Please try again.';
}

function deserializeJupiterTransaction(base64Transaction: string): Transaction | VersionedTransaction {
  const bytes = Buffer.from(base64Transaction, 'base64');

  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

function serializeSignedTransaction(transaction: Transaction | VersionedTransaction): Uint8Array {
  if (transaction instanceof VersionedTransaction) {
    return transaction.serialize();
  }

  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
}

export function StockTradePanel({ stockMint, stockSymbol, stockDecimals }: StockTradePanelProps) {
  const solanaWallet = useEmbeddedSolanaWallet();
  const toast = useToast();
  const walletStore = useWalletStore();
  const cash = useCash();
  const [side, setSide] = useState<TradeSide>('buy');
  const [amount, setAmount] = useState('');
  const [quoteOutAmount, setQuoteOutAmount] = useState<string | null>(null);
  const [tradeMessage, setTradeMessage] = useState<string | null>(null);
  // null = unknown, true = swap can be built, false = priced but not swappable.
  const [tradeable, setTradeable] = useState<boolean | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [trading, setTrading] = useState(false);
  const [amountFocused, setAmountFocused] = useState(false);
  const quoteRequestIdRef = useRef(0);
  // Holds the most recent speculative atomic-buy build (or in-flight promise).
  // Consumed by onExecute when the key still matches and it's fresh.
  const prebuiltBuyRef = useRef<PrebuiltAtomicBuy | null>(null);
  // Same, for the speculative atomic-sell build.
  const prebuiltSellRef = useRef<PrebuiltAtomicSell | null>(null);
  // True while an optimistic sell is still settling on-chain in the background.
  // Blocks a second sell from spending the same tokens before the first lands
  // (the on-chain balance still reads the full holding until confirmation).
  const sellSettlingRef = useRef(false);
  const amountAccessoryId = 'stock-trade-amount-keyboard';

  const wallet = solanaWallet.wallets?.[0] ?? null;
  const walletAddress = wallet?.address ?? null;

  const inputMint = side === 'buy' ? SOLANA_USDC_MINT : stockMint;
  const outputMint = side === 'buy' ? stockMint : SOLANA_USDC_MINT;
  const inputDecimals = side === 'buy' ? 6 : stockDecimals;
  const outputDecimals = side === 'buy' ? stockDecimals : 6;

  const canTrade =
    !!walletAddress &&
    hasValidMint(inputMint) &&
    hasValidMint(outputMint) &&
    isValidDisplayAmount(amount) &&
    tradeable !== false &&
    !trading;

  const quoteDisplay = useMemo(() => {
    if (!quoteOutAmount) {
      return 'No quote yet';
    }

    const parsed = fromSmallestUnits(quoteOutAmount, outputDecimals);
    return formatAmount(parsed, side === 'buy' ? stockSymbol : 'USDC');
  }, [outputDecimals, quoteOutAmount, side, stockSymbol]);

  /**
   * The price this quote actually fills at, per share.
   *
   * A token amount alone hides the thing that matters: 4 USDC buying
   * 0.00534 AMD looks unremarkable until you divide and get $749/share against
   * a real $464. Showing the unit price makes a broken market obvious to a
   * human at a glance, which is the last line of defence behind the server-side
   * execution guard.
   */
  const fillPriceDisplay = useMemo(() => {
    if (!quoteOutAmount || !isValidDisplayAmount(amount)) return null;

    const out = Number(fromSmallestUnits(quoteOutAmount, outputDecimals));
    const typed = Number(amount);
    if (!Number.isFinite(out) || out <= 0 || !Number.isFinite(typed) || typed <= 0) return null;

    // Buy: USD in ÷ shares out. Sell: USD out ÷ shares in.
    const pricePerShare = side === 'buy' ? typed / out : out / typed;
    if (!Number.isFinite(pricePerShare) || pricePerShare <= 0) return null;

    return `≈ $${pricePerShare.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: pricePerShare < 1 ? 6 : 2,
    })} / ${stockSymbol}`;
  }, [amount, outputDecimals, quoteOutAmount, side, stockSymbol]);

  // Start (or refresh) the speculative atomic-buy build for the current amount.
  // Dedupes on the exact amount key + TTL so it's at most one /build per settled
  // amount, and reuses an in-flight build. Returns silently when the inputs
  // aren't a valid buy. Called from onPressIn (intent-proven, always safe) and —
  // when PREBUILD_ON_SETTLE is enabled — from the debounced settle effect.
  function prebuildAtomicBuy(): void {
    if (side !== 'buy' || trading) return;
    if (!walletAddress || !hasValidMint(outputMint)) return;
    // tradeable === false means a prior attempt found no route; don't burn a
    // build retrying it.
    if (tradeable === false) return;

    const smallest = toSmallestUnits(amount, inputDecimals);
    if (!smallest || !isPositiveSmallestUnitAmount(smallest)) return;

    const key = atomicBuyKey(walletAddress, outputMint, smallest);
    const existing = prebuiltBuyRef.current;
    if (existing && existing.key === key && Date.now() - existing.builtAt < PREBUILD_TTL_MS) {
      return;
    }

    const startedAt = Date.now();
    prebuiltBuyRef.current = {
      key,
      builtAt: startedAt,
      promise: createAtomicBuyTransaction({
        taker: walletAddress,
        outputMint,
        amountInUsdc: smallest,
      })
        .then((result) => {
          console.log('[atomic-buy] prebuilt', {
            ms: Date.now() - startedAt,
            fallback: result.fallback,
          });
          return result;
        })
        // createAtomicBuyTransaction already swallows errors into a fallback,
        // but guard anyway so a rejected promise can never poison the cache.
        .catch(() => ({ transaction: null, fallback: true as const })),
    };
  }

  // Speculative atomic-sell pre-build, mirroring prebuildAtomicBuy. On touch-down
  // it clamps the typed amount to the wallet's real on-chain balance AND builds
  // the single-tx sell for that clamped amount — so by release the tap collapses
  // to sign + send (the balance round-trip and the ~2s Jupiter build both happen
  // during the press instead of serially after it). Keyed on the *typed* amount
  // so onExecute reuses it even for "sell all", where the clamp shaves a few raw
  // units off the displayed balance. Intent-proven: only fires from onPressIn of
  // a real sell tap.
  function prebuildAtomicSell(): void {
    if (side !== 'sell' || trading) return;
    if (!walletAddress || !hasValidMint(inputMint)) return;
    // A prior attempt found no route — don't burn a build retrying it.
    if (tradeable === false) return;

    const requested = toSmallestUnits(amount, inputDecimals);
    if (!requested || !isPositiveSmallestUnitAmount(requested)) return;

    const key = atomicSellKey(walletAddress, inputMint, requested);
    const existing = prebuiltSellRef.current;
    if (existing && existing.key === key && Date.now() - existing.builtAt < PREBUILD_TTL_MS) {
      return;
    }

    const startedAt = Date.now();
    const taker = walletAddress;
    const mint = inputMint;
    const displayAmount = amount;
    const declaredDecimals = inputDecimals;
    prebuiltSellRef.current = {
      key,
      builtAt: startedAt,
      promise: (async () => {
        const { smallest, held } = await clampSellSmallestAmount(
          taker,
          mint,
          displayAmount,
          requested,
          declaredDecimals,
        );
        // Nothing transferable — skip the build; onExecute surfaces the error.
        if (held !== null && held <= 0n) {
          return { build: { transaction: null, fallback: true as const }, smallest, held };
        }
        const build = await createAtomicSellTransaction({ taker, inputMint: mint, amount: smallest })
          .then((result) => {
            console.log('[atomic-sell] prebuilt', {
              ms: Date.now() - startedAt,
              fallback: result.fallback,
            });
            return result;
          })
          // createAtomicSellTransaction swallows errors into a fallback, but guard
          // anyway so a rejected promise can never poison the cache.
          .catch(() => ({ transaction: null, fallback: true as const }));
        return { build, smallest, held };
      })(),
    };
  }

  // Debounced settle-trigger pre-build. Gated OFF on the Free tier (see
  // PREBUILD_ON_SETTLE) because it builds for non-buyers and would contend with
  // real trades on the shared ~1 RPS bucket.
  useEffect(() => {
    if (!PREBUILD_ON_SETTLE) return;
    if (side !== 'buy' || trading) return;
    if (!walletAddress || !hasValidMint(outputMint) || tradeable === false) return;
    const smallest = toSmallestUnits(amount, inputDecimals);
    if (!smallest || !isPositiveSmallestUnitAmount(smallest)) return;

    const timer = setTimeout(prebuildAtomicBuy, PREBUILD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, trading, walletAddress, outputMint, amount, inputDecimals, tradeable]);

  // Debounced settle-trigger pre-build for SELLS — clamps + builds the moment the
  // amount settles so the tap is pure sign + send. ON by default (see
  // PREBUILD_SELL_ON_SETTLE): sells are high-intent and dedup bounds the cost.
  useEffect(() => {
    if (!PREBUILD_SELL_ON_SETTLE) return;
    if (side !== 'sell' || trading) return;
    if (!walletAddress || !hasValidMint(inputMint) || tradeable === false) return;
    const smallest = toSmallestUnits(amount, inputDecimals);
    if (!smallest || !isPositiveSmallestUnitAmount(smallest)) return;

    const timer = setTimeout(prebuildAtomicSell, PREBUILD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, trading, walletAddress, inputMint, amount, inputDecimals, tradeable]);

  async function onQuote(): Promise<void> {
    if (!hasValidMint(inputMint) || !hasValidMint(outputMint)) {
      setTradeMessage('Missing token mint for this trade pair.');
      return;
    }

    const smallestAmount = toSmallestUnits(amount, inputDecimals);

    if (!smallestAmount || !isPositiveSmallestUnitAmount(smallestAmount)) {
      setQuoteOutAmount(null);
      setTradeMessage(`Enter a valid ${side === 'buy' ? 'USDC' : stockSymbol} amount.`);
      return;
    }

    const requestId = ++quoteRequestIdRef.current;
    setQuoting(true);
    setQuoteOutAmount(null);
    setTradeMessage(null);

    try {
      const quote = await getJupiterQuote({
        inputMint,
        outputMint,
        amount: smallestAmount,
        // Build against the wallet so the quote reflects real swap buildability.
        ...(walletAddress ? { taker: walletAddress } : {}),
      });

      if (requestId !== quoteRequestIdRef.current) {
        return;
      }

      if (!isPositiveSmallestUnitAmount(quote.outAmount)) {
        setTradeMessage('No executable quote returned from Jupiter.');
        return;
      }

      setQuoteOutAmount(quote.outAmount);
      setTradeable(true);
    } catch (error) {
      if (requestId !== quoteRequestIdRef.current) {
        return;
      }

      // Priced-but-not-swappable tokens fail here once a taker is set.
      if (isNoRouteError(error)) {
        setTradeable(false);
      }
      setTradeMessage(getErrorMessage(error));
      setQuoteOutAmount(null);
    } finally {
      if (requestId === quoteRequestIdRef.current) {
        setQuoting(false);
      }
    }
  }

  async function onExecute(): Promise<void> {
    if (!walletAddress) {
      setTradeMessage('Connect an embedded Solana wallet before trading.');
      return;
    }

    if (!wallet) {
      setTradeMessage('Embedded Solana wallet is not ready yet.');
      return;
    }

    if (!hasValidMint(inputMint) || !hasValidMint(outputMint)) {
      setTradeMessage('Missing token mint for this trade pair.');
      return;
    }

    const requestedAmount = toSmallestUnits(amount, inputDecimals);

    if (!requestedAmount || !isPositiveSmallestUnitAmount(requestedAmount)) {
      setTradeMessage(`Enter a valid ${side === 'buy' ? 'USDC' : stockSymbol} amount.`);
      return;
    }

    // A prior optimistic sell is still landing on-chain. Ignore the re-tap so we
    // don't sign a second tx against tokens the first one is already spending.
    if (side === 'sell' && sellSettlingRef.current) {
      return;
    }

    // Effective amount sent to Jupiter; for sells it gets clamped to the real
    // on-chain balance below.
    let smallestAmount = requestedAmount;

    // Trades run silent: the button's own spinner carries the progress, and a
    // fill announces nothing. Only a failure is worth a toast.
    setTrading(true);
    setTradeMessage(null);

    try {
      // Optimistically deduct the buy amount from the cash balance
      const buyAmountNum = Number(amount);
      if (side === 'buy' && buyAmountNum > 0) {
        const idleDeduction = Math.min(cash.idleUsdc, buyAmountNum);
        if (idleDeduction > 0) {
          walletStore.optimisticAdjust(SOLANA_USDC_MINT, -idleDeduction, -idleDeduction);
        }
      }
      // For a sell, take the fast ATOMIC path: a single gasless Router swap
      // (token → USDC) submitted through /api/solana/send, mirroring the atomic
      // buy and spot sell — the token is already liquid, so it's
      // one signature, one confirmation, and the USDC proceeds land straight in
      // the wallet as spendable cash.
      //
      // Both the on-chain balance clamp AND the build are reused from the
      // touch-down pre-build (prebuildAtomicSell) when it's fresh, so the tap
      // collapses to sign + send — the clamp round-trip and the ~2s Jupiter build
      // already happened during the press instead of serially after it. Only a
      // cold tap (no/stale pre-build) does the clamp + build inline here.
      //
      // The clamp caps the amount to the wallet's exact on-chain balance (these
      // xStocks are Token-2022 and the displayed balance can overshoot what's
      // transferable). No separate routability quote: the builder simulates the
      // swap and so doubles as the routability gate; on its fallback,
      // createJupiterOrder throws for unroutable tokens. Nothing irreversible
      // happens before that, so dropping the extra quote saves a Jupiter
      // round-trip on the shared rate-limit bucket.
      if (side === 'sell' && inputMint) {
        const buildT0 = Date.now();
        const cached = prebuiltSellRef.current;
        const cacheKey = atomicSellKey(walletAddress, inputMint, requestedAmount);
        const usedPrebuild =
          cached !== null &&
          cached.key === cacheKey &&
          Date.now() - cached.builtAt < PREBUILD_TTL_MS;

        let atomic: AtomicSellBuildResult;
        let held: bigint | null;
        if (usedPrebuild) {
          const pre = await cached!.promise;
          smallestAmount = pre.smallest;
          held = pre.held;
          atomic = pre.build;
        } else {
          const clamp = await clampSellSmallestAmount(
            walletAddress,
            inputMint,
            amount,
            requestedAmount,
            inputDecimals,
          );
          smallestAmount = clamp.smallest;
          held = clamp.held;
          atomic =
            held !== null && held <= 0n
              ? { transaction: null, fallback: true }
              : await createAtomicSellTransaction({
                  taker: walletAddress,
                  inputMint,
                  amount: smallestAmount,
                });
        }
        // A pre-built tx's blockhash is single-use; consume it either way so a
        // retry rebuilds fresh rather than reusing a spent one.
        prebuiltSellRef.current = null;

        if (atomic.rejected) {
          // Metis's price was refused. Fall through to order/execute, which
          // also reaches Ultra's RFQ makers and runs the same guard — it
          // answers 422 if that venue is bad too, and that throw is terminal.
          console.log('[atomic-sell] price rejected, trying order/execute', {
            reason: atomic.rejectionReason,
          });
        }

        if (held !== null && held <= 0n) {
          throw new Error(`You don't hold any ${stockSymbol} to sell.`);
        }
        // The clamp changed the amount — invalidate any stale routability flag.
        if (held !== null && BigInt(smallestAmount) !== BigInt(requestedAmount)) {
          setTradeable(null);
        }

        console.log('[atomic-sell] build acquired', {
          ms: Date.now() - buildT0,
          fromPrebuild: usedPrebuild,
          fallback: atomic.fallback,
        });
        if (!atomic.fallback && atomic.transaction) {
          const txB64 = atomic.transaction;
          const soldQtyUi = Number(amount);
          const soldUsd = quoteOutAmount
            ? Number(fromSmallestUnits(quoteOutAmount, outputDecimals))
            : 0;
          const canOptimize = Number.isFinite(soldQtyUi) && soldQtyUi > 0;
          sellSettlingRef.current = true;
          const sendT0 = Date.now();
          // Reflect the sale in the holdings the instant we commit to sending —
          // before the confirm round-trip — so the balance updates on tap rather
          // than ~0.4–1.2s later (mirrors the buy's up-front deduction). The
          // embedded wallet signs programmatically (no user-rejection step), and
          // walletStore.refresh() below reconciles against on-chain state, so a
          // rare failed send self-heals.
          if (canOptimize) {
            walletStore.optimisticAdjust(inputMint, -soldQtyUi, -soldUsd);
          }
          try {
            // Skip re-simulation (the builder already simulated) and use the
            // short fast-confirm window. If Solana only gives us a submitted
            // signature, we acknowledge it as submitted, not as a completed sale.
            const sendResult = await signAndSendBase64WithResult(wallet, txB64, {
              skipSimulation: true,
              fastConfirm: true,
            });
            console.log('[atomic-sell] sign+send', {
              ms: Date.now() - sendT0,
              status: sendResult.status,
            });
            setTradeMessage(null);
            // Silent on a landed sell; a tx that is only submitted still gets a
            // word, because the sale is not a fact yet.
            if (!isLandedTxStatus(sendResult.status)) {
              toast.showToast('Sale submitted', 'info');
            }
          } finally {
            sellSettlingRef.current = false;
          }
          void walletStore.refresh();
          // Proceeds stay liquid in the wallet as spendable cash (Earn is
          // retired — nothing gets swept into a vault anymore).
          return;
        }
        // Fallback: drop through to the order/execute flow below.
      }

      // 1. For a buy, try the ATOMIC path first: unwind any USDC shortfall
      //    swap USDC → the token, in ONE transaction (one signature, one
      //    swap, in ONE transaction (one signature, one
      //    confirmation). The backend builds AND simulates this tx, so the build
      //    itself is the routability gate — no separate pre-quote needed on the
      //    common path. It returns { fallback: true } for RFQ-only tokens (no
      //    Metis route) or when the composed tx is too large, in which case we
      //    drop to the two-tx flow below. The atomic tx lands via
      //    /api/solana/send (signAndSendBase64); since the builder already
      //    simulated it, we pass skipSimulation to skip the redundant
      //    re-simulation on the critical path. The send co-signs the gasless
      //    payer and polls confirmation, so no /execute round-trip is needed.
      if (side === 'buy') {
        // Prefer the speculative pre-build when it matches this exact amount and
        // is still fresh (blockhash not near expiry) — that's the latency win,
        // and it means this buy reused the single /build the pre-build already
        // spent rather than issuing a new one. Otherwise build inline now.
        const buildT0 = Date.now();
        const cached = prebuiltBuyRef.current;
        const cacheKey = atomicBuyKey(walletAddress, outputMint, smallestAmount);
        const usedPrebuild =
          cached !== null &&
          cached.key === cacheKey &&
          Date.now() - cached.builtAt < PREBUILD_TTL_MS;
        const atomic = usedPrebuild
          ? await cached!.promise
          : await createAtomicBuyTransaction({
              taker: walletAddress,
              outputMint,
              amountInUsdc: smallestAmount,
            });
        // Consume it either way: a pre-built tx's blockhash is single-use, and a
        // retry should rebuild fresh rather than reuse a spent one.
        prebuiltBuyRef.current = null;
        console.log('[atomic-buy] build acquired', {
          ms: Date.now() - buildT0,
          fromPrebuild: usedPrebuild,
          fallback: atomic.fallback,
        });
        if (atomic.rejected) {
          // See the sell branch: a venue verdict, not a token verdict.
          console.log('[atomic-buy] price rejected, trying order/execute', {
            reason: atomic.rejectionReason,
          });
        } else if (!atomic.fallback && atomic.transaction) {
          // Atomic buy lands via the same fast path as the atomic sell: skip the
          // redundant re-simulation (the builder already simulated), accept
          // "processed" (~1 slot), and cap the synchronous confirm window at
          // ~1.2s — treating a still-pending tx as submitted rather than blocking
          // the tap on the ~5s "confirmed" wait. Safe because the optimistic
          // balance deduction above + walletStore.refresh() below reconcile final
          // state regardless (and a real on-chain error within the window still
          // surfaces as a throw). This is the same trade-off the sell path makes.
          const sendT0 = Date.now();
          const sendResult = await signAndSendBase64WithResult(wallet, atomic.transaction, {
            skipSimulation: true,
            fastConfirm: true,
          });
          console.log('[atomic-buy] sign+send', {
            ms: Date.now() - sendT0,
            status: sendResult.status,
          });
          setTradeMessage(null);
          // As above: nothing on a landed buy, a word when it is still pending.
          if (!isLandedTxStatus(sendResult.status)) {
            toast.showToast('Buy submitted', 'info');
          }
          // Reconcile the optimistic deduction + show the new position against
          // on-chain state once it lands.
          void walletStore.refresh();
          return;
        }
        // Fallback two-tx flow. Confirm the swap is routable before building the
        // order (the quote builds without requiring balance, so it cleanly flags
        // unroutable tokens by throwing here). The buy spends the wallet's liquid
        // USDC directly.
        if (tradeable !== true) {
          await getJupiterQuote({
            inputMint,
            outputMint,
            amount: smallestAmount,
            ...(walletAddress ? { taker: walletAddress } : {}),
          });
          setTradeable(true);
        }
      }

      // 2. Build the order now that the taker holds the input token. For sells
      //    we exclude the JupiterZ RFQ router: its quotes carry a short expiry
      //    and routinely lapse while the user approves the tx in their wallet,
      //    which surfaces as an opaque "Internal error" at /execute. Excluding
      //    it forces the Metis aggregator, whose standard on-chain tx has far
      //    longer blockhash validity and lands through Jupiter's managed retry.
      //
      //    On the fallback buy path the order builds against the wallet's liquid USDC a moment
      //    ago; Jupiter's own node usually indexes it within a slot, but retry
      //    briefly on an insufficient-balance error to cover the rare lag.
      let order;
      let orderAttempts = 0;
      for (;;) {
        try {
          order = await createJupiterOrder({
            inputMint,
            outputMint,
            amount: smallestAmount,
            taker: walletAddress,
            ...(side === 'sell' ? { excludeRouters: 'jupiterz' } : {}),
          });
          break;
        } catch (err) {
          const msg = getErrorMessage(err).toLowerCase();
          if (
            side === 'buy' &&
            orderAttempts < 2 &&
            /insufficient|balance|not enough/.test(msg)
          ) {
            orderAttempts += 1;
            await new Promise((resolve) => setTimeout(resolve, 900));
            continue;
          }
          throw err;
        }
      }

      const provider = await wallet.getProvider();
      const unsignedTransaction = deserializeJupiterTransaction(order.transaction);
      const signedPayload = await provider.request({
        method: 'signTransaction',
        params: {
          transaction: unsignedTransaction,
        },
      });
      const signedBytes = serializeSignedTransaction(signedPayload.signedTransaction);
      const signedTransaction = Buffer.from(signedBytes).toString('base64');

      const execution = await executeJupiterOrder({
        signedTransaction,
        requestId: order.requestId,
        engine: order.engine,
        ...(order.lastValidBlockHeight ? { lastValidBlockHeight: order.lastValidBlockHeight } : {}),
      });

      // Ultra reports failures via status "Failed" and/or an error message.
      const failed =
        !!execution.errorMessage ||
        (execution.status != null && /fail/i.test(execution.status)) ||
        (!execution.signature && !execution.txid);
      if (failed) {
        toast.showToast(execution.errorMessage ?? 'Swap failed to land. Please try again.', 'error');
        void walletStore.refresh();
        return;
      }

      // 3. On a sell, the USDC proceeds land liquid in the wallet and simply
      //    stay there as spendable cash.
      if (side === 'sell') {
        setTradeMessage(null);
        // Reflect the closed position immediately so a back-to-back sell reads a
        // correct on-chain balance and the UI doesn't show a stale holding.
        void walletStore.refresh();
        return;
      }

      setTradeMessage(null);
    } catch (error) {
      if (isNoRouteError(error)) {
        setTradeable(false);
      }
      const message = getErrorMessage(error);
      setTradeMessage(message);
      toast.showToast(message, 'error');
      void walletStore.refresh();
    } finally {
      setTrading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>USDC Trade</Text>

      <View style={styles.sideRow}>
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            setSide('buy');
            setQuoteOutAmount(null);
            setTradeMessage(null);
            setTradeable(null);
          }}
          style={[styles.sideButton, side === 'buy' && styles.sideButtonActive]}>
          <Text style={[styles.sideButtonText, side === 'buy' && styles.sideButtonTextActive]}>Buy</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            setSide('sell');
            setQuoteOutAmount(null);
            setTradeMessage(null);
            setTradeable(null);
          }}
          style={[styles.sideButton, side === 'sell' && styles.sideButtonActive]}>
          <Text style={[styles.sideButtonText, side === 'sell' && styles.sideButtonTextActive]}>Sell</Text>
        </Pressable>
      </View>

      <Text style={styles.helperText}>Input token: {side === 'buy' ? 'USDC' : stockSymbol}</Text>
      <BottomSheetTextInput
        value={amount}
        onChangeText={(nextValue) => {
          setAmount(nextValue);
          setQuoteOutAmount(null);
          setTradeMessage(null);
          setTradeable(null);
        }}
        onFocus={() => setAmountFocused(true)}
        onBlur={() => setAmountFocused(false)}
        keyboardType="decimal-pad"
        inputAccessoryViewID={Platform.OS === 'ios' ? amountAccessoryId : undefined}
        placeholder={side === 'buy' ? '0.00 USDC' : `0.00 ${stockSymbol}`}
        returnKeyType="done"
        blurOnSubmit
        onSubmitEditing={Keyboard.dismiss}
        style={styles.amountInput}
      />
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={amountAccessoryId}>
          <View style={styles.keyboardAccessory}>
            <Pressable onPress={Keyboard.dismiss} style={styles.keyboardDoneButton}>
              <Text style={styles.keyboardDoneText}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : amountFocused ? (
        <Pressable onPress={Keyboard.dismiss} style={styles.inlineDoneButton}>
          <Text style={styles.inlineDoneText}>Done</Text>
        </Pressable>
      ) : null}

      <View style={styles.quoteRow}>
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            void onQuote();
          }}
          disabled={quoting || trading}
          style={[styles.secondaryButton, (quoting || trading) && styles.buttonDisabled]}>
          <Text style={styles.secondaryButtonText}>{quoting ? 'Quoting...' : 'Get quote'}</Text>
        </Pressable>
        <View style={styles.quoteValueColumn}>
          <Text style={styles.quoteValue}>{quoteDisplay}</Text>
          {fillPriceDisplay ? (
            <Text style={styles.quoteFillPrice}>{fillPriceDisplay}</Text>
          ) : null}
        </View>
      </View>

      <Pressable
        // Intent-proven head start: kick off the atomic build on touch-down so
        // it's in flight (or done) by the time onPress fires. Only ever runs for
        // a real trade tap, so it's safe even on the shared ~1 RPS bucket — one
        // /build per trade, none for non-traders. Each helper guards its own side.
        onPressIn={() => (side === 'buy' ? prebuildAtomicBuy() : prebuildAtomicSell())}
        onPress={() => {
          Keyboard.dismiss();
          void onExecute();
        }}
        disabled={!canTrade || quoting}
        style={[styles.primaryButton, (!canTrade || quoting) && styles.buttonDisabled]}>
        <Text style={styles.primaryButtonText}>
          {trading
            ? 'Submitting...'
            : tradeable === false
              ? 'Not tradeable'
              : 'Execute trade'}
        </Text>
      </Pressable>
      {tradeMessage ? <Text style={styles.messageText}>{tradeMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 13,
    borderRadius: 16,
    backgroundColor: '#fcfdfe',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#10223d',
  },
  sideRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#eef3f8',
    borderRadius: 999,
    padding: 4,
  },
  sideButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 999,
    paddingVertical: 8,
    backgroundColor: 'transparent',
  },
  sideButtonActive: {
    backgroundColor: '#10223d',
  },
  sideButtonText: {
    color: '#617387',
    fontWeight: '700',
    fontSize: 12,
  },
  sideButtonTextActive: {
    color: '#ffffff',
  },
  helperText: {
    marginTop: 10,
    color: '#6c7d91',
    fontSize: 12,
    fontWeight: '600',
  },
  amountInput: {
    marginTop: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
    fontWeight: '700',
    color: '#10223d',
    backgroundColor: '#ffffff',
  },
  keyboardAccessory: {
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: '#d8e2ee',
    backgroundColor: '#f4f8fb',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  keyboardDoneButton: {
    borderRadius: 999,
    backgroundColor: '#10223d',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  keyboardDoneText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  inlineDoneButton: {
    alignSelf: 'flex-end',
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: '#10223d',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  inlineDoneText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  quoteRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  secondaryButton: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#ffffff',
  },
  secondaryButtonText: {
    color: '#10223d',
    fontSize: 12,
    fontWeight: '700',
  },
  quoteValueColumn: {
    flex: 1,
  },
  quoteValue: {
    color: '#10223d',
    fontSize: 12,
    fontWeight: '700',
  },
  quoteFillPrice: {
    marginTop: 2,
    color: '#5b6b82',
    fontSize: 11,
    fontWeight: '600',
  },
  primaryButton: {
    marginTop: 10,
    backgroundColor: '#10223d',
    borderRadius: 15,
    alignItems: 'center',
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  walletText: {
    marginTop: 10,
    color: '#7a8b9f',
    fontSize: 11,
  },
  messageText: {
    marginTop: 8,
    color: '#10223d',
    fontSize: 12,
    lineHeight: 18,
  },
});
