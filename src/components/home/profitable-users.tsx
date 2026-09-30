import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { SectionHeader } from '@/components/section-header';
import { HandleText } from '@/components/handle-text';
import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ProfitableUser } from '@/lib/api';

const F = Fonts.rounded;
const CARD_WIDTH = 236;
const CARD_HEIGHT = 172;

type Props = {
  users: ProfitableUser[];
  loading: boolean;
  failed: boolean;
  currentPrivyUserId: string | null;
  onSelect: (user: ProfitableUser) => void;
  onRetry: () => void;
};

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 1000 ? 0 : 2,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

/**
 * The handle leads, as it does everywhere else in the app; the display name is
 * only what's left when someone has no username.
 */
function displayName(user: ProfitableUser): string {
  const username = user.username?.trim().replace(/^@+/, '');
  if (username) return `@${username}`;
  return user.name?.trim() || 'Bread investor';
}

/**
 * The second line — the display name, and only when it adds something the
 * handle above it doesn't already say.
 */
function secondaryLabel(user: ProfitableUser): string | null {
  const username = user.username?.trim().replace(/^@+/, '');
  if (!username) return null;
  const name = user.name?.trim();
  return name && name.toLowerCase() !== username.toLowerCase() ? name : null;
}

function UserAvatar({ user }: { user: ProfitableUser }) {
  const styles = useThemedStyles(makeStyles);
  const initial = displayName(user).replace(/^@/, '').slice(0, 1).toUpperCase();

  if (user.avatarUrl) {
    return <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />;
  }

  return (
    <View style={styles.avatarFallback}>
      <Text style={styles.avatarInitial}>{initial}</Text>
    </View>
  );
}

function ProfitableUserCard({
  user,
  rank,
  isCurrentUser,
  onPress,
}: {
  user: ProfitableUser;
  rank: number;
  isCurrentUser: boolean;
  onPress: (user: ProfitableUser) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const name = displayName(user);
  const secondary = secondaryLabel(user);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${name}, rank ${rank}, up ${user.pnlPct.toFixed(2)} percent today`}
      onPress={() => onPress(user)}
      scaleTo={0.97}
      style={styles.card}
    >
      <View style={styles.cardTopRow}>
        <View style={styles.identityRow}>
          <UserAvatar user={user} />
          <View style={styles.identityCopy}>
            <View style={styles.nameRow}>
              <HandleText style={styles.name} numberOfLines={1}>
                {name}
              </HandleText>
              {isCurrentUser ? <Text style={styles.youPill}>YOU</Text> : null}
            </View>
            {secondary ? (
              <Text style={styles.handle} numberOfLines={1}>
                {secondary}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>#{rank}</Text>
        </View>
      </View>

      <View>
        <Text style={styles.returnText}>+{user.pnlPct.toFixed(2)}%</Text>
        <Text style={styles.pnlText}>+{formatUsd(user.pnlUsd)} today</Text>
      </View>
    </PressableScale>
  );
}

export function ProfitableUsers({
  users,
  loading,
  failed,
  currentPrivyUserId,
  onSelect,
  onRetry,
}: Props) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.section}>
      <SectionHeader variant="quiet" title="Profitable traders" />

      {loading && users.length === 0 ? (
        <View style={styles.skeletonRow}>
          {Array.from({ length: 2 }).map((_, index) => (
            <View
              key={index}
              accessibilityLabel="Loading profitable users"
              style={styles.skeletonCard}
            />
          ))}
        </View>
      ) : failed && users.length === 0 ? (
        <View style={styles.noticeRow}>
          <Text style={styles.notice}>Couldn&apos;t load today&apos;s leaderboard.</Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Retry profitable users"
            onPress={onRetry}
            style={styles.actionButton}
          >
            <Text style={styles.noticeAction}>Try again</Text>
          </PressableScale>
        </View>
      ) : users.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>The leaderboard is warming up</Text>
          <Text style={styles.notice}>Today&apos;s positive performers will appear here.</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.railContent}
          style={styles.railBleed}
        >
          {users.map((user, index) => (
            <ProfitableUserCard
              key={user.id}
              user={user}
              rank={index + 1}
              isCurrentUser={user.privyUserId === currentPrivyUserId}
              onPress={onSelect}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Tier spacing is owned by the home screen — see `HomeScreen`.
    section: {},
    railBleed: {
      marginHorizontal: -24,
    },
    railContent: {
      paddingHorizontal: 24,
      paddingVertical: 6,
      gap: 12,
    },
    card: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      borderRadius: Radius.xl,
      backgroundColor: c.surfaceAlt,
      padding: 16,
      justifyContent: 'space-between',
    },
    cardTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 10,
    },
    identityRow: {
      minWidth: 0,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    identityCopy: {
      minWidth: 0,
      flex: 1,
    },
    avatar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: c.surfaceSelected,
    },
    avatarFallback: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceSelected,
    },
    avatarInitial: {
      color: c.text,
      fontSize: 17,
      lineHeight: 21,
      fontWeight: '900',
      fontFamily: F,
    },
    nameRow: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    name: {
      minWidth: 0,
      flexShrink: 1,
      color: c.text,
      fontSize: 15,
      lineHeight: 19,
      fontWeight: '800',
      fontFamily: F,
    },
    youPill: {
      color: c.textSecondary,
      fontSize: 9,
      lineHeight: 13,
      fontWeight: '900',
      fontFamily: F,
      letterSpacing: 0.5,
    },
    handle: {
      marginTop: 2,
      color: c.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      fontFamily: F,
    },
    rankBadge: {
      minWidth: 31,
      height: 28,
      paddingHorizontal: 7,
      borderRadius: Radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surface,
    },
    rankText: {
      color: c.textSecondary,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '900',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
    returnText: {
      color: c.positive,
      fontSize: 31,
      lineHeight: 36,
      fontWeight: '900',
      fontFamily: Fonts.displayMedium,
      fontVariant: ['tabular-nums'],
      letterSpacing: -0.7,
    },
    pnlText: {
      marginTop: 3,
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '700',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
    skeletonRow: {
      flexDirection: 'row',
      gap: 12,
      overflow: 'hidden',
    },
    skeletonCard: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      borderRadius: Radius.xl,
      backgroundColor: c.surfaceAlt,
    },
    noticeRow: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    notice: {
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
      fontFamily: F,
    },
    actionButton: {
      minHeight: 44,
      justifyContent: 'center',
    },
    noticeAction: {
      color: c.actionPrimary,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '800',
      fontFamily: F,
    },
    emptyCard: {
      minHeight: 98,
      borderRadius: Radius.lg,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: 16,
      paddingVertical: 15,
      justifyContent: 'center',
      gap: 4,
    },
    emptyTitle: {
      color: c.text,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '800',
      fontFamily: F,
    },
  });
