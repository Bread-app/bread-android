import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AssetLogo } from '@/components/asset-logo';
import { LoadErrorState } from '@/components/load-error-state';
import { isXPostSource } from '@/components/x-post-preview';
import { PressableScale } from '@/components/pressable-scale';
import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { Sandwich, SandwichLeg, SandwichPost } from '@/lib/api';
import { getSourceAuthorMeta, getSourceVideo } from '@/lib/sandwich-feed';
import { symbolLogoSources } from '@/lib/stock-logos';
import { useThemeStore } from '@/lib/theme-store';

const F = Fonts.rounded;

/**
 * Home's feed: every call — podcast moments, X posts, any asset — ranked by
 * return since it was posted, top PnL first. Ticker and return, who and when.
 */

type CallRow = {
  sandwich: Sandwich;
  primary: SandwichLeg;
  extraLegs: SandwichLeg[];
  side: 'LONG' | 'SHORT';
  leverage: number | null;
  returnPct: number;
  /** Who the call came from: the X account or YouTube channel, else the Bread creator. */
  sourceName: string;
  sourceAvatarUrl: string | null;
  platform: 'x' | 'youtube' | null;
  postedAt: Date;
};

type Props = {
  posts: SandwichPost[];
  loading: boolean;
  failed: boolean;
  onSelect: (sandwich: Sandwich) => void;
  onRetry: () => void;
};

export const BestCallsSection = React.memo(function BestCallsSection({
  posts,
  loading,
  failed,
  onSelect,
  onRetry,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const rows = useMemo(() => buildRows(posts), [posts]);

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Trending</Text>

      {loading && rows.length === 0 ? (
        <View style={styles.skeleton} />
      ) : failed && rows.length === 0 ? (
        <LoadErrorState size="section" title="Couldn't load calls" onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <Text style={styles.emptyText}>
          No calls yet.
        </Text>
      ) : (
        <View>
          {rows.map((row, index) => (
            <CallRowView
              key={row.sandwich.id}
              row={row}
              last={index === rows.length - 1}
              onPress={() => onSelect(row.sandwich)}
            />
          ))}
        </View>
      )}

    </View>
  );
});

/**
 * One call: what was called and how it has done, then where it came from
 * (the X account or YouTube channel, with its logo) and when. Everything hangs off the logo column so the eye reads
 * straight down the tickers.
 */
function CallRowView({ row, last, onPress }: { row: CallRow; last: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const up = row.returnPct >= 0;
  const accent = up ? colors.positive : colors.negative;
  const symbol = legSymbol(row.primary);
  // "+N" reads as "and N more assets" beside the ticker, so it counts every
  // other leg — not just the ones the logo stack had no room for, and
  // prediction-market legs too, which have no logo here.
  const otherLegs = row.sandwich.legs.length - 1;
  // Long is the default and goes unsaid; a short or a real perp's leverage is
  // the one qualifier worth a word.
  const qualifier = [
    row.side === 'SHORT' ? 'Short' : null,
    row.leverage && row.leverage > 1 ? formatLeverage(row.leverage) : null,
  ].filter(Boolean).join(' ');

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${symbol}${qualifier ? ` ${qualifier}` : ''} from ${row.sourceName}${row.platform ? ` on ${row.platform === 'x' ? 'X' : 'YouTube'}` : ''}, ${up ? 'up' : 'down'} ${Math.abs(row.returnPct).toFixed(1)} percent`}
      onPress={onPress}
      style={styles.row}
    >
      <LogoCluster legs={[row.primary, ...row.extraLegs]} />
      <View style={[styles.body, !last && styles.bodyDivider]}>
        <View style={styles.headline}>
          <Text style={styles.ticker} numberOfLines={1}>
            {symbol}
            {otherLegs > 0 ? <Text style={styles.tickerMore}>{`  +${otherLegs}`}</Text> : null}
            {qualifier ? <Text style={[styles.tickerMore, { color: colors.negative }]}>{`  ${qualifier}`}</Text> : null}
          </Text>
          <Text style={[styles.returnPct, { color: accent }]} numberOfLines={1}>
            {`${up ? '+' : '−'}${Math.abs(row.returnPct).toFixed(1)}%`}
          </Text>
        </View>
        <View style={styles.byline}>
          <AssetLogo
            uri={row.sourceAvatarUrl}
            size={16}
            backgroundColor={colors.surfaceAlt}
            fallback={<LogoFallback letter={row.sourceName.replace(/^@/, '')} size={16} />}
          />
          <Text style={styles.footnote} numberOfLines={1}>
            {`${row.sourceName} · ${formatAgo(row.postedAt)}`}
          </Text>
          {row.platform === 'youtube' ? (
            <Ionicons name="logo-youtube" size={13} color="#FF0000" />
          ) : row.platform === 'x' ? (
            <Ionicons name="logo-x" size={11} color={colors.text} />
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

const LOGO_SLOT = 38;
/**
 * Every row reserves this width for its logos, so a single 38pt logo and a
 * two-logo stack both leave the ticker at the same x.
 */
const LOGO_COLUMN = 46;
// Two is all the column can hold legibly; three crushed the back ones to slivers.
const CLUSTER_MAX = 2;
/**
 * A basket's logos sit side by side, each overlapping the one before it, and
 * the whole stack fits the shared logo column so every ticker lines up.
 * Logo size per count; the overlap is whatever squeezes the row into the slot.
 */
const CLUSTER_LOGO: Record<number, number> = { 2: 26 };
const CLUSTER_RING = 2;

function legSymbol(leg: SandwichLeg): string {
  return leg.underlyingSymbol ?? leg.symbol ?? leg.label;
}

/**
 * One logo for a single-asset call; for a basket, the first two in a row —
 * ()() — the second tucked under the first. The primary leg leads and draws on top.
 */
function LogoCluster({ legs }: { legs: SandwichLeg[] }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const shown = legs.slice(0, CLUSTER_MAX);
  const single = shown.length === 1;
  const size = single ? LOGO_SLOT : CLUSTER_LOGO[shown.length];
  // A ring in the page colour cuts each logo out of the one beneath it.
  const ring = single ? 0 : CLUSTER_RING;
  const item = size + ring * 2;
  // Spread so first-left to last-right spans exactly the slot.
  const step = single ? 0 : (LOGO_COLUMN - item) / (shown.length - 1);
  return (
    <View style={styles.logoRow}>
      {shown.map((leg, index) => {
        const symbol = legSymbol(leg);
        const derived = symbolLogoSources(symbol);
        return (
          <View
            key={leg.id}
            style={[
              styles.clusterItem,
              {
                width: item,
                height: item,
                borderRadius: size / 2 + ring,
                borderWidth: ring,
                marginLeft: index === 0 ? 0 : step - item,
                // Primary in front, each later leg tucked under the one before.
                zIndex: shown.length - index,
              },
            ]}
          >
            <AssetLogo
              uri={leg.imageUrl}
              fallbackUris={[derived.uri, ...derived.fallbackUris]}
              size={size}
              backgroundColor={colors.surfaceAlt}
              fallback={<LogoFallback letter={symbol} size={size} />}
            />
          </View>
        );
      })}
    </View>
  );
}

function LogoFallback({ letter, size }: { letter: string; size: number }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.logoFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.logoFallbackText, { fontSize: size * 0.45 }]}>
        {letter.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/* ---------------------------------------------------------------- data --- */

function buildRows(posts: SandwichPost[]): CallRow[] {
  const seen = new Set<string>();
  const rows: CallRow[] = [];
  for (const post of posts) {
    for (const sandwich of post.sandwiches) {
      if (seen.has(sandwich.id)) continue;
      seen.add(sandwich.id);
      if (sandwich.pnlStatus === 'unavailable' || sandwich.pnlPct == null) continue;
      // Every kind of call ranks — stocks, crypto, prediction markets, podcast
      // moments — so the heaviest leg leads whatever it is.
      const legs = [...sandwich.legs].sort((a, b) => b.weightBps - a.weightBps);
      const primary = legs[0];
      if (!primary) continue;
      const postedAt = new Date(sandwich.createdAt);
      if (Number.isNaN(postedAt.getTime())) continue;
      const short = sandwich.direction === 'down' || /^(short|sell)$/i.test(primary.side);
      const handle = sandwich.builder?.username?.trim().replace(/^@+/, '');
      const creator = handle ? `@${handle}` : sandwich.builder?.name?.trim() || 'Bread';
      const video = getSourceVideo(sandwich);
      const author = getSourceAuthorMeta(sandwich);
      const platform = video ? 'youtube' : isXPostSource(sandwich.source) ? 'x' : null;
      const sourceName =
        (video?.channelName ?? null) ||
        (author ? (author.isHandle ? `@${author.name}` : author.name) : null) ||
        creator;
      const sourceAvatarUrl =
        video?.channelAvatarUrl ?? author?.avatarUrl ?? sandwich.builder?.avatarUrl ?? null;
      rows.push({
        sandwich,
        primary,
        extraLegs: legs.slice(1),
        side: short ? 'SHORT' : 'LONG',
        // Only a real perp call carries leverage — never a hypothetical
        // "max lev" multiplier on a spot buy.
        leverage: sandwich.venue === 'perp' ? primary.leverage ?? null : null,
        returnPct: sandwich.pnlPct,
        sourceName,
        sourceAvatarUrl,
        platform,
        postedAt,
      });
    }
  }
  return rows.sort((a, b) => b.returnPct - a.returnPct);
}

/* ---------------------------------------------------------- formatting --- */

function formatLeverage(leverage: number): string {
  return `${Number.isInteger(leverage) ? leverage : leverage.toFixed(1)}x`;
}

function formatAgo(date: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* -------------------------------------------------------------- styles --- */

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    section: {},
    title: {
      color: c.text,
      fontSize: 22,
      lineHeight: 28,
      fontWeight: '800',
      fontFamily: F,
      letterSpacing: -0.3,
      marginBottom: 4,
    },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 16 },
    logoRow: { flexDirection: 'row', alignItems: 'center', width: LOGO_COLUMN, height: LOGO_SLOT },
    clusterItem: { borderColor: c.background, overflow: 'hidden' },
    body: { flex: 1, minWidth: 0, paddingBottom: 16, gap: 4 },
    bodyDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    headline: { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
    ticker: { flex: 1, color: c.text, fontFamily: F, fontSize: 16, lineHeight: 20, fontWeight: '800' },
    tickerMore: { color: c.textTertiary, fontSize: 13, fontWeight: '700' },
    returnPct: { minWidth: 58, textAlign: 'right', fontFamily: F, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
    byline: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
    footnote: { flexShrink: 1, color: c.textTertiary, fontFamily: F, fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
    logoFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceAlt },
    logoFallbackText: { color: c.textSecondary, fontFamily: F, fontWeight: '900' },
    skeleton: { height: 60 * 3, borderRadius: Radius.lg, backgroundColor: c.surfaceAlt },
    emptyText: { color: c.textTertiary, fontFamily: F, fontSize: 14, fontWeight: '600', paddingVertical: 14 },
  });
