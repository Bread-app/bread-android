import React from 'react';
import { StyleSheet, Text, type TextProps } from 'react-native';

import type { ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

type Props = Omit<TextProps, 'children'> & {
  /** The label to render. A leading "@" is dimmed; anything else is passed through. */
  children: string | null | undefined;
};

/**
 * A `Text` whose leading "@" sits a rung under the handle it prefixes.
 *
 * The "@" is decoration — it says "this is an address", the name is the
 * information — so it takes the quaternary token while the handle keeps
 * whatever the parent style says. Drop-in for `<Text>` wherever a string
 * that may start with "@" is rendered, so the rule holds everywhere without
 * each call site splitting the string itself. Faded in the colour, not via
 * `opacity`, which does not apply reliably to a nested span across platforms.
 */
export function HandleText({ children, ...rest }: Props) {
  const styles = useThemedStyles(makeStyles);
  const value = children ?? '';
  if (!value.startsWith('@')) return <Text {...rest}>{value}</Text>;
  return (
    <Text {...rest}>
      <Text style={styles.at}>@</Text>
      {value.slice(1)}
    </Text>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    at: {
      color: c.textQuaternary,
    },
  });
