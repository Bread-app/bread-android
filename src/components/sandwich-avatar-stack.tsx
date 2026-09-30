import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AssetLogo } from '@/components/asset-logo';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { symbolLogoSources } from '@/lib/stock-logos';
import { useThemeStore } from '@/lib/theme-store';

const F = Fonts.rounded;

function mintLogoUri(mint: string): string {
  return `https://storage.googleapis.com/tokens-asset-logos-prd/solana/${encodeURIComponent(mint)}.webp`;
}

export type AvatarStackLeg = {
  /** Stored logo, when the leg has one. */
  iconUri: string | null;
  /**
   * The asset's ticker. When it carries no stored image (a crypto leg like
   * NEAR often doesn't) its logo is looked up by symbol instead of falling
   * straight to a letter.
   */
  symbol?: string | null;
  /**
   * The asset's Solana mint. tokens.xyz publishes every listed asset's logo at
   * a mint-keyed URL, which is what a crypto leg with no stored image (NEAR,
   * ZEC) needs — the ticker-keyed currency logos don't exist for them.
   */
  mint?: string | null;
  /** Letter shown when no logo resolves at all. */
  initial: string;
};

function TokenCircle({
  leg,
  size,
  ring,
}: {
  leg: AvatarStackLeg;
  size: number;
  /** Border colour cutting this circle out of whatever it overlaps. */
  ring?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const bySymbol = leg.symbol ? symbolLogoSources(leg.symbol) : null;
  const byMint = leg.mint?.trim() ? mintLogoUri(leg.mint.trim()) : null;
  const [logoUri = null, ...logoFallbacks] = [
    leg.iconUri,
    byMint,
    bySymbol?.uri ?? null,
    ...(bySymbol?.fallbackUris ?? []),
  ].filter((uri): uri is string => Boolean(uri));
  const logo = (
    <AssetLogo
      uri={logoUri}
      fallbackUris={logoFallbacks}
      size={size}
      borderRadius={size / 2}
      backgroundColor={colors.surfaceAlt}
      fallback={
        <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.fallbackText, { fontSize: Math.round(size * 0.42) }]}>
            {leg.initial}
          </Text>
        </View>
      }
    />
  );
  if (!ring) return logo;
  return (
    <View style={[styles.ringed, { borderRadius: size / 2 + 2, borderColor: ring }]}>{logo}</View>
  );
}

/**
 * A Sandwich's face in a list: its tokens as circles side by side, each
 * colliding into the last — `(o)(o)` on a pair, the first logo and a "+N"
 * circle for anything bigger — with the source who made the call on the
 * bottom-right. Shared by the open Holdings card and the Closed row so a
 * position looks the same on either side of the toggle.
 *
 * The footprint is exactly `size` square whether it holds one token or two —
 * the badge hangs off the corner — so titles beside it always line up.
 */
export function SandwichAvatarStack({
  size = 40,
  legs,
  legCount,
  creatorAvatarUri,
  creatorInitial,
}: {
  size?: number;
  /** The basket's first legs, in display order; only the first two are drawn. */
  legs: AvatarStackLeg[];
  /** Total legs in the basket, which may exceed `legs`. */
  legCount: number;
  creatorAvatarUri: string | null;
  /** Null hides the source badge (nobody to credit). */
  creatorInitial: string | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  // The source reads as a person, not a dot: about half the logo's width.
  const badge = Math.round(size * 0.52);
  const total = Math.max(legCount, legs.length);
  const first = legs[0] ?? { iconUri: null, initial: '' };
  // Exactly two: the second token shows its face. More: it would be one of
  // several, so the rest collapse into a count instead.
  const second = total === 2 ? (legs[1] ?? null) : null;
  const more = total > 2 ? total - 1 : 0;
  const paired = Boolean(second) || more > 0;
  // A pair shrinks both circles to fit the same `size`-wide footprint as a
  // single logo, so every row's text starts at the same x. They ride the top
  // of the box, leaving the bottom-right corner to the source badge.
  const circle = paired ? Math.round(size * 0.66) : size;
  const overlap = paired ? circle * 2 - size : 0;
  const ring = 2;
  const width = size;
  const top = paired ? Math.round(size * 0.04) : 0;

  return (
    <View style={{ width, height: size }}>
      <View style={{ position: 'absolute', left: 0, top }}>
        <TokenCircle leg={first} size={circle} />
      </View>
      {paired ? (
        // The ring is the page colour, cutting the second circle out of the
        // first where they collide. Offset by the ring so the logo itself
        // lands exactly where an un-ringed one would.
        <View style={{ position: 'absolute', left: circle - overlap - ring, top: top - ring }}>
          {second ? (
            <TokenCircle leg={second} size={circle} ring={colors.background} />
          ) : (
            <View
              style={[
                styles.moreBubble,
                {
                  width: circle + ring * 2,
                  height: circle + ring * 2,
                  borderRadius: circle / 2 + ring,
                  borderColor: colors.background,
                },
              ]}
            >
              <Text style={[styles.moreBubbleText, { fontSize: Math.round(circle * 0.36) }]}>
                +{more}
              </Text>
            </View>
          )}
        </View>
      ) : null}
      {creatorAvatarUri || creatorInitial ? (
        <View style={[styles.creatorBadge, { borderRadius: badge / 2 + 2, borderColor: colors.background }]}>
          <AssetLogo
            uri={creatorAvatarUri}
            size={badge}
            borderRadius={badge / 2}
            backgroundColor={colors.surfaceAlt}
            fallback={
              <View style={[styles.fallback, { width: badge, height: badge, borderRadius: badge / 2 }]}>
                <Text style={[styles.fallbackText, { fontSize: Math.round(badge * 0.5) }]}>
                  {creatorInitial ?? ''}
                </Text>
              </View>
            }
          />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceAlt },
    fallbackText: { color: c.textSecondary, fontWeight: '800', fontFamily: F },
    ringed: { borderWidth: 2, overflow: 'hidden' },
    moreBubble: {
      borderWidth: 2,
      backgroundColor: c.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    moreBubbleText: {
      color: c.textSecondary,
      fontWeight: '800',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
    creatorBadge: {
      position: 'absolute',
      right: -4,
      bottom: -4,
      borderWidth: 2,
      overflow: 'hidden',
    },
  });
