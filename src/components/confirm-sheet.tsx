import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlurBackdrop } from '@/components/blur-backdrop';
import { SheetModal } from '@/components/sheet-modal';
import { PressableScale } from '@/components/pressable-scale';
import { RotatingChevron } from '@/components/rotating-chevron';
import { CtaButton } from '@/components/side-glass-button';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';

const F = Fonts.rounded;
const STEP_IN = FadeIn.duration(200).reduceMotion(ReduceMotion.System);
/**
 * A follow-up step puts its action exactly where the last one was, so a
 * double-tap on "Continue" would land on "Delete account". The confirm ignores
 * taps for this long after a step appears.
 */
const STEP_ARM_MS = 600;

export type ConfirmStep = {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  confirmLabel: string;
  /** `destructive` paints the action red; anything that spends or grants is `primary`. */
  tone?: 'destructive' | 'primary';
  /** Shown on the button while `onConfirm`'s promise is pending. */
  busyLabel?: string;
  /**
   * Return another step to continue in the same tray (it resizes to the new
   * content, so the progression reads as a step, not a new dialog). Return
   * nothing — or a promise — to finish: the tray closes once it settles.
   */
  onConfirm: () => ConfirmStep | void | Promise<void>;
};

export type ConfirmSheetRef = {
  present: (step: ConfirmStep) => void;
  dismiss: () => void;
};

/**
 * The app's confirmation tray — replaces the native `Alert.alert` for
 * confirmations that deserve context. It rises over the screen the action came
 * from (so the user never loses their place), carries one decision with a
 * title and a plain-language consequence, and puts the action on the shared CTA
 * pill. A second step (a "this is permanent" check) continues in the same
 * tray, with a back chevron, instead of stacking a new alert on top.
 *
 * Present imperatively from the tap handler, never from an effect.
 */
export const ConfirmSheet = forwardRef<ConfirmSheetRef>(function ConfirmSheet(_props, ref) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const insets = useSafeAreaInsets();
  const [steps, setSteps] = useState<ConfirmStep[]>([]);
  const [busy, setBusy] = useState(false);
  const armedAtRef = useRef(0);
  const step = steps[steps.length - 1] ?? null;

  useImperativeHandle(
    ref,
    () => ({
      present(first) {
        armedAtRef.current = Date.now() + STEP_ARM_MS;
        setBusy(false);
        setSteps([first]);
        sheetRef.current?.present();
      },
      dismiss() {
        sheetRef.current?.dismiss();
      },
    }),
    [],
  );

  const confirm = useCallback(() => {
    if (!step || busy || Date.now() < armedAtRef.current) return;
    if (step.tone === 'destructive') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    const result = step.onConfirm();
    if (result && typeof (result as Promise<void>).then === 'function') {
      setBusy(true);
      // The caller reports its own failure (toast / inline error); the tray
      // only needs to know the action is over.
      void (result as Promise<void>).catch(() => {}).finally(() => {
        setBusy(false);
        sheetRef.current?.dismiss();
      });
      return;
    }
    if (result) {
      armedAtRef.current = Date.now() + STEP_ARM_MS;
      setSteps((current) => [...current, result as ConfirmStep]);
      return;
    }
    sheetRef.current?.dismiss();
  }, [busy, step]);

  const canGoBack = steps.length > 1 && !busy;

  return (
    <SheetModal
      ref={sheetRef}
      enableDynamicSizing
      enablePanDownToClose={!busy}
      stackBehavior="push"
      backdropComponent={BlurBackdrop}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handleHidden}
      onDismiss={() => {
        setSteps([]);
        setBusy(false);
      }}
    >
      <BottomSheetView style={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        {step ? (
          // Keyed per step so the new copy fades in as the tray resizes to it.
          <Animated.View key={steps.length} entering={STEP_IN}>
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={2}>
                {step.title}
              </Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={canGoBack ? 'Back' : 'Close'}
                hitSlop={10}
                disabled={busy}
                onPress={() => {
                  void Haptics.selectionAsync();
                  if (canGoBack) {
                    armedAtRef.current = Date.now() + STEP_ARM_MS;
                    setSteps((current) => current.slice(0, -1));
                  }
                  else sheetRef.current?.dismiss();
                }}
                style={styles.headerButton}
              >
                {canGoBack ? (
                  <View style={styles.backChevron}>
                    <RotatingChevron up={false} size={18} color={colors.textSecondary} />
                  </View>
                ) : (
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                )}
              </PressableScale>
            </View>

            {step.icon ? (
              <View
                style={[
                  styles.iconBubble,
                  step.tone === 'destructive' && { backgroundColor: `${colors.negative}1A` },
                ]}
              >
                <Ionicons
                  name={step.icon}
                  size={26}
                  color={step.tone === 'destructive' ? colors.negative : colors.actionPrimary}
                />
              </View>
            ) : null}

            <Text style={styles.body}>{step.body}</Text>
          </Animated.View>
        ) : null}

        {step ? (
          <View style={styles.actions}>
            <CtaButton
              label={step.confirmLabel}
              color={step.tone === 'destructive' ? colors.negative : colors.actionPrimary}
              onPress={confirm}
              loading={busy}
              loadingLabel={step.busyLabel ?? null}
              haptic={step.tone !== 'destructive'}
            />
          </View>
        ) : null}
      </BottomSheetView>
    </SheetModal>
  );
});

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    background: { backgroundColor: c.background, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    handleHidden: { backgroundColor: 'transparent' },
    content: { paddingHorizontal: 22, paddingTop: 2 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
    title: { flex: 1, fontFamily: F, fontWeight: '800', fontSize: 20, color: c.text },
    headerButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    // The same chevron the Back affordance uses elsewhere, turned to point left.
    backChevron: { transform: [{ rotate: '90deg' }] },
    iconBubble: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
      marginBottom: 14,
    },
    body: { fontFamily: F, fontWeight: '500', fontSize: 15, lineHeight: 21, color: c.textSecondary },
    actions: { marginTop: 24 },
  });
