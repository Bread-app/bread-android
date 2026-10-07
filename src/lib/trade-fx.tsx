import React, { useEffect, useState } from 'react';

import { router } from 'expo-router';

import { BuySuccessSheet } from '@/components/buy-success-sheet';
import type { SandwichSource } from '@/lib/api';
import { takeComposerRoute, type TakeComposerTarget } from '@/lib/position-takes';

/**
 * Celebration overlays for the trades that had none.
 *
 * Every trade on Bread now ends on the same screen: `BuySuccessSheet`, the
 * full-screen receipt a stock buy has always opened. Perps and Sandwiches used
 * to each celebrate in a private language — perps had a 2.1s neon burst of
 * streaks and shock rings on a timer, Sandwiches had stacking slabs — which
 * meant three different answers to "did that go through?" depending on which
 * pad you were standing in.
 *
 * They now differ only where the trade genuinely differs:
 *
 *  - perps    → the receipt carries a LONG/SHORT badge with the leverage, the
 *               fill price, and the margin behind it. Closing swaps the verb
 *               and leads with realized PnL.
 *  - sandwich → the hero is a fan of the leg logos instead of one token.
 *
 * The other consequence of the move: these are dismissed by the person reading
 * them, not yanked away on a `setTimeout`. Nobody ever finished reading the
 * old burst.
 *
 * Mounted once at the app root (see `app/(app)/_layout.tsx`) and driven
 * imperatively, so a call site fires it from inside a bottom sheet without
 * owning any of the animation state:
 *
 *   const fx = useTradeFx();
 *   fx.playPerp({ action: 'open', side: 'long', symbol: 'TSLA', leverage: 10 });
 */

export type PerpFxEvent = {
  action: 'open' | 'close';
  side: 'long' | 'short';
  symbol: string;
  /** Shows the receipt as progress without firing its success animation. */
  loading?: boolean;
  /** Display name for the receipt's asset row; falls back to the symbol. */
  name?: string | null;
  logoUri?: string | null;
  /**
   * Further artwork to try when `logoUri` misses — pass
   * `perpLogoSources(position).fallbackUris`. A perp's best face is the
   * asset's tokens.xyz art, and Phoenix's own mark is an SVG that a bare
   * `<Image>` renders as nothing at all, which is how the receipt ended up
   * icon-less.
   */
  logoFallbackUris?: (string | null | undefined)[];
  /** Entry leverage, stamped beside the direction badge. */
  leverage?: number | null;
  /** Fill price on the way in, the position's entry on the way out. */
  entryPrice?: number | null;
  /** Mark the exit filled at. Closing only — it is half of the entry→exit pair. */
  exitPrice?: number | null;
  /** Collateral behind the position. */
  marginUsd?: number | null;
  /**
   * The figure the receipt leads with. Defaults to `marginUsd` — the money that
   * actually moved — rather than notional, which would overstate every trade by
   * the leverage multiple.
   */
  amountUsd?: number | null;
  /** Realized PnL in USD, revealed when closing. */
  pnlUsd?: number | null;
  /**
   * What the exit actually pays out: the collateral this close frees plus the
   * PnL it books. Defaults to `marginUsd + pnlUsd` when both are known, and
   * this — not the margin alone — is the figure a close leads with, because
   * "what did I walk away with" is the only question an exit answers.
   */
  exitValueUsd?: number | null;
  /**
   * The position this open created, for the receipt's "Add thesis" button.
   * Opens only — there is nothing to hold after a close.
   */
  thesis?: TakeComposerTarget | null;
};

export type SandwichFxEvent = {
  action: 'buy' | 'sell';
  /** Shows the receipt as progress ("selling…") without firing its success animation. */
  loading?: boolean;
  /** One entry per leg, in stack order; drives both the slabs and the confetti. */
  icons: (string | null | undefined)[];
  label?: string | null;
  /** Realized PnL in USD, revealed on a sell. */
  pnlUsd?: number | null;
  /**
   * How the sandwich itself has done since it was created — the percentage its
   * feed card shows. Independent of this trade: a buy has it too.
   */
  sincePnlPct?: number | null;
  /** Fraction sold, when it isn't the whole position (25 / 50 / 100). */
  percent?: number | null;
  /** USD put in on a buy, or taken out on a sell — the figure the screen leads with. */
  amountUsd?: number | null;
  /** What was said at the moment this sandwich came from. */
  caption?: string | null;
  /**
   * The sandwich's source, so the receipt can show the X post the thesis came
   * from. Buy and sell both carry it — a sell is a receipt for the same idea.
   */
  source?: SandwichSource | null;
  /** The position this buy created, for the receipt's "Add thesis" button. Buys only. */
  thesis?: TakeComposerTarget | null;
};

/** Push the composer for a receipt's position. Shared by both receipts. */
function openThesisComposer(target: TakeComposerTarget) {
  const route = takeComposerRoute(target);
  router.push({ pathname: route.pathname as never, params: route.params });
}

type TradeFx =
  | ({ id: number; kind: 'perp'; open: boolean } & PerpFxEvent)
  | ({ id: number; kind: 'sandwich'; open: boolean } & SandwichFxEvent);

type TradeFxContextValue = {
  /** Opens a perp receipt and returns the id used to update or dismiss it. */
  playPerp: (event: PerpFxEvent) => number;
  updatePerp: (id: number, event: PerpFxEvent) => void;
  dismissPerp: (id: number) => void;
  /** Opens a Sandwich receipt and returns the id used to update or dismiss it. */
  playSandwich: (event: SandwichFxEvent) => number;
  updateSandwich: (id: number, event: SandwichFxEvent) => void;
  dismissSandwich: (id: number) => void;
};

let fxIdSeq = 1;

/**
 * Dispatch is a module singleton, NOT React context.
 *
 * The screens that fire these bursts are portalled: the perp market view and
 * the Sandwich pads render through gorhom's portal, which re-parents their JSX
 * above every provider in `app/(app)/_layout.tsx`. A `useContext` read from in
 * there comes back empty — which is exactly why opening a perp played nothing
 * at all, silently, while the same code worked from an unportalled screen. See
 * [[bottom-sheet-context-loss]]. A module-level emitter has no such tree to be
 * torn out of, so a call site can be anywhere.
 */
type TradeFxSignal =
  | TradeFx
  | { kind: 'dismiss-perp'; id: number }
  | { kind: 'dismiss-sandwich'; id: number };
type Emitter = (fx: TradeFxSignal) => void;

let emitFx: Emitter | null = null;
/** A burst fired before the host mounted; replayed as soon as it does. */
let pendingFx: TradeFxSignal | null = null;

function dispatchFx(fx: TradeFxSignal) {
  if (emitFx) emitFx(fx);
  else pendingFx = fx;
}

export function playPerpFx(event: PerpFxEvent): number {
  const id = fxIdSeq++;
  dispatchFx({ id, kind: 'perp', open: true, ...event });
  return id;
}

export function updatePerpFx(id: number, event: PerpFxEvent) {
  dispatchFx({ id, kind: 'perp', open: true, ...event });
}

export function dismissPerpFx(id: number) {
  dispatchFx({ id, kind: 'dismiss-perp' });
}

export function playSandwichFx(event: SandwichFxEvent): number {
  const id = fxIdSeq++;
  dispatchFx({ id, kind: 'sandwich', open: true, ...event });
  return id;
}

export function updateSandwichFx(id: number, event: SandwichFxEvent) {
  dispatchFx({ id, kind: 'sandwich', open: true, ...event });
}

export function dismissSandwichFx(id: number) {
  dispatchFx({ id, kind: 'dismiss-sandwich' });
}

const TRADE_FX: TradeFxContextValue = {
  playPerp: playPerpFx,
  updatePerp: updatePerpFx,
  dismissPerp: dismissPerpFx,
  playSandwich: playSandwichFx,
  updateSandwich: updateSandwichFx,
  dismissSandwich: dismissSandwichFx,
};

/**
 * Handle for firing a burst. Stable across renders, so it is safe in a
 * `useCallback` dependency list.
 */
export function useTradeFx(): TradeFxContextValue {
  return TRADE_FX;
}

/** Mounts the overlay host. One per app, at the root. */
export function TradeFxProvider({ children }: { children: React.ReactNode }) {
  // Both kinds open the same receipt, and both are dismissed by the person
  // reading them. They stay in separate state only so a perp and a Sandwich
  // fired back to back can't clobber each other's props mid-animation.
  const [perpFx, setPerpFx] = useState<Extract<TradeFx, { kind: 'perp' }> | null>(null);
  const [sandwichFx, setSandwichFx] = useState<
    Extract<TradeFx, { kind: 'sandwich' }> | null
  >(null);

  useEffect(() => {
    const emit: Emitter = (next) => {
      // A dismissal keeps the receipt's props and only flips `open`, so it can
      // fade out with the numbers it was showing instead of blanking first.
      if (next.kind === 'dismiss-perp') {
        setPerpFx((current) => (current?.id === next.id ? { ...current, open: false } : current));
        return;
      }
      if (next.kind === 'dismiss-sandwich') {
        setSandwichFx((current) =>
          current?.id === next.id ? { ...current, open: false } : current,
        );
        return;
      }
      if (next.kind === 'sandwich') setSandwichFx(next);
      else setPerpFx(next);
    };
    emitFx = emit;
    if (pendingFx) {
      const queued = pendingFx;
      pendingFx = null;
      emit(queued);
    }
    return () => {
      if (emitFx === emit) emitFx = null;
    };
  }, []);

  return (
    <>
      {children}
      <PerpSuccessScreen
        fx={perpFx}
        onClose={() => setPerpFx((current) => (current ? { ...current, open: false } : null))}
      />
      <SandwichSuccessScreen
        fx={sandwichFx}
        onClose={() =>
          setSandwichFx((current) => (current ? { ...current, open: false } : null))
        }
      />
    </>
  );
}

/**
 * Perp open/close receipt.
 *
 * The same component a stock buy opens, plus the `perp` block — direction,
 * leverage, fill, margin. What this replaced was a bespoke 2.1-second burst
 * (streaks, shock rings, chevrons, a leverage stamp) that read as a different
 * app from the rest of the trade surface and cut itself off on a timer before
 * the numbers could be read.
 */
function PerpSuccessScreen({
  fx,
  onClose,
}: {
  fx: Extract<TradeFx, { kind: 'perp' }> | null;
  onClose: () => void;
}) {
  if (!fx) return null;

  const closing = fx.action === 'close';
  const pnlUsd = closing ? (fx.pnlUsd ?? null) : null;
  // What a close pays out: the collateral it frees plus the PnL it books.
  const exitValue = closing
    ? (fx.exitValueUsd ??
      (fx.marginUsd != null && Number.isFinite(fx.marginUsd)
        ? fx.marginUsd + (pnlUsd ?? 0)
        : null))
    : null;
  // Margin is the money that moved. Notional would read as a far bigger trade
  // than the one that was made, which is exactly the lie leverage invites.
  // On the way out the headline is the payout instead.
  const amount = closing
    ? (exitValue ?? fx.amountUsd ?? fx.marginUsd ?? null)
    : (fx.amountUsd ?? fx.marginUsd ?? null);
  const symbol = fx.symbol.toUpperCase();

  return (
    <BuySuccessSheet
      // Keyed per event so a second trade replays the burst from zero instead
      // of leaving the previous one's springs settled.
      key={fx.id}
      visible={fx.open}
      loading={fx.loading ?? false}
      amount={
        amount != null && Number.isFinite(amount) && amount > 0
          ? // An exit is a payout, and cents are part of a payout — rounding
            // them off on the way out reads as an estimate.
            closing
            ? amount.toFixed(2)
            : String(Math.round(amount))
          : ''
      }
      assetName={fx.name?.trim() || symbol}
      assetSymbol={symbol}
      assetIcon={fx.logoUri ?? null}
      assetIconFallbacks={fx.logoFallbackUris ?? null}
      // A close is the exit side of the trade, and `side` is what tells the
      // shareable card to carry realized PnL. The verb it would normally pick
      // from this ("You sold") is overridden by `perp` below.
      side={closing ? 'sell' : 'buy'}
      realizedPnlUsd={pnlUsd}
      // Return on the collateral that was actually at risk — the only
      // denominator a leveraged exit has that means anything to the person
      // who put the money up.
      realizedPnlPct={
        closing &&
        pnlUsd != null &&
        fx.marginUsd != null &&
        Number.isFinite(fx.marginUsd) &&
        fx.marginUsd > 0
          ? (pnlUsd / fx.marginUsd) * 100
          : null
      }
      perp={{
        side: fx.side,
        leverage: fx.leverage ?? null,
        entryPrice: fx.entryPrice ?? null,
        exitPrice: closing ? (fx.exitPrice ?? null) : null,
        marginUsd: fx.marginUsd ?? null,
        exitValueUsd: exitValue,
        closing,
      }}
      onClose={onClose}
      onAddThesis={
        !closing && !fx.loading && fx.thesis ? () => openThesisComposer(fx.thesis!) : undefined
      }
    />
  );
}

/**
 * Sandwich buy/sell receipt.
 *
 * Deliberately the very same component a stock buy/sell opens — a basket is a
 * trade like any other, and having it celebrate in its own private language was
 * the odd one out. The one concession to what a Sandwich is: the hero is a fan
 * of the leg logos instead of a single token.
 */
function SandwichSuccessScreen({
  fx,
  onClose,
}: {
  fx: Extract<TradeFx, { kind: 'sandwich' }> | null;
  onClose: () => void;
}) {
  if (!fx) return null;

  const isSell = fx.action === 'sell';
  const partial = isSell && fx.percent != null && fx.percent < 100;
  // What the sold slice cost: the proceeds this receipt leads with, less the
  // profit inside them. Derived rather than passed, because every call site
  // already sends both halves of it.
  const costBasis =
    isSell && fx.amountUsd != null && fx.pnlUsd != null
      ? fx.amountUsd - fx.pnlUsd
      : null;
  const pnlPct =
    costBasis != null && costBasis > 0 && Number.isFinite(costBasis)
      ? (fx.pnlUsd! / costBasis) * 100
      : null;

  return (
    <BuySuccessSheet
      // Keyed per event so a second trade replays the burst from zero instead
      // of leaving the previous one's springs settled.
      key={fx.id}
      visible={fx.open}
      loading={fx.loading ?? false}
      // Whole dollars: the cents on a basket buy are noise on a receipt whose
      // job is "you bought $100 of this", and they cost the figure its weight.
      amount={
        fx.amountUsd != null && Number.isFinite(fx.amountUsd)
          ? String(Math.round(fx.amountUsd))
          : ''
      }
      assetName={fx.label ?? 'Sandwich'}
      assetSymbol=""
      assetIcons={fx.icons}
      side={fx.action}
      realizedPnlUsd={fx.pnlUsd ?? null}
      realizedPnlPct={pnlPct}
      sincePnlPct={fx.sincePnlPct ?? null}
      // The sandwich's name is the title of the moment quoted under the amount,
      // so it wears the feed card's asset/PnL pill instead of a name row.
      identityPill
      noteLabel={partial ? `${Math.round(fx.percent!)}% of your position` : null}
      sourcePost={fx.source ?? null}
      sourceCaption={fx.caption ?? null}
      onClose={onClose}
      onAddThesis={!isSell && !fx.loading && fx.thesis ? () => openThesisComposer(fx.thesis!) : undefined}
    />
  );
}
