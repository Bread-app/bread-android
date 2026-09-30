import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';

import { Fonts } from '@/constants/theme';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

export type ToastTone = 'processing' | 'success' | 'error' | 'info';

export type Toast = {
  id: number;
  text: string;
  tone: ToastTone;
};

type ToastContextValue = {
  showToast: (text: string, tone?: ToastTone, durationMs?: number) => number;
  dismissToast: (id?: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let toastIdSeq = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismissToast = useCallback(
    (id?: number) => {
      if (id !== undefined && activeIdRef.current !== id) return;
      clearTimer();
      activeIdRef.current = null;
      setToast(null);
    },
    [clearTimer],
  );

  const showToast = useCallback<ToastContextValue['showToast']>(
    (text, tone = 'info', durationMs = 2400) => {
      clearTimer();
      const id = toastIdSeq++;
      activeIdRef.current = id;
      setToast({ id, text, tone });
      if (durationMs > 0) {
        timerRef.current = setTimeout(() => {
          if (activeIdRef.current === id) {
            activeIdRef.current = null;
            setToast(null);
          }
        }, durationMs);
      }
      return id;
    },
    [clearTimer],
  );

  useEffect(() => () => clearTimer(), [clearTimer]);

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <IslandToastHost toast={toast} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      showToast: () => -1,
      dismissToast: () => {},
    };
  }
  return ctx;
}

// ─── Palette ────────────────────────────────────────────────────────────────

const palettesByTone: Record<
  ToastTone,
  {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    iconBg: string;
  }
> = {
  processing: {
    icon: 'time',
    iconBg: 'rgba(56,189,248,0.14)',
  },
  success: {
    icon: 'checkmark-circle',
    iconBg: 'rgba(32,190,72,0.12)',
  },
  error: {
    icon: 'alert-circle',
    iconBg: 'rgba(238, 30, 82,0.1)',
  },
  info: {
    icon: 'information-circle',
    iconBg: 'rgba(56,189,248,0.14)',
  },
};

const ICON_COLORS: Record<ToastTone, string> = {
  processing: '#38BDF8',
  success: '#35F046',
  error: '#EE1E52',
  info: '#38BDF8',
};

// ─── Spring configs ─────────────────────────────────────────────────────────

const ENTER_SPRING = {
  damping: 18,
  stiffness: 220,
  mass: 0.8,
  overshootClamping: false,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.5,
};

const EXIT_DURATION = 200;

// ─── Island Toast ───────────────────────────────────────────────────────────

function IslandToastHost({
  toast,
  onDismiss,
}: {
  toast: Toast | null;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const [mounted, setMounted] = useState<Toast | null>(null);
  const hapticFiredRef = useRef<number | null>(null);

  useEffect(() => {
    if (toast) {
      setMounted(toast);

      if (hapticFiredRef.current !== toast.id) {
        hapticFiredRef.current = toast.id;
        const style =
          toast.tone === 'success'
            ? Haptics.ImpactFeedbackStyle.Medium
            : toast.tone === 'error'
              ? Haptics.ImpactFeedbackStyle.Heavy
              : Haptics.ImpactFeedbackStyle.Light;
        void Haptics.impactAsync(style);
      }

      progress.value = withSpring(1, ENTER_SPRING);
    } else {
      progress.value = withTiming(0, { duration: EXIT_DURATION }, (finished) => {
        if (finished) {
          runOnJS(setMounted)(null);
        }
      });
    }
  }, [toast, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    const p = progress.value;
    return {
      opacity: p,
      transform: [
        { translateY: (1 - p) * -8 },
        { scale: 0.96 + p * 0.04 },
      ],
    };
  });

  if (!mounted) return null;

  const current = mounted;
  const palette = palettesByTone[current.tone];
  const iconColor = ICON_COLORS[current.tone];

  // The safe-area top ends below the Dynamic Island/status bar. A small gap
  // keeps the notification visually detached from the system chrome.
  const topOffset = insets.top + 6;

  const content = (
    <View style={styles.host} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.toastOuter,
          animatedStyle,
          { marginTop: topOffset },
        ]}
      >
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          onPress={onDismiss}
          style={styles.toastPressable}
        >
          <View style={[StyleSheet.absoluteFill, styles.toastBackground]} />

          {/* Icon */}
          <View style={[styles.iconWrap, { backgroundColor: palette.iconBg }]}>
            <Ionicons name={palette.icon} size={18} color={iconColor} />
          </View>

          {/* Text */}
          <View style={styles.textCol}>
            <Text style={styles.messageLabel} numberOfLines={1}>
              {current.text}
            </Text>
          </View>
        </PressableScale>
      </Animated.View>
    </View>
  );

  // Bottom sheets (gorhom) portal up to the BottomSheetModalProvider at the app
  // root, which sits ABOVE the ToastProvider — so a plain toast renders *behind*
  // any open sheet. FullWindowOverlay renders above every RN view including
  // sheets/modals, keeping the toast on top. iOS-only (no-op on Android), so we
  // fall back to the bare view elsewhere.
  return Platform.OS === 'ios' ? (
    <FullWindowOverlay>{content}</FullWindowOverlay>
  ) : (
    content
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99999,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  toastOuter: {
    width: '82%',
    maxWidth: 320,
    borderRadius: 22,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
  },
  toastPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 22,
    overflow: 'hidden',
  },
  toastBackground: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
  },
  iconWrap: {
    position: 'absolute',
    left: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textCol: {
    width: '100%',
    paddingHorizontal: 30,
  },
  messageLabel: {
    color: '#111318',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: F,
    lineHeight: 17,
    textAlign: 'center',
  },
});
