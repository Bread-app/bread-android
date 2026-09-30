import type { NewsItem, Stock } from "@/lib/api";
import { normalizeTicker } from "@/lib/sell-mint";
import { cleanStockName } from "@/lib/stock-name";

/**
 * News tab data model — a LEAF module (no JSX, no screens) so the feed, the
 * reader route and the Home brief can all share it without an import cycle.
 *
 * The tokens.xyz feed returns up to 50 flat items with no paging, and the same
 * event arrives several times from different outlets ("Saylor outlines bill of
 * digital rights" ×2, the CEX outflow ×2). This turns that into stories: one
 * per event, with the other outlets kept as extra sources, and the tradeable
 * assets the headline actually names.
 */

export type NewsStory = {
  /** Stable key — the primary item's URL. */
  id: string;
  item: NewsItem;
  /** Display headline: links, @-handles and wire prefixes stripped. */
  title: string;
  /** Primary outlet label ("CoinTurk News", "@tokens"). */
  source: string;
  /** Other outlets that ran the same story, newest first. */
  alsoReportedBy: NewsItem[];
  /** Tradeable assets named in the headline, biggest mover first. */
  related: Stock[];
  imageUrl: string | null;
  postedAtMs: number | null;
};

export type NewsSection = {
  key: string;
  title: string;
  data: NewsStory[];
};

// Wire prefixes that add no information once the source is shown on the row.
const WIRE_PREFIX_RE =
  /^(?:latest|insight|breaking|update|just in|new|data|report|cointelegraph|coindesk|the block|panews|watch|alert)\s*[:\-–—]\s*/i;

export function cleanNewsTitle(value: string): string {
  let text = value
    .replace(
      /(^|[\s(])(?:(?:https?:)?\/\/)?(?:www\.)?(?:x\.com|twitter\.com|pic\.twitter\.com|t\.co)\/\S+/gi,
      "$1",
    )
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/(^|[^\w.+-])@(?=[A-Za-z0-9_]+)/g, "$1")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Strip up to two stacked prefixes ("COINTELEGRAPH: LATEST: …").
  for (let i = 0; i < 2; i++) {
    const next = text.replace(WIRE_PREFIX_RE, "");
    if (next === text || next.length < 12) break;
    text = next;
  }
  // "INSIGHT: solana currently…" leaves a lowercase first letter behind.
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function newsSourceLabel(item: NewsItem): string {
  if (item.feedSource === "x") return item.sourceName ?? "@tokens";
  const raw = item.sourceName?.trim();
  if (!raw) return "Newswire";
  // "COINTURK NEWS" → "CoinTurk News" reads as a name, not a shout. Leave
  // mixed-case names ("PANews (EN)", "AMBCrypto") exactly as published.
  if (raw === raw.toUpperCase() && /[A-Z]{4,}/.test(raw)) {
    return raw
      .toLowerCase()
      .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  }
  return raw.replace(/\s*\((?:en|english)\)\s*$/i, "");
}

export function newsImageUrl(item: NewsItem): string | null {
  const image = item.imageUrl?.trim();
  if (!image) return null;
  // X falls back to the author's avatar when a post has no media — that is not
  // artwork for the story.
  if (item.feedSource === "x" && /profile[_-]?images|default[_-]?profile|avatar/i.test(image)) {
    return null;
  }
  return image;
}

export function normalizeNewsUrl(value: string): string {
  const cleaned = value.trim().replace(/&amp;/gi, "&");
  if (/^\/\//.test(cleaned)) return `https:${cleaned}`;
  if (/^[a-z][a-z\d+.-]*:/i.test(cleaned)) return cleaned;
  return `https://${cleaned.replace(/^\/+/, "")}`;
}

export function newsRelativeTime(ms: number | null, now = Date.now()): string {
  if (ms == null) return "";
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(ms);
}

// ─── Same-story grouping ────────────────────────────────────────────────────

const DEDUPE_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "as", "at", "by",
  "is", "are", "was", "were", "be", "its", "it", "this", "that", "from", "over", "after",
  "says", "said", "amid", "into", "has", "have", "will", "new", "past", "days", "day",
]);

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/(\d),(\d)/g, "$1$2")
      .split(/[^a-z0-9$.]+/)
      .map((w) => w.replace(/^\.+|\.+$/g, ""))
      .filter((w) => w.length >= 3 && !DEDUPE_STOPWORDS.has(w)),
  );
}

/**
 * Two outlets writing up one event share most of the SHORTER headline's words
 * ("CEX recorded a net outflow of 31,782 BTC" vs "CEX platforms saw a net
 * outflow of 31,782 BTC over the past 7 days, with Binance…"), so overlap is
 * measured against the smaller set, with a floor on shared words so two
 * four-word headlines can't merge on "Solana" + "price".
 */
function isSameStory(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared >= 4 && shared / Math.min(a.size, b.size) >= SAME_STORY_OVERLAP;
}

const SAME_STORY_OVERLAP = 0.55;
const SAME_STORY_WINDOW_MS = 18 * 60 * 60 * 1000;

// ─── Headline → tradeable assets ───────────────────────────────────────────

// Tickers that are also ordinary words: they only count when written $TICKER.
const AMBIGUOUS_TICKERS = new Set([
  "OPEN", "CHIP", "BILL", "MEGA", "LIT", "HUT", "ARM", "FIG", "APP", "BLEND", "PONS",
  "NOW", "ALL", "ONE", "KEY", "CAT", "FUN", "RUN", "BIG", "LOW", "ANY", "NEW", "TOP",
  "AI", "IT", "BE", "MA", "HD", "KO", "PG", "GS", "BP", "INX", "DEUS", "CEO", "ETF",
  "SEC", "USD", "CEX", "DEX", "IPO", "GDP", "CPI", "FED", "NYSE", "DOGE",
]);

// First words of company names that say nothing on their own.
const GENERIC_NAME_WORDS = new Set([
  "global", "united", "first", "american", "national", "international", "general",
  "digital", "financial", "energy", "health", "network", "protocol", "token", "bank",
  "capital", "group", "holdings", "technologies", "systems", "trust", "fund", "index",
  "ishares", "vanguard", "spdr", "invesco", "proshares", "direxion", "paris", "arsenal",
  "billions", "open", "usd", "bullish", "bearish", "strategy", "quant", "circle",
]);

// Names headlines use that the catalog listing doesn't: MSTR is listed as
// "MicroStrategy" but written up as "Strategy" / "Saylor".
const NAME_ALIASES: Record<string, string[]> = {
  MSTR: ["Strategy", "Saylor"],
  CRCL: ["Circle"],
  GOOGL: ["Google", "Alphabet"],
  META: ["Meta", "Facebook"],
  BTC: ["Bitcoin"],
  ETH: ["Ethereum", "Ether"],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Names match as proper nouns — "Strategy's Michael Saylor" is MSTR, "a new
 * strategy" is not — in the three casings headlines actually use: as listed,
 * Title Case ("Nvidia" for "NVIDIA"), and ALL CAPS wire headlines.
 */
function nameRegExp(pattern: string): RegExp {
  const variants = new Set<string>();
  for (const alt of pattern.split("|")) {
    variants.add(alt);
    variants.add(alt.toUpperCase());
    variants.add(alt.split(/(\s+)/).map((w) => (/\s/.test(w) ? w : capitalize(w))).join(""));
  }
  return new RegExp(`\\b(?:${Array.from(variants).join("|")})(?:'s|’s)?\\b`);
}

type CatalogMatcher = {
  stock: Stock;
  ticker: RegExp | null;
  dollarTicker: RegExp;
  name: RegExp | null;
  coinIds: Set<string>;
};

function buildMatchers(catalog: Stock[]): CatalogMatcher[] {
  const seen = new Set<string>();
  const entries: { stock: Stock; ticker: string; cleanName: string; firstWord: string }[] = [];
  const firstWordCounts = new Map<string, number>();
  for (const stock of catalog) {
    const ticker = normalizeTicker(stock.symbol);
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    const cleanName = cleanStockName(stock.name ?? "").replace(/[.,]+$/g, "").trim();
    const firstWord = cleanName.split(/\s+/)[0] ?? "";
    const key = firstWord.toLowerCase();
    firstWordCounts.set(key, (firstWordCounts.get(key) ?? 0) + 1);
    entries.push({ stock, ticker, cleanName, firstWord });
  }

  return entries.map(({ stock, ticker, cleanName, firstWord }) => {
    const names: string[] = [];
    if (cleanName.length >= 4 && !GENERIC_NAME_WORDS.has(cleanName.toLowerCase())) {
      names.push(escapeRegExp(cleanName));
    }
    // The first word alone when it is distinctive ("Broadcom", "Solana") —
    // never "Global", and never a word three listings share ("Strategy PP
    // Variable", "Strategy PP Fixed", …), which would tag all of them.
    const firstKey = firstWord.toLowerCase();
    if (
      firstWord !== cleanName &&
      firstWord.length >= 5 &&
      !GENERIC_NAME_WORDS.has(firstKey) &&
      (firstWordCounts.get(firstKey) ?? 0) === 1
    ) {
      names.push(escapeRegExp(firstWord));
    }
    for (const alias of NAME_ALIASES[ticker] ?? []) names.push(escapeRegExp(alias));

    return {
      stock,
      // Case-sensitive: "NEAR ETF" is the coin, "near $5" is not.
      ticker:
        ticker.length >= 3 && !AMBIGUOUS_TICKERS.has(ticker)
          ? new RegExp(`(?:^|[^A-Za-z0-9$])${escapeRegExp(ticker)}(?![A-Za-z0-9])`)
          : null,
      dollarTicker: new RegExp(`\\$${escapeRegExp(ticker)}(?![A-Za-z0-9])`, "i"),
      name: names.length > 0 ? nameRegExp(names.join("|")) : null,
      coinIds: new Set(
        [cleanName.toLowerCase(), firstWord.toLowerCase()].filter(
          (v) => v.length >= 4 && !GENERIC_NAME_WORDS.has(v),
        ),
      ),
    };
  });
}

function matchStocks(item: NewsItem, title: string, matchers: CatalogMatcher[]): Stock[] {
  const raw = item.title;
  const coinIds = item.relatedCoinIds.map((id) => id.toLowerCase().replace(/[-_]/g, " "));
  const hits: Stock[] = [];
  for (const m of matchers) {
    const hit =
      m.dollarTicker.test(raw) ||
      (m.ticker?.test(title) ?? false) ||
      (m.name?.test(title) ?? false) ||
      coinIds.some((id) => m.coinIds.has(id));
    if (hit) hits.push(m.stock);
  }
  return hits
    .sort((a, b) => Math.abs(b.priceChange24h ?? 0) - Math.abs(a.priceChange24h ?? 0))
    .slice(0, 4);
}

// ─── Build ─────────────────────────────────────────────────────────────────

function postedMs(item: NewsItem): number | null {
  if (!item.postedAt) return null;
  const ms = new Date(item.postedAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Flat feed items → stories, newest first. Duplicates fold into the story that
 * has artwork (else the newest), and every story carries the assets it names.
 */
export function buildNewsStories(items: NewsItem[], catalog: Stock[]): NewsStory[] {
  const matchers = buildMatchers(catalog);
  const sorted = [...items].sort((a, b) => (postedMs(b) ?? 0) - (postedMs(a) ?? 0));

  type Group = { members: NewsItem[]; tokens: Set<string>; newest: number | null };
  const groups: Group[] = [];
  const seenUrls = new Set<string>();

  for (const item of sorted) {
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    const tokens = titleTokens(cleanNewsTitle(item.title));
    const ms = postedMs(item);
    const match = groups.find(
      (g) =>
        (g.newest == null || ms == null || Math.abs(g.newest - ms) <= SAME_STORY_WINDOW_MS) &&
        isSameStory(g.tokens, tokens),
    );
    if (match) {
      match.members.push(item);
    } else {
      groups.push({ members: [item], tokens, newest: ms });
    }
  }

  return groups.map((group) => {
    const primary =
      group.members.find((m) => newsImageUrl(m) != null) ?? group.members[0];
    const title = cleanNewsTitle(primary.title);
    // Match against every outlet's wording — one says "Saylor", another
    // "Strategy's Michael Saylor".
    const related = new Map<string, Stock>();
    for (const member of group.members) {
      for (const stock of matchStocks(member, cleanNewsTitle(member.title), matchers)) {
        related.set(stock.id, stock);
      }
    }
    return {
      id: primary.url,
      item: primary,
      title,
      source: newsSourceLabel(primary),
      alsoReportedBy: group.members.filter((m) => m !== primary),
      related: Array.from(related.values())
        .sort((a, b) => Math.abs(b.priceChange24h ?? 0) - Math.abs(a.priceChange24h ?? 0))
        .slice(0, 4),
      imageUrl: newsImageUrl(primary),
      postedAtMs: group.newest ?? postedMs(primary),
    };
  });
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Time buckets for the list: the last hour, today, yesterday, then by date. */
export function sectionNewsStories(stories: NewsStory[], now = Date.now()): NewsSection[] {
  const today = startOfDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;
  const sections: NewsSection[] = [];
  const byKey = new Map<string, NewsSection>();

  for (const story of stories) {
    const ms = story.postedAtMs;
    let key: string;
    let title: string;
    if (ms == null) {
      key = "undated";
      title = "Earlier";
    } else if (now - ms < 60 * 60 * 1000) {
      key = "hour";
      title = "Last hour";
    } else if (ms >= today) {
      key = "today";
      title = "Earlier today";
    } else if (ms >= yesterday) {
      key = "yesterday";
      title = "Yesterday";
    } else {
      key = `d-${startOfDay(ms)}`;
      title = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }).format(ms);
    }
    let section = byKey.get(key);
    if (!section) {
      section = { key, title, data: [] };
      byKey.set(key, section);
      sections.push(section);
    }
    section.data.push(story);
  }
  return sections;
}

// ─── Reader hand-off ───────────────────────────────────────────────────────

/**
 * The story the reader route shows. A whole record (with its matched assets)
 * travels through here rather than route params, the same way the stock and
 * sandwich detail routes receive theirs.
 */
let activeStory: NewsStory | null = null;

export function setActiveNewsStory(story: NewsStory): void {
  activeStory = story;
}

export function getActiveNewsStory(): NewsStory | null {
  return activeStory;
}
