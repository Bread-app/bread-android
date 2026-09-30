import type Ionicons from "@expo/vector-icons/Ionicons";

import type { ThemeColors } from "@/constants/theme";
import type { PositionTake, Sandwich, SandwichLeg, SandwichPost, Stock } from "@/lib/api";
import { DEMO_POST_ID, isDemoMode } from "@/lib/demo/demo-config";
import { detectLinkPreview } from "@/lib/link-preview";
import { bestMarketReturn } from "@/lib/sandwich-pnl";
import type { PodcastGroupVideo } from "@/components/podcast-sandwich-group-card";

/**
 * The pure data layer behind a Sandwich feed card: titles, formatters,
 * attribution, and the grouping that turns a page of sandwich rows into the
 * cards the feed actually renders.
 *
 * Deliberately a LEAF module — it imports no screens and renders no JSX. This
 * is what lets Home, Profile, Saved and the stock detail sheet show a feed
 * without pulling in `screens/sandwich-screen.tsx` (and, behind it, the
 * composer, the trading engine, web3.js and Privy).
 */
export function formatCompactUsd(value: number | null) {
  if (value === null) return null;
  const magnitude = Math.abs(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: magnitude >= 100000 ? "compact" : "standard",
    // A sub-dollar token needs its digits: $0.0452 rounded to $0.05 is a 10%
    // error on the one figure the row exists to show.
    maximumFractionDigits: magnitude >= 100000 ? 1 : magnitude > 0 && magnitude < 1 ? 4 : 2,
  }).format(value);
}

/**
 * Money, not a price: always cents. For position values and P&L, where
 * "-$0.0267" is false precision — nobody is owed a fraction of a cent.
 */
export function formatMoneyUsd(value: number | null) {
  if (value === null) return null;
  const magnitude = Math.abs(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: magnitude >= 100000 ? "compact" : "standard",
    minimumFractionDigits: magnitude >= 100000 ? 0 : 2,
    maximumFractionDigits: magnitude >= 100000 ? 1 : 2,
  }).format(value);
}

export function formatSocialCount(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(Math.max(0, value));
}

/**
 * Feed-card like count. Capped at three glyphs ("999", "12k", "1m") so it
 * always fits the heart slot's trailing space and can never reach the comment
 * icon next to it.
 */
export function formatCardCount(value: number) {
  if (value >= 1000000) return `${Math.floor(value / 1000000)}m`;
  if (value >= 1000) return `${Math.floor(value / 1000)}k`;
  return String(Math.max(0, value));
}

export function getLegTitle(leg: SandwichLeg) {
  if (leg.type === "prediction_market") {
    // Jupiter/Polymarket label a binary sub-market with just the outcome
    // ("Yes"/"No") while the real question lives on the event. Showing that bare
    // outcome as the title reads as "Yes" with no context, and the side is
    // already surfaced separately as a YES/NO pill — so prefer whichever of
    // question/label actually carries the market question.
    const isBareOutcome = (value?: string | null) =>
      !value || /^(yes|no)$/i.test(value.trim());
    const candidates = [leg.question?.trim(), leg.label?.trim()].filter(
      (value): value is string => !!value && !isBareOutcome(value),
    );
    // Prefer the most descriptive form — a grouped-market leg carries both the
    // bare candidate ("Portugal") and the combined "Question — Portugal", and
    // the latter (longer) is the one a user can actually interpret.
    if (candidates.length > 0) {
      return candidates.sort((a, b) => b.length - a.length)[0];
    }
    return leg.question?.trim() || leg.label?.trim() || "Prediction market";
  }

  return leg.symbol ? `${leg.symbol} · ${leg.label}` : leg.label;
}

export function getLegPrimaryLine(leg: SandwichLeg): string {
  if (leg.type === "prediction_market") {
    return getLegTitle(leg);
  }
  const ticker = getLegCode(leg) || leg.symbol || leg.label;
  return String(ticker || getLegTitle(leg)).trim();
}

export function getLegCode(leg: SandwichLeg) {
  if (leg.type === "prediction_market") return "";
  return leg.underlyingSymbol ?? leg.symbol ?? leg.label;
}

export function stockPreviewFromLeg(leg: SandwichLeg): Stock | null {
  if (leg.type !== "tokenized_stock" || !leg.mint) return null;
  const symbol = String(
    leg.underlyingSymbol ?? leg.symbol ?? leg.label,
  ).trim();
  const typeHint = `${leg.label} ${leg.symbol ?? ""} ${leg.mint}`.toLowerCase();
  const type: Stock["type"] = typeHint.includes("ondo")
    ? "ondo"
    : typeHint.includes("prestock")
      ? "prestock"
      : "xstock";

  return {
    id: leg.mint,
    symbol: symbol || leg.label,
    name: leg.label,
    type,
    holderCount: leg.holderCount,
    icon: leg.imageUrl,
    // Only the LIVE price bridges to the detail sheet. `leg.priceUsd` is the
    // entry recorded when the sandwich was created, so falling back to it put a
    // days-old number in the header where the current price goes.
    usdPrice: leg.currentPriceUsd,
    priceChange1h: null,
    // NOT `leg.pnlPct`. A leg's PnL is measured entry-to-now over the
    // sandwich's whole life; the detail sheet's header reads this field as the
    // 24H window change. Seeding one with the other meant tapping a leg opened
    // the sheet showing, say, -46% under "24H" for a stock that had moved -0.3%
    // that day, and then silently corrected itself once the by-mint fetch
    // landed. A leg carries no 24h data at all — `SandwichLeg` has no such
    // field — so the sheet must get this from its own sources (tokenMeta, then
    // the chart window), and null is the honest answer until one arrives.
    priceChange24h: null,
    volume24h: leg.volume24hUsd,
  };
}

export function getLegDescription(leg: SandwichLeg) {
  return leg.matchSummary ?? leg.reason;
}

export function formatLegSide(leg: SandwichLeg) {
  const side = leg.side.trim().toUpperCase();
  if (leg.type === "prediction_market") {
    return side === "NO" ? "NO" : "YES";
  }
  // A perp leg's direction IS the position, so it's spelled out as such rather
  // than as the buy/sell of an order.
  if (leg.venue === "perp") {
    return side === "SHORT" ? "SHORT" : "LONG";
  }
  return side === "SELL" || side === "SHORT" ? "SELL" : "BUY";
}

export function formatLegPriceValue(leg: SandwichLeg) {
  const value = leg.currentPriceUsd ?? leg.priceUsd;
  if (value === null) return "--";
  if (leg.type === "prediction_market") return `${Math.round(value * 100)}c`;
  return formatCompactUsd(value) ?? "--";
}



export const LIKE_PINK = "#FF1493";

/** Particle ring around the heart, laid out once at module scope. */
export const HEART_BURST_DOTS = Array.from({ length: 8 }, (_, index) => ({
  angle: index * (Math.PI / 4) - Math.PI / 2,
  distance: index % 2 === 0 ? 0.92 : 0.76,
  color: index % 2 === 0 ? LIKE_PINK : "#FF75BE",
}));
export function formatPnl(value: number | null) {
  if (value === null) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/**
 * Feed-card PnL. Same as formatPnl for normal moves, but drops precision on big
 * ones so the pill can never grow wide enough to shove itself off screen —
 * "+1240.00%" is nine glyphs of a width budget that only has room for seven.
 */
export function formatCardPnl(value: number | null) {
  if (value === null) return "--";
  const sign = value >= 0 ? "+" : "-";
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return `${sign}${(magnitude / 1000).toFixed(1)}k%`;
  if (magnitude >= 100) return `${sign}${Math.round(magnitude)}%`;
  return `${sign}${magnitude.toFixed(2)}%`;
}

export function pnlColor(value: number | null, c: ThemeColors) {
  if (value === null || value === 0) return c.text;
  // Green matches the chart's up-line (#35F046) so the number and the curve
  // agree; the negative fallback stays on the theme.
  return value > 0 ? c.chartPositive : c.negative;
}


export const AVATAR_PALETTE = ['#35F046', '#1D4ED8', '#EE1E52', '#F59E0B', '#8B5CF6', '#06B6D4'];
export function getAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// X/Twitter ingestion stores some tweets with their HTML entities still escaped
// (`&gt;`, `&amp;`, `&#39;`, …). Decode the common ones for display so the
// thesis card doesn't render literal entity codes.
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * The headline text of a feed card: the BUILDER's own read.
 *
 * `commentary` is the only field that is actually theirs. Everything below it is
 * a fallback for sandwiches published before commentary existed, and the order
 * matters: the thesis summary (what the sandwich argues) comes before the
 * source's own words, because rendering the origin's text as the builder's is
 * exactly the confusion this card is being rebuilt to remove.
 */
export function getBuilderTake(sandwich: Sandwich) {
  const commentary = sandwich.commentary?.trim();
  if (commentary) return decodeHtmlEntities(commentary);
  const summary = (sandwich.thesis.summary || sandwich.summary)?.trim();
  if (summary) return decodeHtmlEntities(summary);
  const input = sandwich.source.input.trim();
  if (input && !/^https?:\/\//i.test(input)) return decodeHtmlEntities(input);
  return "";
}

/**
 * The cited post's own words — the same field order `XPostPreview` reads, so
 * the feed and the embed can never disagree about what the post said.
 *
 * Used only when the source account IS the card's identity (no builder). There
 * the generated thesis was showing under someone else's name and handle, which
 * put words in their mouth; and the real post was then repeated underneath in a
 * nested embed carrying the same avatar and handle a second time. The post is
 * the card.
 */
export function getSourcePostText(sandwich: Sandwich) {
  const source = sandwich.source;
  const value = [source.text, source.quote, source.input].find(
    (candidate) =>
      typeof candidate === "string" &&
      candidate.trim().length > 0 &&
      !/^https?:\/\//i.test(candidate.trim()),
  );
  return value ? decodeHtmlEntities(value.trim()) : "";
}
export type SourceVideo = {
  videoId: string;
  url: string;
  title: string;
  channelName: string | null;
  channelAvatarUrl: string | null;
};

export const PLATFORM_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  youtube: "logo-youtube",
  x: "logo-x",
  x_post: "logo-x",
  x_summon: "logo-x",
  twitter: "logo-x",
  article: "document-text-outline",
  manual: "create-outline",
};
// A sandwich born from a YouTube video shouldn't present the video's title as
// the creator's own words — surface the video itself (thumbnail + channel) so
// the thesis is visibly attributed to the source.
export function getSourceVideo(sandwich: Sandwich): SourceVideo | null {
  const source = sandwich.source;
  if (source.sourceType !== "youtube") return null;
  const preview = detectLinkPreview(source.sourceUrl ?? source.input);
  if (!preview || preview.type !== "youtube" || !preview.videoId) return null;
  // For YouTube sources `quote` is the video title, or "<title> — <excerpt>".
  const quote = source.quote?.trim();
  const title = quote ? decodeHtmlEntities((quote.split(" — ")[0] || quote).trim()) : "";
  return {
    videoId: preview.videoId,
    url: preview.url,
    title: title || "Watch on YouTube",
    channelName: source.authorName ?? source.authorHandle,
    channelAvatarUrl: source.authorAvatarUrl,
  };
}

/**
 * One YouTube episode is one card, not one card per call.
 *
 * A video that produced three markets used to post three cards that each
 * repeated the same video preview. Grouping by `sourceId` — every market built
 * from an episode shares it — collapses them into a single container whose rows
 * are the markets. Non-video sandwiches pass through untouched, and a group
 * keeps the feed position of its newest member so ordering is unchanged.
 */
export type FeedItem =
  | { kind: "sandwich"; key: string; sandwich: Sandwich }
  | { kind: "video"; key: string; video: PodcastGroupVideo; sandwiches: Sandwich[] }
  /**
   * A holder thesis (§8). The basket rides along so Copy trade opens the same
   * sheet a thesis card would — a take is about a position, and a card you
   * cannot act on is just text.
   */
  | { kind: "take"; key: string; take: PositionTake; sandwich: Sandwich };

/** Stable empty list, so the loading state doesn't hand FlatList a new array. */
export const EMPTY_FEED: FeedItem[] = [];
export function buildFeedItems(sandwiches: Sandwich[]): FeedItem[] {
  const items: FeedItem[] = [];
  const groupIndexBySource = new Map<string, number>();

  for (const sandwich of sandwiches) {
    const video = getSourceVideo(sandwich);
    if (!video) {
      items.push({ kind: "sandwich", key: sandwich.id, sandwich });
      continue;
    }
    const existing = groupIndexBySource.get(sandwich.sourceId);
    if (existing != null) {
      const group = items[existing];
      if (group.kind === "video") group.sandwiches.push(sandwich);
      continue;
    }
    groupIndexBySource.set(sandwich.sourceId, items.length);
    items.push({
      kind: "video",
      key: `video-${sandwich.sourceId}`,
      video: {
        videoId: video.videoId,
        url: video.url,
        title: video.title,
        channelName: video.channelName,
        channelHandle: sandwich.source.authorHandle,
        channelAvatarUrl: video.channelAvatarUrl,
        summary: sandwich.source.editorialSummary,
        publishedAt: sandwich.source.publishedAt,
      },
      sandwiches: [sandwich],
    });
  }

  return items;
}

/**
 * The same cards, built from what the SERVER says a card is.
 *
 * `buildFeedItems` above infers the grouping: it buckets markets by `sourceId`
 * and hopes that matches the Post the backend already created. It usually does,
 * but it can only ever approximate — and it cannot group a card at all when the
 * page boundary splits an episode's markets across two requests, which is
 * exactly what paging over markets does.
 *
 * `/api/posts` states the grouping instead, so one post is one card and the
 * client stops guessing. Kept beside the old builder rather than replacing it:
 * `buildFeedItems` still serves callers that hold loose markets (a source's
 * markets, a profile grid) and have no posts to build from.
 */
export function buildFeedItemsFromPosts(posts: SandwichPost[]): FeedItem[] {
  const items: FeedItem[] = [];

  for (const post of posts) {
    const item = feedItemForPost(post);
    if (item) items.push(item);
  }

  return items;
}

function feedItemForPost(post: SandwichPost): FeedItem | null {
  let item = feedItemByPost.get(post);
  if (item === undefined) {
    item = buildFeedItemForPost(post);
    feedItemByPost.set(post, item);
  }
  return item;
}

/**
 * Posts in feed order, ranked the same way `rankFeedItems` ranks their cards.
 *
 * The feed ranks ONE PAGE at a time and appends it: re-ranking everything
 * loaded meant a strong card on page 3 could land above the cards already on
 * screen and shove them down mid-scroll. Pull-to-refresh starts a new first
 * page, so the top of the feed is still the best of what's fresh.
 */
export function rankPosts(posts: SandwichPost[]): SandwichPost[] {
  const postByItem = new Map<FeedItem, SandwichPost>();
  for (const post of posts) {
    const item = feedItemForPost(post);
    if (item) postByItem.set(item, post);
  }
  return rankFeedItems([...postByItem.keys()]).map((item) => postByItem.get(item)!);
}

/**
 * How the For You feed orders its cards.
 *
 * - `trending`: the blended PnL + likes score (`rankFeedItems`) — the default.
 * - `pnl`: the card's own headline figure, `bestMarketReturn`, highest first.
 *   Unpriced cards sink below every priced one, losers included.
 * - `recent`: the server's order, which is `publishedAt` desc.
 *
 * Like `rankPosts`, the feed applies this ONE PAGE at a time and appends, so
 * scrolling never reorders cards already on screen; a sort switch re-sorts
 * everything loaded, which is the reorder the user just asked for.
 */
export type FeedSort = "trending" | "pnl" | "recent";

export function sortPosts(posts: SandwichPost[], sort: FeedSort): SandwichPost[] {
  if (sort === "trending") return rankPosts(posts);

  const keyed = posts.map((post, index) => ({
    post,
    index,
    pnl: sort === "pnl" ? postHeadlinePnl(post) : null,
    publishedAt: postTimestamp(post),
  }));
  keyed.sort((a, b) => {
    if (sort === "pnl") {
      if (a.pnl !== b.pnl) {
        if (a.pnl === null) return 1;
        if (b.pnl === null) return -1;
        return b.pnl - a.pnl;
      }
    }
    // Recent, and the PnL tie-break. Server order is the final word so equal
    // timestamps keep the order the cursor paged them in.
    return b.publishedAt - a.publishedAt || a.index - b.index;
  });
  return keyed.map((entry) => entry.post);
}

/** The PnL the card DISPLAYS — the same markets `feedRank` reads. */
function postHeadlinePnl(post: SandwichPost): number | null {
  const item = feedItemForPost(post);
  if (!item) return null;
  const markets = item.kind === "video" ? item.sandwiches : [item.sandwich];
  const pnl = bestMarketReturn(markets).pnlPct;
  return pnl !== null && Number.isFinite(pnl) ? pnl : null;
}

function postTimestamp(post: SandwichPost): number {
  const timestamp = Date.parse(post.publishedAt ?? post.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * One FeedItem per post OBJECT. Posts keep their identity across page loads
 * and likes (only the touched post is replaced), so reusing the item keeps the
 * props of every other card referentially equal and their `React.memo` holds.
 * Rebuilding them made each new page re-render every mounted card mid-scroll —
 * a video card's `video` was a fresh object every time.
 */
const feedItemByPost = new WeakMap<SandwichPost, FeedItem | null>();

function buildFeedItemForPost(post: SandwichPost): FeedItem | null {
  const lead = post.sandwiches[0];
  if (!lead) return null;

  // A take is its own card shape. It is still an ordinary Post underneath —
  // likes, comments and paging are unchanged — so this is a rendering branch
  // and nothing more.
  if (post.kind === "take" && post.take) {
    return { kind: "take", key: post.id, take: post.take, sandwich: lead };
  }

  // Video-ness is a property of the SOURCE, not of `post.kind`: a video that
  // produced a single market is still a video card, and that is how the
  // sourceId-grouped builder behaved. Reading the source keeps the two in
  // agreement so the cutover changes nothing a user can see.
  const video = getSourceVideo(lead);
  if (!video) {
    return { kind: "sandwich", key: lead.id, sandwich: lead };
  }

  return {
    // Unchanged key scheme: the episode screen and the group store address a
    // card by its source, and a new key would orphan whatever they hold.
    key: `video-${post.sourceId ?? post.id}`,
    kind: "video",
    video: {
      videoId: video.videoId,
      url: video.url,
      title: video.title,
      channelName: video.channelName,
      channelHandle: lead.source.authorHandle,
      channelAvatarUrl: video.channelAvatarUrl,
      summary: lead.source.editorialSummary,
      publishedAt: lead.source.publishedAt,
    },
    sandwiches: post.sandwiches,
  };
}

type FeedRank = {
  score: number;
  positiveReturnPct: number;
  likeCount: number;
  createdAt: number;
};

/**
 * Rank the public feed by demonstrated performance and social conviction.
 *
 * Returns and likes use log curves: a single outlier cannot permanently pin a
 * card above the rest of the feed, while a post that is both profitable and
 * liked beats one that is strong on only one axis. Profit receives twice the
 * weight because a heart is cheap but a live return is the product's proof.
 *
 * Every card is ranked on the SAME figure it displays: `bestMarketReturn`,
 * which for a one-market card is simply that market's return. A podcast episode
 * used to be ranked on its equal-weight mean instead, so an episode holding a
 * genuine +80% call sank below single sandwiches returning a fraction of that —
 * its winner was averaged away before the sort ever saw it. Ranking and card
 * now agree, which is also the only way the order reads as sorted to someone
 * scrolling: the number on the card is the number it was placed by.
 *
 * The cost, accepted deliberately: an episode gets as many chances to produce a
 * winner as it has calls. `Math.min(500, …)` is what keeps that bounded — one
 * outlier can reach the cap but never past it — and the like term still means a
 * card has to be more than one lucky market to stay at the top.
 */
function feedRank(item: FeedItem): FeedRank {
  const markets = item.kind === "video" ? item.sandwiches : [item.sandwich];
  const first = markets[0];
  const likeCount = Math.max(
    0,
    Number.isFinite(first?.likeCount) ? first?.likeCount ?? 0 : 0,
  );

  const performance = bestMarketReturn(markets);
  // Cap the raw input before applying the log so a bad upstream price cannot
  // monopolise the feed. Genuine large wins still receive the strongest signal.
  // No coverage discount: the best market IS priced, so scaling it by how much
  // of the episode is priced would penalise a real return for its neighbours.
  const positiveReturnPct = Math.min(500, Math.max(0, performance.pnlPct ?? 0));
  const score = 2 * Math.log1p(positiveReturnPct) + Math.log1p(likeCount);
  const createdAt = markets.reduce((latest, market) => {
    const timestamp = Date.parse(market.createdAt);
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);

  return { score, positiveReturnPct, likeCount, createdAt };
}

/**
 * Sort feed cards without mutating the grouped list. Recency is deliberately a
 * tie-breaker rather than part of the score: the feed highlights calls that
 * proved right, while fresh/unpriced calls retain newest-first order together.
 */
export function rankFeedItems(items: FeedItem[]): FeedItem[] {
  const ranks = new Map(items.map((item) => [item.key, feedRank(item)]));
  const sorted = [...items].sort((a, b) => {
    const left = ranks.get(a.key)!;
    const right = ranks.get(b.key)!;
    return (
      right.score - left.score ||
      right.positiveReturnPct - left.positiveReturnPct ||
      right.likeCount - left.likeCount ||
      right.createdAt - left.createdAt ||
      a.key.localeCompare(b.key)
    );
  });

  // Demo mode (shoot builds only): the pinned card sits in front regardless of
  // its score, so its numbers can be whatever reads right on camera. Compile-
  // time gated — `isDemoMode()` is a constant and this folds out of a normal
  // build. See lib/demo/demo-config.ts.
  if (isDemoMode()) {
    const index = sorted.findIndex((item) => {
      const lead = item.kind === "video" ? item.sandwiches[0] : item.sandwich;
      return lead?.postId === DEMO_POST_ID;
    });
    if (index > 0) sorted.unshift(...sorted.splice(index, 1));
  }

  return sorted;
}
export function getThesisDescription(sandwich: Sandwich) {
  return (
    [
      sandwich.derivation.explanation,
      sandwich.routeEvidence.expansion?.shortDescription,
      sandwich.thesis.summary,
      sandwich.summary,
    ]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find((value) => value.length > 0) ?? ""
  );
}

export function getThesisBullets(sandwich: Sandwich) {
  return (
    sandwich.routeEvidence.expansion?.thesisSummaryBullets
      .map((bullet) => bullet.trim())
      .filter((bullet) => bullet.length > 0) ?? []
  );
}

export function compactWallet(value: string | null) {
  if (!value) return null;
  return value.length > 10
    ? `${value.slice(0, 4)}...${value.slice(-4)}`
    : value;
}

/**
 * The identity shown at the top of a card: the BUILDER.
 *
 * This used to read `source.user ?? source.authorHandle` — both of which belong
 * to the source, so the card credited whoever was cited and the builder never
 * appeared at all. It now resolves `sandwich.builder` and deliberately does NOT
 * fall back to the origin: an unowned sandwich has no builder, and saying
 * otherwise would attribute the work to someone who never did it.
 */
export function getBuilderMeta(sandwich: Sandwich) {
  const builder = sandwich.builder;
  if (!builder) return null;
  const username = builder.username ?? null;
  const fallbackName = builder.name ?? compactWallet(null);
  const name = (username ?? fallbackName ?? "Builder").replace(/^@+/, "");
  const avatarUrl = builder.avatarUrl ?? null;
  const initials =
    name
      .replace(/^@/, "")
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "C";

  return { name, avatarUrl, initials };
}

/**
 * The account a sandwich was sourced from — never its Bread builder.
 *
 * An origin is what makes this an externally sourced sandwich. Prefer that
 * public attribution payload, then fill any missing display fields from the
 * source row so older sandwiches get the same byline hierarchy.
 */
export function getSourceAuthorMeta(sandwich: Sandwich) {
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
  const initials =
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "S";
  return {
    name,
    // Only a handle earns the "@" — a bare display name isn't an address.
    isHandle: Boolean(handle),
    // The person's actual name, kept apart from `name` (which leads with the
    // handle). The detail screen bylines the human, not the address.
    displayName,
    avatarUrl: origin.avatarUrl ?? source.authorAvatarUrl ?? null,
    initials,
    platform: origin.platform,
    url: origin.url ?? source.sourceUrl ?? null,
  };
}
