import React from 'react';

import { StockDetailScreen } from '@/screens/stock-detail-screen';

/**
 * SPIKE — the same asset detail as `stock-detail`, pushed as an ordinary native
 * screen so UIKit's own iOS 18 zoom transition drives it (see
 * `lib/native-zoom.ts`). Rendering with `zoom={false}` drops the JS transition:
 * the OS is animating the whole view controller here, so a second animation
 * inside it would fight the first.
 */
export default function StockDetailNativeRoute() {
  return <StockDetailScreen zoom={false} />;
}
