import { Button as SwiftUIButton, HStack, Host, Text as SwiftUIText } from '@expo/ui/swift-ui';
import { frame } from '@expo/ui/swift-ui/modifiers';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GlassActionButton } from '@/components/glass-action-button';
import { HAS_LIQUID_GLASS } from '@/lib/liquid-glass';
import { useThemeStore } from '@/lib/theme-store';

const HEIGHT = 54;
const GAP = 12;

type Props = {
  onAddCash: () => void;
  onWithdraw: () => void;
};

/**
 * "+ Add cash" / "Withdraw", side by side. Shared by the Wallet and Like-to-Buy
 * screens so the pair only has to be laid out once.
 *
 * Both buttons are measured rather than flexed because the iOS 26 body is
 * SwiftUI: `Host` will not size itself to its children, so the row's width has
 * to be read back from layout before the controls inside it can be framed.
 *
 * The two bodies are whole rows, not two swappable buttons — on iOS 26 the
 * buttons live inside a SwiftUI `HStack` and a React Native view cannot be a
 * child of one.
 */
export function WalletActionRow({ onAddCash, onWithdraw }: Props) {
  const { colors } = useThemeStore();
  const [rowWidth, setRowWidth] = useState(0);
  const buttonWidth = (rowWidth - GAP) / 2;

  return (
    <View
      style={styles.row}
      onLayout={(event) => {
        setRowWidth(event.nativeEvent.layout.width);
      }}>
      {rowWidth <= 0 ? null : HAS_LIQUID_GLASS ? (
        <Host style={styles.host}>
          <HStack
            alignment="center"
            spacing={GAP}
            modifiers={[frame({ width: rowWidth, height: HEIGHT })]}>
            <SwiftUIButton
              variant="glassProminent"
              controlSize="large"
              color={colors.actionPrimary}
              modifiers={[frame({ width: buttonWidth, height: HEIGHT })]}
              onPress={onAddCash}>
              + Add cash
            </SwiftUIButton>
            <SwiftUIButton
              variant="glass"
              controlSize="large"
              color={colors.actionSell}
              modifiers={[frame({ width: buttonWidth, height: HEIGHT })]}
              onPress={onWithdraw}>
              <SwiftUIText weight="bold" color="rgba(0,0,0,0.55)">
                Withdraw
              </SwiftUIText>
            </SwiftUIButton>
          </HStack>
        </Host>
      ) : (
        <View style={[styles.fallbackRow, { gap: GAP }]}>
          <GlassActionButton
            variant="glassProminent"
            tint={colors.actionPrimary}
            label="+ Add cash"
            width={buttonWidth}
            height={HEIGHT}
            onPress={onAddCash}
          />
          <GlassActionButton
            variant="glass"
            tint={colors.actionSell}
            label="Withdraw"
            labelColor="rgba(0,0,0,0.55)"
            width={buttonWidth}
            height={HEIGHT}
            onPress={onWithdraw}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignSelf: 'stretch',
    height: HEIGHT,
  },
  host: {
    width: '100%',
    height: HEIGHT,
  },
  fallbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
