import { useCallback, useEffect, useMemo, useState } from "react";

import type { MarketMovingStory } from "@/components/home/market-news-section";
import {
  getTokenNews,
  getTopHolderStocks,
  type NewsItem,
  type Stock,
} from "@/lib/api";

import { relatedStocksForStory } from "./helpers";

/** How many stories the news section shows once they are ranked. */
const STORY_COUNT = 4;

export type HomeDiscovery = {
  /** Gainers and losers interleaved, for the ticker tape. */
  tape: Stock[];
  stories: MarketMovingStory[];
  storiesLoading: boolean;
  newsFailed: boolean;
  reloadNews: () => void;
  refresh: () => Promise<void>;
};

/**
 * Homepage discovery data — market-moving news plus the market catalogue used
 * to rank those stories and drive the header ticker. It loads independently of the
 * portfolio: a slow catalogue fetch must never delay the balance. Failures
 * resolve to empty and the relevant surface hides itself rather than shouting.
 */
export function useHomeDiscovery(): HomeDiscovery {
  const [movers, setMovers] = useState<{ gainers: Stock[]; losers: Stock[] }>({
    gainers: [],
    losers: [],
  });
  const [moversLoading, setMoversLoading] = useState(true);
  const [marketCatalog, setMarketCatalog] = useState<Stock[]>([]);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsFailed, setNewsFailed] = useState(false);

  const loadMovers = useCallback(async () => {
    try {
      const list = await getTopHolderStocks({ limit: 60, category: "all" });
      const tradeable = list.filter(
        (stock) =>
          stock.type !== "prestock" &&
          stock.usdPrice !== null &&
          stock.priceChange24h !== null,
      );
      setMarketCatalog(tradeable);
      setMovers({
        gainers: [...tradeable]
          .sort((a, b) => (b.priceChange24h ?? 0) - (a.priceChange24h ?? 0))
          .slice(0, 10),
        losers: [...tradeable]
          .sort((a, b) => (a.priceChange24h ?? 0) - (b.priceChange24h ?? 0))
          .slice(0, 10),
      });
    } catch {
      setMarketCatalog([]);
      setMovers({ gainers: [], losers: [] });
    } finally {
      setMoversLoading(false);
    }
  }, []);

  const loadNews = useCallback(async () => {
    setNewsLoading(true);
    setNewsFailed(false);
    try {
      setNewsItems(await getTokenNews({ limit: 12 }));
    } catch {
      setNewsFailed(true);
    } finally {
      setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMovers();
  }, [loadMovers]);

  useEffect(() => {
    void loadNews();
  }, [loadNews]);

  // A story that we can tie to a real, moving asset outranks one we cannot —
  // the headline only earns its slot on Home if it explains a price.
  const stories = useMemo<MarketMovingStory[]>(() => {
    return newsItems
      .map((item) => ({ item, related: relatedStocksForStory(item, marketCatalog) }))
      .sort((a, b) => {
        const aMove = Math.max(0, ...a.related.map((stock) => Math.abs(stock.priceChange24h ?? 0)));
        const bMove = Math.max(0, ...b.related.map((stock) => Math.abs(stock.priceChange24h ?? 0)));
        const aScore = (a.related.length > 0 ? 100 : 0) + aMove;
        const bScore = (b.related.length > 0 ? 100 : 0) + bMove;
        return bScore - aScore;
      })
      .slice(0, STORY_COUNT);
  }, [marketCatalog, newsItems]);

  // Interleaved rather than concatenated: eight greens followed by eight reds
  // reads as two blocks going past, where alternating reads as a market.
  const tape = useMemo(() => {
    const out: Stock[] = [];
    const depth = Math.max(movers.gainers.length, movers.losers.length);
    for (let index = 0; index < depth; index++) {
      if (movers.gainers[index]) out.push(movers.gainers[index]);
      if (movers.losers[index]) out.push(movers.losers[index]);
    }
    return out;
  }, [movers.gainers, movers.losers]);

  const reloadNews = useCallback(() => void loadNews(), [loadNews]);

  const refresh = useCallback(async () => {
    await Promise.allSettled([loadMovers(), loadNews()]);
  }, [loadMovers, loadNews]);

  return {
    tape,
    stories,
    // Stories need both feeds: a headline with no catalogue behind it cannot be
    // ranked yet, so the section stays in its loading state until both land.
    storiesLoading: newsLoading || moversLoading,
    newsFailed,
    reloadNews,
    refresh,
  };
}
