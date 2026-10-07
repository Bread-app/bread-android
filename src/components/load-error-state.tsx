import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const F = Fonts.rounded;

type Props = {
  /** What didn't load, e.g. "Couldn't load sandwiches". */
  title: string;
  /** Omit when there is nothing to retry; the line then reads as plain text. */
  onRetry?: () => void;
  /** The line under the title. Defaults to "Try again". */
  retryLabel?: string;
  /**
   * `screen` centres the text in most of the screen's height — for a whole
   * screen or a list that has nothing else to show. `section` only pads it, for
   * a block inside a longer page.
   */
  size?: 'screen' | 'section';
  style?: StyleProp<ViewStyle>;
};

/**
 * The one way a failed load reads anywhere in the app: just text, centred — no
 * card, border or shadow — with "Try again" beneath it as the retry.
 */
export function LoadErrorState({
  title,
  onRetry,
  retryLabel = 'Try again',
  size = 'screen',
  style,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { height } = useWindowDimensions();

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.root,
        size === 'screen' ? { minHeight: Math.round(height * 0.6) } : styles.section,
        style,
      ]}
    >
      <Text style={styles.title}>{title}</Text>
      {onRetry ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          hitSlop={12}
          onPress={onRetry}
        >
          <Text style={styles.retry}>{retryLabel}</Text>
        </PressableScale>
      ) : (
        <Text style={styles.retryPlain}>{retryLabel}</Text>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 6,
    },
    section: {
      flex: 0,
      paddingVertical: 48,
    },
    title: {
      color: c.text,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: '700',
      fontFamily: F,
      textAlign: 'center',
    },
    retry: {
      color: c.textSecondary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '600',
      fontFamily: F,
      textAlign: 'center',
    },
    retryPlain: {
      color: c.textSecondary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '500',
      fontFamily: F,
      textAlign: 'center',
    },
  });
