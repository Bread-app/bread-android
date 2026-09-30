import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { AddThesisButton } from "@/components/add-thesis-button";
import { SandwichAvatarStack } from "@/components/sandwich-avatar-stack";
import { PressableScale } from "@/components/pressable-scale";
import { ValueSkeleton } from "@/components/value-skeleton";
import { VerifiedBadge } from "@/components/verified-badge";
import { Fonts, Spacing, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import type {
  ClosedPosition,
  ClosedSandwichMeta,
  PositionDetail,
  PositionTake,
  PublicSandwichHolding,
  Sandwich,
  SandwichProvenance,
  WalletBalanceToken,
} from "@/lib/api";
import { formatTimestamp } from "@/lib/perp-sandwich-display";
import { type MomentCaption } from "@/lib/moment";
import { formatPnlPercentage } from "@/lib/pnl-percentage";
import { holdingTitle } from "@/lib/sandwich-provenance";
import type { SandwichPosition } from "@/lib/sandwich-positions";
import { useThemeStore } from "@/lib/theme-store";

const F = Fonts.rounded;

/**
 * The sandwich holding card, shared by the own profile, the other-user profile
 * and the closed list, so a held sandwich reads the same wherever it is drawn:
 * byline (cited account, builder as sub-handle), the take, value + return, and
 * the legs + signed return pill.
 */

export type SandwichHoldingRow = {
  position: SandwichPosition;
  legTokens: {
    leg: SandwichPosition["legs"][number];
    token: WalletBalanceToken;
  }[];
  usdValue: number;
  priceChange24h: number | null;
  /** Return since this holder's own entry. */
  returnPct: number | null;
  /**
   * A settled position can have an authoritative realized PnL even when its
   * historical entry or exit receipt is unavailable. Keep it separate from
   * `usdValue`: the latter must remain unknown rather than being invented from
   * an incomplete receipt, while the former is still safe to show.
   */
  realizedPnlUsd: number | null;
  /**
   * Whether the wallet's balances actually loaded. An unheld leg means "sold"
   * when this is true and "unknown" when it is false, and the two must never be
   * conflated: only the first may zero a row.
   */
  balancesKnown: boolean;
};

export type SandwichCreatorMeta = {
  /** The Bread builder who made this sandwich. Null on unowned/legacy rows. */
  name: string | null;
  avatarUrl: string | null;
  /**
   * The cited account the sandwich was sourced from — an X post, a video, an
   * article. Null on a native sandwich, where the builder is the only identity.
   */
  origin: {
    name: string;
    /** Only a handle earns the "@" — a bare display name isn't an address. */
    isHandle: boolean;
    avatarUrl: string | null;
    initials: string;
    platform: string;
    url: string | null;
  } | null;
};

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Icons for the mark beside a cited handle. Mirrors PLATFORM_ICON in the feed —
 * the holdings card credits an origin the same way the sandwich card does.
 */
const HOLDING_PLATFORM_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  youtube: "logo-youtube",
  x: "logo-x",
  x_post: "logo-x",
  x_summon: "logo-x",
  twitter: "logo-x",
  article: "document-text-outline",
  manual: "create-outline",
};

export function initialsFor(name: string, fallback: string) {
  return (
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || fallback
  );
}

/**
 * The two identities on a held sandwich, kept apart: the builder who picked the
 * markets, and the account the take was sourced from.
 *
 * `name` deliberately never falls back to `authorHandle`/`authorName` — those
 * belong to the origin, and crediting them as the builder is exactly the
 * conflation the feed card had to unpick.
 */
export function getSandwichCreatorMeta(sandwich: Sandwich | null): SandwichCreatorMeta {
  if (!sandwich) {
    return { name: null, avatarUrl: null, origin: null };
  }

  const source = sandwich.source;
  const builder = sandwich.builder;
  // Last resort is the submission's own author fields: on an own thesis the
  // builder's submission populates them, so they name the same person.
  const name = (
    builder?.username ??
    builder?.name ??
    source.user?.username ??
    source.user?.name ??
    source.authorHandle ??
    source.authorName ??
    null
  )?.replace(/^@+/, "") ?? null;

  return {
    name,
    avatarUrl: builder?.avatarUrl ?? source.user?.avatarUrl ?? null,
    origin: getHoldingOriginMeta(sandwich),
  };
}

/**
 * The cited account behind a sandwich, resolved from the public attribution
 * payload first and topped up from the source row so older sandwiches keep the
 * same byline.
 */
export function getHoldingOriginMeta(sandwich: Sandwich): SandwichCreatorMeta["origin"] {
  // An origin is what makes this an externally sourced sandwich. Without one
  // there is nobody to cite, and `authorHandle` alone is not evidence of a
  // source — the builder's own submission can populate it.
  const origin = sandwich.origins[0];
  if (!origin) return null;
  const source = sandwich.source;
  const handle =
    origin.handle?.trim().replace(/^@+/, "") ||
    source.authorHandle?.trim().replace(/^@+/, "") ||
    null;
  const displayName = origin.name?.trim() || source.authorName?.trim() || null;
  const name = handle ?? displayName;
  if (!name) return null;

  return {
    name,
    isHandle: Boolean(handle),
    avatarUrl: origin.avatarUrl ?? source.authorAvatarUrl ?? null,
    initials: initialsFor(name, "S"),
    platform: origin.platform,
    url: origin.url ?? source.sourceUrl ?? null,
  };
}

/** Shape a settled sandwich so the open holding card can render it. */
export function closedSandwichRow(position: ClosedPosition): SandwichHoldingRow {
  const meta = position.sandwich;
  const legIcons = meta?.legIcons ?? [];
  return {
    position: {
      id: position.id,
      sandwichId: position.sandwichId ?? position.id,
      name: position.title,
      summary: meta?.summary ?? position.title,
      investedUsd: position.costUsd,
      createdAt: position.openedAt ?? position.closedAt,
      updatedAt: position.closedAt,
      pendingSync: false,
      strictAtomic: false,
      legs: legIcons.map((imageUrl, index) => ({
        legId: `${position.id}:${index}`,
        mint: "",
        symbol: position.symbols[index] ?? null,
        label: position.symbols[index] ?? "",
        imageUrl,
        weightBps: 0,
        inputAmount: null,
        investedUsd: null,
      })),
    },
    legTokens: [],
    usdValue:
      position.proceedsUsd ??
      (position.costUsd !== null && position.realizedPnlUsd !== null
        ? position.costUsd + position.realizedPnlUsd
        : Number.NaN),
    priceChange24h: null,
    returnPct: position.realizedPnlPct === null ? null : position.realizedPnlPct * 100,
    realizedPnlUsd: position.realizedPnlUsd,
    balancesKnown: true,
  };
}

/** The cited account and builder, in the shape the shared card expects. */
export function closedSandwichCreator(position: ClosedPosition): SandwichCreatorMeta {
  return metaCreator(position.sandwich);
}

/** Provenance, so a closed podcast row keeps its headline and timestamp. */
export function closedSandwichProvenance(position: ClosedPosition): SandwichProvenance | null {
  return positionDetailProvenance(position);
}

export function positionDetailProvenance(position: Pick<PositionDetail, 'id' | 'sandwichId' | 'sandwich'> | ClosedPosition): SandwichProvenance | null {
  const meta = position.sandwich;
  if (!meta || !meta.sourceId) return null;
  return {
    sandwichId: position.sandwichId ?? position.id,
    sourceId: meta.sourceId,
    postId: null,
    postKind: null,
    headline: meta.headline,
    speakerName: meta.speakerName,
    source: {
      sourceType: meta.sourceType ?? "",
      url: meta.sourceUrl,
      videoId: meta.videoId,
      authorHandle: meta.authorHandle,
      authorName: meta.authorName,
      startMs: meta.startMs,
      endMs: meta.endMs,
    },
  };
}

/**
 * Someone else's open sandwich, in the shape the card expects. The public
 * holding carries the same attribution block a closed position does, so the
 * two mappers share their reading of it.
 */
export function publicSandwichHoldingRow(holding: PublicSandwichHolding): SandwichHoldingRow {
  const meta = holding.sandwich;
  const legIcons = meta?.legIcons ?? [];
  return {
    position: {
      id: holding.id,
      sandwichId: holding.sandwichId,
      name: holding.title,
      summary: meta?.summary ?? holding.subtitle ?? holding.title,
      investedUsd: holding.costUsd,
      createdAt: holding.openedAt,
      updatedAt: holding.openedAt,
      pendingSync: false,
      strictAtomic: false,
      legs: (legIcons.length > 0 ? legIcons : [holding.logoUri]).map((imageUrl, index) => ({
        legId: `${holding.id}:${index}`,
        mint: holding.legMints[index] ?? "",
        symbol: holding.symbols[index] ?? null,
        label: holding.symbols[index] ?? "",
        imageUrl,
        weightBps: 0,
        inputAmount: null,
        investedUsd: null,
      })),
    },
    legTokens: [],
    usdValue: holding.valueUsd ?? Number.NaN,
    priceChange24h: null,
    returnPct: holding.unrealizedPnlPct === null ? null : holding.unrealizedPnlPct * 100,
    realizedPnlUsd: null,
    balancesKnown: true,
  };
}

export function publicSandwichHoldingCreator(holding: PublicSandwichHolding): SandwichCreatorMeta {
  return metaCreator(holding.sandwich);
}

export function publicSandwichHoldingProvenance(
  holding: PublicSandwichHolding,
): SandwichProvenance | null {
  return positionDetailProvenance({
    id: holding.id,
    sandwichId: holding.sandwichId,
    sandwich: holding.sandwich,
  });
}

/** Builder + cited account, read off the attribution block both payloads carry. */
function metaCreator(meta: ClosedSandwichMeta | null): SandwichCreatorMeta {
  const builderName =
    (meta?.builderUsername ?? meta?.builderName)?.trim().replace(/^@+/, "") || null;
  const originHandle = meta?.authorHandle?.trim().replace(/^@+/, "") || null;
  const originName = originHandle ?? meta?.authorName?.trim() ?? null;
  return {
    name: builderName,
    avatarUrl: meta?.builderAvatarUrl ?? null,
    origin: originName
      ? {
          name: originName,
          isHandle: Boolean(originHandle),
          avatarUrl: meta?.authorAvatarUrl ?? null,
          initials: initialsFor(originName, "S"),
          platform: meta?.sourceType === "youtube" ? "youtube" : (meta?.sourceType ?? "link"),
          url: meta?.sourceUrl ?? null,
        }
      : null,
  };
}

/** Someone else's open sandwich, drawn as the same card the owner sees. */
export function PublicSandwichHoldingCard({
  holding,
  takes = null,
  onOpen,
}: {
  holding: PublicSandwichHolding;
  /**
   * This holder's thesis, when they wrote one. No button here — a take can only
   * be written by the person holding, so someone else's card has nothing to
   * offer beyond showing what they said.
   */
  takes?: { count: number; latest: PositionTake | null } | null;
  onOpen: () => void;
}) {
  const row = React.useMemo(() => publicSandwichHoldingRow(holding), [holding]);
  const creator = React.useMemo(() => publicSandwichHoldingCreator(holding), [holding]);
  const provenance = React.useMemo(() => publicSandwichHoldingProvenance(holding), [holding]);
  return <SandwichHoldingCard row={row} creator={creator} provenance={provenance} takes={takes} onOpen={onOpen} />;
}

export function SandwichHoldingCard({
  row,
  creator,
  creatorLoading = false,
  provenance,
  caption = null,
  settledAt = null,
  fallbackBasisUsd = null,
  takes = null,
  onAddTake,
  onOpen,
}: {
  row: SandwichHoldingRow;
  creator: SandwichCreatorMeta;
  /**
   * The byline is still on its way. The position itself comes from local
   * storage and paints at once; who made it is a network read per sandwich.
   * Without this flag an in-flight read is indistinguishable from an
   * unattributed record, and the row shows a blank face and no handle as if
   * that were the answer.
   */
  creatorLoading?: boolean;
  /** Where this position came from. Absent for a non-podcast sandwich. */
  provenance: SandwichProvenance | null;
  /**
   * The episode's own words at the moment, for a call that came from a
   * timestamped video. Null for every other source, which keeps the written
   * line.
   */
  caption?: MomentCaption | null;
  /** Compact close time shown in the existing creator row for settled cards. */
  settledAt?: string | null;
  /**
   * The position's cost basis, shown in the metric column ONLY when the result
   * itself is unknowable — a settled sandwich whose exit proceeds were never
   * recorded. Labelled "invested" rather than printed bare, because the number
   * is what went in, not what came out, and the two must never be confused.
   */
  fallbackBasisUsd?: number | null;
  /**
   * The thesis this holder has written on the position, when there is one. Both
   * cards render `latest` as a quote line; only the owner's card gets the
   * button, which is what `onAddTake` decides.
   */
  takes?: { count: number; latest: PositionTake | null } | null;
  /**
   * Present on the OWN profile only. A take can only be written by the holder,
   * so a public card has nothing to offer and shows no row at all.
   */
  onAddTake?: () => void;
  onOpen: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  // The leg the avatar shows: one with a stored image if any has one, else the
  // first, whose logo is then looked up by its ticker.
  const faceLeg = row.position.legs.find((leg) => leg.imageUrl) ?? row.position.legs[0] ?? null;
  const avatarLegs = (faceLeg
    ? [faceLeg, ...row.position.legs.filter((leg) => leg !== faceLeg)]
    : []
  ).slice(0, 2).map((leg) => ({
    iconUri: leg.imageUrl ?? null,
    symbol: leg.symbol ?? null,
    mint: leg.mint ?? null,
    initial: (leg.symbol ?? row.position.name).slice(0, 1).toUpperCase(),
  }));
  const returnLabel =
    formatPnlPercentage(row.returnPct) ?? "—";
  const pnlUsd =
    row.realizedPnlUsd ??
    (row.position.investedUsd === null || !Number.isFinite(row.usdValue)
      ? null
      : row.usdValue - row.position.investedUsd);
  // A settled position whose proceeds were never recorded knows nothing about
  // its result — but it does know what was put in, and a card printing that is
  // worth more than one printing two dashes.
  const basisOnly =
    pnlUsd === null &&
    !Number.isFinite(row.usdValue) &&
    typeof fallbackBasisUsd === "number" &&
    Number.isFinite(fallbackBasisUsd);
  const pnlLabel = basisOnly
    ? "invested"
    : pnlUsd === null
      ? "—"
      : `${pnlUsd >= 0 ? "+" : "-"}${formatUsd(Math.abs(pnlUsd))}`;
  const pnlColor =
    pnlUsd === null
      ? colors.textSecondary
      : pnlUsd >= 0
        ? colors.positive
        : colors.negative;
  const valueLabel = basisOnly
    ? formatUsd(fallbackBasisUsd)
    : formatUsd(row.usdValue);
  // The speaker's actual claim beats the generated basket label — the same
  // preference perp Sandwich rows already apply.
  const thesis = holdingTitle(
    provenance,
    row.position.summary.trim() || row.position.name,
  );
  // Where in the episode the call was made. Dropped rather than faked when the
  // source has no timeline, so a manual or X-sourced basket shows nothing. The
  // caption's own start wins: it is the moment those words were said, and the
  // two must never disagree on the same card.
  const timestamp = formatTimestamp(
    caption?.startMs ?? provenance?.source.startMs ?? null,
  );

  // The cited account leads the card and the builder is the sub-handle — the
  // same hierarchy the feed card uses, so a sandwich reads the same in
  // Holdings as it does in the feed. A native sandwich has no origin, so the
  // builder keeps the primary byline there.
  const origin = creator.origin;
  const builderName = creator.name;
  // Null when nobody is known — an unattributed record, or one that failed to
  // load. The row then leads with the thesis rather than a made-up byline.
  const primaryName = origin ? origin.name : builderName;
  const primaryIsHandle = origin ? origin.isHandle : Boolean(builderName);
  const primaryAvatarUrl = origin ? origin.avatarUrl : creator.avatarUrl;
  const primaryInitials = origin
    ? origin.initials
    : primaryName
      ? initialsFor(primaryName, "")
      : null;
  const subBuilderName = origin ? builderName : null;

  const card = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={
        basisOnly
          ? `${row.position.name}, ${valueLabel} invested, result unknown`
          : `${row.position.name}, current value ${valueLabel}, profit and loss ${pnlLabel}, total return ${returnLabel}`
      }
      accessibilityHint={
        provenance?.source.sourceType === "youtube"
          ? "Opens this timestamp, its reasoning and your position"
          : "Opens basket details"
      }
      onPress={onOpen}
      style={styles.sandwichHoldingCard}
    >
      <View style={styles.sandwichHoldingMainRow}>
        {/* Same face as the Closed row: the basket's first asset, a "+N"
            for the rest, and whoever made the call on the corner. */}
        <SandwichAvatarStack
          size={40}
          legs={avatarLegs}
          legCount={row.position.legs.length}
          creatorAvatarUri={primaryAvatarUrl}
          creatorInitial={primaryAvatarUrl || primaryInitials ? (primaryInitials ?? '') : null}
        />

        <View style={styles.sandwichHoldingCopy}>
          {creatorLoading && !primaryName ? (
            <View style={styles.sandwichHoldingHandleRow}>
              <ValueSkeleton width={96} height={12} />
            </View>
          ) : primaryName ? (
          <View style={styles.sandwichHoldingHandleRow}>
            <Text numberOfLines={1} style={styles.sandwichHoldingHandle}>
              {primaryIsHandle ? (
                <Text style={styles.sandwichHoldingHandleAt}>@</Text>
              ) : null}
              {primaryName}
            </Text>
            {/* The blue check means "this is a Bread builder". A cited account
                never gets one — it gets the mark that says where this came
                from. */}
            {origin ? (
              <Pressable
                accessibilityRole={origin.url ? "link" : "image"}
                accessibilityLabel={
                  origin.url ? "Open original source" : "External source"
                }
                disabled={!origin.url}
                hitSlop={12}
                onPress={(event) => {
                  event.stopPropagation();
                  if (origin.url) {
                    void Linking.openURL(origin.url).catch(() => {});
                  }
                }}
                style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
              >
                <Ionicons
                  name={HOLDING_PLATFORM_ICON[origin.platform] ?? "link-outline"}
                  size={13}
                  color={
                    origin.platform === "youtube" ? "#FF0000" : colors.textTertiary
                  }
                />
              </Pressable>
            ) : builderName ? (
              <VerifiedBadge size={14} />
            ) : null}
            {settledAt ? (
              <Text numberOfLines={1} style={styles.sandwichHoldingSettledAt}>
                · {settledAt}
              </Text>
            ) : null}
          </View>
          ) : null}

          {/* On an externally sourced sandwich the Bread builder is the
              sub-handle. A native one already shows this identity above. */}
          {subBuilderName ? (
            <View style={styles.sandwichHoldingSubHandleRow}>
              <Text numberOfLines={1} style={styles.sandwichHoldingSubHandle}>
                <Text style={styles.sandwichHoldingHandleAt}>@</Text>
                {subBuilderName}
              </Text>
              <VerifiedBadge size={12} />
            </View>
          ) : null}

          {/* The holder's own words outrank the generated line — that is the
              whole point of a take. Shown on both the own and public card. */}
          {takes?.latest ? (
            <Text numberOfLines={2} style={styles.sandwichHoldingTakeQuote}>
              {`\u201C${takes.latest.body}\u201D`}
            </Text>
          ) : null}

          {/* A call lifted from a video says what was actually said. The
              generated line only stands in when the moment was never quoted —
              or when the source has no timeline to quote from at all. */}
          {/* The moment leads the line and the words run on after it, so the
              stamp reads as "at 12:34, this was said" rather than a footnote. */}
          {caption ? (
            <Text numberOfLines={3} style={styles.sandwichHoldingCaption}>
              {timestamp ? (
                <Text style={styles.sandwichHoldingMoment}>{`${timestamp}  `}</Text>
              ) : null}
              {`\u201C${caption.text}\u201D`}
            </Text>
          ) : (
            <Text numberOfLines={2} style={styles.sandwichHoldingThesis}>
              {timestamp ? (
                <Text style={styles.sandwichHoldingMoment}>{`${timestamp}  `}</Text>
              ) : null}
              {thesis}
            </Text>
          )}
        </View>

        <View style={styles.sandwichHoldingPositionMetric}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.68}
            style={styles.sandwichHoldingValue}
          >
            {valueLabel}
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            style={[styles.sandwichHoldingPnl, { color: pnlColor }]}
          >
            {returnLabel}
          </Text>
        </View>
      </View>
    </PressableScale>
  );

  // The button sits under the card, not in it: the card opens the basket, the
  // button opens the composer, and a nested Pressable would fire both.
  if (!onAddTake) return card;
  return (
    <View>
      {card}
      <AddThesisButton count={takes?.count ?? 0} onPress={onAddTake} style={styles.sandwichHoldingTakeRow} />
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sandwichHoldingCard: {
    paddingVertical: 12,
  },
  sandwichHoldingTakeQuote: {
    color: c.text,
    fontSize: 13,
    fontFamily: F,
    fontStyle: "italic",
    marginTop: 2,
  },
  sandwichHoldingTakeRow: { marginTop: -2, marginBottom: 10 },
  sandwichHoldingMainRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  sandwichHoldingCopy: {
    flex: 1,
    minWidth: 0,
  },
  sandwichHoldingHandle: {
    flexShrink: 1,
    color: c.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "700",
    letterSpacing: 0,
    fontFamily: F,
  },
  sandwichHoldingHandleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  sandwichHoldingSubHandleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 1,
  },
  sandwichHoldingSubHandle: {
    flexShrink: 1,
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "600",
    fontFamily: F,
  },
  sandwichHoldingHandleAt: {
    color: c.textQuaternary,
    fontSize: 13,
    fontWeight: "600",
  },
  sandwichHoldingSettledAt: {
    flexShrink: 0,
    color: c.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
  },
  sandwichHoldingThesis: {
    marginTop: 3,
    color: c.text,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "500",
    fontFamily: F,
  },
  // Spoken words, so they read as a transcript line rather than as the card's
  // own claim: a shade lighter than the written thesis, and one size down so
  // three lines of captions still fit the same card height.
  sandwichHoldingCaption: {
    marginTop: 3,
    color: c.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    fontFamily: F,
  },
  // Where in the episode the call was made. Leads the claim inline (nested
  // Text, so it inherits the line's size), tinted back as provenance.
  sandwichHoldingMoment: {
    color: c.accentBlue,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  sandwichHoldingPositionMetric: {
    width: 72,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  // Matched to leveragePositionValue / leveragePositionPnl so the right-hand
  // numbers read at the same scale as the perp position rows.
  // No lineHeight here or on the PnL below: on iOS, adjustsFontSizeToFit +
  // an explicit lineHeight shrinks the text to minimumFontScale and clips it.
  sandwichHoldingValue: {
    color: c.text,
    fontSize: 20,
    fontWeight: "700",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  sandwichHoldingPnl: {
    marginTop: 1,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
});
