import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { type BlockedUser, getBlockedUsers } from '@/lib/api';
import { unblock } from '@/lib/moderation';
import { useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';

const F = Fonts.rounded;

function handleOf(user: BlockedUser): string {
  return user.username ? `@${user.username}` : (user.name ?? 'bread user');
}

/** Settings → Blocked accounts. The only place a block is undone from. */
export function BlockedUsersScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const router = useRouter();
  const { showToast } = useToast();
  const [users, setUsers] = useState<BlockedUser[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    void getBlockedUsers()
      .then(setUsers)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  async function onUnblock(user: BlockedUser): Promise<void> {
    setPendingId(user.id);
    const ok = await unblock({ ref: { userId: user.id }, handle: handleOf(user), showToast });
    setPendingId(null);
    if (ok) setUsers((current) => current?.filter((row) => row.id !== user.id) ?? null);
  }

  return (
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.headerButton}>
          <Ionicons name="chevron-back" size={25} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Blocked accounts</Text>
      </View>

      {users === null ? (
        <View style={styles.center}>
          {failed ? (
            <Pressable accessibilityRole="button" onPress={load}>
              <Text style={styles.emptyText}>Couldn&apos;t load. Tap to retry.</Text>
            </Pressable>
          ) : (
            <ActivityIndicator color={colors.icon} />
          )}
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(user) => user.id}
          contentContainerStyle={styles.content}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              You haven&apos;t blocked anyone. Block someone from the ••• menu on their profile, Sandwich, or comment.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              {item.avatarUrl ? (
                <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons name="person" size={20} color={colors.textTertiary} />
                </View>
              )}
              <Text style={styles.name} numberOfLines={1}>
                {handleOf(item)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${handleOf(item)}`}
                disabled={pendingId === item.id}
                onPress={() => void onUnblock(item)}
                style={[styles.unblockButton, pendingId === item.id && styles.unblockButtonBusy]}>
                <Text style={styles.unblockText}>Unblock</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    header: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
    headerButton: {
      width: 44,
      height: 44,
      marginLeft: -10,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 22,
    },
    headerTitle: {
      marginTop: 12,
      color: c.text,
      fontFamily: F,
      fontSize: 30,
      lineHeight: 36,
      fontWeight: '800',
      letterSpacing: -0.5,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    content: { paddingHorizontal: 20, paddingBottom: 48 },
    emptyText: {
      color: c.textSecondary,
      fontFamily: F,
      fontSize: 15,
      lineHeight: 21,
      paddingTop: 12,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
    avatar: { width: 44, height: 44, borderRadius: 22 },
    avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceAlt },
    name: { flex: 1, color: c.text, fontFamily: F, fontSize: 17, fontWeight: '700' },
    unblockButton: {
      paddingHorizontal: 16,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    unblockButtonBusy: { opacity: 0.5 },
    unblockText: { color: c.text, fontFamily: F, fontSize: 15, fontWeight: '700' },
  });
