import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { useLocalSearchParams } from 'expo-router';
import { NotificationAssetScreen } from '@/screens/notification-asset-screen';
import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { PhoenixPositionSheet } from '@/components/phoenix-position-sheet';
import { usePhoenixPositionSheet } from '@/lib/phoenix-position-sheet-store';

/**
 * The Phoenix position sheet as a native iOS form sheet
 * (`presentation: 'formSheet'` in `(app)/_layout.tsx`). UIKit owns dimming,
 * drag-to-dismiss and the parent-stacking effect; the position comes from
 * {@link usePhoenixPositionSheet}, not route params.
 *
 * The local `BottomSheetModalProvider` is what lets the share sheet (a gorhom
 * modal) stack *over* this native sheet: it portals into the nearest
 * provider, and the app-root one sits underneath the presented view.
 */
export default function PhoenixPositionRoute() {
  const params = useLocalSearchParams<{ symbol?: string; openTradePad?: string; tweetUrl?: string }>();
  if (params.symbol) return <NotificationAssetScreen {...params} symbol={params.symbol} perp />;
  return <OwnedPhoenixPosition />;
}

function OwnedPhoenixPosition() {
  const sheet = usePhoenixPositionSheet();
  const { position, context, autoClose, handlers, close, markClosed } = sheet;

  useEffect(() => markClosed, [markClosed]);

  const onUpdated = useCallback(() => handlers.current.onUpdated?.(), [handlers]);
  const onRequestClosePosition = useCallback<
    NonNullable<typeof handlers.current.onRequestClosePosition>
  >((target, options) => handlers.current.onRequestClosePosition?.(target, options), [handlers]);

  if (!position) return <View style={styles.fill} />;

  return (
    <BottomSheetModalProvider>
      <View style={styles.fill}>
        <PhoenixPositionSheet
          position={position}
          context={context}
          autoClose={autoClose}
          dismiss={close}
          onUpdated={onUpdated}
          onRequestClosePosition={onRequestClosePosition}
        />
      </View>
    </BottomSheetModalProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
