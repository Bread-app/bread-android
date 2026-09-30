import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PodcastCallDrawer } from '@/components/podcast-call-drawer';
import { PodcastCallCaption, PodcastCallSheet } from '@/components/podcast-call-sheet';
import type { ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { getSandwichById, type Sandwich } from '@/lib/api';
import { formatTimestamp, getMomentWindow } from '@/lib/moment';
import { callCaption } from '@/lib/podcast-call-format';
import { takePodcastCall } from '@/lib/podcast-call-handoff';
import { listPhoenixMarkets, type PhoenixMarket } from '@/lib/phoenix-api';
import { getSourceVideo } from '@/lib/sandwich-feed';
import type { SandwichPosition } from '@/lib/sandwich-positions';
import { useToast } from '@/lib/toast-store';
import { useTradeFx } from '@/lib/trade-fx';
import { SandwichSellPad } from '@/screens/sandwich-screen';

/**
 * One YouTube call's trade drawer, on its own — the exact drawer and sheets the
 * episode screen raises (the call sheet to buy, the Sandwich sell pad with the
 * call's caption to close), presented as a transparent modal over whatever
 * opened it (Holdings' Buy / Sell on a held YouTube position).
 *
 * A route rather than a portal because both sheets run trade engines that need
 * the wallet/cash/toast providers mounted in (app)/_layout; a gorhom portal
 * renders above them.
 */
export function PodcastCallScreen() {
  const styles = useThemedStyles(makeStyles);
  const toast = useToast();
  const tradeFx = useTradeFx();
  const { sandwichId, startMs, mode } = useLocalSearchParams<{
    sandwichId?: string;
    startMs?: string;
    mode?: string;
  }>();
  const isClose = mode === 'close';
  const [handoff] = useState(() => (sandwichId ? takePodcastCall(sandwichId) : null));
  const [sandwich, setSandwich] = useState<Sandwich | null>(handoff?.sandwich ?? null);
  // Pinned for the drawer's lifetime: a full close hands up null, and the pad
  // has to keep its numbers while it animates away. A partial writes back here.
  const [position, setPosition] = useState<SandwichPosition | null>(handoff?.position ?? null);
  const [markets, setMarkets] = useState<PhoenixMarket[]>([]);
  const onPositionUpdatedRef = useRef(handoff?.onPositionUpdated);

  const dismiss = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, []);

  const handlePositionUpdated = useCallback((next: SandwichPosition | null) => {
    if (next) setPosition(next);
    onPositionUpdatedRef.current?.(next);
  }, []);

  // Nothing to trade: no id, or a sell with no position handed over.
  useEffect(() => {
    if (!sandwichId || (isClose && !position)) dismiss();
    // Mount-only: `position` going null later is a full close, not a bad entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cold entry — the handoff is empty, so read the call by id.
  useEffect(() => {
    if (sandwich || !sandwichId) return;
    let cancelled = false;
    void getSandwichById(sandwichId).then((next) => {
      if (cancelled) return;
      if (next) setSandwich(next);
      else {
        toast.showToast('This call is no longer available.', 'error');
        dismiss();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dismiss, sandwich, sandwichId, toast]);

  useEffect(() => {
    if (isClose) return;
    let cancelled = false;
    void listPhoenixMarkets()
      .then((next) => {
        if (!cancelled) setMarkets(next);
      })
      // A miss only costs perp routing, and the sheet says so in place.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isClose]);

  const lead = useMemo(
    () => (sandwich ? [...sandwich.legs].sort((a, b) => a.order - b.order)[0] ?? null : null),
    [sandwich],
  );

  // The Sandwich's own window first; the holding's provenance start covers a
  // call whose thesis predates stored windows.
  const timestampLabel = useMemo(() => {
    const window = sandwich ? getMomentWindow(sandwich) : null;
    const fallback = startMs != null && startMs !== '' ? Number(startMs) : NaN;
    const start = window?.startMs ?? (Number.isFinite(fallback) && fallback >= 0 ? fallback : null);
    return start != null ? formatTimestamp(start) : null;
  }, [sandwich, startMs]);

  if (!sandwich || !lead || (isClose && !position)) return <View style={styles.root} />;

  const isPerp = sandwich.venue === 'perp';
  const side = isPerp ? (lead.side.trim().toLowerCase() === 'short' ? 'short' : 'long') : 'buy';

  return (
    <View style={styles.root}>
      {/* A close takes the buy's height: the same keypad and terms panel,
          without the perp risk band. */}
      <PodcastCallDrawer tall={isPerp && !isClose} onClosed={dismiss}>
        {(close) =>
          isClose && position ? (
            <View style={styles.closeSheet}>
              <View style={styles.closeHandle} />
              <SandwichSellPad
                position={position}
                sandwich={sandwich}
                // The call's own words, exactly as the buy sheet shows them.
                thesisContent={
                  <View style={styles.closeContext}>
                    <PodcastCallCaption
                      caption={callCaption(sandwich)}
                      timestampLabel={timestampLabel}
                      avatarUrl={getSourceVideo(sandwich)?.channelAvatarUrl ?? null}
                    />
                  </View>
                }
                onClose={close}
                onToast={(next, duration) => {
                  if (!next) {
                    toast.dismissToast();
                    return;
                  }
                  toast.showToast(next.text, next.tone, duration);
                }}
                onCelebrate={tradeFx.playSandwich}
                onPositionUpdated={handlePositionUpdated}
              />
            </View>
          ) : (
            <PodcastCallSheet
              sandwich={sandwich}
              initialLeg={lead}
              markets={markets}
              initialSide={side}
              caption={callCaption(sandwich)}
              timestampLabel={timestampLabel}
              // No player behind this drawer to seek.
              onReplayMoment={null}
              onPositionUpdated={handlePositionUpdated}
              onClose={close}
            />
          )
        }
      </PodcastCallDrawer>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    // Same shell the episode screen gives its sell pad.
    closeSheet: { flex: 1, paddingHorizontal: 18, paddingTop: 8, gap: 14 },
    closeContext: { alignSelf: 'stretch', paddingHorizontal: 16, paddingTop: 4 },
    closeHandle: {
      alignSelf: 'center',
      width: 36,
      height: 5,
      borderRadius: 999,
      backgroundColor: c.border,
    },
  });
}
