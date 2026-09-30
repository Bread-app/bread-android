import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { PressableScale } from "@/components/pressable-scale";
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import type { DailyPrompt } from "@/lib/api";
import { withAlpha } from "@/lib/color-utils";
import { useThemeStore } from "@/lib/theme-store";

const F = Fonts.rounded;

/** "6h left" / "45m left" — the deadline is the point, so it is always shown. */
function timeLeft(expiresAt: string): string | null {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m left`;
  return `${Math.floor(minutes / 60)}h left`;
}

function answersLabel(count: number): string {
  if (count === 0) return "Be the first to answer";
  return count === 1 ? "1 answer" : `${count} answers`;
}

/**
 * Today's question, at the top of the feed. A blank composer gets closed; a
 * timely question with a deadline gets answered. Tapping it opens the composer
 * with the question above the input.
 *
 * A leaf module on purpose: the feed and the composer both render from here,
 * and neither may import the other (Metro's inline requires crash on cycles).
 */
export function DailyPromptCard({ prompt, onPress }: { prompt: DailyPrompt; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const left = timeLeft(prompt.expiresAt);
  // Expired between fetch and render — there is nothing left to answer.
  if (!left) return null;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Today's question: ${prompt.question}. ${left}. Answer with a Sandwich.`}
      onPress={onPress}
      style={styles.card}
    >
      <View style={styles.headerRow}>
        <Ionicons name="help-circle" size={15} color={colors.accentBlue} />
        <Text style={styles.label}>Today&apos;s question</Text>
        <Text style={styles.deadline}>{left}</Text>
      </View>
      <Text style={styles.question}>{prompt.question}</Text>
      {prompt.context ? <Text style={styles.context}>{prompt.context}</Text> : null}
      <View style={styles.footerRow}>
        <Text style={styles.answers}>{answersLabel(prompt.answerCount)}</Text>
        <View style={styles.cta}>
          <Text style={styles.ctaLabel}>Answer</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.textInverse} />
        </View>
      </View>
    </PressableScale>
  );
}

/** The same question, pinned above the composer input while answering it. */
export function DailyPromptBanner({ prompt }: { prompt: DailyPrompt }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  return (
    <View style={styles.banner} accessibilityRole="header">
      <View style={styles.headerRow}>
        <Ionicons name="help-circle" size={15} color={colors.accentBlue} />
        <Text style={styles.label}>Answering today&apos;s question</Text>
      </View>
      <Text style={styles.bannerQuestion}>{prompt.question}</Text>
      {prompt.context ? <Text style={styles.context}>{prompt.context}</Text> : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: withAlpha(c.accentBlue, 0.35),
      backgroundColor: withAlpha(c.accentBlue, 0.07),
      borderRadius: 22,
      padding: 16,
      marginTop: 4,
      marginBottom: 12,
      gap: 8,
    },
    banner: {
      borderRadius: 16,
      backgroundColor: withAlpha(c.accentBlue, 0.08),
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginTop: 16,
      gap: 6,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    label: {
      flex: 1,
      color: c.accentBlue,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1,
      textTransform: "uppercase",
      fontFamily: F,
    },
    deadline: {
      color: c.textSecondary,
      fontSize: 12,
      fontWeight: "700",
      fontFamily: F,
    },
    question: {
      color: c.text,
      fontSize: 19,
      lineHeight: 25,
      fontWeight: "800",
      fontFamily: F,
    },
    bannerQuestion: {
      color: c.text,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "800",
      fontFamily: F,
    },
    context: {
      color: c.textSecondary,
      fontSize: 14,
      lineHeight: 19,
      fontFamily: F,
    },
    footerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 4,
    },
    answers: {
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: "600",
      fontFamily: F,
    },
    cta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: c.actionPrimary,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    ctaLabel: {
      color: c.textInverse,
      fontSize: 14,
      fontWeight: "800",
      fontFamily: F,
    },
  });
