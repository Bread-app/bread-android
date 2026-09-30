import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Buffer } from 'buffer';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Transaction, VersionedTransaction } from '@solana/web3.js';

import { CTA } from '@/lib/screen-corners';
import { useThemeStore } from '@/lib/theme-store';
import { withAlpha } from '@/lib/color-utils';
import {
  CTA_BUTTON_HEIGHT,
  CTA_LABEL_FONT,
  CTA_LABEL_SIZE,
  CtaGlassFill,
  ctaGlassTint,
  CTA_GLASS_SCALE,
  CTA_SOLID_SCALE,
} from '@/components/side-glass-button';

import {
  createAtomicBuyTransaction,
  createAtomicSellTransaction,
  createJupiterOrder,
  executeJupiterOrder,
  getOnchainTokenBalance,
  getTokenTradeDetail,
  humanizeErrorMessage,
  isLandedTxStatus,
  recordWalletTransaction,
  type JupiterTokenDetail,
} from '@/lib/api';
import {
  signAndSendBase64,
  signAndSendBase64WithResult,
} from '@/lib/cash';
import { useCash } from '@/hooks/use-cash';
import type { TradeDetailRow } from '@/components/trade-amount-sheet';
import { useTradeQuotePreview } from '@/hooks/use-trade-quote-preview';
import {
  nextSellSizingPrice,
  sellBalanceUsd,
  sellSizingPriceFor,
  type SellSizingPrice,
} from '@/lib/sell-sizing';
import { loadCostBasisLedger, recordBuy, recordSell } from '@/lib/cost-basis';
import { useToast } from '@/lib/toast-store';
import {
  SOLANA_USDC_MINT,
  fromSmallestUnits,
  hasValidMint,
  isPositiveSmallestUnitAmount,
  toSolanaTradeMint,
  toSmallestUnits,
} from '@/lib/trading';
import { collectSellCandidateMints, normalizeTicker } from '@/lib/sell-mint';
import { standaloneHolding, useSandwichLegReserve } from '@/lib/standalone-holding';
import { useWalletStore } from '@/lib/wallet-store';
import { PressableScale } from '@/components/pressable-scale';
import { maxBuyAmount } from '@/lib/max-buy';

type StockTradeActionsProps = {
  stockMint: string | null;
  stockSymbol: string;
  onTrade?: (side: 'buy' | 'sell') => void;
  /**
   * Whether the user holds a sellable balance. Passed in from the sheet *body*
   * (which has the wallet store in context) because this panel renders inside
   * gorhom's portal, where `WalletStoreProvider` is out of scope and the store
   * reads back empty. Falls back to the panel's own (portal-context) engine when
   * omitted.
   */
  hasPosition?: boolean;
  /**
   * Opens the add-cash / deposit flow. When provided and the user's cash balance
   * is below the buy threshold, the BUY action is replaced with an "Add cash"
   * button. Omitted by callers with no deposit flow in scope (BUY stays shown).
   */
  onAddCash?: () => void;
  /** Native Glass layers cannot be transformed/clipped with a parent card
   * reliably. Embedded detail surfaces use the solid fallback instead. */
  disableGlass?: boolean;
};

// Heavy Rubik display face for the trade button labels (matches the design).

// On iOS 26 the BUY action renders as a native Liquid Glass pill (no solid
// fill). Older OSes fall back to the solid green gradient.
// Brand green (theme `accent`) used to tint the Liquid Glass BUY pill — full
// opacity so the glass keeps its natural green look without washing out.
const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

function getErrorMessage(error: unknown): string {
  return humanizeErrorMessage(error, 'Trade request failed. Please try again.');
}

// ── Speculative atomic build (buys + sells) ─────────────────────────────────
// The atomic `/build` is the slowest leg of a trade (Jupiter HTTP build + an
// RPC lookup-table fetch + a server-side simulate ≈ 2s) and it sits *before*
// the user's signature on the critical path. We hide that latency by building
// speculatively — on touch-down of the confirm button, and (for sells) as soon
// as the amount settles — so the tap collapses to just sign + send.
//
// This MUST stay neutral on Jupiter's shared 60s rate-limit bucket, which is
// reserved for trade execution (see [[jupiter-bucket-reserved-for-trades]]).
// The guards that keep it neutral:
//   - PREBUILD_DEBOUNCE_MS: never build while the user is actively typing.
//   - dedupe by exact amount key + TTL: one build per settled amount, so an
//     actual trade still costs exactly ONE /build — the tap reuses the
//     pre-built tx and never calls /build again.
//   - the in-flight promise is reused by the tap, so a tap mid-build never
//     starts a second build.
// Net: pre-building doesn't add a /build to the common type→trade path; it only
// moves the existing one earlier.
//
// Buys are pre-built on settle too. This used to be off because the key sat on
// Jupiter's ~1 RPS Free tier, where a speculative build for someone who never
// buys could 429 a real trader. The key is now on a 100-requests/10s plan
// (x-ratelimit headers, 2026-09-15), the backend paces trade traffic ahead of
// background traffic, and a build for a listed stock with a warm reference costs
// ONE Jupiter request. Touch-down alone only saved the ~100ms of a press, so the
// tap was still paying the whole build (~0.3s warm, ~2s cold) on every buy.
const PREBUILD_BUY_ON_SETTLE = true;
// Sells DO get the settle pre-build: the user already holds the position, has
// opened its sell panel and typed an amount — they're about to sell.
const PREBUILD_SELL_ON_SETTLE = true;
const PREBUILD_DEBOUNCE_MS = 700;
// A built tx carries a fixed recentBlockhash (~60s of validity). Discard a
// cached build older than this so we never sign a near-expired blockhash; the
// tap then rebuilds inline. Worst-case age at send ≈ build(~2s) + this + sign
// ≈ ~25s, comfortably inside the blockhash window.
const PREBUILD_TTL_MS = 20_000;

type AtomicBuildResult = Awaited<ReturnType<typeof createAtomicBuyTransaction>>;

type PrebuiltBuy = {
  key: string;
  builtAt: number;
  promise: Promise<AtomicBuildResult>;
};

// A pre-built sell carries the clamped on-chain amount it was built for (and
// the raw `held` balance) alongside the build, so onSubmit can sign+send
// without re-running the balance clamp or rebuilding.
type PrebuiltSell = {
  key: string;
  builtAt: number;
  promise: Promise<{
    build: AtomicBuildResult;
    smallest: string;
    held: bigint | null;
    decimals: number | null;
    reservedBySandwich?: boolean;
  }>;
};

/**
 * Narrows an on-chain balance to the units this page may sell: those bought as
 * the asset itself. See `lib/standalone-holding.ts`.
 */
type HeldLimiter = (mint: string, held: bigint, decimals: number) => bigint;

/** Identity of a build. Two builds with the same key are interchangeable. */
function buildKey(taker: string, mint: string, amount: string): string {
  return `${taker}:${mint}:${amount}`;
}

/**
 * Clamp a sell amount to the wallet's *exact* on-chain balance, re-deriving it
 * with the token's real on-chain decimals. The displayed balance comes from a
 * float-based indexer and can sit a few raw units above what's actually
 * transferable (xStocks are Token-2022), so selling the shown amount overshoots
 * and Jupiter rejects with "Insufficient funds". Retries a couple of times; on
 * a genuine failure (`held === null`) the caller proceeds unclamped, and
 * `held === 0n` means there's nothing to sell. Read-only (Helius, not Jupiter's
 * bucket), so it's safe to run speculatively on touch-down.
 */
async function clampSellSmallestAmount(
  taker: string,
  inputMint: string,
  sellTokenQty: number,
  requestedSmallest: string,
  declaredDecimals: number,
  sellAll: boolean,
  limitHeld?: HeldLimiter,
): Promise<{
  smallest: string;
  held: bigint | null;
  decimals: number | null;
  reservedBySandwich: boolean;
}> {
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
  // Sandwich-owned units are not this page's to sell: "Max" and every clamp
  // below work against the direct holding only.
  let reservedBySandwich = false;
  if (held !== null && held > 0n && limitHeld) {
    const limited = limitHeld(inputMint, held, onchainDecimals ?? declaredDecimals);
    reservedBySandwich = limited <= 0n;
    held = limited < held ? limited : held;
  }

  let smallest = requestedSmallest;
  let decimals: number | null = null;
  if (held !== null && held > 0n) {
    if (onchainDecimals !== null && onchainDecimals !== declaredDecimals) {
      const corrected = toSmallestUnits(
        sellTokenQty.toFixed(Math.min(onchainDecimals, 9)),
        onchainDecimals,
      );
      if (corrected && isPositiveSmallestUnitAmount(corrected)) {
        smallest = corrected;
        decimals = onchainDecimals;
      }
    }
    // "Max" sell: liquidate the holding exactly — every raw unit, no more, no
    // less — bypassing the USD→qty conversion's rounding.
    if (sellAll) {
      smallest = held.toString();
      if (onchainDecimals !== null) decimals = onchainDecimals;
    } else if (BigInt(smallest) > held) {
      smallest = held.toString();
      if (onchainDecimals !== null) decimals = onchainDecimals;
    }
  }
  return { smallest, held, decimals, reservedBySandwich };
}

/**
 * The exact mint a sell will actually spend, plus its on-chain size.
 *
 * The screen's mint is one *variant* of an asset (Backpack xStock, Ondo
 * prestock, …) and the user may hold a different one. The UI has always matched
 * holdings suffix-insensitively by ticker, so the position shows up and the Sell
 * button lights — but execution used the screen's mint, whose balance is 0, and
 * bailed with "You don't hold any …". Everything on the sell path (clamp, build,
 * order, bookkeeping) keys off this resolved mint instead.
 */
type SellPosition = { mint: string; raw: bigint; decimals: number };

/**
 * Probe each candidate mint's on-chain balance and return the first one the
 * wallet actually holds, in the caller's preference order (screen mint first,
 * then held ticker-variants by size). Read-only Helius RPC — never Jupiter's
 * bucket — so it's safe to run on mount and after every trade.
 */
async function resolveSellPosition(
  owner: string,
  candidates: string[],
): Promise<SellPosition | null> {
  if (candidates.length === 0) return null;

  const results = await Promise.all(
    candidates.map(async (mint) => {
      try {
        const { amount, decimals } = await getOnchainTokenBalance(owner, mint);
        return { mint, raw: BigInt(amount), decimals };
      } catch {
        // Transient RPC failure on this candidate — treat as "unknown", not
        // "empty". The caller keeps its walletStore fallback for that case.
        return null;
      }
    }),
  );

  for (const result of results) {
    if (result && result.raw > 0n) {
      return { mint: result.mint, raw: result.raw, decimals: result.decimals };
    }
  }
  return null;
}

function formatCashAmount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPresetAmount(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  // Floor (not round) to the displayed precision so a preset can never land a
  // hair *above* the real balance — rounding up there would trip the
  // insufficient-balance guard and disable the confirm button on "Max".
  const d = Math.max(0, Math.min(decimals, 6));
  const factor = 10 ** d;
  const floored = Math.floor(value * factor) / factor;
  const fixed = floored.toFixed(d);
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

async function getSellTradePnl(
  walletAddress: string,
  mint: string,
  qtySold: number,
  usdReceived: number,
): Promise<{ realizedPnlUsd: number; realizedPnlPct: number | null } | null> {
  if (!walletAddress || !mint || !Number.isFinite(qtySold) || qtySold <= 0) return null;
  const ledger = await loadCostBasisLedger(walletAddress);
  const prev = ledger[mint];
  if (!prev || prev.qty <= 0 || prev.avgPriceUsd <= 0) return null;
  const soldQty = Math.min(qtySold, prev.qty);
  const costSold = prev.avgPriceUsd * soldQty;
  if (costSold <= 0) return null;
  const realizedPnlUsd = Math.max(0, usdReceived) - costSold;
  return {
    realizedPnlUsd,
    realizedPnlPct: (realizedPnlUsd / costSold) * 100,
  };
}

function usdToUsdcSmallest(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(toSmallestUnits(value.toFixed(6), 6) ?? '0');
}

function deserializeTransaction(base64Transaction: string): Transaction | VersionedTransaction {
  const bytes = Buffer.from(base64Transaction, 'base64');

  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

function serializeSignedTransaction(transaction: Transaction | VersionedTransaction): string {
  const bytes =
    transaction instanceof VersionedTransaction
      ? transaction.serialize()
      : transaction.serialize({ requireAllSignatures: false, verifySignatures: false });

  return Buffer.from(bytes).toString('base64');
}

/** Snapshot of the trade just submitted — passed to the success callbacks so
 *  the post-buy UI (success sheet) can show what was actually bought without
 *  re-deriving it from state that may have been cleared (`setAmount('')`). */
export type TradeContext = {
  side: 'buy' | 'sell';
  amount: string;
  symbol: string;
  icon: string | null;
  proceedsUsd?: number | null;
  realizedPnlUsd?: number | null;
  realizedPnlPct?: number | null;
};

type TradeEngineOptions = {
  onSuccess?: (ctx: TradeContext) => void;
  /** Fired after a successful buy — drives the success sheet. */
  onBuySuccess?: (ctx: TradeContext) => void;
  /** Fired after a successful sell — drives the success sheet. */
  onSellSuccess?: (ctx: TradeContext) => void;
  /** Fired the moment a buy submission begins — used to open the success
   *  sheet in its loading state so the user sees a spinner during the trade. */
  onBuyStarted?: (ctx: TradeContext) => void;
  /** Fired the moment a sell submission begins — used to open the success sheet. */
  onSellStarted?: (ctx: TradeContext) => void;
  onAfterSubmit?: () => void;
  /** Stock logo, surfaced on the Activity feed's Buy/Sell rows. */
  icon?: string | null;
  /** Price snapshot from the asset surface. Arbitrary Jupiter tokens may not
   * exist in the curated tokens.xyz catalog, but still need correct trade
   * sizing and post-trade bookkeeping. */
  usdPrice?: number | null;
  /**
   * Hands off to the deposit flow. When wired, the buy dialpad's confirm button
   * becomes "Add cash" (instead of "Buy") whenever the user's cash can't cover a
   * buy, and tapping it opens the add-cash flow rather than executing a trade.
   */
  onRequestAddCash?: () => void;
  /**
   * Whether to quote the typed amount live against Jupiter (`quotePreview`
   * below). Off by default: the engine is instantiated wherever a Buy button
   * exists, and only the surface actually showing a dialpad should be spending
   * requests on terms nobody can see. Pass the sheet's open state.
   */
  quotePreview?: boolean;
};

export function useTradeEngine(stockMint: string | null, stockSymbol?: string | null, options?: TradeEngineOptions) {
  const solanaWallet = useEmbeddedSolanaWallet();
  const walletStore = useWalletStore();
  // Passive: don't refresh the cash figure on mount — the always-mounted Home
  // instance keeps it warm. Keeps the open→trade path free of extra
  // calls so the only Jupiter request is the buy/sell execution itself.
  const cash = useCash({ autoRefresh: false });
  const toast = useToast();
  const [tokenDetail, setTokenDetail] = useState<JupiterTokenDetail | null>(null);
  const [amount, setAmount] = useState('');
  // True when the user tapped "Max" on a sell: execution should liquidate the
  // *entire* on-chain holding rather than the rounded USD amount shown in the
  // input. Cleared the moment the amount is edited any other way.
  const [sellMaxRequested, setSellMaxRequested] = useState(false);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The mint a sell will actually spend + its exact on-chain size, read straight
  // from the chain (see the effect below). Backstops the walletStore-based
  // matching AND redirects execution to a held variant of the same ticker.
  // Tagged with the candidate set it was resolved for, so a position never
  // leaks across assets: switching the sheet to another stock changes the key
  // and the stale result stops applying on the very same render (rather than
  // pointing a sell at the previous asset's mint until the refetch lands).
  const [sellPositionState, setSellPositionState] = useState<{
    key: string;
    position: SellPosition | null;
  } | null>(null);
  const requestIdRef = useRef(0);
  const sellDetailRequestIdRef = useRef(0);

  const wallet = solanaWallet.wallets?.[0] ?? null;
  const walletAddress = wallet?.address ?? null;
  // Where a BUY of this asset actually goes.
  //
  // The mint on screen comes from a curated/search row, and those rows carry
  // ONE variant per asset — routinely the thin one. Micron's row is the Ondo
  // wrapper: $3.9k of liquidity and 20 trades a day, printing 14% above the
  // share, while the Backpack variant of the same company trades $5.4M. Buying
  // the row's mint spent USDC in that pool at the premium.
  //
  // The server names the better mint on the asset card (`buyVariantMint`, null
  // whenever the displayed mint is already the right home), and it only knows
  // once the card has loaded — so the first card is fetched for the displayed
  // mint and, if it names a replacement, this flips and the effect below
  // re-runs for THAT mint, picking up its price and decimals for sizing. The
  // server never names a variant as its own replacement, so it cannot ping-pong.
  //
  // Keyed by the mint it was resolved for, so switching the sheet to another
  // asset drops it on the very same render rather than routing the next buy
  // into the previous asset's variant.
  const [buyRoute, setBuyRoute] = useState<{ from: string; mint: string } | null>(null);
  const buyMint = buyRoute && buyRoute.from === stockMint ? buyRoute.mint : stockMint;
  // Helius identifies native SOL with a pseudo-mint (…111), while Jupiter's
  // swap APIs require the canonical wrapped-SOL mint (…112). Keep `stockMint`
  // for balance/UI bookkeeping and use this mint only at execution boundaries.
  const tradeMint = toSolanaTradeMint(buyMint);

  const balanceTokens = walletStore.tokens;
  const balanceLoading = walletStore.loading;

  useEffect(() => {
    if (!hasValidMint(tradeMint)) {
      setTokenDetail(null);
      return;
    }

    const requestId = ++requestIdRef.current;

    void (async () => {
      try {
        const detail = await getTokenTradeDetail(tradeMint);

        if (requestId !== requestIdRef.current) return;
        setTokenDetail(detail);
        // The card we just loaded says a buy belongs on a different variant of
        // this asset — adopt it (see `buyRoute`). Sells are untouched: they
        // spend what the wallet holds.
        if (stockMint && detail?.buyVariantMint && detail.buyVariantMint !== buyMint) {
          setBuyRoute({ from: stockMint, mint: detail.buyVariantMint });
        }
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        setTokenDetail(null);
        console.warn('[trade] token detail unavailable', getErrorMessage(error));
      }
    })();
  }, [tradeMint, buyMint, stockMint]);

  const tradeSymbol = (stockSymbol ?? tokenDetail?.symbol ?? '').toUpperCase();
  const resolvedSymbol = tradeSymbol || 'TOKEN';

  // Mints that could satisfy a sell of this asset, in preference order: the mint
  // on screen first, then any *held* variant carrying the same ticker (a wallet
  // holding TSLAX opened from a TSLAON listing, and vice versa), largest first.
  const sellCandidateMints = useMemo(
    () => collectSellCandidateMints(stockMint, resolvedSymbol, balanceTokens),
    [stockMint, resolvedSymbol, balanceTokens],
  );

  // Authoritative holdings check. walletStore.tokens (Helius-indexed, then
  // symbol-enriched via /jupiter/prices) can lag, omit a Token-2022 xStock, or
  // lose its symbol under rate limits — any of which wrongly shows "NO BALANCE"
  // / disables Sell on an asset the user holds. The RPC balance is ground truth
  // and reflects trades immediately. Re-runs after each trade (submitting) so a
  // full sell clears the position.
  const sellCandidateKey = sellCandidateMints.join(',');
  const resolvedSellPosition =
    sellPositionState && sellPositionState.key === sellCandidateKey
      ? sellPositionState.position
      : null;

  // Units of a mint held as a Sandwich leg belong to that Sandwich: it reports
  // them and sells them. This page only ever sells what was bought on it —
  // otherwise "Max" on ZEC would liquidate the ZEC leg of every basket too.
  const legReserve = useSandwichLegReserve(walletAddress, walletStore.costBasis);
  const standaloneReady = walletStore.costBasisLoaded && legReserve !== null;
  const limitHeldToStandalone: HeldLimiter = (mint, held, decimals) => {
    if (held <= 0n || !standaloneReady) return held;
    const balance = Number(held) / 10 ** decimals;
    const { qty } = standaloneHolding({
      walletBalance: balance,
      entry: walletStore.costBasis[mint],
      reserve: legReserve,
      mint,
    });
    if (qty <= 0) return 0n;
    if (qty >= balance) return held;
    const cap = toSmallestUnits(qty.toFixed(Math.min(decimals, 9)), decimals);
    const capRaw = cap && /^\d+$/.test(cap) ? BigInt(cap) : held;
    return capRaw < held ? capRaw : held;
  };
  const sellPosition = useMemo<SellPosition | null>(() => {
    if (!resolvedSellPosition || !standaloneReady) return null;
    const raw = limitHeldToStandalone(
      resolvedSellPosition.mint,
      resolvedSellPosition.raw,
      resolvedSellPosition.decimals,
    );
    return raw > 0n ? { ...resolvedSellPosition, raw } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedSellPosition, standaloneReady, walletStore.costBasis, legReserve]);
  useEffect(() => {
    if (!walletAddress || sellCandidateMints.length === 0) {
      setSellPositionState(null);
      return;
    }
    let active = true;
    void resolveSellPosition(walletAddress, sellCandidateMints).then((position) => {
      if (active) setSellPositionState({ key: sellCandidateKey, position });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, sellCandidateKey, submitting]);

  // Everything on the sell path spends this mint — not necessarily the one on
  // screen. Falls back to the screen's mint until (or unless) the chain lookup
  // resolves, which keeps behaviour identical for the common single-variant case.
  const sellMint = sellPosition?.mint ?? stockMint;
  const sellTradeMint = toSolanaTradeMint(sellMint);
  const sellsDifferentMint = hasValidMint(sellTradeMint) && sellTradeMint !== tradeMint;

  // A variant is a different token with a different book: xStock and prestock
  // wrappers of one equity quote materially apart. When the sell routes to a
  // mint other than the displayed one, price the sell off *that* mint so the
  // USD→quantity conversion (and the balance shown above the keypad) matches
  // what actually gets sold. Only fetched in the mismatch case.
  const [sellVariantDetail, setSellVariantDetail] = useState<{
    mint: string;
    status: 'loading' | 'ready' | 'failed';
    detail: JupiterTokenDetail | null;
  } | null>(null);
  useEffect(() => {
    if (!sellsDifferentMint || !hasValidMint(sellTradeMint)) {
      setSellVariantDetail(null);
      return;
    }
    const mint = sellTradeMint;
    const requestId = ++sellDetailRequestIdRef.current;
    setSellVariantDetail({ mint, status: 'loading', detail: null });
    void (async () => {
      try {
        const detail = await getTokenTradeDetail(mint);
        if (requestId !== sellDetailRequestIdRef.current) return;
        setSellVariantDetail({ mint, status: 'ready', detail });
      } catch (error) {
        if (requestId !== sellDetailRequestIdRef.current) return;
        // Never strand a user in a position: fall back to the screen's price
        // (below) rather than leaving the sell permanently un-armed.
        setSellVariantDetail({ mint, status: 'failed', detail: null });
        console.warn('[trade] sell variant detail unavailable', getErrorMessage(error));
      }
    })();
  }, [sellsDifferentMint, sellTradeMint]);

  // While the variant's own quote is in flight we intentionally have no sell
  // price (the button stays disabled for that beat) — sizing a sell off the
  // *other* variant's price would misstate the quantity. If the quote fails
  // outright we fall back to the screen's price: an approximate size beats an
  // unsellable position, and the server-side execution guard still blocks a
  // genuinely bad fill.
  const sellVariantIsCurrent =
    sellVariantDetail !== null && sellVariantDetail.mint === sellTradeMint;
  const sellDetail = !sellsDifferentMint
    ? tokenDetail
    : sellVariantIsCurrent && sellVariantDetail.status === 'ready'
      ? sellVariantDetail.detail
      : sellVariantIsCurrent && sellVariantDetail.status === 'failed'
        ? tokenDetail
        : null;

  const availableToken = useMemo(() => {
    if (!walletAddress) return null;

    if (side === 'buy') {
      if (balanceTokens.length === 0) return null;
      return (
        balanceTokens.find((token) => token.mint === SOLANA_USDC_MINT) ??
        balanceTokens.find((token) => (token.symbol ?? '').toUpperCase() === 'USDC') ??
        null
      );
    }

    // The mint the sell will actually spend (a held variant when the screen's
    // own mint is empty), so the displayed balance matches what gets sold.
    if (sellMint) {
      const byMint = balanceTokens.find((token) => token.mint === sellMint);
      if (byMint) return byMint;
    }

    // Fall back to a ticker match (suffix-insensitive) so a held "TSLAX" still
    // resolves when the detail screen's mint is a different variant.
    const target = normalizeTicker(resolvedSymbol);
    if (!target) return null;
    return balanceTokens.find((token) => normalizeTicker(token.symbol) === target) ?? null;
  }, [balanceTokens, walletAddress, side, sellMint, resolvedSymbol]);

  // Priority: the sell mint's own on-chain decimals (authoritative, and the only
  // source that's right when execution routes to a variant) → wallet balance
  // token decimals (Helius, per-token accurate) → token detail → 8 for xStocks.
  const stockDecimals =
    sellPosition?.decimals ??
    availableToken?.decimals ??
    tokenDetail?.decimals ??
    8;
  const inputDecimals = side === 'sell' ? stockDecimals : 6;
  const inputSymbol = side === 'sell' ? resolvedSymbol : 'USDC';
  // Current USD price of the asset — used to denominate the SELL flow in dollars
  // (the user enters a USD amount; we convert to a token quantity to execute).
  const sellPrice = sellDetail?.usdPrice ?? options?.usdPrice ?? null;
  /** The buy side's equivalent: the price of the mint a buy actually spends. */
  const buyPrice = tokenDetail?.usdPrice ?? options?.usdPrice ?? null;
  // Both buy and sell are now entered in USD.
  const amountUnitSymbol = '$';
  const amountUnitLabel = side === 'sell' ? 'dollars' : inputSymbol;
  /**
   * What a sell of THIS token actually clears at, learned from the venue.
   *
   * A sell is typed in dollars and executed in tokens, so something has to turn
   * one into the other — and the card price is the wrong ruler whenever the
   * pool is wide. Micron's Ondo wrapper prints $949.52 on the card and pays
   * $872.78 for a $5 clip: sizing "sell $5" off the card sold 0.005266 tokens
   * and returned $4.60. The same gap in the other direction is what returned
   * $5.18 on a $5 sell.
   *
   * No cached price can fix that, because the discrepancy IS the pool's spread
   * and impact — only the venue knows it. So the first quote is sized off the
   * card, and its `pricePerTokenUsd` (the effective all-in price of that fill)
   * re-sizes the next one. Measured, one pass converges: $4.60 → $5.00, with
   * the effective price stable to 0.007% between passes, so it settles instead
   * of oscillating. The 0.25% floor below keeps that jitter from re-quoting
   * forever, and the price is dropped the moment the mint changes so one
   * asset's spread can never size another's trade.
   */
  // Set by the effect under `quotePreview` below, once the venue has answered.
  const [sellQuotePrice, setSellQuotePrice] = useState<SellSizingPrice | null>(null);

  /** The ruler for this sell: the venue's own price once it has answered. */
  const sellSizingPrice = sellSizingPriceFor(sellQuotePrice, sellTradeMint, sellPrice);

  // Prefer the exact on-chain size over the indexer's float: it's the same
  // number execution clamps to, so "Max" and the balance line can't disagree
  // with what the swap actually sells.
  const spotBalance =
    sellPosition !== null
      ? Number(sellPosition.raw) / 10 ** sellPosition.decimals
      : typeof availableToken?.balance === 'number'
        ? availableToken.balance
        : 0;

  /**
   * What the whole position is worth if sold right now — quoted, not marked.
   *
   * The same request "Max" makes, so when Max is armed this shares the preview
   * hook's cache key and costs no extra call. A position is quoted whole
   * because impact grows with size: a $5 clip's effective price does not
   * describe liquidating the lot, which is exactly the number the balance line
   * is claiming.
   */
  const positionQuote = useTradeQuotePreview({
    enabled: options?.quotePreview === true && side === 'sell' && sellPosition !== null,
    side: 'sell',
    mint: hasValidMint(sellTradeMint) ? sellTradeMint : null,
    amountRaw: sellPosition ? sellPosition.raw.toString() : null,
    taker: walletAddress,
  });
  const realizableBalanceUsd =
    side === 'sell' &&
    positionQuote.preview?.ok === true &&
    positionQuote.preview.mint === sellTradeMint &&
    positionQuote.preview.expectedReceived !== null
      ? positionQuote.preview.expectedReceived
      : null;

  const availableBalance = useMemo(() => {
    if (!walletAddress) return null;

    if (side === 'buy') {
      return cash.totalCash;
    }

    // Sell is denominated in USD — return the dollar value of the holding.
    //
    // REALIZABLE, not marked: what the venue will actually pay for the whole
    // position (`realizableBalanceUsd`), because this figure is not decoration
    // — the presets spend it. "Max" reads it, "50%" halves it, and the
    // insufficient-balance check bounds the typed amount by it, so a marked
    // value that the pool won't pay puts a number on the pad that cannot be
    // filled. On a wide pool the two differ materially: Micron's Ondo wrapper
    // marks at $949.52/token and pays $872.78.
    //
    // Until that quote lands (and if it never does) fall back to marking the
    // position, first at the sell ruler and then at the card price — a slightly
    // stale figure beats "loading" on a balance the user can see in their
    // wallet. Null only while no price of any kind is known.
    return sellBalanceUsd({
      realizableUsd: realizableBalanceUsd,
      positionTokens: spotBalance,
      marks: [sellSizingPrice, sellPrice],
    });
  }, [walletAddress, side, spotBalance, cash.totalCash, sellPrice, sellSizingPrice, realizableBalanceUsd]);

  // A sell is executable once we know which mint it spends and have a price for
  // that mint (its own, or the screen's after a failed variant lookup).
  const sellReady = hasValidMint(sellTradeMint) && sellPrice !== null && sellPrice > 0;

  // Whether the user holds anything sellable for this asset — independent of the
  // currently selected side (the Buy/Sell buttons need this before any side is
  // chosen). Authoritative source first: the exact mint's on-chain balance
  // (`onchainHeld`). Then the walletStore fallbacks: a spot holding by mint OR
  // suffix-insensitive ticker (catches a held variant under a different mint).
  // Drives both the Sell button's enabled/bright state and its "NO BALANCE" hint
  // so they can't disagree with the sell sheet.
  //
  // Only DIRECT units count: a Sandwich leg of this asset is sold from the
  // Sandwich, so holding one must not light up Sell here. Nothing is offered
  // until the ledger that tells the two apart has loaded.
  const hasSellableBalance = useMemo(() => {
    if (!walletAddress || !standaloneReady) return false;
    if (sellPosition !== null) return true;
    // The chain resolved a holding and all of it is Sandwich-owned.
    if (resolvedSellPosition !== null) return false;
    const target = normalizeTicker(resolvedSymbol);
    const ownsSpot = balanceTokens.some((token) => {
      if ((token.balance ?? 0) <= 0 || !token.mint) return false;
      const matches =
        (hasValidMint(stockMint) && token.mint === stockMint) ||
        (target.length > 0 && normalizeTicker(token.symbol) === target);
      if (!matches) return false;
      return (
        standaloneHolding({
          walletBalance: token.balance,
          entry: walletStore.costBasis[token.mint],
          reserve: legReserve,
          mint: token.mint,
        }).qty > 0
      );
    });
    return ownsSpot;
  }, [
    walletAddress,
    standaloneReady,
    sellPosition,
    resolvedSellPosition,
    balanceTokens,
    stockMint,
    resolvedSymbol,
    walletStore.costBasis,
    legReserve,
  ]);

  /**
   * What the typed dollar amount works out to in shares, and at what price.
   *
   * This flow taps straight into sign-and-send (no pre-tap quote), so the exact
   * fill price isn't knowable here — but naming the price we EXPECT to trade at
   * gives the user something to check against, and it's the same reference the
   * server-side execution guard blocks on. A fill far from this number never
   * reaches the chain; see lib/server/execution-guard.ts.
   */
  const estimateLabel = useMemo(() => {
    const price = (side === 'sell' ? sellSizingPrice : buyPrice) ?? null;
    const typed = Number(amount);
    if (!price || price <= 0) return null;
    if (!Number.isFinite(typed) || typed <= 0) return null;

    const qty = typed / price;
    const qtyText = qty.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: qty < 1 ? 6 : 4,
    });
    const priceText = price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: price < 1 ? 6 : 2,
    });
    const verb = side === 'sell' ? 'Selling' : 'Buying';
    return `${verb} ≈ ${qtyText} ${resolvedSymbol} at $${priceText}`;
  }, [amount, side, buyPrice, sellSizingPrice, resolvedSymbol]);

  /**
   * The typed amount in the base units the swap will actually spend, so the
   * live quote below asks about the same trade the confirm button submits.
   *
   * A buy spends USDC, so the conversion is exact. A sell is entered in dollars
   * and executed in tokens, so it goes through the same price the submit path
   * uses — and when "Max" is armed, through the exact on-chain size execution
   * clamps to, rather than the rounded dollar figure shown in the input.
   */
  const previewAmountRaw = useMemo(() => {
    if (side === 'sell') {
      if (sellMaxRequested && sellPosition) return sellPosition.raw.toString();
      const typed = Number(amount);
      if (!sellSizingPrice || sellSizingPrice <= 0 || !Number.isFinite(typed) || typed <= 0) return null;
      const qty = typed / sellSizingPrice;
      return toSmallestUnits(qty.toFixed(Math.min(stockDecimals, 9)), stockDecimals);
    }
    return toSmallestUnits(amount, 6);
  }, [side, amount, sellSizingPrice, sellMaxRequested, sellPosition, stockDecimals]);

  const previewMint = side === 'sell' ? sellTradeMint : tradeMint;

  /**
   * Live venue terms for the typed amount. Replaces nothing — `estimateLabel`
   * stays as the instant, price-derived stand-in while this resolves — but it
   * is the number that reflects the actual offer, including the cases where
   * there is no offer at all (a closed US session for an RFQ-only wrapper).
   */
  const quotePreview = useTradeQuotePreview({
    enabled: options?.quotePreview === true,
    side,
    mint: hasValidMint(previewMint) ? previewMint : null,
    amountRaw: previewAmountRaw,
    taker: walletAddress,
  });

  // Adopt the venue's effective price as the sell ruler — see `sellQuotePrice`.
  const quotedSellPrice = quotePreview.preview;
  useEffect(() => {
    if (
      side !== 'sell' ||
      !quotedSellPrice?.ok ||
      quotedSellPrice.side !== 'sell' ||
      quotedSellPrice.mint !== sellTradeMint ||
      quotedSellPrice.pricePerTokenUsd === null ||
      quotedSellPrice.pricePerTokenUsd <= 0
    ) {
      return;
    }
    const quoted = quotedSellPrice.pricePerTokenUsd;
    setSellQuotePrice((current) =>
      nextSellSizingPrice({
        current,
        mint: sellTradeMint,
        // A new typed amount gets a fresh refinement budget.
        key: `${sellTradeMint}:${amount}`,
        quotedPrice: quoted,
        cardPrice: sellPrice,
      }),
    );
  }, [side, sellTradeMint, sellPrice, amount, quotedSellPrice]);

  const availableLabel = (() => {
    if (!walletAddress) return null;
    if (side === 'buy') {
      if (balanceLoading && balanceTokens.length === 0 && cash.loading) {
        return 'Loading cash balance...';
      }

      return `Cash balance: $${formatCashAmount(cash.totalCash)}`;
    }

    // Sell is denominated in USD — show the dollar value of the holding.
    if (typeof availableBalance === 'number') {
      return `Stock balance: $${formatCashAmount(availableBalance)}`;
    }
    return balanceLoading ? 'Loading balance...' : null;
  })();

  // ── Speculative pre-build ────────────────────────────────────────────────
  // See the notes on PREBUILD_BUY_ON_SETTLE. These caches hold at most one
  // in-flight/finished build per side, keyed on the exact trade identity, so a
  // tap either reuses the warm build (fast path) or falls through to an inline
  // build (unchanged behaviour).
  const prebuiltBuyRef = useRef<PrebuiltBuy | null>(null);
  const prebuiltSellRef = useRef<PrebuiltSell | null>(null);
  // Written during render further down, where affordability and market hours
  // are known; read by the settle pre-build effect, which runs after render.
  const buyPrebuildBlockedRef = useRef(false);

  function prebuildAtomicBuy(): void {
    if (side !== 'buy' || submitting) return;
    if (!walletAddress || !hasValidMint(tradeMint)) return;

    const smallest = toSmallestUnits(amount, 6);
    if (!smallest || !isPositiveSmallestUnitAmount(smallest)) return;

    const key = buildKey(walletAddress, tradeMint, smallest);
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
        outputMint: tradeMint,
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

  // Sell pre-build: clamps the typed amount to the wallet's real on-chain
  // balance AND builds the swap for that clamped amount — so by release the tap
  // is pure sign + send (the balance round-trip and the ~2s Jupiter build both
  // happen during the press instead of serially after it). Keyed on the *typed*
  // amount so the tap reuses it even for "Max", where the clamp shaves a few raw
  // units off the displayed balance.
  function prebuildAtomicSell(): void {
    if (side !== 'sell' || submitting) return;
    if (!walletAddress || !hasValidMint(sellMint) || !hasValidMint(sellTradeMint)) return;
    if (!sellSizingPrice || sellSizingPrice <= 0) return;

    // Same ruler as the preview and the submit path — see `sellQuotePrice`. A
    // pre-build sized off a different price is a pre-build the tap discards.
    const tokenQty = Number(amount) / sellSizingPrice;
    if (!Number.isFinite(tokenQty) || tokenQty <= 0) return;
    const requested = toSmallestUnits(tokenQty.toFixed(Math.min(stockDecimals, 9)), stockDecimals);
    if (!requested || !isPositiveSmallestUnitAmount(requested)) return;

    const key = buildKey(
      walletAddress,
      sellTradeMint,
      `${requested}:${sellMaxRequested ? 'max' : ''}`,
    );
    const existing = prebuiltSellRef.current;
    if (existing && existing.key === key && Date.now() - existing.builtAt < PREBUILD_TTL_MS) {
      return;
    }

    const startedAt = Date.now();
    const taker = walletAddress;
    const balanceMint = sellMint;
    const mint = sellTradeMint;
    const declaredDecimals = stockDecimals;
    const sellAll = sellMaxRequested;
    prebuiltSellRef.current = {
      key,
      builtAt: startedAt,
      promise: (async () => {
        const { smallest, held, decimals, reservedBySandwich } = await clampSellSmallestAmount(
          taker,
          balanceMint,
          tokenQty,
          requested,
          declaredDecimals,
          sellAll,
          limitHeldToStandalone,
        );
        // Nothing transferable — skip the build; onSubmit surfaces the error.
        if (held !== null && held <= 0n) {
          return {
            build: { transaction: null, fallback: true as const },
            smallest,
            held,
            decimals,
            reservedBySandwich,
          };
        }
        const build = await createAtomicSellTransaction({ taker, inputMint: mint, amount: smallest })
          .then((result) => {
            console.log('[atomic-sell] prebuilt', {
              ms: Date.now() - startedAt,
              fallback: result.fallback,
            });
            return result;
          })
          .catch(() => ({ transaction: null, fallback: true as const }));
        return { build, smallest, held, decimals, reservedBySandwich };
      })(),
    };
  }

  /** Touch-down warm-up for the confirm button — intent-proven, always safe. */
  function onSubmitPressIn(): void {
    if (side === 'buy') prebuildAtomicBuy();
    else prebuildAtomicSell();
  }

  // Debounced settle-trigger pre-builds, one per settled amount per side.
  useEffect(() => {
    if (!PREBUILD_BUY_ON_SETTLE) return;
    if (side !== 'buy' || submitting || buyPrebuildBlockedRef.current) return;
    if (!walletAddress || !hasValidMint(tradeMint)) return;
    const timer = setTimeout(prebuildAtomicBuy, PREBUILD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, submitting, walletAddress, tradeMint, amount]);

  useEffect(() => {
    if (!PREBUILD_SELL_ON_SETTLE) return;
    if (side !== 'sell' || submitting) return;
    if (!walletAddress || !hasValidMint(sellMint) || !hasValidMint(sellTradeMint) || !sellPrice) {
      return;
    }
    const timer = setTimeout(prebuildAtomicSell, PREBUILD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, submitting, walletAddress, sellMint, sellTradeMint, amount, stockDecimals, sellSizingPrice, sellMaxRequested]);

  function reset(tradeSide: 'buy' | 'sell') {
    prebuiltBuyRef.current = null;
    prebuiltSellRef.current = null;
    setSide(tradeSide);
    setAmount('');
    setSellMaxRequested(false);
    setMessage(null);
  }

  function tapDigit(digit: string) {
    setMessage(null);
    // Any manual edit invalidates a pending "sell entire holding" intent.
    setSellMaxRequested(false);
    if (digit === 'del') {
      setAmount((prev) => (prev.length <= 1 ? '' : prev.slice(0, -1)));
      return;
    }
    if (digit === '.') {
      if (amount.includes('.')) return;
      setAmount((prev) => (prev === '' ? '0.' : prev + '.'));
      return;
    }
    setAmount((prev) => (prev === '0' ? digit : prev + digit));
  }

  function tapPreset(value: string) {
    setMessage(null);
    const normalized = value.trim();
    const lower = normalized.toLowerCase();

    if (lower === 'max' || /%$/.test(lower)) {
      if (availableBalance === null) {
        setMessage('Balance not available yet.');
        return;
      }

      // Both buy and sell amounts are entered in USD ($, 2 decimals).
      const presetDecimals = 2;

      if (lower === 'max') {
        // On a sell, "Max" means liquidate the entire on-chain holding exactly.
        // The displayed USD figure is just for show — execution reads the flag
        // and sells the precise full balance (no dust left, never overshoots).
        setSellMaxRequested(side === 'sell');
        // A buy keeps a little headroom under the cash balance (see
        // `maxBuyAmount`) — spending the exact figure failed on-chain.
        setAmount(
          formatPresetAmount(
            side === 'buy' ? maxBuyAmount(availableBalance, presetDecimals) : availableBalance,
            presetDecimals,
          ),
        );
        return;
      }

      setSellMaxRequested(false);
      const match = normalized.match(/^(\d+(?:\.\d+)?)%$/);
      const percent = match ? Number(match[1]) : NaN;
      if (!Number.isFinite(percent)) {
        setAmount(value);
        return;
      }

      const nextAmount = availableBalance * (percent / 100);
      setAmount(formatPresetAmount(nextAmount, presetDecimals));
      return;
    }

    setSellMaxRequested(false);
    setAmount(value);
  }


  async function onSubmit(): Promise<void> {
    const tradeCtx: TradeContext = {
      side,
      amount,
      symbol: resolvedSymbol,
      icon: options?.icon ?? null,
    };

    if (!walletAddress || !wallet) {
      toast.showToast('Connect a wallet before trading.', 'error');
      return;
    }
    // Buys spend USDC into `buyMint` — the mint on screen, unless the server
    // routed the buy to a better variant of the same asset (see `buyRoute`);
    // sells spend the mint the wallet actually holds (`sellMint`), which is the
    // same one except when the user owns a different variant of this ticker.
    // Pin both here so a mid-flight re-resolution can't move the trade out from
    // under this submission — and note that everything keying off `execMint`
    // downstream (cost basis, the wallet-store row, the post-buy balance poll)
    // therefore follows the mint that actually moved, not the one on screen.
    const execMint = side === 'sell' ? sellMint : buyMint;
    const execTradeMint = side === 'sell' ? sellTradeMint : tradeMint;
    if (!hasValidMint(execMint) || !hasValidMint(execTradeMint)) {
      toast.showToast('Not available for trading yet.', 'error');
      return;
    }

    // Sell is entered in USD — convert to a token quantity (qty = usd / price)
    // before sizing the swap. Buy is already in USD (USDC in).
    const sellTokenQty =
      side === 'sell' && sellSizingPrice && sellSizingPrice > 0
        ? Number(amount) / sellSizingPrice
        : 0;

    let inputAmount: string;
    // The decimals `inputAmount` is actually scaled in. Starts as the cached
    // stock decimals but is reset to the *on-chain* decimals below whenever we
    // re-scale to the true balance — so the displayed quantity / proceeds
    // derived from it stay correct (and a Max sell visibly zeroes the holding).
    let sellInputDecimals = inputDecimals;
    if (side === 'sell') {
      if (!sellSizingPrice || sellSizingPrice <= 0) {
        toast.showToast('Price unavailable, try again in a moment.', 'error');
        return;
      }
      const converted = toSmallestUnits(
        sellTokenQty.toFixed(Math.min(stockDecimals, 9)),
        stockDecimals,
      );
      if (!converted || !isPositiveSmallestUnitAmount(converted)) {
        toast.showToast('Enter a valid amount.', 'error');
        return;
      }
      inputAmount = converted;
    } else {
      const requestedInputAmount = toSmallestUnits(amount, inputDecimals);
      if (!requestedInputAmount || !isPositiveSmallestUnitAmount(requestedInputAmount)) {
        toast.showToast(`Enter a valid ${inputSymbol} amount.`, 'error');
        return;
      }
      inputAmount = requestedInputAmount;
    }

    // Acknowledge a sell the instant the amount is valid: show the processing
    // screen and flag `submitting` BEFORE the on-chain balance clamp and order
    // build run, so tapping Sell feels immediate (buys already do this via
    // onBuyStarted up front). Any early return below must clear `submitting`.
    if (side === 'sell') {
      options?.onSellStarted?.(tradeCtx);
      setSubmitting(true);
      setMessage(null);
    }

    // For sells, clamp the amount to the wallet's *exact* on-chain balance.
    // The displayed balance comes from a float-based indexer (Helius) and can
    // sit a few raw units above what's actually transferable, so selling the
    // shown amount overshoots and Jupiter rejects with "Insufficient funds".
    // The touch-down / settle pre-build usually already did this clamp *and*
    // the swap build (see prebuildAtomicSell); reuse it when the key matches so
    // the tap doesn't pay for either round-trip again. Otherwise clamp inline.
    let prebuiltSell: Awaited<PrebuiltSell['promise']> | null = null;
    // The mints this submission ultimately trades. They only move if the
    // last-chance re-resolution below finds the position under another variant.
    let activeSellMint = execMint;
    let activeSellTradeMint = execTradeMint;
    if (side === 'sell') {
      const sellKey = buildKey(
        walletAddress,
        execTradeMint,
        `${inputAmount}:${sellMaxRequested ? 'max' : ''}`,
      );
      const cached = prebuiltSellRef.current;
      if (cached && cached.key === sellKey && Date.now() - cached.builtAt < PREBUILD_TTL_MS) {
        prebuiltSell = await cached.promise;
      } else {
        const { smallest, held, decimals, reservedBySandwich } = await clampSellSmallestAmount(
          walletAddress,
          execMint,
          sellTokenQty,
          inputAmount,
          stockDecimals,
          sellMaxRequested,
          limitHeldToStandalone,
        );
        prebuiltSell = {
          build: { transaction: null, fallback: true },
          smallest,
          held,
          decimals,
          reservedBySandwich,
        };
      }

      // Nothing under the mint we were about to sell. Before telling a user who
      // can *see* the position that they don't hold it, re-resolve against every
      // candidate variant — the background resolution may not have landed yet
      // (sheet opened and tapped fast) or may have been resolved while a stale
      // indexer snapshot hid the ticker match.
      if (prebuiltSell.held !== null && prebuiltSell.held <= 0n) {
        const rescued =
          sellCandidateMints.length > 0
            ? await resolveSellPosition(walletAddress, sellCandidateMints)
            : null;
        const rescuedTradeMint = toSolanaTradeMint(rescued?.mint ?? null);
        if (rescued && rescued.mint !== activeSellMint && hasValidMint(rescuedTradeMint)) {
          activeSellMint = rescued.mint;
          activeSellTradeMint = rescuedTradeMint;
          setSellPositionState({ key: sellCandidateKey, position: rescued });
          // Re-clamp against the variant we're actually selling. `inputAmount`
          // is still scaled in `stockDecimals` (that's what built it); the clamp
          // re-scales it itself when the variant's on-chain decimals differ.
          const { smallest, held, decimals, reservedBySandwich } = await clampSellSmallestAmount(
            walletAddress,
            rescued.mint,
            sellTokenQty,
            inputAmount,
            stockDecimals,
            sellMaxRequested,
            limitHeldToStandalone,
          );
          // The cached build was for the old mint — it can't be reused.
          prebuiltSell = {
            build: { transaction: null, fallback: true },
            smallest,
            held,
            decimals,
            reservedBySandwich,
          };
        }
      }

      if (prebuiltSell.held !== null) {
        if (prebuiltSell.held <= 0n) {
          // Genuinely empty across every variant — reflect that in the UI too,
          // so the Sell button stops offering a trade that can't happen.
          setSellPositionState({ key: sellCandidateKey, position: null });
          setSubmitting(false);
          toast.showToast(
            prebuiltSell.reservedBySandwich
              ? `Your ${resolvedSymbol} is held in a Sandwich. Sell it from the Sandwich.`
              : `You don't hold any ${resolvedSymbol} to sell.`,
            'error',
          );
          void walletStore.refresh();
          return;
        }
        inputAmount = prebuiltSell.smallest;
        if (prebuiltSell.decimals !== null) sellInputDecimals = prebuiltSell.decimals;
      }
    }

    const stockQtyInput = side === 'sell'
      ? (fromSmallestUnits(inputAmount, sellInputDecimals) ?? sellTokenQty)
      : 0;
    // Quantity to remove from the on-screen holding. On a Max sell, deduct at
    // least the full displayed balance so the row drops cleanly to zero — the
    // optimisticAdjust floor at 0 absorbs any float gap between the indexer's
    // balance and the exact on-chain amount we actually sold.
    const sellQtyOptimistic = sellMaxRequested
      ? Math.max(stockQtyInput, spotBalance)
      : stockQtyInput;
    // Price the trade off the mint being traded: a sell routed to a held variant
    // must value its proceeds at that variant's price, not the screen's.
    const currentPrice = (side === 'sell' ? sellSizingPrice : buyPrice) ?? null;
    const usdNotional = side === 'buy' ? Number(amount) : stockQtyInput * (currentPrice ?? 0);

    // Cost basis, the wallet-store row and the activity record all key off the
    // mint that actually moved — the resolved sell mint on a sell, the screen's
    // mint on a buy. Adjusting the wrong variant's row would leave a phantom
    // position on screen and corrupt the next PnL.
    const bookkeepingMint = side === 'sell' ? activeSellMint : execMint;

    // Sells already flipped into their submitting state before the clamp above;
    // only the buy path needs to flip into its submitting state here.
    //
    // `onBuyStarted` fires HERE rather than at the top of the submit, paired
    // with `submitting` in the same tick. It used to run before the amount was
    // validated, so a rejected amount opened the processing screen and then
    // returned without ever flipping `submitting` — leaving whoever listens for
    // the trade to finish waiting on a trade that never started. Nothing
    // between there and here awaits on the buy path, so this is no later in
    // wall-clock terms.
    if (side === 'buy') {
      options?.onBuyStarted?.(tradeCtx);
      setSubmitting(true);
      setMessage(null);
    }

    try {
      // Optimistically deduct the buy amount from the cash balance
      const buyAmountNum = Number(amount);
      if (side === 'buy' && buyAmountNum > 0) {
        const idleDeduction = Math.min(cash.idleUsdc, buyAmountNum);
        if (idleDeduction > 0) {
          walletStore.optimisticAdjust(SOLANA_USDC_MINT, -idleDeduction, -idleDeduction);
        }
      }

      // Snapshot the pre-buy on-chain stock balance so we can wait for the
      // purchase to be indexed before reconciling the wallet store (below).
      // Deliberately NOT awaited here: nothing on the signing path needs it, and
      // awaiting put a full RPC round-trip in front of every buy. Only the
      // background indexing poll consumes it (after the tx has landed, by which
      // point this has long since resolved).
      const stockBeforePromise: Promise<bigint> =
        side === 'buy' && hasValidMint(execMint)
          ? getOnchainTokenBalance(walletAddress, execMint)
              .then((b) => BigInt(b.amount))
              .catch(() => 0n)
          : Promise.resolve(0n);

      // After a buy, defer the reconciling refresh until Helius reflects the new
      // position. Refreshing immediately would replace the optimistic add with a
      // pre-indexed snapshot that lacks the just-bought asset — which disables
      // the Sell button while the user actually holds it. The optimistic add
      // bridges the UI until the poll confirms the balance and refreshes.
      const refreshAfterBuyIndexed = () => {
        void (async () => {
          const stockBefore = await stockBeforePromise;
          const deadline = Date.now() + 15_000;
          for (;;) {
            try {
              const { amount } = await getOnchainTokenBalance(walletAddress, execMint);
              if (BigInt(amount) > stockBefore) break;
            } catch {
              // transient RPC error — keep polling until the deadline
            }
            if (Date.now() >= deadline) break;
            await new Promise((resolve) => setTimeout(resolve, 1_500));
          }
          await walletStore.refresh();
        })();
      };

      // Spot buys try the atomic one-transaction path first. RFQ-only tokens and
      // oversized routes fall back to the order/execute path below. The build
      // was usually already started on touch-down (prebuildAtomicBuy) — reuse it
      // (awaiting the in-flight promise if it hasn't landed yet) so the tap
      // doesn't pay the ~2s build again.
      if (side === 'buy') {
        const buyCacheKey = buildKey(walletAddress, execTradeMint, inputAmount);
        const cachedBuy = prebuiltBuyRef.current;
        const atomic =
          cachedBuy && cachedBuy.key === buyCacheKey && Date.now() - cachedBuy.builtAt < PREBUILD_TTL_MS
            ? await cachedBuy.promise
            : await createAtomicBuyTransaction({
                taker: walletAddress,
                outputMint: execTradeMint,
                amountInUsdc: inputAmount,
              });
        // A build is single-use: its blockhash is now spent (or the attempt
        // failed), so never let a retry reuse it.
        prebuiltBuyRef.current = null;
        if (atomic.rejected) {
          // A verdict on Metis's price, not on the token: the order/execute
          // path below also reaches Ultra's RFQ makers (Ondo prestocks quote
          // ~$460 there and nowhere else) and runs the same guard on whatever
          // it builds. Skip the atomic path, let the next venue try, and stop
          // for real only if that one is refused too — it answers 422.
          console.log('[atomic-buy] price rejected, trying order/execute', {
            reason: atomic.rejectionReason,
          });
        } else if (!atomic.fallback && atomic.transaction) {
          const atomicSig = await signAndSendBase64(wallet, atomic.transaction, {
            skipSimulation: true,
            // Return as soon as the swap is in a block rather than holding the
            // UI for the commitment level; requireConfirmed still rejects a tx
            // we never saw land. Final state reconciles in the background below.
            fastConfirm: true,
            requireConfirmed: true,
          });
          // Success handling mirrors the spot-buy branch below. The ledger write
          // and the cost-basis reload are bookkeeping — the trade already landed
          // — so they must NOT sit between the send and the success callback.
          // reloadCostBasis merges the local ledger with the server's, so it's
          // chained after recordBuy rather than run alongside it.
          const estQty = currentPrice && currentPrice > 0 ? usdNotional / currentPrice : 0;
          if (estQty > 0) walletStore.optimisticAdjust(bookkeepingMint, estQty, usdNotional);
          void (async () => {
            try {
              if (estQty > 0) {
                await recordBuy(walletAddress, bookkeepingMint, estQty, usdNotional);
              }
              await walletStore.reloadCostBasis();
            } catch {
              // Local bookkeeping only — the buy already landed on-chain.
            }
          })();
          if (atomicSig) {
            void recordWalletTransaction({
              direction: 'buy',
              amount: usdToUsdcSmallest(usdNotional).toString(),
              txHash: atomicSig,
              asset: bookkeepingMint,
              ...(resolvedSymbol ? { symbol: resolvedSymbol } : {}),
              ...(options?.icon ? { logoUrl: options.icon } : {}),
            }).catch(() => {});
          }
          options?.onBuySuccess?.(tradeCtx);
          setAmount('');
          options?.onAfterSubmit?.();
          refreshAfterBuyIndexed();
          options?.onSuccess?.(tradeCtx);
          return;
        }
      }

      // Sells: try the gasless Router-build + /api/solana/send path (one
      // signature, fast submitted state) instead of the slower Ultra
      // order→execute round trip. The token is already
      // liquid. Falls back to order/execute below on RFQ-only / oversized /
      // sim-failure / 429.
      if (side === 'sell') {
        // The touch-down / settle pre-build usually already built this exact
        // swap alongside the clamp — reuse it rather than rebuilding.
        const prebuiltBuild = prebuiltSell?.build;
        const atomicSell =
          prebuiltBuild && !prebuiltBuild.fallback && prebuiltBuild.transaction
            ? prebuiltBuild
            : await createAtomicSellTransaction({
                taker: walletAddress,
                inputMint: activeSellTradeMint,
                amount: inputAmount,
              });
        // Single-use: the blockhash is spent (or the attempt failed) — never let
        // a retry reuse this build.
        prebuiltSellRef.current = null;
        if (atomicSell.rejected) {
          // Same reasoning as the buy branch: try the other venue rather than
          // stranding the user in a position they can't exit. Selling into an
          // empty book is how the second half of that $2.50 loss happened, and
          // order/execute is guarded too.
          console.log('[atomic-sell] price rejected, trying order/execute', {
            reason: atomicSell.rejectionReason,
          });
        } else if (!atomicSell.fallback && atomicSell.transaction) {
          // Require the sell to have actually landed before we show success.
          // requireConfirmed throws (→ caught below, error toast, no success
          // screen) on a merely-submitted "pending" tx that might never land —
          // the failure mode this guard exists for. It does accept "processed",
          // which is a real landing one commitment level early.
          const sellResult = await signAndSendBase64WithResult(wallet, atomicSell.transaction, {
            skipSimulation: true,
            fastConfirm: true,
            requireConfirmed: true,
          });
          const sellSig = sellResult.signature;
          // Optimistic balance adjustment mirrors the order/execute sell branch.
          const proceedsUsd = currentPrice && stockQtyInput > 0 ? stockQtyInput * currentPrice : 0;
          const sellPnl = stockQtyInput > 0
            ? await getSellTradePnl(walletAddress, bookkeepingMint, stockQtyInput, proceedsUsd)
            : null;
          if (stockQtyInput > 0) {
            const estUsd = currentPrice ? stockQtyInput * currentPrice : 0;
            const removeUsd = currentPrice ? sellQtyOptimistic * currentPrice : estUsd;
            walletStore.optimisticAdjust(bookkeepingMint, -sellQtyOptimistic, -removeUsd);
            if (estUsd > 0) walletStore.optimisticAdjust(SOLANA_USDC_MINT, estUsd, estUsd);
          }
          // Bookkeeping only — the sell already landed, so none of this belongs
          // between the send and the success screen. sellPnl above was computed
          // from the pre-sell ledger, so recording after it is still correct.
          if (isLandedTxStatus(sellResult.status)) {
            const estUsd = currentPrice ? stockQtyInput * currentPrice : 0;
            void (async () => {
              try {
                if (stockQtyInput > 0) {
                  await recordSell(walletAddress, bookkeepingMint, stockQtyInput, estUsd);
                }
                await walletStore.reloadCostBasis();
              } catch {
                // Local bookkeeping only — the sell already landed on-chain.
              }
            })();
          }
          if (isLandedTxStatus(sellResult.status) && sellSig) {
            // The Closed tab derives realized P&L from this durable record, but
            // it no longer holds up the success screen: getClosedPositions (and
            // the other readers of these rows) settle in-flight records before
            // fetching, so navigating there straight away still sees this sell.
            void recordWalletTransaction({
              direction: 'sell',
              amount: usdToUsdcSmallest(usdNotional).toString(),
              txHash: sellSig,
              asset: bookkeepingMint,
              ...(resolvedSymbol ? { symbol: resolvedSymbol } : {}),
              ...(options?.icon ? { logoUrl: options.icon } : {}),
            }).catch(() => {});
          }
          // Proceeds stay liquid in the wallet as spendable cash.
          const sellCtx = {
            ...tradeCtx,
            amount: formatCashAmount(proceedsUsd),
            proceedsUsd,
            realizedPnlUsd: sellPnl?.realizedPnlUsd ?? null,
            realizedPnlPct: sellPnl?.realizedPnlPct ?? null,
          };
          setAmount('');
          setSellMaxRequested(false);
          options?.onAfterSubmit?.();
          void walletStore.refresh();
          options?.onSellSuccess?.(sellCtx);
          options?.onSuccess?.(sellCtx);
          return;
        }
      }

      // Only the legacy order/execute fallback needs the raw provider (the
      // atomic paths above sign through signAndSendBase64), so resolve it here
      // rather than ahead of the fast path.
      const provider = await wallet.getProvider();

      const order = await createJupiterOrder({
        inputMint: side === 'sell' ? activeSellTradeMint : execTradeMint,
        outputMint: side === 'sell' ? SOLANA_USDC_MINT : execTradeMint,
        amount: inputAmount,
        taker: walletAddress,
        // Sells go straight from "build order" → wallet signature → execute.
        // The JupiterZ RFQ quote would expire during that signing delay and
        // fail with "Internal error", so force the Metis aggregator route.
        ...(side === 'sell' ? { excludeRouters: 'jupiterz' } : {}),
      });
      const transaction = deserializeTransaction(order.transaction);
      const signedPayload = await provider.request({
        method: 'signTransaction',
        params: { transaction },
      });
      const signedTransaction = serializeSignedTransaction(signedPayload.signedTransaction);
      const result = await executeJupiterOrder({
        signedTransaction,
        requestId: order.requestId,
        ...(order.lastValidBlockHeight ? { lastValidBlockHeight: order.lastValidBlockHeight } : {}),
      });

      const swapFailed =
        (!!result.errorMessage && !result.signature && !result.txid) ||
        (result.status != null && /fail/i.test(result.status)) ||
        (result.code !== null && result.code !== 0) ||
        (!result.signature && !result.txid);
      if (swapFailed) {
        toast.showToast(result.errorMessage ?? 'Swap failed to land. Please try again.', 'error');
        // Rollback optimistic deductions
        if (side === 'buy') {
          const buyAmountNum = Number(amount);
          const idleDeduction = Math.min(cash.idleUsdc, buyAmountNum);
          if (idleDeduction > 0) {
            walletStore.optimisticAdjust(SOLANA_USDC_MINT, idleDeduction, idleDeduction);
          }
        }
        void walletStore.refresh();
        return;
      }

      let sellPnl: { realizedPnlUsd: number; realizedPnlPct: number | null } | null = null;

      // Trade confirmed — optimistic balance adjustment. The ledger write and the
      // cost-basis reload are bookkeeping behind an already-landed trade, so they
      // run in the background instead of holding up the success screen. sellPnl
      // is still read synchronously (SecureStore only) because the success sheet
      // needs it, and it must be read *before* recordSell mutates the ledger.
      const bookkeeping = async (): Promise<void> => {};
      let writeLedger: () => Promise<void> = bookkeeping;
      if (side === 'buy' && currentPrice && currentPrice > 0) {
        const estQty = usdNotional / currentPrice;
        walletStore.optimisticAdjust(bookkeepingMint, estQty, usdNotional);
        writeLedger = async () => {
          await recordBuy(walletAddress, bookkeepingMint, estQty, usdNotional);
        };
      } else if (side === 'sell' && stockQtyInput > 0) {
        const estUsd = currentPrice ? stockQtyInput * currentPrice : 0;
        const removeUsd = currentPrice ? sellQtyOptimistic * currentPrice : estUsd;
        sellPnl = await getSellTradePnl(walletAddress, bookkeepingMint, stockQtyInput, estUsd);
        walletStore.optimisticAdjust(bookkeepingMint, -sellQtyOptimistic, -removeUsd);
        if (estUsd > 0) walletStore.optimisticAdjust(SOLANA_USDC_MINT, estUsd, estUsd);
        writeLedger = async () => {
          await recordSell(walletAddress, bookkeepingMint, stockQtyInput, estUsd);
        };
      }
      void (async () => {
        try {
          await writeLedger();
          await walletStore.reloadCostBasis();
        } catch {
          // Local bookkeeping only — the trade already landed on-chain.
        }
      })();

      // Record a typed Buy/Sell row for the Activity feed (and hide the raw USDC
      // legs Privy's webhook captures, e.g. the swap amount + referral fee).
      // Best-effort — never block the trade on it.
      const tradeSignature = result.signature ?? result.txid ?? null;
      if (tradeSignature) {
        const record = recordWalletTransaction({
          direction: side,
          amount: usdToUsdcSmallest(usdNotional).toString(),
          txHash: tradeSignature,
          asset: bookkeepingMint,
          ...(resolvedSymbol ? { symbol: resolvedSymbol } : {}),
          ...(options?.icon ? { logoUrl: options.icon } : {}),
        });
        // Never blocks the receipt: readers of these rows (Closed tab, activity,
        // cost basis) wait for in-flight records themselves — see
        // settlePendingTradeRecords in api.ts.
        void record.catch(() => {});
      }

      if (side === 'buy') {
        options?.onBuySuccess?.(tradeCtx);
      }
      setAmount('');
      options?.onAfterSubmit?.();

      // Sale proceeds stay liquid in the wallet.
      if (side === 'sell') {
        const proceedsUsd =
          currentPrice && stockQtyInput > 0 ? stockQtyInput * currentPrice : 0;

        const sellCtx = {
          ...tradeCtx,
          amount: formatCashAmount(proceedsUsd),
          proceedsUsd,
          realizedPnlUsd: sellPnl?.realizedPnlUsd ?? null,
          realizedPnlPct: sellPnl?.realizedPnlPct ?? null,
        };
        options?.onSellSuccess?.(sellCtx);

        // Sells reduce the position; reconciling now is safe.
        void walletStore.refresh();
      } else {
        // Buys: wait for the new holding to be indexed before refreshing, so the
        // Sell button stays enabled on the asset the user just bought.
        refreshAfterBuyIndexed();
      }
      options?.onSuccess?.(tradeCtx);
    } catch (error) {
      const msg = getErrorMessage(error);
      toast.showToast(msg, 'error');
      void walletStore.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  // Block the trade when the entered amount exceeds what the wallet can cover.
  // Buys are sized in USD against total cash (liquid USDC); sells are sized
  // against the spot holding. Skip while balances are still loading so the UI
  // does not flash "insufficient" before they resolve.
  const numericAmount = Number(amount);
  const hasNumericAmount =
    amount.length > 0 && Number.isFinite(numericAmount) && numericAmount > 0;
  const balanceReady =
    side === 'buy' ? !cash.loading : !balanceLoading;
  const insufficientBalance =
    hasNumericAmount &&
    balanceReady &&
    typeof availableBalance === 'number' &&
    // Tolerance absorbs the rounding in the "Max"/percent presets (which format
    // the balance to a few decimals and can land a hair above the raw value) so
    // selling/spending the full balance isn't falsely blocked.
    numericAmount > availableBalance + Math.max(availableBalance * 1e-6, 1e-6);

  // Show "Add cash" only when the buy actually can't be covered: the entered
  // amount exceeds the spendable balance ("crossing the limit"). Before any
  // amount is typed we only nudge if the wallet is genuinely empty — a wallet
  // with cash should land on BUY so small affordable buys aren't blocked.
  const needsCash =
    side === 'buy' &&
    !cash.loading &&
    !!options?.onRequestAddCash &&
    (insufficientBalance || (!hasNumericAmount && cash.totalCash <= 0));

  const confirmLabel = needsCash ? 'Add cash' : undefined;

  // A closed US session is a fact about the venue, not a transient miss: the
  // RFQ makers behind these wrappers will not quote again until the opening
  // bell, so the trade cannot succeed and the button says so instead of
  // spending a signature to find out. Every OTHER unavailable code stays
  // advisory — "no route right now" is often a momentary miss, and the
  // execution path (and its guard) is still the authority on whether a trade
  // can proceed.
  const blockedByClosedMarket = quotePreview.preview?.unavailable?.code === 'market_closed';
  // A build that cannot become a trade only spends the shared Jupiter bucket.
  buyPrebuildBlockedRef.current = insufficientBalance || blockedByClosedMarket;

  const canConfirm =
    needsCash ||
    (!!walletAddress &&
      !!wallet &&
      // A sell needs the mint it will actually spend (and, when that's a
      // different variant, its price) resolved before the button arms.
      (side === 'sell' ? sellReady : hasValidMint(tradeMint)) &&
      !submitting &&
      !insufficientBalance &&
      !blockedByClosedMarket &&
      hasNumericAmount);

  /**
   * Essential terms for the pad's drop-up detail panel.
   *
   * Sourced entirely from the venue's own answer, so a row appears only when
   * that field came back. `minReceived` is the one worth reading: it is the
   * on-chain floor the swap reverts below, i.e. the only number here the chain
   * itself enforces.
   */
  // Token amounts span many orders of magnitude across xStocks and prestocks,
  // so precision follows size rather than a fixed scale — same rule as
  // TradeQuotePreviewRow, so the panel and the inline row never disagree.
  const formatQty = (value: number): string =>
    value === 0
      ? '0'
      : value < 0.001
        ? value.toExponential(2)
        : value < 1
          ? value.toFixed(6)
          : value < 1000
            ? value.toFixed(4)
            : value.toLocaleString('en-US', { maximumFractionDigits: 2 });

  const detailRows = useMemo((): TradeDetailRow[] => {
    const preview = quotePreview.preview;
    if (!preview || !preview.ok) return [];
    const rows: TradeDetailRow[] = [];
    const unit = side === 'sell' ? 'USDC' : tradeSymbol;

    if (preview.spent !== null) {
      rows.push({
        label: 'You pay',
        value: side === 'sell' ? `${formatQty(preview.spent)} ${tradeSymbol}`.trim() : `$${preview.spent.toFixed(2)}`,
      });
    }
    if (preview.expectedReceived !== null) {
      rows.push({ label: 'You receive', value: `${formatQty(preview.expectedReceived)} ${unit}`.trim() });
    }
    if (preview.minReceived !== null) {
      rows.push({ label: 'Minimum received', value: `${formatQty(preview.minReceived)} ${unit}`.trim() });
    }
    if (preview.pricePerTokenUsd !== null) {
      rows.push({ label: 'Effective price', value: `$${preview.pricePerTokenUsd.toFixed(preview.pricePerTokenUsd < 1 ? 4 : 2)}` });
    }
    if (preview.firmQuote) {
      // An RFQ maker quotes a fixed price: there is no band, and printing
      // "0.00%" would imply a tolerance that does not exist here.
      rows.push({ label: 'Quote', value: 'Firm (no slippage)' });
    } else if (preview.maxSlippagePct !== null) {
      rows.push({
        label: 'Max slippage',
        value: `${preview.maxSlippagePct.toFixed(2)}%`,
        tone: preview.maxSlippagePct >= 2 ? 'warn' : 'default',
      });
    }
    return rows;
  }, [quotePreview.preview, side, tradeSymbol]);

  return {
    amount,
    side,
    message,
    amountUnitSymbol,
    amountUnitLabel,
    availableLabel,
    estimateLabel,
    /**
     * The price the CURRENT side trades at — the traded mint's own market print.
     * Anything valuing what a trade returns must use this rather than the
     * header price: the header shows the listed share (and follows the chart
     * scrub), so valuing a fill with it prints a gain or loss that is really
     * just the gap between two instruments.
     */
    unitPriceUsd: side === 'sell' ? sellSizingPrice : buyPrice,
    /** Live venue terms for the typed amount — see useTradeQuotePreview. */
    quotePreview,
    /** Those same terms, shaped for the pad's drop-up panel. */
    detailRows,
    hasSellableBalance,
    submitting,
    canConfirm,
    confirmLabel,
    /** The confirm action is a deposit, not a trade — see TradeAmountPad's `addCash`. */
    needsCash,
    reset,
    tapDigit,
    tapPreset,
    // In the "Add cash" state the confirm button opens the deposit flow instead
    // of executing a trade.
    onSubmit: needsCash && options?.onRequestAddCash ? options.onRequestAddCash : onSubmit,
    // Touch-down warm-up: starts the swap build during the press so the release
    // only has to sign + send. No-op in the "Add cash" state.
    onSubmitPressIn: needsCash && options?.onRequestAddCash ? () => {} : onSubmitPressIn,
  };
}

export function StockTradeActions({
  onTrade,
  hasPosition,
  onAddCash,
  disableGlass = false,
}: StockTradeActionsProps) {
  const { colors, scheme } = useThemeStore();
  const isDark = scheme === 'dark';
  const cash = useCash();
  // Replace BUY with "Add cash" when the user can't cover a buy — but only when a
  // deposit flow is wired in (otherwise the button would do nothing) and the
  // balance has actually resolved (so we don't flash Add cash on a loading 0).
  // Entry "Buy" button: only becomes "Add cash" for a genuinely empty wallet, so
  // any user with spendable cash can open the buy sheet and size their order.
  const showAddCash = !!onAddCash && !cash.loading && cash.totalCash <= 0;
  const useGlass = HAS_GLASS && !disableGlass;

  const buyGlassStyle = {
    backgroundColor: withAlpha(colors.actionBuy, isDark ? 0.3 : 0.04),
    borderColor: withAlpha(colors.actionBuy, isDark ? 0.65 : 0.15),
    borderWidth: 1,
  };

  const sellGlassStyle = {
    backgroundColor: withAlpha(colors.actionSell, isDark ? 0.3 : 0.04),
    borderColor: withAlpha(colors.actionSell, isDark ? 0.65 : 0.15),
    borderWidth: 1,
  };

  const addCashGlassStyle = {
    backgroundColor: withAlpha(colors.actionPrimary, isDark ? 0.08 : 0.05),
    borderColor: withAlpha(colors.actionPrimary, isDark ? 0.3 : 0.15),
    borderWidth: 1,
  };

  const buyTextStyle = [
    styles.buyButtonText,
    {
      textShadowColor: withAlpha(colors.actionBuy, 0.4),
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 6,
    },
  ];

  const sellTextStyle = [
    styles.buyButtonText,
    {
      textShadowColor: withAlpha(colors.actionSell, 0.4),
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 6,
    },
  ];

  const addCashTextStyle = [
    styles.buyButtonText,
    {
      textShadowColor: withAlpha(colors.actionPrimary, 0.4),
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 6,
    },
  ];

  // Primary action — either BUY or, when the balance is too low, Add cash. Same
  // shell/size either way; `shellStyle` controls full-width vs half (with SELL).
  const renderPrimary = (shellStyle: object) =>
    showAddCash ? (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Add cash"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onAddCash?.();
        }}
        scaleTo={useGlass ? CTA_GLASS_SCALE : CTA_SOLID_SCALE}
        style={[styles.buttonShell, shellStyle]}>
        {useGlass ? (
          <GlassView
            glassEffectStyle="clear"
            isInteractive
            tintColor={isDark ? withAlpha(colors.actionPrimary, 0.25) : colors.actionPrimary}
            colorScheme={isDark ? 'dark' : 'light'}
            style={[styles.buttonFill, addCashGlassStyle]}>
            <CtaGlassFill color={colors.actionPrimary} isDark={isDark} />
            <Text style={addCashTextStyle}>Add cash</Text>
          </GlassView>
        ) : (
          <View style={[styles.buttonFill, { overflow: 'hidden' }]}>
            <CtaGlassFill color={colors.actionPrimary} isDark={isDark} glass={false} />
            <Text style={styles.buyButtonText}>Add cash</Text>
          </View>
        )}
      </PressableScale>
    ) : (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Buy"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onTrade?.('buy');
        }}
        scaleTo={useGlass ? CTA_GLASS_SCALE : CTA_SOLID_SCALE}
        style={[styles.buttonShell, shellStyle]}>
        {useGlass ? (
          <GlassView
            glassEffectStyle="clear"
            isInteractive
            tintColor={ctaGlassTint(colors.actionBuy, isDark)}
            colorScheme={isDark ? 'dark' : 'light'}
            style={[styles.buttonFill, buyGlassStyle]}>
            <CtaGlassFill color={colors.actionBuy} isDark={isDark} />
            <Text style={buyTextStyle}>BUY</Text>
          </GlassView>
        ) : (
          <View style={[styles.buttonFill, { overflow: 'hidden' }]}>
            <CtaGlassFill color={colors.actionBuy} isDark={isDark} glass={false} />
            <Text style={styles.buyButtonText}>BUY</Text>
          </View>
        )}
      </PressableScale>
    );

  if (hasPosition) {
    return (
      <View style={[styles.container, styles.row]}>
        {renderPrimary(styles.halfButtonShell)}

        <PressableScale
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onTrade?.('sell');
          }}
          scaleTo={useGlass ? CTA_GLASS_SCALE : CTA_SOLID_SCALE}
        style={[styles.buttonShell, styles.halfButtonShell]}>
          {useGlass ? (
            <GlassView
              glassEffectStyle="clear"
              isInteractive
              tintColor={ctaGlassTint(colors.actionSell, isDark)}
              colorScheme={isDark ? 'dark' : 'light'}
              style={[styles.buttonFill, sellGlassStyle]}>
              <CtaGlassFill color={colors.actionSell} isDark={isDark} />
              <Text style={sellTextStyle}>SELL</Text>
            </GlassView>
          ) : (
            <View style={[styles.buttonFill, { overflow: 'hidden' }]}>
              <CtaGlassFill color={colors.actionSell} isDark={isDark} glass={false} />
              <Text style={styles.buyButtonText}>SELL</Text>
            </View>
          )}
        </PressableScale>
      </View>
    );
  }

  return <View style={styles.container}>{renderPrimary(styles.buyShell)}</View>;
}

const styles = StyleSheet.create({
  container: {
    // The row owns its distance from the screen edge (its hosts pin it flush)
    // so the corners below can be cut to match the display's.
    paddingHorizontal: CTA.inset,
    paddingVertical: 2,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  // Pressable shell owns sizing + rounding (with overflow:hidden so the glass /
  // gradient fill is clipped to the rounded corners); the inner GlassView or
  // LinearGradient paints the fill.
  buttonShell: {
    borderRadius: CTA.radius,
    overflow: 'hidden',
  },
  buyShell: {
    alignSelf: 'stretch',
  },
  halfButtonShell: {
    flex: 1,
  },
  buttonFill: {
    alignItems: 'center',
    justifyContent: 'center',
    height: CTA_BUTTON_HEIGHT,
  },
  buyButtonText: {
    color: '#ffffff',
    fontSize: CTA_LABEL_SIZE,
    fontFamily: CTA_LABEL_FONT,
    letterSpacing: 1,
  },
});
