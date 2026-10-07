import Ionicons from "@expo/vector-icons/Ionicons";
import MaskedView from "@react-native-masked-view/masked-view";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  Image,
} from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { useEmbeddedSolanaWallet, useSigners } from "@privy-io/expo";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BlurBackdrop } from "@/components/blur-backdrop";
import { BalanceCardStack } from "@/components/balance-card-stack";
import { LikeToBuyCard } from "@/components/like-to-buy-card";
import { DepositSheet, type DepositSheetRef } from "@/components/deposit-sheet";
import { WithdrawSheet, type WithdrawSheetRef } from "@/components/withdraw-sheet";
import { HandleText } from "@/components/handle-text";
import { useCash } from "@/hooks/use-cash";
import { useWalletStore } from "@/lib/wallet-store";
import { linkXAccount } from "@/lib/x-link";
import {
  disconnectX,
  getAutoBuyConfig,
  getXConnection,
  humanizeErrorMessage,
  registerAutoBuyDelegation,
  revokeAutoBuyDelegation,
  updateAutoBuyConfig,
  type AutoBuyConfig,
  type XConnectionStatus,
} from "@/lib/api";
import { Fonts, type ThemeColors } from "@/constants/theme";
import { registerForPushNotificationsIfNeeded } from "@/lib/notification-permissions";
import { useThemeStore } from "@/lib/theme-store";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import { PressableScale } from '@/components/pressable-scale';
import { WalletActionRow } from '@/components/wallet-action-row';

const F = Fonts.rounded;
const TITLE_OUTLINE_RADIUS = 3;
const TITLE_OUTLINE_OFFSETS: [number, number][] = Array.from(
  { length: 24 },
  (_, index): [number, number] => {
    const angle = (Math.PI * 2 * index) / 24;
    return [
      Math.cos(angle) * TITLE_OUTLINE_RADIUS,
      Math.sin(angle) * TITLE_OUTLINE_RADIUS,
    ];
  },
);
// Privy key-quorum / signer id that the backend signs with (must match the
// server's PRIVY_QUORUM_ID). Session signers grant this id access to the
// user's TEE wallet. Optional policy ids constrain what it may sign.
const PRIVY_SIGNER_ID = process.env.EXPO_PUBLIC_PRIVY_SIGNER_ID ?? "";
const PRIVY_POLICY_IDS = (process.env.EXPO_PUBLIC_PRIVY_POLICY_ID ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function SandwichStyleTitle({ label }: { label: string }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.displayTitleStack}>
      {TITLE_OUTLINE_OFFSETS.map(([left, top], index) => (
        <Text
          key={index}
          style={[
            styles.displayTitle,
            styles.displayTitleOutline,
            { left, top },
          ]}
        >
          {label}
        </Text>
      ))}
      <MaskedView maskElement={<Text style={styles.displayTitle}>{label}</Text>}>
        <LinearGradient
          colors={["#FFFFFF", "#FFFFFF", "#C3C9F0"]}
          locations={[0, 0.45, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        >
          <Text style={[styles.displayTitle, styles.displayTitleMeasure]}>
            {label}
          </Text>
        </LinearGradient>
      </MaskedView>
    </View>
  );
}

/**
 * "Buy when I like" settings: connect X, set the spend amount + caps, and
 * choose confirm (one-tap sheet) vs auto (Privy delegated server signing).
 *
 * Connecting X runs Bread's own OAuth 2.0 + PKCE grant (not Privy's linker):
 * `like.create` is a private Activity event that X only delivers for a user
 * token holding `like.read`. Toggles/mode persist immediately; numeric fields
 * save via the explicit Save button.
 */
export function AutoBuyScreen({ showBackButton = true }: { showBackButton?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const solanaWallet = useEmbeddedSolanaWallet();
  const walletAddress = solanaWallet.wallets?.[0]?.address ?? null;
  const walletStore = useWalletStore();
  const cash = useCash();
  const depositSheetRef = useRef<DepositSheetRef>(null);
  const withdrawSheetRef = useRef<WithdrawSheetRef>(null);
  // TEE wallets: server-side access is granted via session signers, not the
  // on-device delegateWallet (which Privy rejects for TEE execution).
  const { addSigners, removeSigners } = useSigners();

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AutoBuyConfig | null>(null);
  const [xStatus, setXStatus] = useState<XConnectionStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // which action is in flight
  const [error, setError] = useState<string | null>(null);
  // On the wallet tab (no back button) the Like to Buy settings live in a
  // bottom-sheet drawer rather than expanding inline.
  const likeToBuySheetRef = useRef<BottomSheetModal>(null);
  const { height: windowHeight } = useWindowDimensions();
  const likeToBuySheetHeight = Math.round(windowHeight * 0.88);
  const likeToBuySnapPoints = useMemo(
    () => [likeToBuySheetHeight],
    [likeToBuySheetHeight],
  );

  // Editable numeric fields (strings while typing).
  const [amount, setAmount] = useState("");
  const [dailyCap, setDailyCap] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [cfg, x] = await Promise.all([getAutoBuyConfig(), getXConnection()]);
      setConfig(cfg);
      setXStatus(x);
      setAmount(String(cfg.amountUsdc));
      setDailyCap(String(cfg.dailyCapUsdc));
      setError(null);
    } catch (err) {
      setError(humanizeErrorMessage(err, "Couldn't load auto-buy settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      void walletStore.refresh();
      // The provider owns a stable shared balance store; refresh whenever this
      // tab becomes active so the card reflects recent deposits and trades.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const openDeposit = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    depositSheetRef.current?.open();
  }, []);

  const openWithdraw = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    withdrawSheetRef.current?.open();
  }, []);

  const openLikeToBuy = useCallback(() => {
    void Haptics.selectionAsync();
    likeToBuySheetRef.current?.present();
  }, []);

  const renderSheetBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BlurBackdrop {...props} />
    ),
    [],
  );

  async function applyUpdate(updates: Parameters<typeof updateAutoBuyConfig>[0], tag: string) {
    setBusy(tag);
    setError(null);
    try {
      const next = await updateAutoBuyConfig(updates);
      setConfig(next);
      return true;
    } catch (err) {
      setError(humanizeErrorMessage(err, "Couldn't save settings."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const numbersDirty =
    config !== null &&
    (Number(amount) !== config.amountUsdc ||
      Number(dailyCap) !== config.dailyCapUsdc);

  async function saveNumbers() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const amountUsdc = Number(amount);
    const dailyCapUsdc = Number(dailyCap);
    const parsed = {
      amountUsdc,
      // Each like creates one purchase, so the internal per-trade safety cap
      // follows the user-facing amount instead of becoming a duplicate field.
      perTradeCapUsdc: amountUsdc,
      dailyCapUsdc,
    };
    if (Object.values(parsed).some((v) => !Number.isFinite(v) || v <= 0)) {
      setError("Amounts must be positive numbers.");
      return;
    }
    if (dailyCapUsdc < amountUsdc) {
      setError("Daily limit must be at least the amount per like.");
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await applyUpdate(parsed, "numbers");
  }

  // ── X connect (first-party OAuth 2.0 + PKCE) ───────────────────────────────
  async function connectX() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBusy("x");
    setError(null);
    try {
      const outcome = await linkXAccount();
      if (!outcome) return; // user dismissed
      if (!outcome.likesSubscribed) {
        // A connection without a live subscription buys nothing — say so
        // instead of showing a green "Connected" that silently does nothing.
        throw new Error(outcome.subscriptionError ?? "Like-tracking isn't active yet.");
      }
      await refresh();
    } catch (err) {
      setError(humanizeErrorMessage(err, "Couldn't connect your X account."));
    } finally {
      setBusy(null);
    }
  }

  function confirmDisconnectX() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Disconnect X?",
      "Likes will stop triggering buys, and any auto-buy permission is revoked immediately.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy("x");
              try {
                await disconnectX();
                await refresh();
              } catch (err) {
                setError(humanizeErrorMessage(err, "Couldn't disconnect."));
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  }

  // ── Auto mode: Privy session signer (TEE wallets) ───────────────────────────
  async function enableAutoMode() {
    if (!walletAddress) {
      setError("No wallet found on this account.");
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!PRIVY_SIGNER_ID) {
      setError("Automatic buys aren't configured (missing signer id). Contact support.");
      return;
    }
    Alert.alert(
      "Enable automatic buys?",
      `Bread will buy sandwiches with YOUR money, without asking, whenever you like a matching X post — $${config?.amountUsdc ?? "-"} per like and up to $${config?.dailyCapUsdc ?? "-"} per day. You can turn this off any time.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "I understand, enable",
          onPress: () => {
            void (async () => {
              setBusy("delegate");
              setError(null);
              try {
                // Step 1: grant Bread's server signer session access to this
                // wallet. If a signer is already present, Privy throws — that's
                // fine, we proceed to record it.
                try {
                  await addSigners({
                    address: walletAddress,
                    signers: [{ signerId: PRIVY_SIGNER_ID, policyIds: PRIVY_POLICY_IDS }],
                  });
                } catch (signerErr) {
                  const msg = String(
                    (signerErr as { message?: string })?.message ?? signerErr,
                  ).toLowerCase();
                  const alreadyGranted = msg.includes("already") && msg.includes("sign");
                  if (!alreadyGranted) {
                    setError(
                      humanizeErrorMessage(
                        signerErr,
                        "Granting automatic-buy access was declined or failed. Approve the Privy prompt to continue.",
                      ),
                    );
                    return;
                  }
                }

                // Step 2: backend confirms the wallet + records the grant.
                await registerAutoBuyDelegation();

                // Step 3: flip to auto mode.
                const next = await updateAutoBuyConfig({ mode: "auto", autoBuy: true });
                setConfig(next);
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch (err) {
                setError(humanizeErrorMessage(err, "Couldn't enable automatic buys."));
              } finally {
                setBusy(null);
                void refresh();
              }
            })();
          },
        },
      ],
    );
  }

  async function revokeAutoMode({ disableFeature = false } = {}) {
    setBusy("delegate");
    setError(null);
    try {
      // Server stops signing first, then remove the Privy session signer.
      await revokeAutoBuyDelegation();
      if (walletAddress) {
        await removeSigners({ address: walletAddress }).catch(() => {}); // best-effort; server flag already off
      }
      const next = await updateAutoBuyConfig({
        mode: "confirm",
        autoBuy: false,
        ...(disableFeature ? { enabled: false } : {}),
      });
      setConfig(next);
    } catch (err) {
      setError(humanizeErrorMessage(err, "Couldn't revoke."));
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  // the connected account's X profile picture (same unavatar source the feed uses).
  // Above the loading return: hooks must run on every render.
  const xAvatarUrl = xStatus?.xHandle ? `https://unavatar.io/x/${xStatus.xHandle.replace(/^@/, "")}` : null;
  const [xAvatarFailed, setXAvatarFailed] = useState(false);
  useEffect(() => setXAvatarFailed(false), [xAvatarUrl]);

  if (loading || !config) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const connected = xStatus?.connected === true;
  const autoActive = config.mode === "auto" && config.delegationStatus === "active";
  const hasWallet = Boolean(walletStore.walletAddress);
  const balanceReady = hasWallet && walletStore.hasLoaded && cash.hasLoaded;

  // The Like to Buy settings render both inline (standalone route, with the
  // back button) and inside the wallet-tab drawer. `inSheet` swaps the numeric
  // fields to BottomSheetTextInput so the keyboard behaves inside the sheet.
  // Nothing below the X card works without a connection, so an unconnected
  // user gets one thing to do, centred, instead of a page of disabled rows.
  const renderConnectX = (inSheet: boolean) => (
    <View
      style={[
        styles.connectState,
        inSheet ? { minHeight: likeToBuySheetHeight - 160 } : styles.connectStateInline,
      ]}
    >
      <View style={styles.connectLogo}>
        <Text style={styles.connectLogoMark}>𝕏</Text>
      </View>
      <Text style={styles.connectTitle}>Connect your X account</Text>
      <Text style={styles.connectSub}>
        Like a post on X that has a trade idea, and Bread makes a small buy
        into it.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Connect X account"
        style={[styles.button, styles.connectButton]}
        disabled={busy === "x"}
        onPress={connectX}
      >
        {busy === "x" ? (
          <ActivityIndicator size="small" color={colors.background} />
        ) : (
          <Text style={[styles.buttonLabel, styles.connectButtonLabel]}>Connect X</Text>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );

  const renderSettings = (inSheet: boolean) => (
    !connected ? renderConnectX(inSheet) : <>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* X connection */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={styles.accountIdentity}>
            {xAvatarUrl && !xAvatarFailed ? (
              <Image
                source={{ uri: xAvatarUrl }}
                style={styles.xAvatar}
                onError={() => setXAvatarFailed(true)}
                accessibilityLabel={`@${xStatus?.xHandle} on X`}
              />
            ) : (
              <View style={styles.iconWell}>
                <Text style={styles.xMark}>𝕏</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>X account</Text>
              <HandleText style={styles.cardSub}>
                {connected
                  ? `@${xStatus?.xHandle ?? "unknown"}`
                  : "Connect to turn your likes into trades."}
              </HandleText>
            </View>
          </View>
          <Pressable
            style={[styles.button, connected ? styles.buttonGhost : null]}
            disabled={busy === "x"}
            onPress={connected ? confirmDisconnectX : connectX}
          >
            {busy === "x" ? (
              <ActivityIndicator
                size="small"
                color={connected ? colors.text : colors.background}
              />
            ) : (
              <Text
                style={[
                  styles.buttonLabel,
                  connected ? styles.buttonGhostLabel : null,
                ]}
              >
                {connected ? "Disconnect" : "Connect"}
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* Master switch */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Buy when I like</Text>
            <Text style={styles.cardSub}>
              Like a post on X that has a trade idea, and Bread makes a small
              buy into it.
            </Text>
          </View>
          <Switch
            value={config.enabled}
            disabled={!connected || busy !== null}
            trackColor={{
              false: colors.surfaceSelected,
              true: colors.accentDeep,
            }}
            thumbColor={colors.textInverse}
            onValueChange={(value) => {
              if (!value && autoActive) {
                void revokeAutoMode({ disableFeature: true });
                return;
              }
              void (async () => {
                const saved = await applyUpdate({ enabled: value }, "enabled");
                if (saved && value) {
                  await registerForPushNotificationsIfNeeded();
                }
              })();
            }}
          />
        </View>
      </View>

      {config.enabled ? (
        <>
          {/* Amounts */}
          <Text style={styles.sectionLabel}>Spending limit</Text>
          <View style={styles.card}>
            <Field
              label="Per like"
              hint="Each buy"
              value={amount}
              onChange={setAmount}
              styles={styles}
              inSheet={inSheet}
            />
            <View style={styles.divider} />
            <Field
              label="Per day"
              hint="Max per day"
              value={dailyCap}
              onChange={setDailyCap}
              styles={styles}
              inSheet={inSheet}
            />
            {numbersDirty ? (
              <Pressable
                style={[styles.button, styles.saveButton]}
                disabled={busy !== null}
                onPress={() => void saveNumbers()}
              >
                {busy === "numbers" ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <Text style={styles.buttonLabel}>Save</Text>
                )}
              </Pressable>
            ) : null}
          </View>

          {/* Mode */}
          <Text style={styles.sectionLabel}>How buys happen</Text>
          <View style={styles.card}>
            <Pressable
              style={[
                styles.modeRow,
                config.mode === "confirm" ? styles.modeRowActive : null,
              ]}
              disabled={busy !== null}
              onPress={() =>
                autoActive
                  ? void revokeAutoMode()
                  : void applyUpdate({ mode: "confirm" }, "mode")
              }
            >
              <Ionicons
                name={
                  config.mode === "confirm"
                    ? "radio-button-on"
                    : "radio-button-off"
                }
                size={23}
                color={
                  config.mode === "confirm" ? colors.accentDeep : colors.iconMuted
                }
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.modeTitle}>Ask me first</Text>
                <Text style={styles.cardSub}>
                  Confirm every buy with one tap.
                </Text>
              </View>
            </Pressable>
            <Pressable
              style={[
                styles.modeRow,
                config.mode === "auto" ? styles.modeRowActive : null,
              ]}
              disabled={busy !== null || !connected}
              onPress={() => (autoActive ? undefined : void enableAutoMode())}
            >
              <Ionicons
                name={
                  config.mode === "auto"
                    ? "radio-button-on"
                    : "radio-button-off"
                }
                size={23}
                color={
                  config.mode === "auto" ? colors.accentDeep : colors.iconMuted
                }
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.modeTitle}>Permissionless</Text>
                <Text style={styles.cardSub}>
                  Bread buys for you, within your limits.
                </Text>
              </View>
              {busy === "delegate" ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : null}
            </Pressable>
          </View>

          <Text style={styles.disclosure}>
            Buys come from your USDC balance and can&apos;t be undone once
            on-chain. Bread never spends more than your limits, and we can
            pause all buying at any time.
          </Text>
        </>
      ) : null}
    </>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {showBackButton ? (
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={12}
            onPress={() => router.back()}
          >
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.title}>Like to Buy</Text>
          </View>
          <View style={{ width: 26 }} />
        </View>
      ) : null}

      {!showBackButton ? <Text style={styles.walletTitle}>Wallet</Text> : null}

      <ScrollView
        contentContainerStyle={[
          styles.content,
          !showBackButton && styles.walletContent,
          showBackButton && !connected && styles.contentFill,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {!showBackButton ? (
          <>
            <View style={styles.walletCardSlot}>
              <BalanceCardStack
                balanceLabel={balanceReady ? formatUsd(cash.totalCash) : null}
                walletAddress={walletStore.walletAddress}
                onWithdraw={openWithdraw}
              />
            </View>

            {hasWallet ? (
              <WalletActionRow onAddCash={openDeposit} onWithdraw={openWithdraw} />
            ) : null}

            <LikeToBuyCard style={styles.likeToBuyCard} onPress={openLikeToBuy} />
          </>
        ) : null}

        {showBackButton ? renderSettings(false) : null}
      </ScrollView>

      <DepositSheet
        ref={depositSheetRef}
        walletAddress={walletStore.walletAddress}
        onCheckout={async () => {}}
      />
      <WithdrawSheet ref={withdrawSheetRef} />

      {/* Like to Buy settings live in a drawer on the wallet tab. */}
      <BottomSheetModal
        ref={likeToBuySheetRef}
        snapPoints={likeToBuySnapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        backdropComponent={renderSheetBackdrop}
        handleComponent={null}
        backgroundStyle={styles.sheetBg}
      >
        <BottomSheetScrollView
          style={{ height: likeToBuySheetHeight }}
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sheetHandleSpacer} />
          <View style={styles.sheetTitleRow}>
            <SandwichStyleTitle label="Like to Buy" />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              onPress={() => likeToBuySheetRef.current?.dismiss()}
              style={styles.sheetCloseBtn}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </PressableScale>
          </View>
          {renderSettings(true)}
        </BottomSheetScrollView>
      </BottomSheetModal>
    </View>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  styles,
  inSheet = false,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  styles: ReturnType<typeof makeStyles>;
  inSheet?: boolean;
}) {
  // Inside a bottom sheet the input must be BottomSheetTextInput so the sheet
  // tracks focus and pans the keyboard correctly; inline it's a plain input.
  const Input = inSheet ? BottomSheetTextInput : TextInput;
  return (
    <View style={styles.fieldRow}>
      <View>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldHint}>{hint}</Text>
      </View>
      <View style={styles.amountInput}>
        <Text style={styles.currency}>$</Text>
        <Input
          accessibilityLabel={`${label} amount`}
          style={styles.fieldInput}
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder="0"
        />
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    center: { alignItems: "center", justifyContent: "center" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    headerTitleWrap: { flex: 1, alignItems: "center" },
    title: { fontFamily: F, fontWeight: "700", fontSize: 20, color: c.text },
    walletTitle: {
      color: c.text,
      fontSize: 34,
      fontWeight: "900",
      fontFamily: F,
      letterSpacing: -0.5,
      marginTop: 12,
      marginBottom: 16,
      paddingHorizontal: 22,
    },
    displayTitleStack: {
      position: "relative",
      alignSelf: "flex-start",
    },
    displayTitle: {
      color: "#FFFFFF",
      fontSize: 24,
      fontWeight: "900",
      fontFamily: F,
      textTransform: "capitalize",
    },
    displayTitleOutline: {
      position: "absolute",
      color: "#000000",
    },
    displayTitleMeasure: { opacity: 0 },
    content: { paddingHorizontal: 22, paddingTop: 30, paddingBottom: 140, gap: 8 },
    contentFill: { flexGrow: 1, paddingTop: 0, paddingBottom: 0 },
    connectState: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
      gap: 10,
    },
    connectStateInline: { flex: 1 },
    connectLogo: {
      width: 84,
      height: 84,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.text,
      marginBottom: 8,
    },
    connectLogoMark: { color: c.background, fontSize: 40, fontWeight: "600" },
    connectTitle: { fontFamily: F, fontWeight: "800", fontSize: 22, color: c.text, textAlign: "center" },
    connectSub: {
      fontFamily: F,
      fontWeight: "500",
      fontSize: 14,
      lineHeight: 20,
      color: c.textSecondary,
      textAlign: "center",
      maxWidth: 280,
    },
    connectButton: { marginTop: 14, paddingHorizontal: 32, paddingVertical: 14, minWidth: 200 },
    connectButtonLabel: { fontSize: 16 },
    walletContent: { paddingTop: 0 },
    walletCardSlot: {
      marginBottom: 8,
    },
    walletActions: {
      alignSelf: "stretch",
      height: 54,
      marginBottom: 18,
    },
    walletActionHost: {
      width: "100%",
      height: 54,
    },
    likeToBuyCard: {
      marginTop: 6,
      marginBottom: 8,
    },
    // ── Like to Buy drawer ────────────────────────────────────────────────────
    sheetBg: {
      backgroundColor: c.background,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
    },
    sheetContent: {
      paddingHorizontal: 22,
      paddingBottom: 48,
      gap: 8,
    },
    sheetHandleSpacer: { height: 14 },
    sheetTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    sheetCloseBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
    },
    sectionLabel: {
      marginTop: 16,
      marginBottom: 1,
      paddingHorizontal: 3,
      color: c.textSecondary,
      fontFamily: F,
      fontWeight: "700",
      fontSize: 15,
    },
    card: {
      backgroundColor: "transparent",
      paddingHorizontal: 2,
      paddingVertical: 16,
      gap: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    cardTitle: { fontFamily: F, fontWeight: "600", fontSize: 18, color: c.text },
    cardSub: { fontFamily: F, fontWeight: "400", fontSize: 15, lineHeight: 21, color: c.textSecondary, marginTop: 2 },
    rowBetween: { flexDirection: "row", alignItems: "center", gap: 14 },
    accountIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: 14 },
    iconWell: {
      width: 48,
      height: 48,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.text,
    },
    xMark: { color: c.background, fontSize: 22, fontWeight: "600" },
    xAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.surfaceAlt },
    button: {
      backgroundColor: c.accent,
      borderRadius: 1149,
      paddingHorizontal: 18,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonLabel: { fontFamily: F, fontWeight: "600", fontSize: 16, color: c.background },
    buttonGhost: { backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
    buttonGhostLabel: { color: c.text },
    saveButton: { marginTop: 2 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border },
    fieldRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 2,
    },
    fieldLabel: { fontFamily: F, fontWeight: "400", fontSize: 16, color: c.text },
    fieldHint: { marginTop: 2, fontFamily: F, fontSize: 14, color: c.textTertiary },
    amountInput: {
      minWidth: 106,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingLeft: 12,
    },
    currency: { color: c.textSecondary, fontFamily: F, fontSize: 17 },
    fieldInput: {
      minWidth: 71,
      textAlign: "right",
      fontFamily: F, fontWeight: "600",
      fontSize: 18,
      color: c.text,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    modeRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 2,
    },
    modeRowActive: {},
    modeTitle: { fontFamily: F, fontWeight: "600", fontSize: 17, color: c.text },
    error: {
      fontFamily: F, fontWeight: "400",
      fontSize: 15,
      color: c.negative,
      paddingHorizontal: 5,
    },
    disclosure: {
      fontFamily: F, fontWeight: "400",
      fontSize: 14,
      color: c.textSecondary,
      paddingHorizontal: 9,
      lineHeight: 20,
    },
  });
