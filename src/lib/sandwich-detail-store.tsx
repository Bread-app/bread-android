import { useEmbeddedSolanaWallet, usePrivy } from "@privy-io/expo";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  appUserPayloadFromPrivyUser,
  getSandwichById,
  getUserPortfolio,
  setCardLike,
  type AppUserPayload,
  type Sandwich,
} from "@/lib/api";
import { cardSocial, toggledCardSocial, withCardSocial } from "@/lib/card-social";
import { getAnonymousSocialId } from "@/lib/social-identity";
import { useToast } from "@/lib/toast-store";
import {
  SandwichShareSheet,
  type SandwichShareSheetRef,
} from "@/components/sandwich-share-sheet";
import {
  getStoredSandwichPositions,
  seedFromBackend,
  type SandwichPosition,
} from "@/lib/sandwich-positions";
import type { ToastState } from "@/lib/toast-state";
import {
  NATIVE_ZOOM_SPIKE,
  openWithNativeZoom,
  sandwichNativeZoomSourceKey,
} from "@/lib/native-zoom";

type OpenOptions = {
  /**
   * Fired with the latest sandwich whenever its social state changes here (e.g.
   * a like toggle on the detail screen) so the originating list/row can keep
   * itself in sync — mirroring the old `onSandwichUpdated` host callback.
   */
  onUpdated?: (sandwich: Sandwich) => void;
  /** Open the comment drawer as soon as the detail route is mounted. */
  showComments?: boolean;
  /**
   * The viewer's holding when detail was opened from Profile. Keeping this
   * alongside the post lets the shared detail route show portfolio-specific
   * value and PnL without changing the public Sandwich payload.
   */
  position?: SandwichPosition | null;
  /**
   * Someone ELSE's holding, when detail was opened from their profile. Shown
   * read-only beside the post: valued from their public position row, never
   * from the viewer's wallet, and never wired to buy-more or sell.
   */
  viewedPosition?: ViewedPosition | null;
  /**
   * Open the buy pad as soon as the detail route is mounted — what makes a Buy
   * tap on a feed card land straight on the amount pad instead of asking the
   * user to find the button again.
   */
  showBuy?: boolean;
  /** With `showBuy`: what the pad opens holding. Copy trade's size band. */
  buyAmount?: string | null;
  /**
   * Called one frame after the detail push begins. A native modal opener uses
   * this to stay alive while UIKit captures its marked source, then disappear
   * without covering the zoom transition.
   */
  onNavigationStarted?: () => void;
};

/** Another user's position, with the figures their profile row already showed. */
export type ViewedPosition = {
  position: SandwichPosition;
  valuation: {
    costUsd: number | null;
    valueUsd: number | null;
    pnlUsd: number | null;
    /** Percent, not a fraction: 10.5 is +10.5%. */
    returnPct: number | null;
  };
};

type SandwichDetailContextValue = {
  /** The sandwich currently shown on the detail screen, or null. */
  sandwich: Sandwich | null;
  /** The viewer's position in the active sandwich, when one is known. */
  position: SandwichPosition | null;
  /** Another user's holding in the active sandwich, read-only. */
  viewedPosition: ViewedPosition | null;
  /** Update the active holding after a buy-more or sell completes. */
  updatePosition: (position: SandwichPosition | null) => void;
  appUser: AppUserPayload | null;
  /** Push the full-screen detail route for `sandwich`. */
  open: (sandwich: Sandwich, options?: OpenOptions) => void;
  /** Pop the detail route. */
  close: () => void;
  /**
   * Load the sandwich by id when the screen was reached without one in memory.
   * No-op when the held sandwich already matches. Resolves to false when the id
   * could not be loaded, so the screen can show its empty state.
   */
  recoverById: (id: string) => Promise<boolean>;
  /**
   * The most recent copy of `id` this provider has held, without touching the
   * network. Detail routes stack, and they all read one shared `sandwich` — a
   * screen uses this to keep rendering ITS post while a newer one sits on top.
   */
  peekById: (id: string) => Sandwich | null;
  /** Optimistically like/unlike the active sandwich. */
  toggleLike: () => void;
  /** Keep comment counts synchronized across the detail screen and its opener. */
  updateCommentCount: (threadKey: string, count: number) => void;
  /** Open the themed share sheet for the active sandwich. */
  share: () => void;
  /** Surface a toast (passes through the global toast host). */
  onToast: (toast: ToastState, duration?: number) => void;
};

const SandwichDetailContext = createContext<SandwichDetailContextValue | null>(
  null,
);

/**
 * Owns the single, app-wide sandwich detail *screen* (the route at
 * `(app)/sandwich-detail`). Any list — the feed, search, saved — opens the exact
 * same thesis detail by calling {@link useSandwichDetail}().open(sandwich); this
 * provider holds the active sandwich, drives the like/share/toast wiring once
 * (instead of every screen re-implementing it), and reports social-state changes
 * back to the opener via the `onUpdated` callback.
 *
 * Mounted in `(app)/_layout` *inside* the wallet/toast providers and *above* the
 * router Stack, so both the tab screens (callers) and the detail route consume
 * the same context.
 */
export function SandwichDetailProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user } = usePrivy();
  const appUser = useMemo(() => appUserPayloadFromPrivyUser(user), [user]);
  const appToast = useToast();
  const shareSheetRef = useRef<SandwichShareSheetRef>(null);
  const onUpdatedRef = useRef<OpenOptions["onUpdated"]>(undefined);
  const [sandwich, setSandwich] = useState<Sandwich | null>(null);
  const [position, setPosition] = useState<SandwichPosition | null>(null);
  const walletAddress = useEmbeddedSolanaWallet().wallets?.[0]?.address ?? null;
  // The sandwich id whose `position` is already settled — handed in by the
  // opener, looked up below, or set by a buy/sell. Guards the lookup from
  // resurrecting a position a full sell just cleared.
  const positionSettledForRef = useRef<string | null>(null);
  // Bumped by every open(), so reopening the SAME sandwich re-runs the lookup.
  const [openCount, setOpenCount] = useState(0);
  const [viewedPosition, setViewedPosition] = useState<ViewedPosition | null>(null);
  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  // Every sandwich this provider has shown, by id. Popping back to an earlier
  // detail route restores from here instead of refetching, so Back is instant
  // and never lands on a spinner.
  const seenRef = useRef(new Map<string, Sandwich>());

  const remember = useCallback((value: Sandwich) => {
    const cache = seenRef.current;
    cache.set(value.id, value);
    // Bounded so a long browsing session cannot grow without limit; insertion
    // order makes the oldest entry the first key.
    if (cache.size > 40) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
  }, []);

  const peekById = useCallback((id: string) => seenRef.current.get(id) ?? null, []);

  useEffect(() => {
    let cancelled = false;
    setAnonymousId(null);
    void getAnonymousSocialId(appUser?.privyUserId).then((value) => {
      if (!cancelled) setAnonymousId(value);
    });
    return () => {
      cancelled = true;
    };
  }, [appUser?.privyUserId]);

  // A detail route can remain mounted while Privy swaps users. Never let the
  // next account operate on a post or callback owned by the previous one.
  useEffect(() => {
    setSandwich(null);
    setPosition(null);
    setViewedPosition(null);
    positionSettledForRef.current = null;
    seenRef.current.clear();
    onUpdatedRef.current = undefined;
  }, [appUser?.privyUserId]);

  const onToast = useCallback(
    (toast: ToastState, duration = 2200) => {
      if (!toast) {
        appToast.dismissToast();
        return;
      }
      appToast.showToast(toast.text, toast.tone, duration);
    },
    [appToast],
  );

  // Update the held sandwich and notify the opener so its list row stays in sync.
  const applyUpdate = useCallback((updated: Sandwich) => {
    remember(updated);
    setSandwich((current) =>
      current && current.id === updated.id ? updated : current,
    );
    onUpdatedRef.current?.(updated);
  }, [remember]);

  const open = useCallback(
    (next: Sandwich, options?: OpenOptions) => {
      onUpdatedRef.current = options?.onUpdated;

      // A YouTube-sourced call has exactly one home: its episode screen. Every
      // list — feed, search, saved, a profile, a share deep link — funnels
      // through here, so redirecting at this single point is what keeps the
      // podcast experience from ever splitting back into two screens.
      //
      // `sourceId` rebuilds the episode (the callers only hold one market) and
      // `focus` tells it which call was tapped, so the player opens on that
      // timestamp instead of the top of the video.
      if (next.source.sourceType === 'youtube') {
        setSandwich(null);
        router.push({
          pathname: '/podcast-sandwich',
          params: {
            sourceId: next.sourceId,
            focus: next.id,
            ...(options?.showComments ? { comments: next.id } : {}),
          },
        });
        return;
      }

      remember(next);
      setSandwich(next);
      setPosition(options?.position ?? null);
      positionSettledForRef.current = options?.position ? next.id : null;
      setOpenCount((count) => count + 1);
      setViewedPosition(options?.viewedPosition ?? null);
      // `id` rides along purely as a recovery key. The context above is still
      // the fast path — this is what lets the screen refetch itself when it is
      // reached cold (a share link, a Privy user swap, a state loss) instead of
      // showing "Sandwich unavailable".
      const pushDetail = () => {
        router.push({
          pathname: "/sandwich-detail",
          params: {
            id: next.id,
            ...(options?.showComments ? { comments: "1" } : {}),
            ...(options?.showBuy ? { buy: "1" } : {}),
            ...(options?.showBuy && options.buyAmount ? { amount: options.buyAmount } : {}),
          },
        });
        if (options?.onNavigationStarted) {
          requestAnimationFrame(options.onNavigationStarted);
        }
      };

      if (NATIVE_ZOOM_SPIKE) {
        // Every ordinary post card uses the namespaced id below as its native
        // source marker. A cold/deep-link open has no marked row, in which case
        // the patched stack simply keeps its normal push animation.
        openWithNativeZoom(sandwichNativeZoomSourceKey(next.id), pushDetail);
      } else {
        pushDetail();
      }
    },
    [remember, router],
  );

  const close = useCallback(() => {
    router.back();
  }, [router]);

  // Guards against a slow refetch landing after the user has moved on to a
  // different sandwich, which would swap the screen's contents under them.
  const recoveringRef = useRef<string | null>(null);

  const recoverById = useCallback(
    async (id: string) => {
      if (!id || sandwich?.id === id) return true;
      // Already seen: this is a pop back to an earlier detail route, not a cold
      // entry. Restoring from memory is what stops the screen from showing the
      // sandwich the *newer* route opened.
      const cached = seenRef.current.get(id);
      if (cached) {
        recoveringRef.current = null;
        setSandwich(cached);
        return true;
      }
      if (recoveringRef.current === id) return true;
      recoveringRef.current = id;
      let fetched: Sandwich | null = null;
      try {
        fetched = await getSandwichById(id, anonymousId);
      } catch {
        fetched = null;
      }
      if (recoveringRef.current !== id) return true;
      recoveringRef.current = null;
      if (!fetched) return false;
      remember(fetched);
      setSandwich(fetched);
      return true;
    },
    [anonymousId, remember, sandwich?.id],
  );

  const toggleLike = useCallback(async () => {
    const current = sandwich;
    if (!current) return;
    if (!anonymousId) {
      onToast({ text: "Preparing reactions...", tone: "processing" });
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const before = cardSocial([current]);
    const optimistic = toggledCardSocial(before);
    // Take only the social fields. Swapping in a whole object would hand every
    // consumer a fresh `legs` array, and the detail chart keys its fetch off
    // that array — so a like made the graph reload and replay its draw-in.
    applyUpdate(withCardSocial(current, optimistic));

    try {
      const updated = await setCardLike(current, optimistic.viewerHasLiked, anonymousId);
      applyUpdate(withCardSocial(current, updated));
    } catch {
      applyUpdate(withCardSocial(current, before));
      onToast({ text: "Couldn't update like. Try again.", tone: "error" });
    }
  }, [sandwich, anonymousId, applyUpdate, onToast]);

  /**
   * A comment was posted or deleted on a CARD.
   *
   * Addressed by post id, because the thread is the card's — an episode has one
   * thread over N markets. The lookup falls back to a scan of the remembered
   * rows, which are keyed by market id, since the drawer can belong to a detail
   * route sitting under a newer one.
   */
  const updateCommentCount = useCallback((threadKey: string, count: number) => {
    const keyOf = (row: Sandwich) => row.postId ?? row.id;
    const target =
      sandwich && keyOf(sandwich) === threadKey
        ? sandwich
        : [...seenRef.current.values()].find((row) => keyOf(row) === threadKey) ?? null;
    if (!target) return;
    const nextCount = Math.max(0, count);
    if (target.commentCount === nextCount) return;
    applyUpdate({ ...target, commentCount: nextCount });
  }, [applyUpdate, sandwich]);

  const updatePosition = useCallback((nextPosition: SandwichPosition | null) => {
    positionSettledForRef.current = nextPosition?.sandwichId ?? sandwich?.id ?? null;
    setPosition(nextPosition);
  }, [sandwich?.id]);

  // Only the Holdings card used to hand the detail a position, so a sandwich
  // reached any other way — the Like-to-Buy "You're in" push, the feed, search —
  // showed Buy and never Sell. A server-side auto-buy also never touches this
  // device's store, so its legs were reachable only as single stocks, whose sell
  // correctly refuses ("held in a Sandwich"). Resolve the viewer's own position
  // here: the device store first, then the server's record of the buy.
  const sandwichId = sandwich?.id ?? null;
  const privyUserId = appUser?.privyUserId ?? null;
  useEffect(() => {
    if (!sandwichId || !walletAddress) return;
    if (positionSettledForRef.current === sandwichId) return;
    positionSettledForRef.current = sandwichId;
    let cancelled = false;
    let done = false;
    void (async () => {
      const stored = await getStoredSandwichPositions(walletAddress).catch(() => []);
      let found = stored.find((row) => row.sandwichId === sandwichId) ?? null;
      if (!found && privyUserId) {
        const backend = await getUserPortfolio(privyUserId).catch(() => null);
        if (backend?.some((row) => row.sandwichId === sandwichId)) {
          const merged = await seedFromBackend(walletAddress, backend).catch(() => null);
          found = merged?.find((row) => row.sandwichId === sandwichId) ?? null;
        }
      }
      done = true;
      if (cancelled || !found) return;
      // A buy or sell on this screen may have settled it while we were reading.
      setPosition((current) => current ?? found);
    })();
    return () => {
      cancelled = true;
      // Interrupted mid-read: unsettle so the next run retries.
      if (!done && positionSettledForRef.current === sandwichId) {
        positionSettledForRef.current = null;
      }
    };
  }, [openCount, privyUserId, sandwichId, walletAddress]);

  // present() must run synchronously from the tap that calls share(); keep sync.
  const share = useCallback(() => {
    if (sandwich) shareSheetRef.current?.open(sandwich);
  }, [sandwich]);

  const value = useMemo(
    () => ({ sandwich, position, viewedPosition, updatePosition, appUser, open, close, recoverById, peekById, toggleLike, updateCommentCount, share, onToast }),
    [sandwich, position, viewedPosition, updatePosition, appUser, open, close, recoverById, peekById, toggleLike, updateCommentCount, share, onToast],
  );

  return (
    <SandwichDetailContext.Provider value={value}>
      {children}
      <SandwichShareSheet ref={shareSheetRef} />
    </SandwichDetailContext.Provider>
  );
}

/** The detail store, or null outside its provider — see useOptionalSandwichComposer. */
export function useOptionalSandwichDetail(): SandwichDetailContextValue | null {
  return useContext(SandwichDetailContext);
}

export function useSandwichDetail(): SandwichDetailContextValue {
  const ctx = useContext(SandwichDetailContext);
  if (!ctx) {
    throw new Error(
      "useSandwichDetail must be used within a SandwichDetailProvider",
    );
  }
  return ctx;
}
