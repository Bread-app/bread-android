import { usePrivy } from "@privy-io/expo";
import React, { useCallback, useEffect, useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";

import { SandwichCard } from "@/components/sandwich-card";
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import { getSandwiches, getSandwichShareUrl, setCardLike, type Sandwich } from "@/lib/api";
import { recommendSandwiches } from "@/lib/sandwich-recommendations";
import { getAnonymousSocialId } from "@/lib/social-identity";

const F = Fonts.rounded;
/** Feed rows ranked against. Same page size the asset sheet filters. */
const POOL_SIZE = 50;
/** Full feed cards are tall; a few is a suggestion, more is a second feed. */
const MAX_CARDS = 4;

/**
 * "Recommended for you" — sandwiches holding the same (or nearby) assets as
 * the one on screen, drawn with the Explore feed's card. Renders nothing until
 * it has at least one to show, so a slow or failed fetch never leaves a hole
 * in the page.
 */
export function RecommendedSandwiches({
  sandwich,
  onOpen,
}: {
  sandwich: Sandwich;
  onOpen: (sandwich: Sandwich, options?: { showComments?: boolean }) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { user } = usePrivy();
  const [items, setItems] = useState<Sandwich[]>([]);
  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  const [localLikes, setLocalLikes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    void getSandwiches(POOL_SIZE)
      .then((rows) => {
        if (!cancelled) setItems(recommendSandwiches(sandwich, rows, MAX_CARDS));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
    // Re-rank only when the viewed sandwich changes, not on like/comment
    // updates to the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandwich.id]);

  useEffect(() => {
    let cancelled = false;
    setAnonymousId(null);
    setLocalLikes({});
    void getAnonymousSocialId(user?.id).then((value) => {
      if (!cancelled) setAnonymousId(value);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleToggleLike = useCallback(
    async (s: Sandwich) => {
      if (!anonymousId) return;
      const wasLiked = localLikes[s.id] ?? s.viewerHasLiked;
      setLocalLikes((prev) => ({ ...prev, [s.id]: !wasLiked }));
      try {
        await setCardLike(s, !wasLiked, anonymousId);
      } catch {
        setLocalLikes((prev) => ({ ...prev, [s.id]: wasLiked }));
      }
    },
    [anonymousId, localLikes],
  );

  const handleShare = useCallback(async (s: Sandwich) => {
    await Share.share({ url: getSandwichShareUrl(s.id), message: s.name });
  }, []);

  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Recommended for you</Text>
      {items.map((item) => (
        <SandwichCard
          key={item.id}
          sandwich={{ ...item, viewerHasLiked: localLikes[item.id] ?? item.viewerHasLiked }}
          onPress={(s) => onOpen(s)}
          onToggleLike={handleToggleLike}
          onComment={(s) => onOpen(s, { showComments: true })}
          onShare={handleShare}
          showRemix={false}
          layout="holding"
        />
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Same inset as the asset rows above, so avatars share their left edge.
    section: {
      marginTop: 16,
      paddingHorizontal: 10,
    },
    title: {
      color: c.textSecondary,
      fontSize: 17,
      fontWeight: "600",
      fontFamily: F,
      marginBottom: 4,
    },
  });
