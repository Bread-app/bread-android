import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { FollowButton } from "@/components/follow-button";
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import type { SocialUser } from "@/lib/api";
import { useThemeStore } from "@/lib/theme-store";
import { userDisplayName } from "@/lib/user-display";
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

type Props = {
  users: SocialUser[];
  /** Follow state lives with the parent, which owns the optimistic override. */
  isFollowing: (user: SocialUser) => boolean;
  onPressUser: (user: SocialUser) => void;
  onToggleFollow: (user: SocialUser) => void;
  onRemove: (user: SocialUser) => void;
  onClearAll: () => void;
  /** Suppresses the follow pill on the viewer's own card. */
  viewerPrivyUserId?: string | null;
};

/**
 * "Recents" — the people the user has recently opened from search.
 *
 * A horizontal strip of cards rather than the vertical rows used for search
 * RESULTS, and the difference is deliberate: results are a list you scan top to
 * bottom looking for one person, while recents are a shortcut you recognise by
 * face. A card that leads with a large avatar is recognisable at a glance; a
 * 44pt row avatar in a stack of ten is not.
 *
 * Renders nothing when the list is empty, so a new install's browse view is
 * exactly what it was before this existed.
 */
export function RecentUsersCarousel({
  users,
  isFollowing,
  onPressUser,
  onToggleFollow,
  onRemove,
  onClearAll,
  viewerPrivyUserId,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();

  if (users.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Recents</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear recent people"
          hitSlop={10}
          onPress={onClearAll}
        >
          <Text style={styles.clear}>Clear all</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // The strip bleeds to both screen edges while its cards stay inside the
        // page gutter, so the last card is visibly cut off rather than looking
        // like the end of the list.
        style={styles.strip}
        contentContainerStyle={styles.stripContent}
      >
        {users.map((user) => {
          const isMe =
            Boolean(viewerPrivyUserId) &&
            user.privyUserId === viewerPrivyUserId;
          return (
            <PressableScale
              key={user.privyUserId}
              accessibilityRole="button"
              accessibilityLabel={userDisplayName(user)}
              onPress={() => onPressUser(user)}
              style={styles.card}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${userDisplayName(user)} from recents`}
                hitSlop={12}
                // Stops the tap from also opening the profile behind it.
                onPress={(event) => {
                  event.stopPropagation();
                  onRemove(user);
                }}
                style={styles.remove}
              >
                <Ionicons name="close" size={15} color={colors.textTertiary} />
              </Pressable>

              {user.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons
                    name="person"
                    size={26}
                    color={colors.textTertiary}
                  />
                </View>
              )}

              <Text style={styles.name} numberOfLines={1}>
                {userDisplayName(user)}
              </Text>

              <View style={styles.metaRow}>
                <Ionicons name="person" size={11} color={colors.textTertiary} />
                <Text style={styles.meta} numberOfLines={1}>
                  {formatCount(user.followerCount)}
                </Text>
              </View>

              {isMe ? (
                <Text style={styles.you}>You</Text>
              ) : (
                <FollowButton
                  size="sm"
                  shape="rounded"
                  following={isFollowing(user)}
                  onPress={(event) => {
                    event.stopPropagation();
                    onToggleFollow(user);
                  }}
                  style={styles.follow}
                />
              )}
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** 1.2K / 496.2K / 1.4M — a card is too narrow for a full grouped number. */
function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${trimZero(value / 1000)}K`;
  return `${trimZero(value / 1_000_000)}M`;
}

function trimZero(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

const CARD_WIDTH = 156;

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: { marginTop: 6, marginBottom: 4 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    title: { color: c.text, fontSize: 19, fontWeight: "800", fontFamily: F },
    clear: {
      color: c.accentBlue,
      fontSize: 15,
      fontWeight: "700",
      fontFamily: F,
    },
    // Negative margin cancels the screen gutter so the strip scrolls edge to
    // edge; the matching padding puts the first card back on the gutter.
    strip: { marginHorizontal: -16 },
    stripContent: { paddingHorizontal: 16, gap: 10 },
    card: {
      width: CARD_WIDTH,
      alignItems: "center",
      paddingTop: 18,
      paddingBottom: 14,
      paddingHorizontal: 12,
      borderRadius: 18,
      backgroundColor: c.surfaceAlt,
    },
    remove: {
      position: "absolute",
      top: 6,
      right: 6,
      width: 26,
      height: 26,
      alignItems: "center",
      justifyContent: "center",
    },
    avatar: {
      width: 62,
      height: 62,
      borderRadius: 31,
      backgroundColor: c.surface,
    },
    avatarFallback: { alignItems: "center", justifyContent: "center" },
    name: {
      color: c.text,
      fontSize: 15,
      fontWeight: "800",
      fontFamily: F,
      marginTop: 10,
      maxWidth: "100%",
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: 4,
    },
    meta: {
      color: c.textTertiary,
      fontSize: 12,
      fontWeight: "600",
      fontFamily: F,
    },
    you: {
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: "700",
      fontFamily: F,
      marginTop: 12,
      paddingVertical: 8,
    },
    follow: { marginTop: 12, alignSelf: "stretch" },
  });
