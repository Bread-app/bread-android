import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { NotificationAssetScreen } from '@/screens/notification-asset-screen';

import { StockDetailScreen } from '@/screens/stock-detail-screen';

export default function StockDetailRoute() {
  const params = useLocalSearchParams<{ symbol?: string; openTradePad?: string; tweetUrl?: string }>();
  if (params.symbol) return <NotificationAssetScreen {...params} symbol={params.symbol} />;
  return <StockDetailScreen />;
}
