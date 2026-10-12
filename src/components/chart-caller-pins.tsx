import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AssetLogo } from '@/components/asset-logo';
import { Fonts } from '@/constants/theme';
import type { Sandwich } from '@/lib/api';
import { callAttribution } from '@/lib/call-attribution';
import { useThemeStore } from '@/lib/theme-store';

/** One creator's call on this asset, pinned to the chart where it was made. */
export type ChartCaller = {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** When the call was made — where on the time axis the pin lands. */
  occurredAt: string;
  /** The call the user opened this asset from. Drawn larger, ringed, on top. */
  highlighted: boolean;
  /** The Sandwich the pin stands for — what a tap on it previews. */
  sandwich?: Sandwich;
};

/** Callers shown besides the highlighted one. More than this is a smear. */
const MAX_OTHER_CALLERS = 8;

/**
 * The pins for an asset: the call the user came from first (highlighted), then
 * every other creator who called the same asset — one pin per creator, at
 * their most recent call, so a prolific caller does not wallpaper the line.
 */
export function chartCallersFor(
  primary: readonly Sandwich[] | null | undefined,
  related: readonly Sandwich[],
): ChartCaller[] {
  const [opened, ...others] = primary ?? [];
  const seenCreators = new Set<string>();
  const seenSandwiches = new Set<string>();
  const callers: ChartCaller[] = [];
  const push = (sandwich: Sandwich, highlighted: boolean) => {
    if (seenSandwiches.has(sandwich.id)) return;
    seenSandwiches.add(sandwich.id);
    const who = callAttribution(sandwich);
    const key = who.name.trim().toLowerCase();
    if (seenCreators.has(key)) return;
    seenCreators.add(key);
    callers.push({
      id: sandwich.id,
      name: who.name,
      avatarUrl: who.avatarUrl,
      occurredAt: sandwich.createdAt,
      highlighted,
      sandwich,
    });
  };
  if (opened) push(opened, true);
  const rest = [...others, ...related].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  for (const sandwich of rest) {
    if (callers.length >= MAX_OTHER_CALLERS + (opened ? 1 : 0)) break;
    push(sandwich, false);
  }
  return callers;
}

/** Where a tapped pin's chart sits on screen (window points): the preview hangs off it. */
export type ChartPinAnchor = { top: number; height: number };

export const CALLER_PIN_SIZE = 22;
export const CALLER_PIN_HIGHLIGHT_SIZE = 30;
/** Gap between the line and the bottom of the avatar, where the stem runs. */
const STEM = 6;

export function callerPinSize(caller: ChartCaller): number {
  return caller.highlighted ? CALLER_PIN_HIGHLIGHT_SIZE : CALLER_PIN_SIZE;
}

/** Points a pin rises above its dot — what the host needs as headroom. */
export function callerPinReach(caller: ChartCaller, lift = 0): number {
  return STEM + lift + callerPinSize(caller) + 4;
}

/**
 * Index of the bar nearest `occurredAt`, or -1 when the call is from before
 * the series starts (it belongs to a longer window) or the time is unreadable.
 */
export function nearestBarIndex(times: readonly number[], occurredAt: string): number {
  const at = new Date(occurredAt).getTime();
  if (!Number.isFinite(at) || times.length === 0) return -1;
  const step = times.length > 1 ? times[1] - times[0] : 0;
  if (at < times[0] - step) return -1;
  let nearest = 0;
  let distance = Math.abs(times[0] - at);
  for (let index = 1; index < times.length; index += 1) {
    const next = Math.abs(times[index] - at);
    if (next < distance) {
      nearest = index;
      distance = next;
    }
  }
  return nearest;
}

/**
 * Callers that land on the same bar stack upward rather than on top of each
 * other. Returns each caller's lift in points, in input order.
 */
export function stackLifts(callers: readonly ChartCaller[], indices: readonly number[]): number[] {
  const height = new Map<number, number>();
  return callers.map((caller, i) => {
    const index = indices[i];
    if (index < 0) return 0;
    const lift = height.get(index) ?? 0;
    height.set(index, lift + callerPinSize(caller) - 6);
    return lift;
  });
}

/**
 * The pin under a tap, if any. `pins` are in paint order (the last draws on
 * top, so it wins); x/y is the pin's point on the line, in the same space as
 * the tap. The target is the avatar, padded so a 22pt face is easy to hit.
 */
export function hitCallerPin(
  pins: readonly { caller: ChartCaller; x: number; y: number; lift: number; below: boolean }[],
  tapX: number,
  tapY: number,
): ChartCaller | null {
  for (let i = pins.length - 1; i >= 0; i -= 1) {
    const { caller, x, y, lift, below } = pins[i];
    const size = callerPinSize(caller);
    const ring = caller.highlighted ? 2 : 1.5;
    const reach = STEM + lift + size / 2 + ring;
    const cy = below ? y + reach : y - reach;
    const r = size / 2 + ring + 10;
    if ((tapX - x) ** 2 + (tapY - cy) ** 2 <= r * r) return caller;
  }
  return null;
}

/**
 * One creator pin: a dot on the line where the call was made, a hairline stem,
 * and their avatar above it. The origin of this view is the point on the line,
 * so a host only has to translate it there.
 */
export function CallerPin({
  caller,
  lift = 0,
  below = false,
}: {
  caller: ChartCaller;
  lift?: number;
  /** Hang the avatar under the line — for a point too near the plot's top. */
  below?: boolean;
}) {
  const { colors } = useThemeStore();
  const size = callerPinSize(caller);
  const ring = caller.highlighted ? colors.actionBuy : colors.background;
  const ringWidth = caller.highlighted ? 2 : 1.5;
  const stem = STEM + lift;
  return (
    <View pointerEvents="none" style={styles.anchor}>
      <View
        style={[
          styles.stem,
          { height: stem, top: below ? 0 : -stem, backgroundColor: caller.highlighted ? colors.actionBuy : colors.textTertiary },
        ]}
      />
      <View
        style={[
          styles.dot,
          { backgroundColor: caller.highlighted ? colors.actionBuy : colors.textSecondary, borderColor: colors.background },
        ]}
      />
      <View
        style={[
          styles.avatar,
          {
            width: size + ringWidth * 2,
            height: size + ringWidth * 2,
            borderRadius: size / 2 + ringWidth,
            borderWidth: ringWidth,
            borderColor: ring,
            left: -(size / 2 + ringWidth),
            top: below ? stem : -(stem + size + ringWidth * 2),
            backgroundColor: colors.surfaceAlt,
          },
        ]}
      >
        <AssetLogo
          uri={caller.avatarUrl}
          size={size}
          backgroundColor={colors.surfaceAlt}
          fallback={
            <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceAlt }]}>
              <Text style={[styles.fallbackText, { fontSize: size * 0.45, color: colors.textSecondary }]}>
                {caller.name.replace(/^@/, '').slice(0, 1).toUpperCase()}
              </Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, top: 0, width: 0, height: 0 },
  stem: { position: 'absolute', left: -0.5, width: 1, opacity: 0.6 },
  dot: { position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  avatar: {
    position: 'absolute',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackText: { fontFamily: Fonts.rounded, fontWeight: '900' },
});
