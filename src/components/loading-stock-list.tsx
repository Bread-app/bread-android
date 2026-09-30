import React from 'react';
import { StyleSheet, View } from 'react-native';

import { type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

export function LoadingStockList() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View>
      {Array.from({ length: 6 }).map((_, index) => (
        <View key={index} style={styles.card}>
          <View style={styles.left}>
            <View style={styles.circle} />
            <View>
              <View style={[styles.line, styles.symbolLine]} />
              <View style={[styles.line, styles.nameLine]} />
            </View>
          </View>
          <View style={styles.right}>
            <View style={[styles.line, styles.holderLabel]} />
            <View style={[styles.line, styles.holderValue]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card: {
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: 'transparent',
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    flex: 1,
  },
  right: {
    alignItems: 'flex-end',
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
  },
  line: {
    backgroundColor: c.surfaceAlt,
    borderRadius: 4,
  },
  symbolLine: {
    width: 82,
    height: 15,
    marginBottom: 6,
  },
  nameLine: {
    width: 42,
    height: 10,
  },
  holderLabel: {
    width: 82,
    height: 14,
    marginBottom: 5,
  },
  holderValue: {
    width: 46,
    height: 10,
  },
});
