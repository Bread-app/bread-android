import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import { useThemeStore } from "@/lib/theme-store";

const F = Fonts.rounded;

/**
 * The "Add thesis" action: a plus, then the label — the same weight as the
 * Share it sits beside, so the two read as one row of things to do with the
 * position rather than a call to action and a utility.
 *
 * Rendered as a sibling of the card, never inside it: the card opens the
 * position, this opens the composer, and nesting one Pressable in another is
 * how a tap lands on both.
 */
export function AddThesisButton({
  count = 0,
  compact = false,
  tone = "accent",
  onPress,
  style,
}: {
  /** Takes already written on this position; > 0 flips the label to "Update". */
  count?: number;
  /** Sized to sit in a row of 14pt actions (the position card's Share). */
  compact?: boolean;
  /** `muted` matches the neighbouring Share text instead of calling out in blue. */
  tone?: "accent" | "muted";
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const ink = tone === "muted" ? colors.textSecondary : colors.accentBlue;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `Update thesis, ${count} posted` : "Add thesis"}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.row, compact && styles.rowCompact, pressed && { opacity: 0.6 }, style]}
    >
      <Ionicons name="add" size={compact ? 18 : 22} color={ink} />
      <Text style={[styles.label, compact && styles.labelCompact, { color: ink }]}>
        {count ? `Update thesis · ${count}` : "Add thesis"}
      </Text>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 4,
    },
    label: {
      color: c.accentBlue,
      fontSize: 16,
      fontWeight: "800",
      fontFamily: F,
    },
    rowCompact: { gap: 4, minHeight: 40, paddingVertical: 0 },
    labelCompact: { fontSize: 14, lineHeight: 18, fontWeight: "600" },
  });
