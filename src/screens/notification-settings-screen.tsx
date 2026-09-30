import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
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
import {
  getNotificationPreferences,
  POSITION_ALERT_STEPS,
  updateNotificationPreferences,
  type NotificationPreferences,
} from '@/lib/api';
import { registerForPushNotificationsIfNeeded } from '@/lib/notification-permissions';
import { useThemeStore } from '@/lib/theme-store';

const F = Fonts.rounded;

type ToggleKey = keyof Pick<
  NotificationPreferences,
  | 'socialTrades'
  | 'marketMoves'
  | 'marketPulse'
  | 'social'
  | 'money'
  | 'market'
  | 'product'
  | 'positionAlerts'
  | 'quietHoursEnabled'
  | 'pushEnabled'
>;

const CATEGORIES: { key: ToggleKey; label: string; hint: string }[] = [
  {
    key: 'money',
    label: 'Trades & cash',
    hint: 'Fills, partial fills, deposits and withdrawals. Delivered even during quiet hours.',
  },
  {
    key: 'social',
    label: 'Social',
    hint: 'Follows, likes, comments, and when someone buys a sandwich you built.',
  },
  { key: 'socialTrades', label: 'People you follow trade', hint: 'Trades and position theses from the community.' },
  {
    key: 'market',
    label: 'Market moves',
    hint: 'Big moves in positions you hold.',
  },
  { key: 'marketMoves', label: 'Moves on sandwiches you hold or liked', hint: 'Price moves on calls you care about.' },
  { key: 'marketPulse', label: 'Market pulse', hint: 'Big moves, earnings, calls playing out.' },
  {
    key: 'product',
    label: 'Tips & updates',
    hint: 'Occasional nudges about your account. Off by default.',
  },
];

function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/**
 * Per-category delivery settings.
 *
 * These control PUSH only — everything still lands in the inbox, so muting a
 * category costs the user visibility, never history. The screen writes each
 * toggle straight through (optimistically) rather than batching behind a save
 * button: there is nothing here worth a two-step commit.
 */
export function NotificationSettingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const router = useRouter();

  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [systemGranted, setSystemGranted] = useState<boolean | null>(null);

  useEffect(() => {
    void getNotificationPreferences()
      .then(setPreferences)
      .catch(() => setPreferences(null));
    void Notifications.getPermissionsAsync()
      .then((status) => setSystemGranted(status.status === 'granted'))
      .catch(() => setSystemGranted(null));
  }, []);

  const toggle = useCallback(
    (key: ToggleKey, value: boolean) => {
      void Haptics.selectionAsync();
      setPreferences((current) => (current ? { ...current, [key]: value } : current));
      void updateNotificationPreferences({ [key]: value })
        .then(setPreferences)
        .catch(() => {
          // Roll back to the truth rather than leaving a switch lying.
          void getNotificationPreferences().then(setPreferences).catch(() => {});
        });
    },
    [],
  );

  const setBudget = useCallback((budget: number) => {
    void Haptics.selectionAsync();
    setPreferences(current => current ? { ...current, marketPulseBudget: budget } : current);
    void updateNotificationPreferences({ marketPulseBudget: budget }).then(setPreferences).catch(() => {
      void getNotificationPreferences().then(setPreferences).catch(() => {});
    });
  }, []);

  const setStep = useCallback((step: number) => {
    void Haptics.selectionAsync();
    setPreferences((current) => (current ? { ...current, positionAlertStepPct: step } : current));
    void updateNotificationPreferences({ positionAlertStepPct: step })
      .then(setPreferences)
      .catch(() => {
        void getNotificationPreferences().then(setPreferences).catch(() => {});
      });
  }, []);

  const enableSystemPermission = useCallback(async () => {
    const granted = await registerForPushNotificationsIfNeeded();
    setSystemGranted(granted);
    // A previous denial can only be undone in system settings — asking again
    // does nothing, so send the user where the switch actually is.
    if (!granted) void Linking.openSettings();
  }, []);

  if (!preferences) {
    return (
      <SafeAreaView style={styles.page} edges={['top']}>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accentBlue} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {systemGranted === false ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void enableSystemPermission()}
            style={styles.banner}>
            <Ionicons name="notifications-off" size={18} color={colors.text} />
            <Text style={styles.bannerText}>
              Push is off for Bread on this device. Tap to turn it on — you&apos;ll still see
              everything in the app.
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.card}>
          <Row
            label="Push notifications"
            hint="The master switch for this account, on every device."
            value={preferences.pushEnabled}
            onChange={(value) => toggle('pushEnabled', value)}
            styles={styles}
            colors={colors}
          />
        </View>

        <Text style={styles.sectionTitle}>What to send</Text>
        <View style={styles.card}>
          {CATEGORIES.map((category, index) => (
            <Row
              key={category.key}
              label={category.label}
              hint={category.hint}
              value={preferences[category.key] as boolean}
              disabled={!preferences.pushEnabled}
              onChange={(value) => toggle(category.key, value)}
              divider={index < CATEGORIES.length - 1}
              styles={styles}
              colors={colors}
            />
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Market pulse per day</Text>
            <View style={styles.stepChips}>
              {[0, 1, 3].map(budget => (
                <Pressable key={budget} accessibilityRole="button" accessibilityLabel={budget === 0 ? 'Market pulse off' : `${budget} market pulse pushes per day`}
                  accessibilityState={{ selected: preferences.marketPulseBudget === budget }}
                  disabled={!preferences.pushEnabled || !preferences.market || !preferences.marketPulse}
                  onPress={() => setBudget(budget)} style={[styles.stepChip, preferences.marketPulseBudget === budget && styles.stepChipActive]}>
                  <Text style={[styles.stepChipText, preferences.marketPulseBudget === budget && styles.stepChipTextActive]}>{budget === 0 ? 'Off' : budget}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
        <Text style={styles.sectionTitle}>Position alerts</Text>
        <View style={styles.card}>
          <Row
            label="Tell me when a position moves"
            hint="Alerts when a sandwich you hold crosses a move, in either direction. Each level fires once."
            value={preferences.positionAlerts}
            disabled={!preferences.pushEnabled}
            onChange={(value) => toggle('positionAlerts', value)}
            divider
            styles={styles}
            colors={colors}
          />
          <View style={[styles.stepRow, !preferences.positionAlerts && styles.rowDisabled]}>
            <Text style={styles.rowLabel}>Every</Text>
            <View style={styles.stepChips}>
              {POSITION_ALERT_STEPS.map((step) => {
                const active = preferences.positionAlertStepPct === step;
                return (
                  <Pressable
                    key={step}
                    accessibilityRole="button"
                    accessibilityLabel={`Alert every ${step} percent`}
                    disabled={!preferences.positionAlerts || !preferences.pushEnabled}
                    onPress={() => setStep(step)}
                    style={[styles.stepChip, active && styles.stepChipActive]}>
                    <Text style={[styles.stepChipText, active && styles.stepChipTextActive]}>
                      {step}%
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.stepHint}>
            At {preferences.positionAlertStepPct}% you&apos;ll hear at{' '}
            {[1, 2, 3].map((n) => `${n * preferences.positionAlertStepPct}%`).join(', ')} and so on —
            up or down. Perp moves are measured on your margin.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Quiet hours</Text>
        <View style={styles.card}>
          <Row
            label={`${formatMinutes(preferences.quietHoursStart)} – ${formatMinutes(
              preferences.quietHoursEnd,
            )}`}
            hint="Holds social and market notifications overnight. Trade and cash updates always come through."
            value={preferences.quietHoursEnabled}
            disabled={!preferences.pushEnabled}
            onChange={(value) => toggle('quietHoursEnabled', value)}
            styles={styles}
            colors={colors}
          />
        </View>

        <Text style={styles.footnote}>
          Muting a category only stops the banner. Everything still shows up in your
          notifications list.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  hint,
  value,
  onChange,
  disabled,
  divider,
  styles,
  colors,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  divider?: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  return (
    <View style={[styles.row, divider && styles.rowDivider, disabled && styles.rowDisabled]}>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.actionPrimary, false: colors.surfaceAlt }}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontFamily: F, fontWeight: '800', fontSize: 18, color: c.text },
    content: { paddingHorizontal: 16, paddingBottom: 48, gap: 8 },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 14,
      borderRadius: 14,
      backgroundColor: c.surfaceAlt,
      marginBottom: 8,
    },
    bannerText: { flex: 1, fontFamily: F, fontWeight: '600', fontSize: 13, color: c.text, lineHeight: 18 },
    sectionTitle: {
      fontFamily: F,
      fontWeight: '800',
      fontSize: 13,
      color: c.textSecondary,
      marginTop: 16,
      marginBottom: 4,
      marginLeft: 4,
    },
    card: { borderRadius: 16, backgroundColor: c.surface, overflow: 'hidden' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 14,
      paddingTop: 14,
    },
    stepChips: { flexDirection: 'row', gap: 6 },
    stepChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    stepChipActive: { backgroundColor: c.actionPrimary },
    stepChipText: { fontFamily: F, fontWeight: '800', fontSize: 13, color: c.textSecondary },
    stepChipTextActive: { color: c.actionPrimaryText },
    stepHint: {
      fontFamily: F,
      fontWeight: '500',
      fontSize: 12,
      color: c.textSecondary,
      lineHeight: 17,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 14,
    },
    rowDisabled: { opacity: 0.45 },
    rowBody: { flex: 1, gap: 3 },
    rowLabel: { fontFamily: F, fontWeight: '800', fontSize: 15, color: c.text },
    rowHint: { fontFamily: F, fontWeight: '500', fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    footnote: {
      fontFamily: F,
      fontWeight: '500',
      fontSize: 12,
      color: c.textTertiary,
      lineHeight: 17,
      marginTop: 16,
      marginHorizontal: 4,
    },
  });
