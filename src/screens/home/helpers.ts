import { cleanStockName } from "@/lib/stock-name";
import type { NewsItem, Stock } from "@/lib/api";

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTicker(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (normalized.endsWith("X") && normalized.length > 4) return normalized.slice(0, -1);
  return normalized.replace(/ON$/i, "") || value;
}

/**
 * The (at most three) catalogue stocks a headline is plausibly about — matched
 * on ticker, significant name words, or the story's own related coin ids, then
 * ordered by how much each moved so the biggest mover leads.
 */
export function relatedStocksForStory(item: NewsItem, catalog: Stock[]): Stock[] {
  const title = item.title.toLowerCase();
  const coinIds = item.relatedCoinIds.map((id) => id.toLowerCase().replace(/[-_]/g, " "));

  return catalog
    .filter((stock) => {
      const ticker = normalizeTicker(stock.symbol).toLowerCase();
      const cleanName = cleanStockName(stock.name).toLowerCase();
      const significantNameWords = cleanName.split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
      const tickerMatch =
        ticker.length >= 2 && new RegExp(`\\b${escapeRegExp(ticker)}\\b`, "i").test(title);
      const nameMatch = significantNameWords.some((word) => title.includes(word));
      const coinMatch = coinIds.some(
        (coinId) => coinId.includes(cleanName) || cleanName.includes(coinId) || coinId === ticker,
      );
      return tickerMatch || nameMatch || coinMatch;
    })
    .sort(
      (a, b) => Math.abs(b.priceChange24h ?? 0) - Math.abs(a.priceChange24h ?? 0),
    )
    .slice(0, 3);
}

export function normalizeOpenUrl(value: string): string {
  const cleaned = value.trim().replace(/&amp;/gi, "&");
  if (/^\/\//.test(cleaned)) return `https:${cleaned}`;
  if (/^[a-z][a-z\d+.-]*:/i.test(cleaned)) return cleaned;
  return `https://${cleaned.replace(/^\/+/, "")}`;
}
