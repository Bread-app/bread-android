import { useCallback, useEffect, useMemo, useState } from "react";

import { getTopHolderStocks, type Stock } from "@/lib/api";

/** How many assets each side of the rail carries. */
const MOVER_COUNT = 10;

export type HomeMovers = {
  gainers: Stock[];
  losers: Stock[];
  /** Gainers and losers interleaved, for the moving tape. */
  tape: Stock[];
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * The 24h best and worst performers for Home's movers rail. Loads on its own so
 * a slow catalogue never holds up the balance or the feed, and a failure
 * resolves to empty — the rail then hides itself.
 */
export function useHomeMovers(): HomeMovers {
  const [movers, setMovers] = useState<{ gainers: Stock[]; losers: Stock[] }>({
    gainers: [],
    losers: [],
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await getTopHolderStocks({ limit: 60, category: "all" });
      const tradeable = list.filter(
        (stock) =>
          stock.type !== "prestock" &&
          stock.usdPrice !== null &&
          stock.priceChange24h !== null,
      );
      setMovers({
        // Only real moves on each side: a flat day shouldn't list a 0.0% asset
        // as a "gainer".
        gainers: tradeable
          .filter((stock) => (stock.priceChange24h ?? 0) > 0)
          .sort((a, b) => (b.priceChange24h ?? 0) - (a.priceChange24h ?? 0))
          .slice(0, MOVER_COUNT),
        losers: tradeable
          .filter((stock) => (stock.priceChange24h ?? 0) < 0)
          .sort((a, b) => (a.priceChange24h ?? 0) - (b.priceChange24h ?? 0))
          .slice(0, MOVER_COUNT),
      });
    } catch {
      setMovers({ gainers: [], losers: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Interleaved rather than concatenated: ten greens then ten reds reads as two
  // blocks going past, where alternating reads as a market.
  const tape = useMemo(() => {
    const out: Stock[] = [];
    const depth = Math.max(movers.gainers.length, movers.losers.length);
    for (let index = 0; index < depth; index++) {
      if (movers.gainers[index]) out.push(movers.gainers[index]);
      if (movers.losers[index]) out.push(movers.losers[index]);
    }
    return out;
  }, [movers.gainers, movers.losers]);

  return { ...movers, tape, loading, refresh };
}
