import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { getStockBySymbol, type Stock } from '@/lib/api';
import { getPhoenixMarket, type PhoenixMarket } from '@/lib/phoenix-api';
import { useThemeStore } from '@/lib/theme-store';
import { StockDetailScreen } from './stock-detail-screen';

/** A cold notification has no navigation-store asset. Resolve it explicitly. */
export function NotificationAssetScreen({ symbol, perp = false, openTradePad, tweetUrl }: { symbol: string; perp?: boolean; openTradePad?: string; tweetUrl?: string }) {
  const { colors } = useThemeStore();
  const router = useRouter();
  const [asset, setAsset] = useState<{ stock: Stock; market?: PhoenixMarket } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setAsset(null); setError(false);
    const load = async () => {
      if (!perp) return { stock: await getStockBySymbol(symbol) };
      const { market, markPrice } = await getPhoenixMarket(symbol);
      const stock: Stock = { id: `phoenix:${market.symbol}`, symbol: market.symbol, name: market.name, type: 'token', category: market.category, holderCount: null, icon: market.iconUri ?? market.logoUri, usdPrice: markPrice, priceChange1h: null, priceChange24h: null, volume24h: null };
      return { stock, market };
    };
    void load().then(value => { if (active) setAsset(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [symbol, perp]);
  if (!asset) return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', gap: 16 }}>
    {error ? <Text style={{ color: colors.text }}>This market could not be loaded.</Text> : <ActivityIndicator color={colors.text} />}
    <Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={{ color: colors.text }}>Back</Text></Pressable>
  </View>;
  return <StockDetailScreen zoom={false} assetOverride={asset.stock} optionsOverride={{ venue: perp ? 'perp' : 'spot', perpMarket: asset.market, hideActions: perp }} openTradePad={openTradePad === '1'} tweetUrl={tweetUrl} />;
}
