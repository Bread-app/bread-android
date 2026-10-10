import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotificationTweet } from '@/components/notification-tweet';
import { TradeAmountPad } from '@/components/trade-amount-sheet';
import { useStockTradeSheet, useStockTradeSheetContent } from '@/lib/stock-trade-sheet-store';

export default function StockTradeRoute() {
  const content = useStockTradeSheetContent();
  const { markClosed } = useStockTradeSheet();
  const insets = useSafeAreaInsets();
  useEffect(() => markClosed, [markClosed]);

  return (
    <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 28) }]}>
      {content?.tweetUrl ? <NotificationTweet url={content.tweetUrl} compact /> : null}
      {content ? <TradeAmountPad {...content.pad} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The native contentStyle owns the fill: an opaque root hides the hoisted
  // ScrollView that react-native-screens places behind this view.
  sheet: {
    flex: 1,
    paddingTop: 20,
    paddingHorizontal: 16,
  },
});
