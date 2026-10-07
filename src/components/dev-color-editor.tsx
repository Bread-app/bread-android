import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type ThemeColor } from '@/constants/theme';
import {
  contrastRatio,
  hsvaToColor,
  parseColor,
  rgbaToHsva,
  type HsvaColor,
} from '@/lib/color-utils';
import { useThemePreview, useThemeStore } from '@/lib/theme-store';

type TokenOption = { token: ThemeColor; label: string };
type TokenGroup = { label: string; options: TokenOption[] };

const TOKEN_GROUPS: TokenGroup[] = [
  {
    label: 'Canvas',
    options: [
      { token: 'background', label: 'Background' },
      { token: 'backgroundAlt', label: 'Alt background' },
      { token: 'surface', label: 'Cards' },
      { token: 'surfaceAlt', label: 'Secondary surface' },
      { token: 'surfaceSelected', label: 'Selected surface' },
    ],
  },
  {
    label: 'Text',
    options: [
      { token: 'text', label: 'Primary text' },
      { token: 'textSecondary', label: 'Secondary text' },
      { token: 'textTertiary', label: 'Muted text' },
      { token: 'textQuaternary', label: 'Decorative text' },
      { token: 'textInverse', label: 'Inverse text' },
    ],
  },
  {
    label: 'Actions',
    options: [
      { token: 'actionPrimary', label: 'Primary button' },
      { token: 'actionPrimaryText', label: 'Primary button text' },
      { token: 'actionBuy', label: 'Buy action' },
      { token: 'actionSell', label: 'Sell / negative' },
    ],
  },
  {
    label: 'Charts',
    options: [
      { token: 'chartPositive', label: 'Positive line' },
      { token: 'chartNegative', label: 'Negative line' },
      { token: 'chartNeutral', label: 'Neutral chart' },
      { token: 'chartGrid', label: 'Grid' },
      { token: 'chartCrosshair', label: 'Crosshair' },
    ],
  },
  {
    label: 'Chrome',
    options: [
      { token: 'border', label: 'Borders' },
      { token: 'icon', label: 'Icons' },
      { token: 'iconMuted', label: 'Muted icons' },
    ],
  },
];

const DEFAULT_RECENTS = ['#38BDF8', '#35F046', '#FF1AB8', '#FFFFFF', '#0B1622'];
const HUE_COLORS = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'] as const;

function readableToken(token: ThemeColor) {
  return TOKEN_GROUPS.flatMap((group) => group.options).find((option) => option.token === token)?.label ?? token;
}

export function DevColorEditor() {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useThemeStore();
  const {
    previewRouteKey,
    previewOverrides,
    setPreviewColor,
    resetCurrentPreview,
    resetAllPreviews,
  } = useThemePreview();
  const [visible, setVisible] = useState(false);
  const [selectedToken, setSelectedToken] = useState<ThemeColor>('actionSell');
  const [hsva, setHsva] = useState<HsvaColor>(() => rgbaToHsva(parseColor(colors.actionSell)!));
  const [inputValue, setInputValue] = useState(colors.actionSell);
  const [inputError, setInputError] = useState<string | null>(null);
  const [svSize, setSvSize] = useState({ width: 1, height: 1 });
  const [hueWidth, setHueWidth] = useState(1);
  const [alphaWidth, setAlphaWidth] = useState(1);
  const [recents, setRecents] = useState(DEFAULT_RECENTS);

  const selectedColor = colors[selectedToken];
  useEffect(() => {
    const parsed = parseColor(selectedColor);
    if (!parsed) return;
    setHsva(rgbaToHsva(parsed));
    setInputValue(selectedColor);
    setInputError(null);
  }, [selectedColor, selectedToken]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      setRecents((current) => [selectedColor, ...current.filter((color) => color !== selectedColor)].slice(0, 8));
    }, 350);
    return () => clearTimeout(timer);
  }, [selectedColor, visible]);

  const updateColor = (next: HsvaColor) => {
    setHsva(next);
    setPreviewColor(selectedToken, hsvaToColor(next));
  };

  const updateSv = (event: GestureResponderEvent) => {
    updateColor({
      ...hsva,
      s: Math.max(0, Math.min(1, event.nativeEvent.locationX / svSize.width)),
      v: 1 - Math.max(0, Math.min(1, event.nativeEvent.locationY / svSize.height)),
    });
  };

  const updateHue = (event: GestureResponderEvent) => {
    updateColor({ ...hsva, h: Math.max(0, Math.min(359.99, (event.nativeEvent.locationX / hueWidth) * 360)) });
  };

  const updateAlpha = (event: GestureResponderEvent) => {
    updateColor({ ...hsva, a: Math.max(0, Math.min(1, event.nativeEvent.locationX / alphaWidth)) });
  };

  const commitInput = () => {
    const parsed = parseColor(inputValue);
    if (!parsed) {
      setInputError('Use #RGB, #RRGGBB, #RRGGBBAA, rgb(), or rgba().');
      return;
    }
    setInputError(null);
    setHsva(rgbaToHsva(parsed));
    setPreviewColor(selectedToken, inputValue.trim());
  };

  const contrast = useMemo(() => {
    if (selectedToken === 'actionPrimaryText') {
      return contrastRatio(colors.actionPrimaryText, colors.actionPrimary);
    }
    if (
      selectedToken === 'text' ||
      selectedToken === 'textSecondary' ||
      selectedToken === 'textTertiary' ||
      selectedToken === 'textQuaternary'
    ) {
      return contrastRatio(colors[selectedToken], colors.background);
    }
    return null;
  }, [colors, selectedToken]);

  const hueColor = hsvaToColor({ h: hsva.h, s: 1, v: 1, a: 1 });
  const opaqueColor = hsvaToColor({ ...hsva, a: 1 });
  const hasCurrentOverrides = Object.keys(previewOverrides).length > 0;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open color editor"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          styles.launcher,
          { top: Math.max(insets.top + 92, 132) },
          pressed && styles.pressed,
        ]}
      >
        <LinearGradient colors={['#38BDF8', '#8B5CF6', '#FF1AB8']} style={styles.launcherFill}>
          <Ionicons name="color-palette" size={22} color="#FFFFFF" />
        </LinearGradient>
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
            accessibilityLabel="Close color editor"
            onPress={() => setVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.eyebrow}>DEV THEME LAB · {scheme.toUpperCase()}</Text>
                <Text style={styles.title}>Color editor</Text>
                <Text style={styles.route} numberOfLines={1}>{previewRouteKey}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close color editor"
                hitSlop={8}
                onPress={() => setVisible(false)}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={22} color="#E5E7EB" />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {TOKEN_GROUPS.map((group) => (
                <View key={group.label} style={styles.group}>
                  <Text style={styles.groupLabel}>{group.label}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tokenRow}>
                    {group.options.map(({ token, label }) => {
                      const selected = token === selectedToken;
                      return (
                        <Pressable
                          key={token}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          accessibilityLabel={`Edit ${label}`}
                          onPress={() => setSelectedToken(token)}
                          style={({ pressed }) => [
                            styles.token,
                            selected && styles.tokenSelected,
                            pressed && styles.pressed,
                          ]}
                        >
                          <View style={[styles.tokenSwatch, { backgroundColor: colors[token] }]} />
                          <Text style={[styles.tokenLabel, selected && styles.tokenLabelSelected]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ))}

              <View style={styles.editorHeader}>
                <Text style={styles.editorLabel}>{readableToken(selectedToken)}</Text>
                <Text style={styles.editorValue}>{selectedColor}</Text>
              </View>

              <View
                accessibilityLabel="Saturation and brightness picker"
                accessibilityRole="adjustable"
                accessibilityValue={{
                  text: `${Math.round(hsva.s * 100)}% saturation, ${Math.round(hsva.v * 100)}% brightness`,
                }}
                onLayout={(event: LayoutChangeEvent) => setSvSize(event.nativeEvent.layout)}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={updateSv}
                onResponderMove={updateSv}
                style={[styles.svField, { backgroundColor: hueColor }]}
              >
                <LinearGradient colors={['#FFFFFF', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                <LinearGradient colors={['rgba(0,0,0,0)', '#000000']} style={StyleSheet.absoluteFill} />
                <View
                  pointerEvents="none"
                  style={[
                    styles.pickerThumb,
                    {
                      left: hsva.s * svSize.width - 10,
                      top: (1 - hsva.v) * svSize.height - 10,
                      backgroundColor: selectedColor,
                    },
                  ]}
                />
              </View>

              <Text style={styles.controlLabel}>Hue</Text>
              <View
                accessibilityLabel="Hue slider"
                accessibilityRole="adjustable"
                accessibilityValue={{ min: 0, max: 360, now: Math.round(hsva.h), text: `${Math.round(hsva.h)} degrees` }}
                onLayout={(event) => setHueWidth(event.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={updateHue}
                onResponderMove={updateHue}
                style={styles.slider}
              >
                <LinearGradient colors={HUE_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sliderFill} />
                <View pointerEvents="none" style={[styles.sliderThumb, { left: (hsva.h / 360) * hueWidth - 9 }]} />
              </View>

              <Text style={styles.controlLabel}>Opacity · {Math.round(hsva.a * 100)}%</Text>
              <View
                accessibilityLabel="Opacity slider"
                accessibilityRole="adjustable"
                accessibilityValue={{ min: 0, max: 100, now: Math.round(hsva.a * 100), text: `${Math.round(hsva.a * 100)} percent` }}
                onLayout={(event) => setAlphaWidth(event.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={updateAlpha}
                onResponderMove={updateAlpha}
                style={[styles.slider, styles.alphaTrack]}
              >
                <LinearGradient colors={['rgba(255,255,255,0)', opaqueColor]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sliderFill} />
                <View pointerEvents="none" style={[styles.sliderThumb, { left: hsva.a * alphaWidth - 9 }]} />
              </View>

              <Text style={styles.controlLabel}>Hex or RGBA</Text>
              <TextInput
                accessibilityLabel={`${readableToken(selectedToken)} color value`}
                autoCapitalize="characters"
                autoCorrect={false}
                onBlur={commitInput}
                onChangeText={(value) => {
                  setInputValue(value);
                  if (inputError) setInputError(null);
                }}
                onSubmitEditing={() => {
                  commitInput();
                  Keyboard.dismiss();
                }}
                returnKeyType="done"
                selectTextOnFocus
                spellCheck={false}
                style={[styles.input, inputError && styles.inputError]}
                value={inputValue}
              />
              {inputError ? <Text style={styles.errorText}>{inputError}</Text> : null}
              {contrast !== null ? (
                <Text style={[styles.contrastText, contrast < 4.5 && styles.contrastWarning]}>
                  Contrast {contrast.toFixed(2)}:1{contrast < 4.5 ? ' · below AA for body text' : ' · passes AA'}
                </Text>
              ) : null}

              <Text style={styles.controlLabel}>Recent</Text>
              <View style={styles.recentRow}>
                {recents.map((color, index) => (
                  <Pressable
                    key={`${color}-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Use recent color ${color}`}
                    onPress={() => {
                      const parsed = parseColor(color);
                      if (!parsed) return;
                      setHsva(rgbaToHsva(parsed));
                      setPreviewColor(selectedToken, color);
                    }}
                    style={({ pressed }) => [styles.recentButton, pressed && styles.pressed]}
                  >
                    <View style={[styles.recentSwatch, { backgroundColor: color }]} />
                  </Pressable>
                ))}
              </View>

              <View style={styles.resetRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={!hasCurrentOverrides}
                  onPress={resetCurrentPreview}
                  style={({ pressed }) => [
                    styles.resetButton,
                    !hasCurrentOverrides && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.resetText}>Reset this screen</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={resetAllPreviews}
                  style={({ pressed }) => [styles.resetButton, styles.resetAllButton, pressed && styles.pressed]}
                >
                  <Text style={styles.resetAllText}>Reset all</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  launcher: {
    position: 'absolute', right: 10, width: 48, height: 48, borderRadius: 24,
    zIndex: 9999, elevation: 20, overflow: 'hidden', shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.24, shadowRadius: 10,
  },
  launcherFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' },
  panel: {
    maxHeight: '88%', backgroundColor: '#111318', borderTopLeftRadius: 24,
    borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#30343B',
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#7DD3FC', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', marginTop: 2 },
  route: { color: '#8B93A1', fontSize: 12, marginTop: 2 },
  closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#242830', alignItems: 'center', justifyContent: 'center' },
  group: { marginBottom: 10 },
  groupLabel: { color: '#8B93A1', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 7 },
  tokenRow: { gap: 8, paddingRight: 12 },
  token: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, borderWidth: 1, borderColor: '#30343B', paddingHorizontal: 10, backgroundColor: '#1A1D23' },
  tokenSelected: { borderColor: '#38BDF8', backgroundColor: '#172632' },
  tokenSwatch: { width: 16, height: 16, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#FFFFFF66' },
  tokenLabel: { color: '#AAB1BC', fontSize: 12, fontWeight: '700' },
  tokenLabelSelected: { color: '#EAF8FF' },
  editorHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8, marginBottom: 10 },
  editorLabel: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  editorValue: { color: '#9CA3AF', fontSize: 12, fontWeight: '600' },
  svField: { height: 170, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#FFFFFF22' },
  pickerThumb: { position: 'absolute', width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#000000', shadowOpacity: 0.5, shadowRadius: 3 },
  controlLabel: { color: '#C7CDD6', fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 7 },
  slider: { height: 40, justifyContent: 'center' },
  sliderFill: { height: 14, borderRadius: 7, overflow: 'hidden' },
  sliderThumb: { position: 'absolute', top: 10, width: 18, height: 20, borderRadius: 9, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#111318' },
  alphaTrack: { backgroundColor: '#252A32', borderRadius: 10, paddingHorizontal: 0 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#39404A', backgroundColor: '#1A1D23', color: '#FFFFFF', paddingHorizontal: 14, fontSize: 15, fontWeight: '700' },
  inputError: { borderColor: '#FF33C9' },
  errorText: { color: '#FF66D4', fontSize: 12, marginTop: 6 },
  contrastText: { color: '#86EFAC', fontSize: 12, marginTop: 7 },
  contrastWarning: { color: '#FBBF24' },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentButton: { width: 42, height: 42, borderRadius: 12, padding: 4, backgroundColor: '#242830' },
  recentSwatch: { flex: 1, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#FFFFFF55' },
  resetRow: { flexDirection: 'row', gap: 10, marginTop: 20, marginBottom: 6 },
  resetButton: { minHeight: 46, flex: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#242830', borderWidth: 1, borderColor: '#39404A' },
  resetAllButton: { backgroundColor: 'rgba(255,26,184,0.16)', borderColor: 'rgba(255,26,184,0.4)' },
  resetText: { color: '#E5E7EB', fontWeight: '800', fontSize: 13 },
  resetAllText: { color: '#FF66D4', fontWeight: '800', fontSize: 13 },
  disabled: { opacity: 0.38 },
});
