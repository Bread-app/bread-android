import Ionicons from '@expo/vector-icons/Ionicons';
import { usePrivy } from '@privy-io/expo';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { getUserProfile, setShowPositionSize } from '@/lib/api';
import { unregisterCurrentPushToken } from '@/lib/notification-permissions';
import { useUnreadNotificationCount } from '@/lib/notifications-store';
import { type ThemeMode, useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';

const F = Fonts.rounded;

type SettingsRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void | Promise<void>;
  badge?: string;
  disabled?: boolean;
  haptic?: 'selection' | 'heavy';
  showChevron?: boolean;
  tone?: 'default' | 'destructive';
  value?: string;
};

function SettingsRow({
  icon,
  label,
  onPress,
  badge,
  disabled = false,
  haptic = 'selection',
  showChevron = true,
  tone = 'default',
  value,
}: SettingsRowProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const isDestructive = tone === 'destructive';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        badge ? `${label}, ${badge} unread` : value ? `${label}, ${value}` : label
      }
      accessibilityState={{ busy: disabled, disabled }}
      disabled={disabled}
      onPress={() => {
        if (haptic === 'heavy') {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        } else {
          void Haptics.selectionAsync();
        }
        void onPress();
      }}
      style={[styles.row, disabled && styles.rowDisabled]}>
      <View style={styles.iconShell}>
        <Ionicons name={icon} size={20} color={isDestructive ? colors.negative : colors.icon} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, isDestructive && styles.rowLabelDestructive]}>
          {label}
        </Text>
      </View>
      {disabled ? (
        <ActivityIndicator size="small" color={isDestructive ? colors.negative : colors.icon} />
      ) : (
        <View style={styles.rowTrailing}>
          {value ? <Text style={styles.rowValue}>{value}</Text> : null}
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
          {showChevron ? (
            <Ionicons name="chevron-forward" size={22} color={colors.iconMuted} />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/**
 * A switch instead of a chevron, in the same frame as the rows around it. The
 * hint line is not decoration: this one setting changes what OTHER people see,
 * and a bare label would not say that.
 */
function SettingsToggleRow({
  icon,
  label,
  hint,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();

  return (
    <View style={styles.row}>
      <View style={styles.iconShell}>
        <Ionicons name={icon} size={20} color={colors.icon} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={(next) => {
          void Haptics.selectionAsync();
          onChange(next);
        }}
        trackColor={{ true: colors.actionPrimary, false: colors.surfaceAlt }}
      />
    </View>
  );
}

const APPEARANCE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
];

export function SettingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, mode, setMode } = useThemeStore();
  const router = useRouter();
  const { user, logout } = usePrivy();
  const { showToast } = useToast();
  const unreadNotifications = useUnreadNotificationCount();
  const [isOpeningProfile, setIsOpeningProfile] = useState(false);
  /**
   * §8.4. Null until the profile answers, which is what keeps the switch from
   * flashing "on" and then correcting itself for someone who turned it off.
   */
  const [showSize, setShowSize] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void getUserProfile(user.id, user.id)
      .then((profile) => {
        if (!cancelled) setShowSize(profile?.showPositionSize !== false);
      })
      .catch(() => {
        if (!cancelled) setShowSize(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function openEditProfile(): Promise<void> {
    if (!user?.id || isOpeningProfile) return;
    setIsOpeningProfile(true);

    try {
      const profile = await getUserProfile(user.id, user.id);
      router.push({
        pathname: '/edit-profile',
        params: {
          ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
          ...(profile?.username ? { username: profile.username } : {}),
          ...(profile?.bio ? { bio: profile.bio } : {}),
        },
      });
    } catch {
      showToast("Couldn't load your profile. Try again.", 'error');
    } finally {
      setIsOpeningProfile(false);
    }
  }

  async function onLogout(): Promise<void> {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    try {
      await unregisterCurrentPushToken();
      await logout();
    } catch {
      showToast("Couldn't log out. Try again.", 'error');
    } finally {
      setIsLoggingOut(false);
    }
  }

  function chooseAppearance(): void {
    const applyMode = (nextMode: ThemeMode) => {
      void Haptics.selectionAsync();
      setMode(nextMode);
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...APPEARANCE_OPTIONS.map((option) => option.label), 'Cancel'],
          cancelButtonIndex: APPEARANCE_OPTIONS.length,
          title: 'Appearance',
        },
        (buttonIndex) => {
          const option = APPEARANCE_OPTIONS[buttonIndex];
          if (option) applyMode(option.value);
        },
      );
      return;
    }

    Alert.alert(
      'Appearance',
      'Choose how Bread looks on this device.',
      [
        ...APPEARANCE_OPTIONS.map((option) => ({
          text: option.label,
          onPress: () => applyMode(option.value),
        })),
        { text: 'Cancel', style: 'cancel' },
      ],
    );
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
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.settingsList}>
          <SettingsRow
            icon="person"
            label="Edit profile"
            disabled={isOpeningProfile}
            onPress={openEditProfile}
          />
          {showSize !== null ? (
            <SettingsToggleRow
              icon="eye-off"
              label="Show position size"
              hint="Your takes show a size band like $100–1K. Return and holding time are always shown."
              value={showSize}
              onChange={(next) => {
                // Optimistic: the switch is the state, and a failed write is
                // reverted rather than left disagreeing with the server.
                setShowSize(next);
                void setShowPositionSize(next).catch(() => setShowSize(!next));
              }}
            />
          ) : null}
          <SettingsRow
            icon="sunny"
            label="Appearance"
            value={APPEARANCE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Light'}
            onPress={chooseAppearance}
          />
          <SettingsRow
            icon="notifications"
            label="Notifications"
            badge={
              unreadNotifications > 0
                ? unreadNotifications > 99
                  ? '99+'
                  : String(unreadNotifications)
                : undefined
            }
            onPress={() => router.push('/notifications')}
          />
          <SettingsRow
            icon="flash"
            label="Like to Buy"
            onPress={() => router.push('/auto-buy')}
          />
          <SettingsRow
            icon="time"
            label="Activity"
            onPress={() => router.push('/activity')}
          />
          <SettingsRow
            icon="wallet"
            label="Clean up wallet"
            onPress={() => router.push('/cleanup-wallet')}
          />
          <SettingsRow
            icon="options"
            label="Notification preferences"
            onPress={() => router.push('/notification-settings')}
          />
          <SettingsRow
            icon="log-out"
            label="Log out"
            disabled={isLoggingOut}
            haptic="heavy"
            onPress={onLogout}
            showChevron={false}
            tone="destructive"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 12,
    },
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
    content: {
      flexGrow: 1,
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 48,
    },
    settingsList: {
      width: '100%',
    },
    row: {
      minHeight: 76,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      paddingVertical: 16,
    },
    rowDisabled: {
      opacity: 0.55,
    },
    iconShell: {
      width: 40,
      height: 44,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowCopy: {
      flex: 1,
    },
    rowLabel: {
      color: c.text,
      fontFamily: F,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: '700',
    },
    rowHint: {
      color: c.textSecondary,
      fontFamily: F,
      fontSize: 13,
      lineHeight: 17,
      marginTop: 2,
      marginRight: 10,
    },
    rowLabelDestructive: {
      color: c.negative,
    },
    rowTrailing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    rowValue: {
      color: c.textSecondary,
      fontFamily: F,
      fontSize: 16,
      fontWeight: '700',
    },
    badge: {
      minWidth: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
      paddingHorizontal: 8,
      backgroundColor: c.accentBlue,
    },
    badgeText: {
      color: c.textInverse,
      fontFamily: F,
      fontSize: 13,
      fontWeight: '800',
    },
  });
