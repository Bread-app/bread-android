import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SkeletonRows } from "@/components/skeleton-rows";
import { AssetLogo } from "@/components/asset-logo";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CTA, ctaBottomInset } from '@/lib/screen-corners';
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemeStore } from "@/lib/theme-store";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import {
  createManualSandwich,
  createCuratedEntry,
  uploadCuratedCoverImageMobile,
  getTopHolderStocks,
  type AppUserPayload,
  type Stock,
} from "@/lib/api";

const F = Fonts.rounded;
const { width: SW } = Dimensions.get("window");
const HERO_HEIGHT = SW * 0.56;

type SelectedStock = {
  stock: Stock;
  weightPct: number; // 0–100, integers, sum = 100
};

type Props = {
  visible: boolean;
  onClose: () => void;
  userPayload: AppUserPayload | null;
};

function equalWeights(count: number): number[] {
  if (count === 0) return [];
  const base = Math.floor(100 / count);
  const rem = 100 - base * count;
  return Array.from({ length: count }, (_, i) => base + (i === 0 ? rem : 0));
}

// Nudge one stock's weight by ±1% and balance it against a single counterpart
// (the largest of the other stocks) so the basket always totals 100% and only
// two rows move by exactly 1% per tap — smooth and predictable.
function nudgeWeight(selected: SelectedStock[], idx: number, delta: number): SelectedStock[] {
  if (selected.length <= 1) return selected; // single holding is fixed at 100%
  const target = selected[idx].weightPct + delta;
  if (target < 1 || target > 100) return selected;

  // Counterpart: the other holding with the highest weight. When increasing we
  // also require it to stay ≥ 1 after giving up 1%.
  let j = -1;
  let best = -1;
  selected.forEach((s, i) => {
    if (i === idx) return;
    if (delta > 0 && s.weightPct <= 1) return;
    if (s.weightPct > best) {
      best = s.weightPct;
      j = i;
    }
  });
  if (j === -1) return selected;

  return selected.map((s, i) => {
    if (i === idx) return { ...s, weightPct: s.weightPct + delta };
    if (i === j) return { ...s, weightPct: s.weightPct - delta };
    return s;
  });
}

export function CreateCuratedSandwichScreen({ visible, onClose, userPayload }: Props) {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();

  // Editable card fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [coverUri, setCoverUri] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedStock[]>([]);

  // Stock picker modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allStocks, setAllStocks] = useState<Stock[]>([]);
  const [stocksLoading, setStocksLoading] = useState(false);
  const [stockSearch, setStockSearch] = useState("");
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [publishing, setPublishing] = useState(false);

  const loadStocks = useCallback(async (query = "") => {
    const q = query.trim();
    setStocksLoading(true);
    try {
      // With a query → full-catalog server search; without → curated top list.
      const rows = q
        ? await getTopHolderStocks({ q, limit: 50 })
        : await getTopHolderStocks({ limit: 100, type: "xstock" });
      setAllStocks(rows);
    } catch {
      // ignore
    } finally {
      setStocksLoading(false);
    }
  }, []);

  // Load the default list the first time the picker opens.
  useEffect(() => {
    if (pickerOpen && allStocks.length === 0) void loadStocks();
  }, [pickerOpen, allStocks.length, loadStocks]);

  function onSearchChange(q: string) {
    setStockSearch(q);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => void loadStocks(q), 280);
  }

  function toggleStock(stock: Stock) {
    const idx = selected.findIndex((s) => s.stock.id === stock.id);
    if (idx >= 0) {
      const next = selected.filter((s) => s.stock.id !== stock.id);
      const weights = equalWeights(next.length);
      setSelected(next.map((s, i) => ({ ...s, weightPct: weights[i] })));
    } else {
      if (selected.length >= 8) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert("Max 8 stocks", "Remove a stock before adding another.");
        return;
      }
      const next = [...selected, { stock, weightPct: 0 }];
      const weights = equalWeights(next.length);
      setSelected(next.map((s, i) => ({ ...s, weightPct: weights[i] })));
    }
  }

  function adjustWeight(idx: number, delta: number) {
    setSelected((prev) => nudgeWeight(prev, idx, delta));
  }

  async function pickCover() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      setCoverUri(result.assets[0].uri);
    }
  }

  async function handlePublish() {
    if (!name.trim()) { Alert.alert("Name your portfolio first"); return; }
    if (selected.length < 1) { Alert.alert("Add at least one stock"); return; }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    Keyboard.dismiss();
    setPublishing(true);
    try {
      const sandwich = await createManualSandwich(
        {
          name: name.trim(),
          summary: description.trim() || name.trim(),
          horizon: "Medium to long term",
          direction: "up",
          confidence: "high",
          legs: selected.map((s) => ({
            type: "tokenized_stock" as const,
            label: s.stock.name,
            symbol: s.stock.symbol,
            mint: s.stock.id,
            side: "long",
            weightBps: Math.round(s.weightPct * 100),
            priceUsd: s.stock.usdPrice ?? null,
            volume24hUsd: s.stock.volume24h ?? null,
            holderCount: s.stock.holderCount ?? null,
            reason: `Part of "${name.trim()}" curated portfolio`,
          })),
          warnings: [],
        },
        userPayload,
      );

      const curated = await createCuratedEntry(
        sandwich.id,
        name.trim(),
        null,
      );

      if (coverUri) {
        await uploadCuratedCoverImageMobile(curated.id, coverUri);
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Published!", `"${name.trim()}" is now live.`, [
        { text: "Done", onPress: handleClose },
      ]);
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Failed to publish", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setPublishing(false);
    }
  }

  function handleClose() {
    setName("");
    setDescription("");
    setSelected([]);
    setCoverUri(null);
    setStockSearch("");
    setPickerOpen(false);
    onClose();
  }

  const weightTotal = selected.reduce((sum, s) => sum + s.weightPct, 0);
  const canPublish = name.trim().length >= 2 && selected.length >= 1 && !publishing;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={styles.root}>
        {/* Close */}
        <Pressable onPress={handleClose} style={[styles.closeBtn, { top: insets.top + 8 }]} hitSlop={8}>
          <Ionicons name="close" size={20} color={colors.textInverse} />
        </Pressable>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Hero: tap to add image, editable green-highlight title ── */}
          <Pressable style={styles.hero} onPress={() => void pickCover()}>
            {coverUri ? (
              <Image source={{ uri: coverUri }} style={styles.coverImage} />
            ) : (
              <View style={styles.coverEmpty}>
                <Ionicons name="image-outline" size={34} color="rgba(255,255,255,0.9)" />
                <Text style={styles.coverEmptyText}>Tap to add cover image</Text>
              </View>
            )}
            <View style={styles.heroScrim} />

            {/* Change-image chip when an image is set */}
            {coverUri ? (
              <View style={styles.changeChip}>
                <Ionicons name="camera" size={13} color={colors.text} />
                <Text style={styles.changeChipText}>Change</Text>
              </View>
            ) : null}

            {/* Editable marker-highlight title */}
            <View style={styles.heroLabel}>
              <View style={styles.heroTitleChip}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Name your portfolio"
                  placeholderTextColor="rgba(0,0,0,0.45)"
                  style={styles.heroTitleInput}
                  maxLength={42}
                  multiline
                />
              </View>
            </View>
          </Pressable>

          {/* ── Thesis / description ── */}
          <View style={[styles.section, styles.sectionFirst]}>
            <Text style={styles.sectionLabel}>Thesis</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What is this portfolio about? Write the thesis the way it should read on the card…"
              placeholderTextColor="#94a3b8"
              style={styles.descriptionInput}
              multiline
              maxLength={400}
              textAlignVertical="top"
            />
          </View>

          {/* ── Allocation: each stock's % of the basket ── */}
          <View style={styles.section}>
            <View style={styles.holdingsHeader}>
              <Text style={styles.sectionHeader}>Allocation</Text>
              <Pressable
                style={styles.addStockBtn}
                onPress={() => { Keyboard.dismiss(); setPickerOpen(true); }}
              >
                <Ionicons name="add" size={16} color={colors.text} />
                <Text style={styles.addStockBtnText}>Add stock</Text>
              </Pressable>
            </View>

            {selected.length === 0 ? (
              <Pressable style={styles.holdingsEmpty} onPress={() => setPickerOpen(true)}>
                <Text style={styles.holdingsEmptyText}>No stocks yet — tap “Add stock” to build the basket (up to 8), then set each one’s % of the basket.</Text>
              </Pressable>
            ) : (
              <>
                <View style={styles.allocSummary}>
                  <Text style={styles.allocSummaryLabel}>{selected.length}/8 stocks · % of basket</Text>
                  <Text style={[styles.allocSummaryTotal, weightTotal !== 100 && styles.allocSummaryTotalOff]}>
                    {weightTotal}%
                  </Text>
                </View>
                {selected.map((s, idx) => (
                  <View key={s.stock.id} style={styles.allocRow}>
                    <View style={styles.allocTopRow}>
                      <AssetLogo
                        uri={s.stock.icon}
                        size={36}
                        borderRadius={18}
                        backgroundColor={colors.border}
                        fallback={
                          <View style={[styles.legIcon, styles.legIconFallback]}>
                            <Text style={styles.legIconLetter}>{s.stock.symbol.slice(0, 1)}</Text>
                          </View>
                        }
                      />
                      <View style={styles.legInfo}>
                        <Text style={styles.legSymbol}>{s.stock.symbol.replace(/(ON|X)$/i, "")}</Text>
                        <Text style={styles.legLabel} numberOfLines={1}>{s.stock.name}</Text>
                      </View>
                      <View style={styles.weightCtl}>
                        <Pressable onPress={() => adjustWeight(idx, -1)} style={styles.weightBtn} hitSlop={6}>
                          <Text style={styles.weightBtnText}>−</Text>
                        </Pressable>
                        <Text style={styles.weightPct}>{s.weightPct}%</Text>
                        <Pressable onPress={() => adjustWeight(idx, 1)} style={styles.weightBtn} hitSlop={6}>
                          <Text style={styles.weightBtnText}>+</Text>
                        </Pressable>
                      </View>
                      <Pressable onPress={() => toggleStock(s.stock)} hitSlop={8} style={styles.removeBtn}>
                        <Ionicons name="close-circle" size={20} color={colors.iconMuted} />
                      </Pressable>
                    </View>
                    {/* Allocation bar */}
                    <View style={styles.allocBarTrack}>
                      <View style={[styles.allocBarFill, { width: `${Math.max(0, Math.min(100, s.weightPct))}%` }]} />
                    </View>
                  </View>
                ))}
              </>
            )}
          </View>
        </ScrollView>

        {/* ── Bottom publish bar (replaces the Trade button) ── */}
        <View style={[styles.bottomBar, { paddingBottom: ctaBottomInset(insets.bottom) }]}>
          <Pressable
            style={[styles.publishBtn, !canPublish && styles.publishBtnDisabled]}
            onPress={() => void handlePublish()}
            disabled={!canPublish}
          >
            {publishing ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <Text style={styles.publishBtnText}>Publish Portfolio</Text>
            )}
          </Pressable>
        </View>

        {/* ── Stock picker modal ── */}
        <Modal visible={pickerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickerOpen(false)}>
          <SafeAreaView style={styles.root}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Add stocks</Text>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={8}>
                <Text style={styles.pickerDone}>Done</Text>
              </Pressable>
            </View>

            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.textTertiary} />
              <TextInput
                style={styles.searchInput}
                value={stockSearch}
                onChangeText={onSearchChange}
                placeholder="Search stocks…"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
              />
            </View>

            <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
              {stocksLoading ? (
                <SkeletonRows count={8} accessibilityLabel="Loading stocks" />
              ) : (
                allStocks.map((stock) => {
                  const isSelected = selected.some((s) => s.stock.id === stock.id);
                  return (
                    <Pressable
                      key={stock.id}
                      style={[styles.stockRow, isSelected && styles.stockRowSelected]}
                      onPress={() => toggleStock(stock)}
                    >
                      <AssetLogo
                        uri={stock.icon}
                        size={36}
                        borderRadius={18}
                        backgroundColor={colors.border}
                        fallback={
                          <View style={[styles.stockIcon, styles.legIconFallback]}>
                            <Text style={styles.legIconLetter}>{stock.symbol.slice(0, 1)}</Text>
                          </View>
                        }
                      />
                      <View style={styles.legInfo}>
                        <Text style={styles.legSymbol}>{stock.symbol.replace(/(ON|X)$/i, "")}</Text>
                        <Text style={styles.legLabel} numberOfLines={1}>{stock.name}</Text>
                      </View>
                      {stock.usdPrice ? (
                        <Text style={styles.stockPrice}>
                          ${stock.usdPrice < 1 ? stock.usdPrice.toFixed(4) : stock.usdPrice.toFixed(2)}
                        </Text>
                      ) : null}
                      <Ionicons
                        name={isSelected ? "checkmark-circle" : "add-circle-outline"}
                        size={22}
                        color={isSelected ? colors.accent : colors.iconMuted}
                      />
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  scroll: { flex: 1 },
  closeBtn: {
    position: "absolute",
    right: 16,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },

  hero: {
    height: HERO_HEIGHT,
    backgroundColor: c.text,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  coverImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%", resizeMode: "cover" },
  coverEmpty: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 8 },
  coverEmptyText: { fontFamily: F, fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.9)" },
  heroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.18)" },
  changeChip: {
    position: "absolute",
    top: 14,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  changeChipText: { fontFamily: F, fontSize: 12, fontWeight: "700", color: "#000000" },
  heroLabel: { position: "absolute", bottom: 18, left: 14, right: 40, alignItems: "flex-start" },
  heroTitleChip: { backgroundColor: "#35F046", paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start" },
  heroTitleInput: { fontFamily: F, fontSize: 28, fontWeight: "900", color: "#000000", padding: 0, minWidth: 200 },

  section: { paddingHorizontal: 20, paddingTop: 18 },
  sectionFirst: { paddingTop: 22 },
  sectionLabel: { fontFamily: F, fontSize: 12, fontWeight: "700", color: c.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  sectionHeader: { fontFamily: F, fontSize: 15, fontWeight: "700", color: c.text },

  descriptionInput: {
    minHeight: 92,
    backgroundColor: c.backgroundAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 14,
    padding: 14,
    fontFamily: F,
    fontSize: 15,
    lineHeight: 22,
    color: c.text,
  },

  holdingsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  addStockBtn: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#35F046", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  addStockBtnText: { fontFamily: F, fontSize: 13, fontWeight: "800", color: "#000000" },
  holdingsEmpty: { borderRadius: 14, borderWidth: 1, borderColor: c.border, borderStyle: "dashed", backgroundColor: c.backgroundAlt, padding: 18 },
  holdingsEmptyText: { fontFamily: F, fontSize: 13, color: c.textTertiary, textAlign: "center" },

  allocSummary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  allocSummaryLabel: { fontFamily: F, fontSize: 11, fontWeight: "600", color: c.textTertiary, textTransform: "uppercase", letterSpacing: 0.4 },
  allocSummaryTotal: { fontFamily: F, fontSize: 13, fontWeight: "800", color: c.accent },
  allocSummaryTotalOff: { color: "#f59e0b" },
  allocRow: { marginBottom: 16 },
  allocTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  allocBarTrack: { height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt, marginTop: 10, overflow: "hidden" },
  allocBarFill: { height: "100%", borderRadius: 3, backgroundColor: "#35F046" },

  legIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.border },
  legIconFallback: { backgroundColor: c.text, alignItems: "center", justifyContent: "center" },
  legIconLetter: { color: c.textInverse, fontSize: 13, fontWeight: "800", fontFamily: F },
  legInfo: { flex: 1, minWidth: 0 },
  legSymbol: { fontFamily: F, fontSize: 14, fontWeight: "700", color: c.text },
  legLabel: { fontFamily: F, fontSize: 11, color: c.textTertiary, marginTop: 1 },
  weightCtl: { flexDirection: "row", alignItems: "center", gap: 6 },
  weightBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.surfaceAlt, alignItems: "center", justifyContent: "center" },
  weightBtnText: { fontFamily: F, fontSize: 16, fontWeight: "700", color: c.text, lineHeight: 20 },
  weightPct: { fontFamily: F, fontSize: 13, fontWeight: "700", color: c.text, width: 38, textAlign: "center" },
  removeBtn: { padding: 2 },

  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: c.background,
    // Matches the bar's bottom padding, so the button's corners nest inside the
    // display's instead of crossing them.
    paddingHorizontal: CTA.inset,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  publishBtn: {
    backgroundColor: "#35F046",
    borderRadius: CTA.radius,
    height: CTA.height,
    alignItems: "center",
    justifyContent: "center",
  },
  publishBtnDisabled: { opacity: 0.4 },
  publishBtnText: { fontFamily: F, fontSize: 20, fontWeight: "800", color: "#000000" },

  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border },
  pickerTitle: { fontFamily: F, fontSize: 17, fontWeight: "800", color: c.text },
  pickerDone: { fontFamily: F, fontSize: 15, fontWeight: "700", color: c.accent },
  searchRow: { flexDirection: "row", alignItems: "center", backgroundColor: c.backgroundAlt, borderRadius: 12, margin: 16, paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderWidth: 1, borderColor: c.border },
  searchInput: { flex: 1, fontFamily: F, fontSize: 14, color: c.text },
  pickerList: { flex: 1, paddingHorizontal: 16 },
  stockRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  stockRowSelected: { backgroundColor: "rgba(32,230,0,0.06)" },
  stockIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.border },
  stockPrice: { fontFamily: F, fontSize: 13, color: c.text, marginRight: 6 },
});
