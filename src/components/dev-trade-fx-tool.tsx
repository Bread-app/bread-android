import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePaperMode } from '@/lib/paper-mode';
import { playPerpFx, type PerpFxEvent } from '@/lib/trade-fx';
import { Fonts } from '@/constants/theme';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

/**
 * Dev-only harness for the trade receipt.
 *
 * The perps success screen used to be reachable exactly one way: place a real
 * order, with real collateral, on a real position you then had to unwind. That
 * made a one-line copy tweak a round trip through the chain, so the screen
 * went unpolished for a long time.
 *
 * Two ways in from here, and neither of them trades:
 *
 *  - the variant list fires `playPerpFx` directly with made-up numbers, which
 *    covers the edge cases a live order rarely produces on demand (a 100x
 *    entry, a five-figure loss, a symbol long enough to wrap).
 *  - the Paper mode switch flips `isPaperMode`, so the *real* order pad runs
 *    its real validation and sizing and then plays the receipt off what you
 *    typed instead of signing. That is the one that catches the bugs the
 *    variant list can't — wrong field plumbed through, pad left open, a
 *    spinner that never clears.
 *
 * Gated on `__DEV__` at the top of the component and again inside
 * `paper-mode`, so nothing here exists in a release bundle.
 */

const GREEN = '#35F046';
const CHERRY_RED = '#FF1F4B';

type Variant = {
  key: string;
  label: string;
  hint: string;
  accent: string;
  event: (symbol: string, leverage: number) => PerpFxEvent;
};

const VARIANTS: Variant[] = [
  {
    key: 'long',
    label: 'Open long',
    hint: 'Green badge, fill + margin',
    accent: GREEN,
    event: (symbol, leverage) => ({
      action: 'open',
      side: 'long',
      symbol,
      name: symbol,
      leverage,
      entryPrice: 248.31,
      marginUsd: 120,
    }),
  },
  {
    key: 'short',
    label: 'Open short',
    hint: 'Pink badge, fill + margin',
    accent: CHERRY_RED,
    event: (symbol, leverage) => ({
      action: 'open',
      side: 'short',
      symbol,
      name: symbol,
      leverage,
      entryPrice: 248.31,
      marginUsd: 120,
    }),
  },
  {
    key: 'close-win',
    label: 'Close in profit',
    hint: 'Payout headline, entry → exit ledger',
    accent: GREEN,
    event: (symbol, leverage) => ({
      action: 'close',
      side: 'long',
      symbol,
      name: symbol,
      leverage,
      entryPrice: 214.88,
      exitPrice: 289.42,
      marginUsd: 120,
      pnlUsd: 418.62,
    }),
  },
  {
    key: 'close-loss',
    label: 'Close at a loss',
    hint: 'Pink ledger on a short',
    accent: CHERRY_RED,
    event: (symbol, leverage) => ({
      action: 'close',
      side: 'short',
      symbol,
      name: symbol,
      leverage,
      entryPrice: 261.04,
      exitPrice: 279.51,
      marginUsd: 120,
      pnlUsd: -87.15,
    }),
  },
  {
    key: 'sub-dollar',
    label: 'Sub-dollar asset',
    hint: 'Price precision at $0.000042',
    accent: GREEN,
    event: (symbol, leverage) => ({
      action: 'open',
      side: 'long',
      symbol,
      name: symbol,
      leverage,
      entryPrice: 0.000042,
      marginUsd: 25,
    }),
  },
  {
    key: 'bare',
    label: 'No leverage / no fill',
    hint: 'Badge only — stats row must vanish',
    accent: GREEN,
    event: (symbol) => ({
      action: 'open',
      side: 'long',
      symbol,
      name: symbol,
      leverage: null,
      entryPrice: null,
      marginUsd: null,
    }),
  },
];

export function DevTradeFxTool() {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [paperMode, setPaperMode] = usePaperMode();
  const [symbol, setSymbol] = useState('TSLA');
  const [leverage, setLeverage] = useState(10);

  if (!__DEV__) return null;

  const play = (variant: Variant) => {
    // Close first: the receipt is a full-screen modal, and firing it from under
    // this one leaves two modals stacked with the wrong one on top.
    setVisible(false);
    setTimeout(() => {
      playPerpFx(variant.event(symbol.trim().toUpperCase() || 'TSLA', leverage));
    }, 260);
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Open trade FX tool"
        onPress={() => setVisible(true)}
        style={[styles.launcher, { top: Math.max(insets.top + 148, 188) }]}
      >
        <Ionicons name="flash-outline" size={22} color="#FFFFFF" />
      </PressableScale>

      <Modal
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={visible}
        onRequestClose={() => setVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <Pressable
            style={[styles.panel, { marginTop: insets.top + 60, marginBottom: insets.bottom + 40 }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.header}>
              <Text style={styles.title}>Trade receipt</Text>
              <Pressable onPress={() => setVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color="#94a3b8" />
              </Pressable>
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.paperRow}>
                <View style={styles.paperCopy}>
                  <Text style={styles.paperTitle}>Paper mode</Text>
                  <Text style={styles.paperHint}>
                    The real Long/Short button stops before signing and plays the receipt off
                    your typed values. No collateral moves.
                  </Text>
                </View>
                <Switch
                  value={paperMode}
                  onValueChange={setPaperMode}
                  trackColor={{ false: '#cbd5f5', true: GREEN }}
                />
              </View>

              <View style={styles.fieldRow}>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Symbol</Text>
                  <TextInput
                    value={symbol}
                    onChangeText={setSymbol}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={styles.input}
                    placeholder="TSLA"
                    placeholderTextColor="#94a3b8"
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Leverage</Text>
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => setLeverage((value) => Math.max(1, value - 1))}
                      hitSlop={8}
                      style={styles.stepperButton}
                    >
                      <Ionicons name="remove" size={18} color="#0B1622" />
                    </Pressable>
                    <Text style={styles.stepperValue}>{leverage}×</Text>
                    <Pressable
                      onPress={() => setLeverage((value) => Math.min(100, value + 1))}
                      hitSlop={8}
                      style={styles.stepperButton}
                    >
                      <Ionicons name="add" size={18} color="#0B1622" />
                    </Pressable>
                  </View>
                </View>
              </View>

              <Text style={styles.sectionLabel}>Play a variant</Text>
              {VARIANTS.map((variant) => (
                <Pressable
                  key={variant.key}
                  onPress={() => play(variant)}
                  style={({ pressed }) => [styles.variant, pressed && styles.variantPressed]}
                >
                  <View style={[styles.variantDot, { backgroundColor: variant.accent }]} />
                  <View style={styles.variantCopy}>
                    <Text style={styles.variantLabel}>{variant.label}</Text>
                    <Text style={styles.variantHint}>{variant.hint}</Text>
                  </View>
                  <Ionicons name="play" size={16} color="#94a3b8" />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  launcher: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,22,34,0.86)',
    zIndex: 9999,
  },
  pressed: {
    opacity: 0.7,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,11,16,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  title: {
    fontFamily: F,
    fontSize: 20,
    fontWeight: '900',
    color: '#0B1622',
    letterSpacing: -0.4,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    gap: 12,
  },
  paperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
  },
  paperCopy: {
    flex: 1,
    gap: 3,
  },
  paperTitle: {
    fontFamily: F,
    fontSize: 16,
    fontWeight: '900',
    color: '#0B1622',
  },
  paperHint: {
    fontFamily: F,
    fontSize: 12,
    lineHeight: 16,
    color: '#64748b',
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 12,
  },
  field: {
    flex: 1,
    gap: 6,
  },
  fieldLabel: {
    fontFamily: F,
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.4,
  },
  input: {
    fontFamily: F,
    fontSize: 17,
    fontWeight: '900',
    color: '#0B1622',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
  },
  stepperButton: {
    width: 26,
    alignItems: 'center',
  },
  stepperValue: {
    fontFamily: F,
    fontSize: 17,
    fontWeight: '900',
    color: '#0B1622',
  },
  sectionLabel: {
    marginTop: 6,
    fontFamily: F,
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.4,
  },
  variant: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
  },
  variantPressed: {
    backgroundColor: '#E2E8F0',
  },
  variantDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  variantCopy: {
    flex: 1,
    gap: 2,
  },
  variantLabel: {
    fontFamily: F,
    fontSize: 15,
    fontWeight: '900',
    color: '#0B1622',
  },
  variantHint: {
    fontFamily: F,
    fontSize: 12,
    color: '#64748b',
  },
});
