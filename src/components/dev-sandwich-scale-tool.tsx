import Ionicons from "@expo/vector-icons/Ionicons";
import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const STORAGE_KEY = "bread.dev.sandwich-scales";
const ACTION_STORAGE_KEY = "bread.dev.sandwich-action-colors";
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.3;
const SCALE_STEP = 0.05;
const MIN_ACTION_OPACITY = 0.4;
const MAX_ACTION_OPACITY = 1;
const ACTION_OPACITY_STEP = 0.04;

export type SandwichScaleKey =
  | "postHeader"
  | "chart"
  | "positionCard"
  | "assetRows"
  | "assetPrices"
  | "details"
  | "actions";

export type SandwichScales = Record<SandwichScaleKey, number>;

export const DEFAULT_SANDWICH_SCALES: SandwichScales = {
  postHeader: 1,
  chart: 0.85,
  positionCard: 1,
  assetRows: 0.9,
  assetPrices: 1.15,
  details: 1.1,
  actions: 0.95,
};

const SCALE_CONTROLS: { key: SandwichScaleKey; label: string; hint: string }[] = [
  { key: "postHeader", label: "Post header", hint: "Creator, thesis, and social actions" },
  { key: "chart", label: "Chart", hint: "Performance chart and timeframe" },
  { key: "positionCard", label: "Position card", hint: "Your value, return, and share card" },
  { key: "assetRows", label: "Asset rows", hint: "Each asset row and its spacing" },
  { key: "assetPrices", label: "Asset prices", hint: "Price text inside asset rows" },
  { key: "details", label: "Details", hint: "Expanded thesis and show-more control" },
  { key: "actions", label: "Bottom actions", hint: "Buy, Buy More, and Sell buttons" },
];

export type SandwichActionKey = "buy" | "buyMore" | "sell";

/** `color: null` means "keep whatever the theme says". */
export type SandwichActionStyle = { color: string | null; opacity: number };

export type SandwichActionSettings = {
  actions: Record<SandwichActionKey, SandwichActionStyle>;
  /** Skip the glass treatment entirely — a flat, fully opaque fill. */
  solid: boolean;
};

export const DEFAULT_SANDWICH_ACTION_SETTINGS: SandwichActionSettings = {
  actions: {
    buy: { color: null, opacity: 1 },
    buyMore: { color: null, opacity: 0.92 },
    sell: { color: null, opacity: 0.92 },
  },
  solid: false,
};

const ACTION_CONTROLS: { key: SandwichActionKey; label: string; hint: string }[] = [
  { key: "buy", label: "Buy", hint: "The single BUY button" },
  { key: "buyMore", label: "Buy more", hint: "Left button once you hold" },
  { key: "sell", label: "Sell", hint: "Right button once you hold" },
];

// A spread wide enough to try a direction quickly; the picker in the theme
// editor is the tool for landing on an exact value.
const ACTION_SWATCHES = [
  "#02ED45",
  "#00C853",
  "#38BDF8",
  "#2563EB",
  "#7C3AED",
  "#EE1E52",
  "#E83E67",
  "#F59E0B",
  "#111827",
  "#FFFFFF",
];

function clampOpacity(value: number) {
  return (
    Math.round(Math.min(MAX_ACTION_OPACITY, Math.max(MIN_ACTION_OPACITY, value)) * 100) / 100
  );
}

function parseStoredActionSettings(value: string | null): SandwichActionSettings | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as {
      actions?: Partial<Record<SandwichActionKey, unknown>>;
      solid?: unknown;
    };
    const actions = ACTION_CONTROLS.reduce<Record<SandwichActionKey, SandwichActionStyle>>(
      (result, control) => {
        const fallback = DEFAULT_SANDWICH_ACTION_SETTINGS.actions[control.key];
        const candidate = parsed.actions?.[control.key] as Partial<SandwichActionStyle> | undefined;
        result[control.key] = {
          color: typeof candidate?.color === "string" ? candidate.color : fallback.color,
          opacity:
            typeof candidate?.opacity === "number" && Number.isFinite(candidate.opacity)
              ? clampOpacity(candidate.opacity)
              : fallback.opacity,
        };
        return result;
      },
      { ...DEFAULT_SANDWICH_ACTION_SETTINGS.actions },
    );
    return { actions, solid: parsed.solid === true };
  } catch {
    return null;
  }
}

function isDefaultActionSettings(settings: SandwichActionSettings) {
  if (settings.solid !== DEFAULT_SANDWICH_ACTION_SETTINGS.solid) return false;
  return ACTION_CONTROLS.every(({ key }) => {
    const current = settings.actions[key];
    const fallback = DEFAULT_SANDWICH_ACTION_SETTINGS.actions[key];
    return (
      current.color === fallback.color && Math.abs(current.opacity - fallback.opacity) < 0.001
    );
  });
}

/**
 * Dev-only overrides for the sandwich screen's Buy / Buy more / Sell buttons.
 * Kept apart from the theme editor because these are throwaway experiments on
 * one screen, not a change to the app's action tokens.
 */
export function useSandwichActionSettings() {
  const [actionSettings, setActionSettings] = useState<SandwichActionSettings>(
    DEFAULT_SANDWICH_ACTION_SETTINGS,
  );
  const storageQueue = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback((next: SandwichActionSettings) => {
    storageQueue.current = storageQueue.current
      .catch(() => {})
      .then(() => SecureStore.setItemAsync(ACTION_STORAGE_KEY, JSON.stringify(next)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!__DEV__) return;
    let active = true;
    SecureStore.getItemAsync(ACTION_STORAGE_KEY)
      .then((stored) => {
        const parsed = parseStoredActionSettings(stored);
        if (active && parsed) setActionSettings(parsed);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback(
    (mutate: (current: SandwichActionSettings) => SandwichActionSettings) => {
      if (!__DEV__) return;
      setActionSettings((current) => {
        const next = mutate(current);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setActionColor = useCallback(
    (key: SandwichActionKey, color: string | null) => {
      update((current) => ({
        ...current,
        actions: { ...current.actions, [key]: { ...current.actions[key], color } },
      }));
    },
    [update],
  );

  const setActionOpacity = useCallback(
    (key: SandwichActionKey, opacity: number) => {
      update((current) => ({
        ...current,
        actions: {
          ...current.actions,
          [key]: { ...current.actions[key], opacity: clampOpacity(opacity) },
        },
      }));
    },
    [update],
  );

  const setSolidActions = useCallback(
    (solid: boolean) => {
      update((current) => ({ ...current, solid }));
    },
    [update],
  );

  const resetActionSettings = useCallback(() => {
    setActionSettings(DEFAULT_SANDWICH_ACTION_SETTINGS);
    if (__DEV__) {
      storageQueue.current = storageQueue.current
        .catch(() => {})
        .then(() => SecureStore.deleteItemAsync(ACTION_STORAGE_KEY))
        .catch(() => {});
    }
  }, []);

  return {
    actionSettings,
    setActionColor,
    setActionOpacity,
    setSolidActions,
    resetActionSettings,
  };
}

function clampScale(value: number) {
  return Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)) * 100) / 100;
}

function parseStoredScales(value: string | null): SandwichScales | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Record<SandwichScaleKey, unknown>>;
    return SCALE_CONTROLS.reduce<SandwichScales>((result, control) => {
      const candidate = parsed[control.key];
      result[control.key] =
        typeof candidate === "number" && Number.isFinite(candidate)
          ? clampScale(candidate)
          : DEFAULT_SANDWICH_SCALES[control.key];
      return result;
    }, { ...DEFAULT_SANDWICH_SCALES });
  } catch {
    return null;
  }
}

export function useSandwichScaleSettings() {
  const [scales, setScales] = useState<SandwichScales>(DEFAULT_SANDWICH_SCALES);
  const storageQueue = useRef<Promise<void>>(Promise.resolve());

  const enqueueStorageWrite = useCallback((operation: () => Promise<void>) => {
    storageQueue.current = storageQueue.current
      .catch(() => {})
      .then(operation)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!__DEV__) return;
    let active = true;
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((stored) => {
        const parsed = parseStoredScales(stored);
        if (active && parsed) setScales(parsed);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const setScale = useCallback((key: SandwichScaleKey, value: number) => {
    if (!__DEV__) return;
    setScales((current) => {
      const next = { ...current, [key]: clampScale(value) };
      enqueueStorageWrite(() => SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next)));
      return next;
    });
  }, [enqueueStorageWrite]);

  const resetAll = useCallback(() => {
    setScales(DEFAULT_SANDWICH_SCALES);
    if (__DEV__) enqueueStorageWrite(() => SecureStore.deleteItemAsync(STORAGE_KEY));
  }, [enqueueStorageWrite]);

  return { scales, setScale, resetAll };
}

/**
 * Scales a section and adjusts its layout height to match the visual result.
 * Widening the unscaled child first keeps the final rendered width aligned to
 * the screen, avoiding the empty gutters produced by a plain scale transform.
 */
export function ScaledSandwichSection({
  children,
  scale,
  style,
}: {
  children: React.ReactNode;
  scale: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [contentHeight, setContentHeight] = useState(0);
  const normalizedScale = clampScale(scale);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    setContentHeight((current) =>
      Math.abs(current - nextHeight) < 0.5 ? current : nextHeight,
    );
  }, []);

  if (Math.abs(normalizedScale - 1) < 0.001) {
    return <View style={style}>{children}</View>;
  }

  const width = `${100 / normalizedScale}%` as `${number}%`;
  return (
    <View
      style={[
        styles.scaleFrame,
        style,
        contentHeight > 0 ? { height: contentHeight * normalizedScale } : null,
      ]}
    >
      <View
        onLayout={handleLayout}
        style={{
          width,
          transform: [{ scale: normalizedScale }],
          transformOrigin: "top left",
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function DevSandwichScaleTool({
  scales,
  onChange,
  onResetAll,
  actionSettings,
  actionDefaultColors,
  onChangeActionColor,
  onChangeActionOpacity,
  onChangeSolidActions,
}: {
  scales: SandwichScales;
  onChange: (key: SandwichScaleKey, value: number) => void;
  onResetAll: () => void;
  actionSettings: SandwichActionSettings;
  /** What each button renders as with no override — drives the "Auto" chip. */
  actionDefaultColors: Record<SandwichActionKey, string>;
  onChangeActionColor: (key: SandwichActionKey, color: string | null) => void;
  onChangeActionOpacity: (key: SandwichActionKey, opacity: number) => void;
  onChangeSolidActions: (solid: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const hasChanges = useMemo(
    () =>
      SCALE_CONTROLS.some(
        ({ key }) =>
          Math.abs(scales[key] - DEFAULT_SANDWICH_SCALES[key]) > 0.001,
      ) || !isDefaultActionSettings(actionSettings),
    [actionSettings, scales],
  );

  if (!__DEV__) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open sandwich scale tool"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          styles.launcher,
          { top: Math.max(insets.top + 92, 132) },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="resize-outline" size={23} color="#FFFFFF" />
      </Pressable>

      <Modal
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={visible}
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close sandwich scale tool"
            onPress={() => setVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.eyebrow}>DEV · SANDWICH SCREEN</Text>
                <Text style={styles.title}>Element scale</Text>
                <Text style={styles.subtitle}>Auto-saved · Tap a percentage to reset it.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close sandwich scale tool"
                hitSlop={8}
                onPress={() => setVisible(false)}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={22} color="#E5E7EB" />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.controlList}
              showsVerticalScrollIndicator={false}
              style={styles.controlScroll}
            >
              {SCALE_CONTROLS.map((control) => {
                const value = scales[control.key];
                const atMinimum = value <= MIN_SCALE;
                const atMaximum = value >= MAX_SCALE;
                return (
                  <View key={control.key} style={styles.controlRow}>
                    <View style={styles.controlCopy}>
                      <Text style={styles.controlLabel}>{control.label}</Text>
                      <Text numberOfLines={1} style={styles.controlHint}>{control.hint}</Text>
                    </View>
                    <View style={styles.stepper}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease ${control.label} scale`}
                        accessibilityState={{ disabled: atMinimum }}
                        disabled={atMinimum}
                        onPress={() => onChange(control.key, value - SCALE_STEP)}
                        style={({ pressed }) => [
                          styles.stepButton,
                          atMinimum && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons name="remove" size={19} color="#E5E7EB" />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Reset ${control.label} scale to default`}
                        accessibilityHint="Restores the built-in scale for this element"
                        onPress={() =>
                          onChange(control.key, DEFAULT_SANDWICH_SCALES[control.key])
                        }
                        style={({ pressed }) => [styles.scaleValue, pressed && styles.pressed]}
                      >
                        <Text style={styles.scaleValueText}>{Math.round(value * 100)}%</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Increase ${control.label} scale`}
                        accessibilityState={{ disabled: atMaximum }}
                        disabled={atMaximum}
                        onPress={() => onChange(control.key, value + SCALE_STEP)}
                        style={({ pressed }) => [
                          styles.stepButton,
                          atMaximum && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons name="add" size={19} color="#E5E7EB" />
                      </Pressable>
                    </View>
                  </View>
                );
              })}

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Action buttons</Text>
                <Text style={styles.sectionHint}>
                  Colour and fill strength for Buy, Buy more, and Sell.
                </Text>
              </View>

              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="Solid action buttons"
                accessibilityState={{ checked: actionSettings.solid }}
                onPress={() => onChangeSolidActions(!actionSettings.solid)}
                style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
              >
                <View style={styles.controlCopy}>
                  <Text style={styles.controlLabel}>Solid fill</Text>
                  <Text numberOfLines={1} style={styles.controlHint}>
                    Drops the glass blur the buttons pick up over content
                  </Text>
                </View>
                <View style={[styles.toggle, actionSettings.solid && styles.toggleOn]}>
                  <View
                    style={[styles.toggleKnob, actionSettings.solid && styles.toggleKnobOn]}
                  />
                </View>
              </Pressable>

              {ACTION_CONTROLS.map((control) => {
                const setting = actionSettings.actions[control.key];
                const activeColor = setting.color ?? actionDefaultColors[control.key];
                const atMinimum = setting.opacity <= MIN_ACTION_OPACITY;
                const atMaximum = setting.opacity >= MAX_ACTION_OPACITY;
                return (
                  <View key={control.key} style={styles.colorRow}>
                    <View style={styles.controlRowTop}>
                      <View style={styles.controlCopy}>
                        <Text style={styles.controlLabel}>{control.label}</Text>
                        <Text numberOfLines={1} style={styles.controlHint}>
                          {control.hint}
                        </Text>
                      </View>
                      <View style={styles.stepper}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Decrease ${control.label} fill opacity`}
                          accessibilityState={{ disabled: atMinimum }}
                          disabled={atMinimum}
                          onPress={() =>
                            onChangeActionOpacity(control.key, setting.opacity - ACTION_OPACITY_STEP)
                          }
                          style={({ pressed }) => [
                            styles.stepButton,
                            atMinimum && styles.disabled,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Ionicons name="remove" size={19} color="#E5E7EB" />
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Reset ${control.label} fill opacity`}
                          onPress={() =>
                            onChangeActionOpacity(
                              control.key,
                              DEFAULT_SANDWICH_ACTION_SETTINGS.actions[control.key].opacity,
                            )
                          }
                          style={({ pressed }) => [styles.scaleValue, pressed && styles.pressed]}
                        >
                          <Text style={styles.scaleValueText}>
                            {Math.round(setting.opacity * 100)}%
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Increase ${control.label} fill opacity`}
                          accessibilityState={{ disabled: atMaximum }}
                          disabled={atMaximum}
                          onPress={() =>
                            onChangeActionOpacity(control.key, setting.opacity + ACTION_OPACITY_STEP)
                          }
                          style={({ pressed }) => [
                            styles.stepButton,
                            atMaximum && styles.disabled,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Ionicons name="add" size={19} color="#E5E7EB" />
                        </Pressable>
                      </View>
                    </View>

                    <ScrollView
                      contentContainerStyle={styles.swatchRow}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Use the theme colour for ${control.label}`}
                        accessibilityState={{ selected: setting.color === null }}
                        onPress={() => onChangeActionColor(control.key, null)}
                        style={({ pressed }) => [
                          styles.swatch,
                          styles.autoSwatch,
                          { backgroundColor: actionDefaultColors[control.key] },
                          setting.color === null && styles.swatchSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.autoSwatchText}>AUTO</Text>
                      </Pressable>
                      {ACTION_SWATCHES.map((swatch) => (
                        <Pressable
                          key={swatch}
                          accessibilityRole="button"
                          accessibilityLabel={`Set ${control.label} to ${swatch}`}
                          accessibilityState={{
                            selected: setting.color?.toUpperCase() === swatch,
                          }}
                          onPress={() => onChangeActionColor(control.key, swatch)}
                          style={({ pressed }) => [
                            styles.swatch,
                            { backgroundColor: swatch },
                            setting.color?.toUpperCase() === swatch && styles.swatchSelected,
                            pressed && styles.pressed,
                          ]}
                        />
                      ))}
                    </ScrollView>

                    <View style={styles.previewRow}>
                      <Text style={styles.previewLabel}>{activeColor.toUpperCase()}</Text>
                      <View
                        style={[
                          styles.previewChip,
                          {
                            backgroundColor: activeColor,
                            opacity: actionSettings.solid ? 1 : setting.opacity,
                          },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset all sandwich scales and action colours"
              accessibilityState={{ disabled: !hasChanges }}
              disabled={!hasChanges}
              onPress={onResetAll}
              style={({ pressed }) => [
                styles.resetButton,
                !hasChanges && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="refresh" size={18} color="#E5E7EB" />
              <Text style={styles.resetText}>Reset all to defaults</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  scaleFrame: { width: "100%", overflow: "visible" },
  launcher: {
    position: "absolute",
    right: 10,
    width: 48,
    height: 48,
    borderRadius: 24,
    zIndex: 10000,
    elevation: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    borderWidth: 1,
    borderColor: "#93C5FD",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.35 },
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.48)" },
  panel: {
    maxHeight: "88%",
    backgroundColor: "#111318",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#30343B",
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: "#93C5FD", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginTop: 2 },
  subtitle: { color: "#9CA3AF", fontSize: 12, lineHeight: 16, marginTop: 2 },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#242830",
    alignItems: "center",
    justifyContent: "center",
  },
  controlScroll: { flexShrink: 1 },
  controlList: { gap: 8, paddingBottom: 12 },
  controlRow: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "#1A1D23",
    borderWidth: 1,
    borderColor: "#30343B",
  },
  controlRowTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  controlCopy: { flex: 1, minWidth: 0 },
  sectionHeader: { marginTop: 10, paddingHorizontal: 4 },
  sectionTitle: { color: "#F3F4F6", fontSize: 15, fontWeight: "900" },
  sectionHint: { color: "#9CA3AF", fontSize: 11, lineHeight: 15, marginTop: 2 },
  toggleRow: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "#1A1D23",
    borderWidth: 1,
    borderColor: "#30343B",
  },
  toggle: {
    width: 50,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: "center",
    backgroundColor: "#292E37",
    borderWidth: 1,
    borderColor: "#3B4350",
  },
  toggleOn: { backgroundColor: "#17263D", borderColor: "#31598E" },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#6B7280",
  },
  toggleKnobOn: { backgroundColor: "#BFDBFE", alignSelf: "flex-end" },
  colorRow: {
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#1A1D23",
    borderWidth: 1,
    borderColor: "#30343B",
  },
  swatchRow: { gap: 8, paddingRight: 4 },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#3B4350",
  },
  swatchSelected: { borderWidth: 3, borderColor: "#BFDBFE" },
  autoSwatch: { width: 52 },
  autoSwatchText: {
    color: "#0B1220",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  previewLabel: {
    color: "#9CA3AF",
    fontSize: 11,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  previewChip: { flex: 1, height: 18, borderRadius: 9 },
  controlLabel: { color: "#F3F4F6", fontSize: 14, lineHeight: 18, fontWeight: "800" },
  controlHint: { color: "#9CA3AF", fontSize: 11, lineHeight: 15, marginTop: 2 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#292E37",
    borderWidth: 1,
    borderColor: "#3B4350",
  },
  scaleValue: {
    minWidth: 58,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#17263D",
    borderWidth: 1,
    borderColor: "#31598E",
  },
  scaleValueText: { color: "#BFDBFE", fontSize: 13, fontWeight: "900", fontVariant: ["tabular-nums"] },
  resetButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    backgroundColor: "#242830",
    borderWidth: 1,
    borderColor: "#39404A",
  },
  resetText: { color: "#E5E7EB", fontSize: 13, fontWeight: "800" },
});
