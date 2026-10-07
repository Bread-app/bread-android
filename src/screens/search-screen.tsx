import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  ReduceMotion,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { usePrivy } from "@privy-io/expo";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemeStore } from "@/lib/theme-store";
import { userDisplayName } from "@/lib/user-display";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import { FollowButton } from "@/components/follow-button";
import { LoadingStockList } from "@/components/loading-stock-list";
import { StockCard } from "@/components/stock-card";
import {
  StockDetailSheet,
  type StockDetailSheetRef,
} from "@/components/stock-detail-sheet";
import { useStockDetail } from "@/lib/stock-detail-store";
import type { ZoomSourceRect } from "@/lib/zoom-transition";
import { PhoenixMarketCard } from "@/components/phoenix-market-card";
import { usePhoenixMarkets, usePhoenixRotatingPrices } from "@/hooks/use-phoenix-live";
import {
  findPhoenixMarketForAsset,
  type PhoenixMarket,
} from "@/lib/phoenix-api";
import { phoenixOnlyMarkets } from "@/lib/phoenix-symbol";
import { setPendingCuratedEntry } from "@/screens/curated-sandwich-detail-screen";
import { useSandwichDetail } from "@/lib/sandwich-detail-store";
import { UserProfileScreen } from "@/screens/user-profile-screen";
import {
  appUserPayloadFromPrivyUser,
  followUser,
  getCachedCuratedSandwiches,
  getCachedSandwiches,
  getCuratedSandwiches,
  getSandwiches,
  getTopHolderStocks,
  searchUsers,
  unfollowUser,
  type AssetFilter,
  type CuratedSandwich,
  type Sandwich,
  type SocialUser,
  type Stock,
} from "@/lib/api";
import { parseSolanaMintInput } from "@/lib/solana-token-input";
import { RecentUsersCarousel } from "@/components/recent-users-carousel";
import {
  clearRecentUsers,
  getRecentUserIds,
  loadRecentUsers,
  recordRecentUser,
  removeRecentUser,
  subscribeToRecentUsers,
} from "@/lib/recent-users-store";
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

type DiscoveryTile = {
  key: string;
  title: string;
  subtitle?: string;
  subtitleIsPerformance?: boolean;
  imageUrl?: string | null;
  containImage?: boolean;
  onPress: () => void;
};

type BrowseCategoryKey = "stocks" | "private" | "crypto" | "perps" | "metals";
type MarketBrowseCategoryKey = Exclude<BrowseCategoryKey, "perps">;

const BROWSE_CATEGORY_FILTERS: Record<MarketBrowseCategoryKey, AssetFilter> = {
  stocks: "stocks",
  private: "ipos",
  crypto: "crypto",
  metals: "metals",
};

const BROWSE_CATEGORY_ORDER: BrowseCategoryKey[] = [
  "stocks",
  "private",
  "crypto",
  "metals",
];

/**
 * The browse tabs that also carry Phoenix-only perps, and the asset class each
 * one unions in. Metals stay spot-only: Phoenix commodities are not tradable.
 */
const BROWSE_CATEGORY_PERP_KIND: Partial<
  Record<MarketBrowseCategoryKey, "equity" | "crypto">
> = {
  stocks: "equity",
  crypto: "crypto",
};

const BROWSE_CATEGORY_TITLES: Record<BrowseCategoryKey, string> = {
  stocks: "Stocks",
  private: "Private",
  crypto: "Crypto",
  perps: "Perps",
  metals: "Metals",
};

type SearchResultsProps = {
  /** Current query text, owned by the floating search bar. */
  query: string;
  /** Whether the search surface is open (drives data loading + focus). */
  active: boolean;
  /** Space to leave at the bottom for the tab bar (+ keyboard). */
  bottomPad: number;
};

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function DiscoverySection({
  title,
  items,
}: {
  title: string;
  items: DiscoveryTile[];
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();

  if (items.length === 0) return null;

  return (
    <View style={styles.discoverySection}>
      <View style={styles.discoveryHeadingRow}>
        <View style={styles.discoveryHeadingCopy}>
          <Text style={styles.discoveryEyebrow}>Ideas for you</Text>
          <Text style={styles.discoveryTitle}>{title}</Text>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Explore ${title}`}
          hitSlop={6}
          onPress={items[0].onPress}
          style={styles.discoveryExploreButton}
        >
          <Ionicons name="arrow-forward" size={22} color={colors.icon} />
        </PressableScale>
      </View>

      <View style={styles.discoveryGrid}>
        {items.slice(0, 4).map((item) => (
          <PressableScale
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={item.onPress}
            style={styles.discoveryTile}
          >
            {item.imageUrl ? (
              <Image
                source={{ uri: item.imageUrl }}
                resizeMode={item.containImage ? "contain" : "cover"}
                style={[
                  styles.discoveryTileImage,
                  item.containImage && styles.discoveryTileImageContained,
                ]}
              />
            ) : (
              <View style={styles.discoveryTileFallback}>
                <Ionicons
                  name="sparkles"
                  size={24}
                  color={colors.textTertiary}
                />
              </View>
            )}
            <LinearGradient
              pointerEvents="none"
              colors={["transparent", "rgba(0,0,0,0.76)"]}
              locations={[0.38, 1]}
              style={styles.discoveryTileShade}
            />
            <View pointerEvents="none" style={styles.discoveryTileCopy}>
              <Text style={styles.discoveryTileTitle} numberOfLines={2}>
                {item.title}
              </Text>
              {item.subtitle ? (
                <Text
                  style={[
                    styles.discoveryTileSubtitle,
                    item.subtitleIsPerformance && styles.discoveryTilePerformance,
                  ]}
                  numberOfLines={1}
                >
                  {item.subtitle}
                </Text>
              ) : null}
            </View>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

function AssetCategoryShelf({
  selectedKey,
  onSelect,
}: {
  selectedKey: BrowseCategoryKey;
  onSelect: (key: BrowseCategoryKey) => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.assetCategorySection}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.assetCategoryScroll}
        contentContainerStyle={styles.assetCategoryScrollContent}
      >
        {BROWSE_CATEGORY_ORDER.map((key) => {
          const selected = selectedKey === key;
          return (
            <PressableScale
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`Browse ${BROWSE_CATEGORY_TITLES[key]}`}
              accessibilityState={{ selected }}
              onPress={() => onSelect(key)}
              hitSlop={8}
            >
              <Text
                style={[
                  styles.assetCategoryTab,
                  selected && styles.assetCategoryTabSelected,
                ]}
              >
                {BROWSE_CATEGORY_TITLES[key]}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * The scrollable results surface behind the floating search bar. Renders the
 * searchable universes — assets, sandwiches, and people — plus the browse-only
 * category shelves. It also hosts the detail sheets opened from results. The
 * search input itself lives in the native header.
 */
export function SearchResults({
  query,
  active,
  bottomPad,
}: SearchResultsProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const { user } = usePrivy();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [heroIndex, setHeroIndex] = useState(0);
  const [selectedBrowseCategory, setSelectedBrowseCategory] =
    useState<BrowseCategoryKey>("stocks");
  const [categoryLists, setCategoryLists] = useState<
    Partial<Record<MarketBrowseCategoryKey, Stock[]>>
  >({});
  const [categoryLoading, setCategoryLoading] = useState<
    Partial<Record<MarketBrowseCategoryKey, boolean>>
  >({});
  const [categoryErrors, setCategoryErrors] = useState<
    Partial<Record<MarketBrowseCategoryKey, string>>
  >({});
  const [refreshing, setRefreshing] = useState(false);
  const followOverrideRef = useRef<Map<string, boolean>>(new Map());
  const [, forceFollowUpdate] = useState(0);

  const [assets, setAssets] = useState<Stock[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  // Full-catalog asset hits from the tokens.xyz search (`/v1/assets/search`),
  // separate from the cached top list used for the empty-state trending view.
  const [assetResults, setAssetResults] = useState<Stock[]>([]);
  const [assetSearchLoading, setAssetSearchLoading] = useState(false);
  const [mintResult, setMintResult] = useState<Stock | null>(null);
  const [mintLookupStatus, setMintLookupStatus] = useState<
    "idle" | "loading" | "not-found" | "error" | "ready"
  >("idle");
  const [mintLookupNonce, setMintLookupNonce] = useState(0);
  const [sandwiches, setSandwiches] = useState<Sandwich[]>([]);
  const [curated, setCurated] = useState<CuratedSandwich[]>([]);
  const [people, setPeople] = useState<SocialUser[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  // Recently opened people, shown as a carousel above the browse view. Held as
  // hydrated rows rather than ids so the strip paints in one pass.
  const [recentUsers, setRecentUsers] = useState<SocialUser[]>([]);
  const sandwichDetail = useSandwichDetail();
  // Whose profile the overlay shows. A privy id (not a SocialUser) because it
  // is opened both from the People results and from a stock sheet's Holders
  // row, which only knows the id.
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userOpen, setUserOpen] = useState(false);

  const stockSheetRef = useRef<StockDetailSheetRef>(null);
  const { open: openStockRoute } = useStockDetail();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assetDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedMintRef = useRef<string | null>(null);
  const mintLookupRequestRef = useRef(0);
  const loadedRef = useRef(false);

  const pastedMint = useMemo(() => parseSolanaMintInput(query), [query]);

  const loadBrowseCategory = useCallback(async (key: MarketBrowseCategoryKey) => {
    setCategoryLoading((current) => ({ ...current, [key]: true }));
    setCategoryErrors((current) => ({ ...current, [key]: undefined }));
    try {
      const items = await getTopHolderStocks({
        limit: 100,
        category: BROWSE_CATEGORY_FILTERS[key],
      });
      setCategoryLists((current) => ({ ...current, [key]: items }));
    } catch (error) {
      setCategoryErrors((current) => ({
        ...current,
        [key]:
          error instanceof Error ? error.message : "Couldn't load this market.",
      }));
    } finally {
      setCategoryLoading((current) => ({ ...current, [key]: false }));
    }
  }, []);

  // Load the searchable universes once, the first time search opens.
  useEffect(() => {
    if (!active || loadedRef.current) return;
    loadedRef.current = true;

    // Load each discovery category independently so lower-volume metals and
    // private assets are not crowded out by the all-market volume ranking.
    setAssetsLoading(true);
    void Promise.all([
      getTopHolderStocks({ limit: 12, category: "stocks" }).catch(() => []),
      getTopHolderStocks({ limit: 12, category: "crypto" }).catch(() => []),
      getTopHolderStocks({ limit: 12, category: "metals" }).catch(() => []),
      getTopHolderStocks({ limit: 12, category: "ipos" }).catch(() => []),
    ])
      .then(([stocks, crypto, metals, privateAssets]) => {
        // Keep one deduplicated local universe for instant matches while the
        // full-catalog debounced search request is still in flight.
        const merged = new Map<string, Stock>();
        [...stocks, ...crypto, ...metals, ...privateAssets].forEach((stock) => {
          merged.set(stock.id, stock);
        });
        setAssets([...merged.values()]);
      })
      .finally(() => setAssetsLoading(false));

    // The default browse list, so the tab row lands on a populated Stocks list.
    void loadBrowseCategory("stocks");

    // Public sandwiches (cache-first).
    const cachedSandwiches = getCachedSandwiches(50);
    if (cachedSandwiches) {
      setSandwiches(cachedSandwiches);
    } else {
      void getSandwiches(50)
        .then(setSandwiches)
        .catch(() => {});
    }

    // Curated sandwiches (cache-first).
    const cachedCurated = getCachedCuratedSandwiches(null);
    if (cachedCurated) {
      setCurated(cachedCurated);
    } else {
      void getCuratedSandwiches(null)
        .then(setCurated)
        .catch(() => {});
    }

  }, [active, loadBrowseCategory]);

  // Debounced full-catalog asset discovery via tokens.xyz `/v1/assets/search`
  // (routed through getTopHolderStocks with a `q`), so results aren't limited
  // to the cached top list.
  useEffect(() => {
    const term = query.trim();
    if (!active || term.length < 2 || pastedMint) {
      setAssetResults([]);
      setAssetSearchLoading(false);
      return;
    }
    if (assetDebounceRef.current) clearTimeout(assetDebounceRef.current);
    setAssetSearchLoading(true);
    assetDebounceRef.current = setTimeout(() => {
      void getTopHolderStocks({ q: term, limit: 20 })
        .then((results) => {
          setAssetResults(results);
          setAssetSearchLoading(false);
        })
        .catch(() => setAssetSearchLoading(false));
    }, 250);
    return () => {
      if (assetDebounceRef.current) clearTimeout(assetDebounceRef.current);
    };
  }, [query, active, pastedMint]);

  // A pasted CA is an intent, not a fuzzy search. Resolve that exact mint via
  // the tokens.xyz catalog search and open the same full-screen asset route as
  // a tapped stock card. Deliberately NOT Jupiter: its token index holds every
  // memecoin on Solana, and search only surfaces listed assets — the backend
  // drops tokens.xyz's unlisted `solana-<mint>` singletons for the same reason.
  // Do not present the legacy gorhom sheet here: its vertical pan competes with
  // the trade pad's horizontal slide-to-confirm gesture and can cancel submit
  // after the Jupiter prebuild has already succeeded.
  useEffect(() => {
    const requestId = ++mintLookupRequestRef.current;
    let cancelled = false;

    if (!active || !pastedMint) {
      setMintResult(null);
      setMintLookupStatus("idle");
      openedMintRef.current = null;
      return;
    }

    setMintResult(null);
    setMintLookupStatus("loading");

    void getTopHolderStocks({ q: pastedMint, limit: 5 })
      .then((results) => {
        if (cancelled || requestId !== mintLookupRequestRef.current) return;
        // Enforce identity client-side so a fuzzy hit can never open the
        // wrong CA.
        const nextStock = results.find((stock) => stock.id === pastedMint);
        if (!nextStock) {
          setMintLookupStatus("not-found");
          return;
        }

        setMintResult(nextStock);
        setMintLookupStatus("ready");

        if (openedMintRef.current !== pastedMint) {
          openedMintRef.current = pastedMint;
          Keyboard.dismiss();
          openStockRoute(nextStock, { source: null });
        }
      })
      .catch(() => {
        if (cancelled || requestId !== mintLookupRequestRef.current) return;
        setMintLookupStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [active, mintLookupNonce, openStockRoute, pastedMint]);

  // Debounced people search against our stored profiles.
  useEffect(() => {
    const q = query.trim();
    if (!active || q.length < 2 || pastedMint) {
      setPeople([]);
      setPeopleLoading(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPeopleLoading(true);
    debounceRef.current = setTimeout(() => {
      void searchUsers(q, user?.id ?? null, 10)
        .then((results) => {
          setPeople(results);
          setPeopleLoading(false);
        })
        .catch((error: unknown) => {
          // Logged, not swallowed. A server-side failure here renders as an
          // empty People section, which is indistinguishable from "no such
          // user" — that is how a broken search query went unnoticed while
          // every lookup returned nothing.
          console.warn("[search] people lookup failed", error);
          setPeopleLoading(false);
        });
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, active, pastedMint, user?.id]);

  // Close the detail sheets whenever search closes.
  useEffect(() => {
    if (!active) {
      stockSheetRef.current?.close();
    }
  }, [active]);

  const q = query.trim().toLowerCase();

  // Instant local matches from the cached top list, shown while the tokens.xyz
  // search request is in flight.
  const localAssetHits = useMemo(() => {
    if (!q) return [];
    return assets
      .filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [assets, q]);

  // Prefer the full-catalog server results; fall back to local hits until they
  // land so the list never flashes empty.
  const assetHits = useMemo(
    () =>
      pastedMint
        ? mintResult
          ? [mintResult]
          : []
        : assetResults.length > 0
          ? assetResults
          : localAssetHits,
    [assetResults, localAssetHits, mintResult, pastedMint],
  );

  const sandwichHits = useMemo(() => {
    if (!q) return [];
    return sandwiches
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [sandwiches, q]);

  // Phoenix perps. The whole board is a few dozen markets of pure metadata,
  // fetched once per session, so matching happens locally — there is no perp
  // search endpoint to call and no reason to want one at this size.
  const {
    markets: allPerpMarkets,
    loading: perpMarketsLoading,
    error: perpMarketsError,
    refresh: refreshPerpMarkets,
  } = usePhoenixMarkets();

  /**
   * The perps *listed as their own rows* — equities only.
   *
   * Crypto perps are deliberately absent here. Every crypto perp has a spot
   * asset of the same name in this very list, so listing both would show the
   * user the same coin twice; the perp is reached from that spot row's
   * spot/perp toggle instead. Equity perps stay listed because their spot side
   * is a *wrapper* (AAPLx), a genuinely different instrument.
   */
  const perpMarkets = useMemo(
    () => allPerpMarkets.filter((market) => market.category === "equity"),
    [allPerpMarkets],
  );

  // Asset rows open the full-screen detail with the iOS-style zoom, growing out
  // of the row's own measured rect. Perp rows still present the sheet: they are
  // reached from `openPerp`, which has no row rect to grow from.
  const openStockDetail = useCallback(
    (stock: Stock, source: ZoomSourceRect | null) => {
      openStockRoute(stock, {
        source,
        // Matched against the full board, not the listed subset: this is exactly
        // how a crypto perp becomes reachable.
        perpMarket: findPhoenixMarketForAsset(allPerpMarkets, stock),
      });
    },
    [allPerpMarkets, openStockRoute],
  );

  /**
   * Perp rows for the query: every matching equity perp, plus the crypto perps
   * that have no spot twin among the asset hits (DOGE, XRP, LINK — tokens.xyz
   * does not list them, so without this they are unreachable from search).
   *
   * Crypto rows wait for the full-catalog asset search to settle: judged
   * against the interim local hits, a perp would flash in and then vanish once
   * its spot twin arrived.
   */
  const perpHits = useMemo(() => {
    if (!q || pastedMint) return [];
    const matchesQuery = (m: PhoenixMarket) =>
      m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    const equityHits = perpMarkets.filter(matchesQuery);
    const cryptoHits = assetSearchLoading
      ? []
      : phoenixOnlyMarkets(
          allPerpMarkets.filter(matchesQuery),
          assetHits,
          "crypto",
        );
    return [...equityHits, ...cryptoHits].slice(0, 4);
  }, [allPerpMarkets, assetHits, assetSearchLoading, pastedMint, perpMarkets, q]);

  /**
   * The browse tab as a union: the tokens.xyz list first, then the Phoenix
   * markets of the same asset class that the list has no row for (SPY, QQQ on
   * Stocks; DOGE, XRP, JUP on Crypto). Judged against the loaded list rather
   * than the whole catalog, so a perp never appears twice on one screen.
   */
  const browsePerpOnly = useMemo(() => {
    if (selectedBrowseCategory === "perps") return [];
    const kind = BROWSE_CATEGORY_PERP_KIND[selectedBrowseCategory];
    const items = categoryLists[selectedBrowseCategory];
    if (!kind || items === undefined) return [];
    return phoenixOnlyMarkets(allPerpMarkets, items, kind);
  }, [allPerpMarkets, categoryLists, selectedBrowseCategory]);

  // Live mark prices, for the rows actually on screen. Phoenix has no bulk price
  // endpoint and rate-limits at ~5 req/s, so a list longer than one batch is
  // priced a batch per poll rather than all at once.
  const pricedPerpSymbols = useMemo(
    () =>
      (q
        ? perpHits
        : selectedBrowseCategory === "perps"
          ? perpMarkets.slice(0, 8)
          : browsePerpOnly
      ).map((market) => market.symbol),
    [browsePerpOnly, perpHits, perpMarkets, q, selectedBrowseCategory],
  );
  const { prices: perpPrices, changes: perpChanges } =
    usePhoenixRotatingPrices(pricedPerpSymbols);

  const curatedBySandwichId = useMemo(
    () => new Map(curated.map((c) => [c.sandwichId, c])),
    [curated],
  );

  const hasQuery = q.length > 0;
  const nothingFound =
    hasQuery &&
    !pastedMint &&
    !peopleLoading &&
    !assetSearchLoading &&
    mintLookupStatus !== "loading" &&
    assetHits.length === 0 &&
    sandwichHits.length === 0 &&
    perpHits.length === 0 &&
    people.length === 0;

  const applyUpdatedSandwich = useCallback((updated: Sandwich) => {
    setSandwiches((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
  }, []);

  const getPersonIsFollowing = useCallback((person: SocialUser) => {
    const override = followOverrideRef.current.get(person.privyUserId);
    return override ?? person.isFollowing;
  }, []);

  /**
   * True when the query is explicitly about a person ("@ana").
   *
   * The "@" is the one unambiguous signal that the user wants somebody rather
   * than a ticker, so it is the only thing that reorders the results — every
   * other query keeps assets first, because most queries here are tickers.
   */
  const handleQuery = query.trim().startsWith("@");

  const peopleSection =
    people.length > 0 || peopleLoading ? (
      <>
        <Text style={styles.sectionLabel}>People</Text>
        {peopleLoading && people.length === 0 ? (
          <LoadingStockList />
        ) : (
          people.map((u) => {
            const isMe = u.privyUserId === user?.id;
            return (
              <PressableScale
                key={u.id}
                onPress={() => {
                  if (isMe) return;
                  openPerson(u);
                }}
                style={styles.row}
              >
                {u.avatarUrl ? (
                  <Image
                    source={{ uri: u.avatarUrl }}
                    style={styles.rowAvatar}
                  />
                ) : (
                  <View style={[styles.rowAvatar, styles.rowIconFallback]}>
                    <Ionicons name="person" size={22} color={colors.textTertiary} />
                  </View>
                )}
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {userDisplayName(u)}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {u.followerCount} followers
                  </Text>
                </View>
                {isMe ? (
                  <Text style={styles.youText}>You</Text>
                ) : (
                  <FollowButton
                    size="sm"
                    following={getPersonIsFollowing(u)}
                    onPress={(event) => {
                      event.stopPropagation();
                      void handleFollowPerson(u);
                    }}
                  />
                )}
              </PressableScale>
            );
          })
        )}
      </>
    ) : null;

  /**
   * Hydrates the Recents strip from the stored id order.
   *
   * Re-runs when the stored order changes (a tap, a removal, a clear) and when
   * the viewer changes, because `isFollowing` is resolved per viewer. An empty
   * list short-circuits without a request.
   */
  const refreshRecentUsers = useCallback(async () => {
    if (getRecentUserIds().length === 0) {
      setRecentUsers([]);
      return;
    }
    try {
      setRecentUsers(await loadRecentUsers(user?.id ?? null));
    } catch {
      // Recents are a shortcut, never the point of the screen — a failed
      // hydrate leaves what is already on screen rather than blanking it.
    }
  }, [user?.id]);

  useEffect(() => {
    void refreshRecentUsers();
    return subscribeToRecentUsers(() => {
      void refreshRecentUsers();
    });
  }, [refreshRecentUsers]);

  /** Opens a person and moves them to the front of Recents. */
  const openPerson = useCallback((person: SocialUser) => {
    recordRecentUser(person.privyUserId);
    setSelectedUserId(person.privyUserId);
    setUserOpen(true);
  }, []);

  const handleRemoveRecentUser = useCallback((person: SocialUser) => {
    void Haptics.selectionAsync();
    removeRecentUser(person.privyUserId);
    // Drops out of the strip immediately; the subscriber refetch that follows
    // only confirms what the user already sees.
    setRecentUsers((current) =>
      current.filter((entry) => entry.privyUserId !== person.privyUserId),
    );
  }, []);

  const handleClearRecentUsers = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearRecentUsers();
    setRecentUsers([]);
  }, []);

  const handleFollowPerson = useCallback(
    async (person: SocialUser) => {
      const actor = appUserPayloadFromPrivyUser(user);
      if (!actor) return;
      const wasFollowing = getPersonIsFollowing(person);
      followOverrideRef.current.set(person.privyUserId, !wasFollowing);
      forceFollowUpdate((value) => value + 1);
      try {
        if (wasFollowing) {
          await unfollowUser(actor, person.privyUserId);
        } else {
          await followUser(actor, person.privyUserId);
        }
      } catch {
        followOverrideRef.current.set(person.privyUserId, wasFollowing);
        forceFollowUpdate((value) => value + 1);
      }
    },
    [getPersonIsFollowing, user],
  );

  const handleSelectBrowseCategory = useCallback(
    (key: BrowseCategoryKey) => {
      setSelectedBrowseCategory(key);
      if (key !== "perps" && categoryLists[key] === undefined) {
        void loadBrowseCategory(key);
      }
    },
    [categoryLists, loadBrowseCategory],
  );

  const refreshDiscovery = useCallback(async () => {
    setRefreshing(true);
    refreshPerpMarkets();
    try {
      const [stocks, crypto, metals, privateAssets, publicSandwiches, curatedItems] =
        await Promise.all([
          getTopHolderStocks({ limit: 12, category: "stocks" }).catch(() => []),
          getTopHolderStocks({ limit: 12, category: "crypto" }).catch(() => []),
          getTopHolderStocks({ limit: 12, category: "metals" }).catch(() => []),
          getTopHolderStocks({ limit: 12, category: "ipos" }).catch(() => []),
          getSandwiches(50).catch(() => sandwiches),
          getCuratedSandwiches(null).catch(() => curated),
        ]);
      const merged = new Map<string, Stock>();
      [...stocks, ...crypto, ...metals, ...privateAssets].forEach((stock) =>
        merged.set(stock.id, stock),
      );
      setAssets([...merged.values()]);
      setSandwiches(publicSandwiches);
      setCurated(curatedItems);
      if (selectedBrowseCategory !== "perps") {
        await loadBrowseCategory(selectedBrowseCategory);
      }
    } finally {
      setRefreshing(false);
    }
  }, [
    curated,
    loadBrowseCategory,
    refreshPerpMarkets,
    sandwiches,
    selectedBrowseCategory,
  ]);

  function openSandwich(s: Sandwich) {
    // Portfolio (curated) sandwiches open the cover-image "Trend Report"
    // detail; thesis (user-generated) sandwiches open the SAME detail sheet
    // used in the feed (chart, thesis, holdings, like/share, buy flow), via
    // the shared host. Present synchronously from the gesture.
    const entry = curatedBySandwichId.get(s.id);
    if (entry) {
      setPendingCuratedEntry(entry);
      router.push(`/(app)/curated-sandwich/${entry.id}`);
      return;
    }
    sandwichDetail.open(s, {
      onUpdated: applyUpdatedSandwich,
    });
  }

  function sandwichPnlColor(s: Sandwich) {
    return s.pnlPct === null ? "#94a3b8" : s.pnlPct >= 0 ? "#02ED45" : "#D2042D";
  }

  // Portfolio (curated) row — square cover thumbnail, name + asset count.
  function renderPortfolioRow(s: Sandwich) {
    const cover = curatedBySandwichId.get(s.id)?.coverImageUrl ?? null;
    return (
      <PressableScale
        key={s.id}
        onPress={() => openSandwich(s)}
        style={styles.row}
      >
        {cover ? (
          <Image source={{ uri: cover }} style={styles.rowIcon} />
        ) : (
          <View style={[styles.rowIcon, styles.rowIconFallback]}>
            <Text style={styles.rowIconLetter}>
              {s.name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {s.name}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {s.legs.length} asset{s.legs.length !== 1 ? "s" : ""}
          </Text>
        </View>
        <Text style={[styles.rowPnl, { color: sandwichPnlColor(s) }]}>
          {formatPct(s.pnlPct)}
        </Text>
      </PressableScale>
    );
  }

  // Thesis (user-generated) row — styled distinctly from portfolio cards:
  // round creator avatar, and the byline (creator handle/name) as the subtitle.
  function renderThesisRow(s: Sandwich) {
    const creatorName =
      s.source.user?.name ?? s.source.authorName ?? s.source.authorHandle ?? null;
    const avatarUrl = s.source.user?.avatarUrl ?? s.source.authorAvatarUrl ?? null;
    const byline = creatorName
      ? `${s.legs.length} asset${s.legs.length !== 1 ? "s" : ""} · by ${creatorName}`
      : `${s.legs.length} asset${s.legs.length !== 1 ? "s" : ""}`;
    return (
      <PressableScale
        key={s.id}
        onPress={() => openSandwich(s)}
        style={styles.row}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.rowAvatar} />
        ) : (
          <View style={[styles.rowAvatar, styles.rowIconFallback]}>
            <Ionicons name="person" size={22} color={colors.textTertiary} />
          </View>
        )}
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {s.name}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {byline}
          </Text>
        </View>
        <Text style={[styles.rowPnl, { color: sandwichPnlColor(s) }]}>
          {formatPct(s.pnlPct)}
        </Text>
      </PressableScale>
    );
  }

  const heroItems: DiscoveryTile[] = [
    ...curated
      .filter((entry) => Boolean(entry.coverImageUrl))
      .slice(0, 2)
      .map((entry) => ({
        key: `hero-sandwich-${entry.id}`,
        title: entry.sandwich.name,
        subtitle: `${entry.sandwich.legs.length} assets · Curated strategy`,
        imageUrl: entry.coverImageUrl,
        onPress: () => openSandwich(entry.sandwich),
      })),
  ].slice(0, 3);

  const sandwichIdeas: DiscoveryTile[] = curated.slice(0, 4).map((entry) => ({
    key: `sandwich-${entry.id}`,
    title: entry.sandwich.name,
    subtitle: `${entry.sandwich.legs.length} assets`,
    imageUrl: entry.coverImageUrl,
    onPress: () => openSandwich(entry.sandwich),
  }));

  const heroWidth = Math.max(screenWidth - 32, 0);
  const discoveryLoading =
    heroItems.length === 0 && assetsLoading;

  function renderBrowseCategory() {
    const key = selectedBrowseCategory;
    if (key === "perps") {
      return (
        <View style={styles.browseListSection}>
          {perpMarketsLoading && perpMarkets.length === 0 ? (
            <LoadingStockList />
          ) : perpMarketsError && perpMarkets.length === 0 ? (
            <View style={styles.browseStateCard}>
              <Ionicons name="cloud-offline-outline" size={32} color={colors.iconMuted} />
              <Text style={styles.browseStateTitle}>Couldn&apos;t load perps</Text>
              <Text style={styles.browseStateBody}>{perpMarketsError}</Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Retry Perps"
                onPress={refreshPerpMarkets}
                style={styles.browseRetryButton}
              >
                <Text style={styles.browseRetryText}>Try again</Text>
              </PressableScale>
            </View>
          ) : perpMarkets.length === 0 ? (
            <View style={styles.browseStateCard}>
              <Ionicons name="search-outline" size={32} color={colors.iconMuted} />
              <Text style={styles.browseStateTitle}>No perp markets available</Text>
              <Text style={styles.browseStateBody}>Pull down to refresh this category.</Text>
            </View>
          ) : (
            perpMarkets.map((market) => (
              <PhoenixMarketCard
                key={market.symbol}
                market={market}
                price={perpPrices[market.symbol] ?? null}
                change={perpChanges[market.symbol] ?? null}
                onPress={(item) => stockSheetRef.current?.openPerp(item)}
              />
            ))
          )}
        </View>
      );
    }

    const items = categoryLists[key];
    const loading = categoryLoading[key] === true;
    const error = categoryErrors[key];
    return (
      <View style={styles.browseListSection}>
        {loading && items === undefined ? (
          <LoadingStockList />
        ) : error && items === undefined ? (
          <View style={styles.browseStateCard}>
            <Ionicons
              name="cloud-offline-outline"
              size={32}
              color={colors.iconMuted}
            />
            <Text style={styles.browseStateTitle}>Couldn&apos;t load this market</Text>
            <Text style={styles.browseStateBody}>{error}</Text>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Retry ${BROWSE_CATEGORY_TITLES[key]}`}
              onPress={() => void loadBrowseCategory(key)}
              style={styles.browseRetryButton}
            >
              <Text style={styles.browseRetryText}>Try again</Text>
            </PressableScale>
          </View>
        ) : items?.length === 0 ? (
          <View style={styles.browseStateCard}>
            <Ionicons name="search-outline" size={32} color={colors.iconMuted} />
            <Text style={styles.browseStateTitle}>No assets available</Text>
            <Text style={styles.browseStateBody}>
              Pull down to refresh this category.
            </Text>
          </View>
        ) : (
          <>
            {items?.map((stock) => (
              <StockCard
                key={stock.id}
                stock={stock}
                onPress={openStockDetail}
              />
            ))}
            {browsePerpOnly.map((market) => (
              <PhoenixMarketCard
                key={`perp-${market.symbol}`}
                market={market}
                price={perpPrices[market.symbol] ?? null}
                change={perpChanges[market.symbol] ?? null}
                onPress={(item) => stockSheetRef.current?.openPerp(item)}
              />
            ))}
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Animated.View style={styles.stackedScreen}>
      <ScrollView
        style={styles.scroll}
        // The large-title header insets this scroll view itself; adding our own
        // top padding on top of that pushed the hero and filter row off screen.
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomPad },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refreshDiscovery()}
            tintColor={colors.textSecondary}
          />
        }
      >
        {/* Keyed on browse vs. results so flipping between the trending view
            and search results crossfades once — individual rows stay static
            while the user types. */}
        {!hasQuery ? (
          <Animated.View
            key="browse"
            entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}>
            {/* Above the hero on purpose: a shortcut back to somebody the user
                was just looking at beats a merchandised card. Renders nothing
                until there IS a recent person, so a new install's browse view
                is exactly what it was before this existed. */}
            <RecentUsersCarousel
              users={recentUsers}
              isFollowing={getPersonIsFollowing}
              onPressUser={openPerson}
              onToggleFollow={(person) => void handleFollowPerson(person)}
              onRemove={handleRemoveRecentUser}
              onClearAll={handleClearRecentUsers}
              viewerPrivyUserId={user?.id ?? null}
            />

            {heroItems.length > 0 ? (
              <>
                <ScrollView
                  horizontal
                  pagingEnabled
                  bounces={false}
                  decelerationRate="fast"
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(event) => {
                    if (heroWidth === 0) return;
                    setHeroIndex(
                      Math.round(event.nativeEvent.contentOffset.x / heroWidth),
                    );
                  }}
                  style={styles.heroCarousel}
                >
                  {heroItems.map((item) => (
                    <PressableScale
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityLabel={item.title}
                      onPress={item.onPress}
                      style={[styles.heroCard, { width: heroWidth }]}
                    >
                      {item.imageUrl ? (
                        <Image
                          source={{ uri: item.imageUrl }}
                          resizeMode="cover"
                          style={styles.heroImage}
                        />
                      ) : null}
                      <View pointerEvents="none" style={styles.heroCopy}>
                        <Text style={styles.heroEyebrow}>{item.subtitle}</Text>
                        <Text style={styles.heroTitle} numberOfLines={2}>
                          {item.title}
                        </Text>
                      </View>
                    </PressableScale>
                  ))}
                </ScrollView>
                {heroItems.length > 1 ? (
                  <View style={styles.heroDots}>
                    {heroItems.map((item, index) => (
                      <View
                        key={`dot-${item.key}`}
                        style={[
                          styles.heroDot,
                          index === heroIndex && styles.heroDotActive,
                        ]}
                      />
                    ))}
                  </View>
                ) : null}
              </>
            ) : discoveryLoading ? (
              <View style={styles.heroSkeleton} />
            ) : null}

            <DiscoverySection title="Sandwich strategies" items={sandwichIdeas} />

            <AssetCategoryShelf
              selectedKey={selectedBrowseCategory}
              onSelect={handleSelectBrowseCategory}
            />

            {renderBrowseCategory()}

          </Animated.View>
        ) : (
          <Animated.View
            key="results"
            entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}>
            {handleQuery ? peopleSection : null}

            {pastedMint && mintLookupStatus === "loading" ? (
              <View style={styles.mintLookupCard} accessibilityLiveRegion="polite">
                <View style={styles.mintLookupIcon}>
                  <ActivityIndicator size="small" color={colors.icon} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle}>Finding token</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {`${pastedMint.slice(0, 4)}…${pastedMint.slice(-4)}`}
                  </Text>
                </View>
              </View>
            ) : pastedMint && mintLookupStatus === "error" ? (
              <View style={styles.mintLookupError} accessibilityLiveRegion="polite">
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle}>Couldn&apos;t look up this token</Text>
                  <Text style={styles.rowSub}>Check your connection and try again.</Text>
                </View>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Retry token lookup"
                  onPress={() => setMintLookupNonce((value) => value + 1)}
                  style={styles.mintRetryButton}
                >
                  <Text style={styles.mintRetryText}>Retry</Text>
                </PressableScale>
              </View>
            ) : pastedMint && mintLookupStatus === "not-found" ? (
              <View style={styles.emptyWrap} accessibilityLiveRegion="polite">
                <Text style={styles.emptyTitle}>Token not found</Text>
                <Text style={styles.emptyBody}>
                  This address isn&apos;t a stock or crypto asset listed on Bread.
                </Text>
              </View>
            ) : null}

            {assetHits.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Assets</Text>
                {/* Keep people and portfolio matches reachable above the keyboard. */}
                {assetHits.slice(0, 6).map((stock) => (
                  <StockCard
                    key={stock.id}
                    stock={stock}
                    onPress={openStockDetail}
                  />
                ))}
              </>
            ) : null}

            {/* People sit directly under Assets, not at the bottom. A username
                query used to render below every ticker, perp and sandwich hit,
                so finding a person meant scrolling past everything that was
                not one. */}
            {handleQuery ? null : peopleSection}

            {perpHits.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Perps</Text>
                {perpHits.map((market) => (
                  <PhoenixMarketCard
                    key={market.symbol}
                    market={market}
                    price={perpPrices[market.symbol] ?? null}
                    change={perpChanges[market.symbol] ?? null}
                    onPress={(item) => stockSheetRef.current?.openPerp(item)}
                  />
                ))}
              </>
            ) : null}

            {sandwichHits.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Sandwiches</Text>
                {sandwichHits.map((s) =>
                  curatedBySandwichId.has(s.id)
                    ? renderPortfolioRow(s)
                    : renderThesisRow(s),
                )}
              </>
            ) : null}

            {nothingFound ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>No results</Text>
                <Text style={styles.emptyBody}>
                  Try a ticker, token CA, sandwich name, or username.
                </Text>
              </View>
            ) : null}
          </Animated.View>
        )}
      </ScrollView>
      </Animated.View>

      <StockDetailSheet
        ref={stockSheetRef}
        onOpenUser={(privyUserId) => {
          setSelectedUserId(privyUserId);
          setUserOpen(true);
        }}
      />

      {selectedUserId ? (
        <UserProfileScreen
          visible={userOpen}
          onClose={() => setUserOpen(false)}
          targetPrivyUserId={selectedUserId}
          viewerPrivyUserId={user?.id ?? null}
          viewerPayload={user ? appUserPayloadFromPrivyUser(user) : null}
        />
      ) : null}

    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: {
    // Flows below the screen title rather than covering it. The detail sheets
    // hosted here portal out (gorhom modal / RN <Modal>), so they are unaffected.
    flex: 1,
    backgroundColor: c.backgroundAlt,
  },
  stackedScreen: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: c.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  heroCarousel: {
    borderRadius: 28,
  },
  heroCard: {
    height: 320,
    borderRadius: 28,
    backgroundColor: c.surfaceAlt,
    overflow: "hidden",
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    bottom: 112,
    width: undefined,
    height: undefined,
  },
  heroCopy: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 112,
    paddingHorizontal: 20,
    paddingVertical: 16,
    justifyContent: "center",
    alignItems: "flex-start",
    backgroundColor: c.surface,
  },
  heroEyebrow: {
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: F,
    marginBottom: 5,
    textAlign: "left",
  },
  heroTitle: {
    color: c.text,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: "800",
    fontFamily: F,
    textAlign: "left",
  },
  heroDots: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  heroDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: c.border,
  },
  heroDotActive: {
    backgroundColor: c.text,
  },
  heroSkeleton: {
    height: 320,
    borderRadius: 28,
    backgroundColor: c.surfaceAlt,
  },
  discoverySection: {
    marginTop: 30,
  },
  discoveryHeadingRow: {
    minHeight: 64,
    marginBottom: 14,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  discoveryHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  discoveryEyebrow: {
    color: c.textSecondary,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "500",
    fontFamily: F,
    marginBottom: 3,
  },
  discoveryTitle: {
    color: c.text,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "800",
    fontFamily: F,
  },
  discoveryExploreButton: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  discoveryGrid: {
    height: 204,
    borderRadius: 26,
    overflow: "hidden",
    flexDirection: "row",
    gap: 2,
    backgroundColor: c.surfaceAlt,
  },
  discoveryTile: {
    flex: 1,
    minWidth: 0,
    backgroundColor: c.surfaceAlt,
    overflow: "hidden",
  },
  discoveryTileImage: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
  },
  discoveryTileImageContained: {
    top: 20,
    right: 12,
    bottom: 62,
    left: 12,
  },
  discoveryTileFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceAlt,
  },
  discoveryTileShade: {
    ...StyleSheet.absoluteFillObject,
  },
  discoveryTileCopy: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 10,
  },
  discoveryTileTitle: {
    color: "#FFFFFF",
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "800",
    fontFamily: F,
  },
  discoveryTileSubtitle: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "600",
    fontFamily: F,
    marginTop: 2,
  },
  assetCategorySection: {
    marginTop: 30,
  },
  assetCategoryScroll: {
    marginHorizontal: -16,
  },
  assetCategoryScrollContent: {
    paddingLeft: 16,
    paddingRight: 24,
    gap: 20,
  },
  assetCategoryTab: {
    color: c.textTertiary,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    fontFamily: F,
  },
  assetCategoryTabSelected: {
    color: c.text,
  },
  discoveryTilePerformance: {
    fontFamily: Fonts.displayMedium,
  },
  browseListSection: {
    marginTop: 28,
  },
  browseStateCard: {
    minHeight: 180,
    borderRadius: 24,
    backgroundColor: c.surfaceAlt,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  browseStateTitle: {
    marginTop: 12,
    color: c.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: F,
    textAlign: "center",
  },
  browseStateBody: {
    marginTop: 5,
    maxWidth: 260,
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    fontFamily: F,
    textAlign: "center",
  },
  browseRetryButton: {
    minWidth: 104,
    minHeight: 44,
    marginTop: 16,
    borderRadius: 22,
    backgroundColor: c.text,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  browseRetryText: {
    color: c.textInverse,
    fontSize: 13,
    fontWeight: "800",
    fontFamily: F,
  },
  sectionLabel: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 18,
    marginBottom: 4,
  },
  mintLookupCard: {
    minHeight: 68,
    marginTop: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: c.surfaceAlt,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  mintLookupIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  mintLookupError: {
    minHeight: 76,
    marginTop: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: c.surfaceAlt,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  mintRetryButton: {
    minWidth: 72,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: c.text,
    alignItems: "center",
    justifyContent: "center",
  },
  mintRetryText: {
    color: c.textInverse,
    fontSize: 13,
    fontWeight: "800",
    fontFamily: F,
  },
  sectionNote: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "500",
    fontFamily: F,
    paddingVertical: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: c.surfaceAlt,
  },
  rowAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.surfaceAlt,
  },
  rowIconFallback: {
    // Neutral default profile picture (person glyph) — no per-user color.
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  rowIconLetter: {
    color: c.textInverse,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: F,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: c.text,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: F,
  },
  rowSub: {
    marginTop: 2,
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "500",
    fontFamily: F,
  },
  rowPnl: {
    fontSize: 14,
    fontWeight: "800",
    fontFamily: Fonts.displayMedium,
  },
  youText: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: F,
  },
  emptyWrap: {
    alignItems: "center",
    paddingTop: 48,
    gap: 4,
  },
  emptyTitle: {
    color: c.text,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: F,
  },
  emptyBody: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "500",
    fontFamily: F,
  },
});
