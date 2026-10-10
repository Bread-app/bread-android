import React, { useCallback, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";

import { Fonts, type ThemeColors } from "@/constants/theme";
import { BalanceCardStack } from "@/components/balance-card-stack";
import { LikeToBuyCard } from "@/components/like-to-buy-card";
import { useCash } from "@/hooks/use-cash";
import { useWalletStore } from "@/lib/wallet-store";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import { WalletActionRow } from '@/components/wallet-action-row';

const F = Fonts.rounded;

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function WalletScreen() {
  const styles = useThemedStyles(makeStyles);
  const cash = useCash();
  const walletStore = useWalletStore();
  const hasFocusedRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [phoenixRefreshKey, setPhoenixRefreshKey] = useState(0);

  const hasWallet = Boolean(walletStore.walletAddress);
  // Mirror the gating used elsewhere: don't show a real figure until both the
  // balance read and the legacy vault read have resolved, so the card never
  // flashes a low/$0 total.
  const balanceReady = hasWallet && walletStore.hasLoaded && cash.hasLoaded;

  useFocusEffect(
    useCallback(() => {
      void walletStore.refresh();
      void cash.refresh();
      if (hasFocusedRef.current) {
        setPhoenixRefreshKey((value) => value + 1);
      } else {
        hasFocusedRef.current = true;
      }
      // refresh fns are stable refs; intentionally run once per focus.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([walletStore.refresh(), cash.refresh()]);
      setPhoenixRefreshKey((value) => value + 1);
    } finally {
      setRefreshing(false);
    }
  }, [walletStore, cash]);

  // TRIAL: native iOS form sheet route instead of the gorhom DepositSheet.
  const openDeposit = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/deposit');
  }, []);

  const openWithdraw = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.navigate('/withdraw');
  }, []);

  // Like-to-Buy settings live on their own pushed route (with a back button);
  // this card is the wallet's entry point into it.
  const openLikeToBuy = useCallback(() => {
    void Haptics.selectionAsync();
    router.push("/auto-buy");
  }, []);

  return (
    <SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
      <Text style={styles.title}>Wallet</Text>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.cardSlot}>
          <BalanceCardStack
            venue="phoenix"
            balanceLabel={balanceReady ? formatUsd(cash.totalCash) : null}
            walletAddress={walletStore.walletAddress}
            onWithdraw={openWithdraw}
            refreshKey={phoenixRefreshKey}
          />
        </View>

        {hasWallet ? (
          <View style={styles.actionSlot}>
            <WalletActionRow onAddCash={openDeposit} onWithdraw={openWithdraw} />
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Automations</Text>
        <LikeToBuyCard style={styles.likeToBuyCard} onPress={openLikeToBuy} />
      </ScrollView>

    </SafeAreaView>
  );
}

const GUTTER = 20;

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: c.background,
    },
    content: {
      paddingHorizontal: GUTTER,
      paddingTop: 4,
      paddingBottom: 160,
    },
    title: {
      color: c.text,
      fontSize: 34,
      fontWeight: "900",
      fontFamily: F,
      letterSpacing: -0.5,
      marginTop: 12,
      marginBottom: 12,
      paddingHorizontal: GUTTER,
    },
    cardSlot: {
      marginBottom: 20,
    },
    actionSlot: {
      marginBottom: 32,
    },
    sectionLabel: {
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: "800",
      fontFamily: F,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      marginBottom: 10,
      paddingHorizontal: 4,
    },
    // The card insets itself for other hosts; here it lines up with the
    // balance card and buttons above it.
    likeToBuyCard: {
      marginHorizontal: 0,
    },
  });
