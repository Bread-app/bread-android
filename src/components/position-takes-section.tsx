import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import { getSandwichTakes, type PositionTake } from "@/lib/api";
import { TAKE_SIGNAL_LABEL, stampLabel, visibleSizeBand } from "@/lib/position-takes";
import { useThemeStore } from "@/lib/theme-store";

const F = Fonts.rounded;

export function TakeRow({ take, onPressAuthor }: { take: PositionTake; onPressAuthor?: (userId: string) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const handle = take.author.username ? `@${take.author.username}` : take.author.name ?? "Someone";
  const positive = take.stamp.pct >= 0;

  // Byline on one line — face, handle, stamp — and the take underneath it at
  // full width, the way a post reads rather than a chat message.
  return (
    <View style={styles.row}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole={onPressAuthor ? "button" : "image"}
          disabled={!onPressAuthor}
          onPress={() => onPressAuthor?.(take.author.id)}
          hitSlop={6}
        >
          {take.author.avatarUrl ? (
            <Image source={{ uri: take.author.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Ionicons name="person" size={14} color={colors.textTertiary} />
            </View>
          )}
        </Pressable>
        <Text numberOfLines={1} style={styles.handle}>
          {handle}
        </Text>
        <Text style={[styles.stamp, { color: positive ? colors.positive : colors.negative }]}>
          {stampLabel(take)}
        </Text>
        {take.signal ? (
          <Text style={styles.signalChip}>{TAKE_SIGNAL_LABEL[take.signal] ?? take.signal}</Text>
        ) : null}
        {/* A band, never a number — and nothing at all when they hid it. */}
        {visibleSizeBand(take.sizeBand) ? (
          <Text style={styles.sizeBand}>{visibleSizeBand(take.sizeBand)}</Text>
        ) : null}
      </View>

      <Text style={styles.text}>{take.body}</Text>
      {take.edited ? <Text style={styles.edited}>edited</Text> : null}
    </View>
  );
}

/**
 * Every take on one basket (§8.1).
 *
 * Sorted server-side by the taker's position age, so an early holder with a
 * record floats up rather than the loudest one — which is what sorting by likes
 * would do.
 */
export function PositionTakesSection({
  sandwichId,
  onPressAuthor,
}: {
  sandwichId: string;
  onPressAuthor?: (userId: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const [takes, setTakes] = React.useState<PositionTake[] | null>(null);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void getSandwichTakes(sandwichId).then((page) => {
      if (cancelled) return;
      setTakes(page.takes);
      setCursor(page.nextCursor);
    });
    return () => {
      cancelled = true;
    };
  }, [sandwichId]);

  // Nothing at all rather than an empty-state card: a basket nobody has written
  // about should not advertise the absence.
  if (takes !== null && takes.length === 0) return null;

  return (
    <View style={styles.section}>
      {takes === null ? (
        <ActivityIndicator size="small" color={colors.textTertiary} style={styles.loader} />
      ) : (
        <>
          {takes.map((take) => (
            <TakeRow key={take.id} take={take} onPressAuthor={onPressAuthor} />
          ))}
          {cursor ? (
            <Pressable
              accessibilityRole="button"
              disabled={loadingMore}
              onPress={() => {
                setLoadingMore(true);
                void getSandwichTakes(sandwichId, cursor)
                  .then((page) => {
                    setTakes((current) => [...(current ?? []), ...page.takes]);
                    setCursor(page.nextCursor);
                  })
                  .finally(() => setLoadingMore(false));
              }}
              style={({ pressed }) => [styles.more, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.moreText}>{loadingMore ? "Loading…" : "Show more takes"}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    section: { paddingHorizontal: 20, paddingTop: 24, gap: 18 },
    loader: { alignSelf: "flex-start" },
    row: { gap: 6 },
    avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.surfaceAlt },
    avatarFallback: { alignItems: "center", justifyContent: "center" },
    headerRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
    handle: { color: c.text, fontSize: 14, fontWeight: "800", fontFamily: F, flexShrink: 1 },
    stamp: { fontSize: 12, fontWeight: "700", fontFamily: F },
    signalChip: {
      color: c.textSecondary,
      fontSize: 11,
      fontWeight: "700",
      fontFamily: F,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      overflow: "hidden",
    },
    sizeBand: { color: c.textTertiary, fontSize: 11, fontFamily: F },
    text: { color: c.text, fontSize: 14, fontFamily: F, lineHeight: 20 },
    edited: { color: c.textTertiary, fontSize: 11, fontFamily: F },
    more: { paddingVertical: 8 },
    moreText: { color: c.textSecondary, fontSize: 13, fontWeight: "700", fontFamily: F },
  });
