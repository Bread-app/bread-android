import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AssetLogo } from '@/components/asset-logo';
import { GlassSegmentedControl } from '@/components/glass-segmented-control';
import { LoadErrorState } from '@/components/load-error-state';
import { PressableScale } from '@/components/pressable-scale';
import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { Sandwich, SandwichLeg, SandwichPost } from '@/lib/api';
import { callAttribution, legTicker } from '@/lib/call-attribution';
import { symbolLogoSources } from '@/lib/stock-logos';
import { useThemeStore } from '@/lib/theme-store';

const F = Fonts.rounded;

/**
 * Home's feed: every call — podcast moments, X posts, any asset. Top ranks by
 * return since it was posted; New is newest first. Ticker and return, who
 * and when.
 */

const SORTS = ['Top', 'New'] as const;
type CallSort = (typeof SORTS)[number];

type CallRow = {
  sandwich: Sandwich;
  primary: SandwichLeg;
  extraLegs: SandwichLeg[];
  side: 'LONG' | 'SHORT';
  /**
   * The perp leverage the row quotes: the asset's perp market max when one
   * exists, else a perp call's own opening leverage.
   */
  leverage: number | null;
  /** At `leverage` when the asset has a perp market, else the call's own return. */
  returnPct: number;
  /** Who the call came from: the X account or YouTube channel, else the Bread creator. */
  sourceName: string;
  sourceAvatarUrl: string | null;
  platform: 'x' | 'youtube' | null;
  postedAt: Date;
  /** Other people who made the same call on the same asset. */
  coCallers: CoCaller[];
};

type CoCaller = { name: string; avatarUrl: string | null };

/** Faces the byline stack shows before folding the rest into "+N". */
const CO_CALLER_FACES = 3;

type Props = {
  posts: SandwichPost[];
  loading: boolean;
  failed: boolean;
  /** The max leverage of the perp market behind a leg, or null when it has none. */
  maxLeverageFor: (leg: SandwichLeg) => number | null;
  onSelect: (sandwich: Sandwich) => void;
  onRetry: () => void;
};

export const BestCallsSection = React.memo(function BestCallsSection({
  posts,
  loading,
  failed,
  maxLeverageFor,
  onSelect,
  onRetry,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const [sort, setSort] = useState<CallSort>('Top');
  const ranked = useMemo(() => buildRows(posts, maxLeverageFor), [posts, maxLeverageFor]);
  const rows = useMemo(
    () => (sort === 'Top' ? ranked : [...ranked].sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())),
    [ranked, sort],
  );

  return (
    <View style={styles.section}>
      {/* The title names what the list is; the toggle only says how it's sorted. */}
      <View style={styles.header}>
        <Text style={styles.title}>Trades</Text>
        <GlassSegmentedControl options={SORTS} value={sort} onChange={setSort} accessibilityLabel="Sort trades" />
      </View>

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
          {rows.map((row) => (
            <CallRowView
              key={row.sandwich.id}
              row={row}
              onPress={() => onSelect(row.sandwich)}
            />
          ))}
        </View>
      )}

    </View>
  );
});

/** A solid up / down triangle in place of the +/− sign. */
function TrendArrow({ up, color, size = 11 }: { up: boolean; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" style={styles0.arrow}>
      <Path d={up ? 'M6 1.6 L11 10.4 H1 Z' : 'M6 10.4 L11 1.6 H1 Z'} fill={color} strokeLinejoin="round" stroke={color} strokeWidth={1.2} />
    </Svg>
  );
}

const styles0 = StyleSheet.create({ arrow: { marginRight: 4 } });

/**
 * One call: what was called and how it has done, then where it came from
 * (the X account or YouTube channel, with its logo) and when. Everything hangs off the logo column so the eye reads
 * straight down the tickers.
 */
function CallRowView({ row, onPress }: { row: CallRow; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const up = row.returnPct >= 0;
  // The app's one neon green and one red, as is: no per-screen darkening.
  const ink = (color: string) => color;
  const accent = ink(up ? colors.positive : colors.negative);
  const symbol = legSymbol(row.primary);
  // "+N" reads as "and N more assets" beside the ticker, so it counts every
  // other leg — not just the ones the logo stack had no room for, and
  // prediction-market legs too, which have no logo here.
  const otherLegs = row.sandwich.legs.length - 1;
  const short = row.side === 'SHORT';
  const leverage = row.leverage && row.leverage > 1 ? formatLeverage(row.leverage) : null;
  const qualifier = [short ? 'Short' : 'Long', leverage].filter(Boolean).join(' ');
  const sideInk = ink(short ? colors.negative : colors.positive);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${symbol}${qualifier ? ` ${qualifier}` : ''} from ${row.sourceName}${row.platform ? ` on ${row.platform === 'x' ? 'X' : 'YouTube'}` : ''}, ${up ? 'up' : 'down'} ${Math.abs(row.returnPct).toFixed(1)} percent`}
      onPress={onPress}
      style={styles.row}
    >
      <LogoCluster legs={[row.primary, ...row.extraLegs]} />
      <View style={styles.body}>
        <View style={styles.headline}>
          <Text style={styles.ticker} numberOfLines={1}>
            {symbol}
            {otherLegs > 0 ? <Text style={styles.tickerMore}>{`  +${otherLegs}`}</Text> : null}
          </Text>
          <Text style={[styles.side, { color: sideInk }]} numberOfLines={1}>
            {short ? 'SHORT' : 'LONG'}
            {leverage ? ` ${leverage}` : null}
          </Text>
          <Text style={styles.time} numberOfLines={1}>
            {formatAgo(row.postedAt)}
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
            {row.sourceName}
          </Text>
          {row.platform === 'youtube' ? (
            <Ionicons name="logo-youtube" size={13} color="#FF0000" />
          ) : row.platform === 'x' ? (
            <Ionicons name="logo-x" size={12} color={colors.text} />
          ) : null}
          {row.coCallers.length > 0 ? <CoCallerStack callers={row.coCallers} /> : null}
          <View style={styles.returnWrap}>
            <TrendArrow up={up} color={accent} />
            <Text style={[styles.returnPct, { color: accent }]} numberOfLines={1}>
              {`${Math.abs(row.returnPct).toFixed(1)}%`}
            </Text>
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

const FACE = 18;
const FACE_RING = 1.5;

/**
 * Everyone else who made the same call: a few overlapping
 * faces in a pill, the rest counted as "+N".
 */
function CoCallerStack({ callers }: { callers: CoCaller[] }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const shown = callers.slice(0, CO_CALLER_FACES);
  const more = callers.length - shown.length;
  return (
    <View
      style={styles.coCallers}
      accessible
      accessibilityLabel={`Also called by ${callers.map((c) => c.name).join(', ')}`}
    >
      {shown.map((caller, index) => (
        <View
          key={caller.name}
          style={[styles.coCallerFace, { marginLeft: index === 0 ? 0 : -6, zIndex: shown.length - index }]}
        >
          <AssetLogo
            uri={caller.avatarUrl}
            size={FACE}
            backgroundColor={colors.surfaceAlt}
            fallback={<LogoFallback letter={caller.name.replace(/^@/, '')} size={FACE} />}
          />
        </View>
      ))}
      {more > 0 ? <Text style={styles.coCallerMore}>{`+${more}`}</Text> : null}
    </View>
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

const legSymbol = legTicker;

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

function buildRows(posts: SandwichPost[], maxLeverageFor: Props['maxLeverageFor']): CallRow[] {
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
      const { name: sourceName, avatarUrl: sourceAvatarUrl, platform } = callAttribution(sandwich);
      // A single-asset call with a perp market behind it is quoted at that
      // market's max leverage. `pnlPct` is the signed, unlevered move, so the
      // levered return is a straight multiple, floored at liquidation. A
      // basket's return can't be levered by one leg's market, so it stays as is.
      const maxLeverage = legs.length === 1 ? maxLeverageFor(primary) : null;
      const leverage = maxLeverage && maxLeverage > 1
        ? maxLeverage
        : sandwich.venue === 'perp' ? primary.leverage ?? null : null;
      rows.push({
        sandwich,
        primary,
        extraLegs: legs.slice(1),
        side: short ? 'SHORT' : 'LONG',
        leverage,
        returnPct: maxLeverage && maxLeverage > 1
          ? Math.max(-100, sandwich.pnlPct * maxLeverage)
          : sandwich.pnlPct,
        sourceName,
        sourceAvatarUrl,
        platform,
        postedAt,
        coCallers: [],
      });
    }
  }
  return mergeByAsset(rows).sort((a, b) => b.returnPct - a.returnPct);
}

/** The asset a call leads with, as a key: its mint when it has one, else its ticker. */
function assetKey(leg: SandwichLeg): string {
  return leg.mint ? `mint:${leg.mint}` : `sym:${legTicker(leg).trim().toUpperCase()}`;
}

/**
 * One row per asset and side. The best-performing call leads; everyone else
 * who made the same call — whenever they posted it — goes in the pill, best
 * call first, one face per person. Repeat calls from the lead's own source
 * just fold away.
 */
function mergeByAsset(rows: CallRow[]): CallRow[] {
  const groups = new Map<string, CallRow[]>();
  for (const row of rows) {
    const key = `${assetKey(row.primary)}|${row.side}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const merged: CallRow[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => b.returnPct - a.returnPct);
    const [lead, ...others] = group;
    const seen = new Set([lead.sourceName.toLowerCase()]);
    const coCallers: CoCaller[] = [];
    for (const other of others) {
      const id = other.sourceName.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      coCallers.push({ name: other.sourceName, avatarUrl: other.sourceAvatarUrl });
    }
    merged.push({ ...lead, coCallers });
  }
  return merged;
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
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    title: { color: c.text, fontFamily: F, fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.3 },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: 13 },
    logoRow: { flexDirection: 'row', alignItems: 'center', width: LOGO_COLUMN, height: LOGO_SLOT },
    clusterItem: { borderColor: c.background, overflow: 'hidden' },
    body: { flex: 1, minWidth: 0, paddingBottom: 13, gap: 3 },
    headline: { flexDirection: 'row', alignItems: 'center', minHeight: 21 },
    ticker: { flexShrink: 1, color: c.text, fontFamily: F, fontSize: 16, lineHeight: 21, fontWeight: '800' },
    tickerMore: { color: c.textTertiary, fontSize: 13, fontWeight: '700' },
    side: { marginLeft: 8, fontFamily: Fonts.displayOne, fontSize: 13, lineHeight: 18, letterSpacing: 0.3 },
    // Nudged up to sit on the ticker's cap height, and faded under the figures.
    time: { marginLeft: 'auto', paddingLeft: 8, alignSelf: 'flex-start', marginTop: 0, opacity: 0.55, color: c.textTertiary, fontFamily: F, fontSize: 11, lineHeight: 15, fontWeight: '500', fontVariant: ['tabular-nums'] },
    returnWrap: { marginLeft: 'auto', paddingLeft: 8, flexDirection: 'row', alignItems: 'center' },
    returnPct: { textAlign: 'right', fontFamily: Fonts.displayMedium, fontSize: 15, lineHeight: 20, letterSpacing: 0.3, fontVariant: ['tabular-nums'] },
    coCallers: { flexDirection: 'row', alignItems: 'center', marginLeft: 3 },
    coCallerFace: { borderRadius: FACE / 2 + FACE_RING, borderWidth: FACE_RING, borderColor: c.background, overflow: 'hidden' },
    coCallerMore: { marginLeft: 4, color: c.textSecondary, fontFamily: F, fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
    byline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
    footnote: { flexShrink: 1, color: c.textTertiary, fontFamily: F, fontSize: 13, lineHeight: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
    logoFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceAlt },
    logoFallbackText: { color: c.textSecondary, fontFamily: F, fontWeight: '900' },
    skeleton: { height: 60 * 3, borderRadius: Radius.lg, backgroundColor: c.surfaceAlt },
    emptyText: { color: c.textTertiary, fontFamily: F, fontSize: 14, fontWeight: '600', paddingVertical: 14 },
  });
