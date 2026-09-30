import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackgroundProps,
} from '@gorhom/bottom-sheet';

import { BlurBackdrop } from '@/components/blur-backdrop';
import { GlassSheetSurface } from '@/components/glass-sheet-surface';
import { PressableScale } from '@/components/pressable-scale';
import { useEmbeddedEthereumWallet, useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useFundSolanaWallet } from '@privy-io/expo/ui';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInLeft, FadeInRight, ReduceMotion } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import QRCodeStyled from 'react-native-qrcode-styled';
import { TRADE_PAD_SCRIM, TRADE_PAD_SCRIM_DARK, TradeAmountPad } from './trade-amount-sheet';

// The Crypto row's coin pair; USDC also sits inline in the "Send USDC on …" line.
const USDC_LOGO = require('../../assets/images/addcash/usdc.png');
const USDT_LOGO = require('../../assets/images/addcash/usdt.png');

import {
  createRelayDepositAddress,
  getWalletDeposits,
  humanizeErrorMessage,
  type RelayDepositAddressResponse,
} from '@/lib/api';
import {
  RELAY_SOURCE_CHAINS,
  pollRelayDeposit,
  pollWalletDepositLanded,
  type RelayDepositStatus,
  type RelaySourceChain,
} from '@/lib/relay';
import {
  useOptionalDepositAddresses,
  type DepositAddressesValue,
} from '@/lib/deposit-addresses-store';
import { useToast } from '@/lib/toast-store';
import { toSmallestUnits } from '@/lib/trading';
import { useWalletStore } from '@/lib/wallet-store';
import { Fonts, Motion, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';
import { useMwaUsdcDeposit } from '@/hooks/use-mwa-usdc-deposit';
import { isNoWalletInstalled, isWalletCancellation } from '@/hooks/use-solana-wallet-login';
import { isSeekerDevice } from '@/lib/solana-mobile/seeker';

export type DepositSheetRef = {
  open: () => void;
};

type FlowProps = {
  walletAddress?: string | null;
  /** Closes whatever container is presenting the flow (gorhom sheet or native route). */
  dismiss: () => void;
  /** Tells a host which step is showing. */
  onStepChange?: (step: Step) => void;
  /**
   * `native` when hosted by the form-sheet route: UIKit owns the sheet, and a
   * ScrollView inside it lays out at the wrong origin, so steps render plain.
   */
  host?: 'gorhom' | 'native';
  /**
   * The app-level deposit-address cache, read by the HOST. A gorhom modal
   * portals its content above `DepositAddressesProvider`, so the flow can't
   * read the context itself there; the native route can, and omits this.
   */
  depositAddresses?: DepositAddressesValue;
};

type Props = {
  walletAddress?: string | null;
  // Retained for API compatibility with existing callers (Crossmint checkout);
  // the redesigned flow funds via the Privy on-ramp instead.
  onCheckout?: (method: 'apple_pay', amount: string, email: string) => Promise<void>;
};

type Step = 'method' | 'crypto_network' | 'solana_deposit' | 'chain_deposit' | 'fiat_amount' | 'wallet_amount' | 'success';

type FiatMethod = 'apple_pay' | 'debit';

// Solana sits at the top of the network list as a direct deposit to the user's
// own wallet; the chains below it generate a Relay deposit address.
const SOLANA_NETWORK = {
  name: 'Solana',
  color: '#9945FF',
  logoUrl: 'https://assets.coingecko.com/coins/images/4128/standard/solana.png',
};

// Relay deposit addresses are amount-flexible: they accept whatever the user
// sends and re-quote on receipt, so we only need a seed amount to mint the
// address — the user never has to enter one.
const RELAY_QUOTE_SEED_USDC = '100';

// On Seeker the on-device wallet is Seed Vault; elsewhere it is whichever
// MWA wallet the user has installed (Phantom, Solflare, …).
const ON_DEVICE_WALLET_SUBTITLE = isSeekerDevice()
  ? 'Seed Vault · USDC on Solana'
  : 'Phantom, Solflare & more · USDC on Solana';

const NO_CACHED_DEPOSIT_ADDRESSES: DepositAddressesValue = {
  addresses: {},
  getAddress: () => null,
  warm: async () => {},
  hydrated: false,
};

/** Module size of the deposit QR; the eye radii below are in the same units. */
const QR_PIECE = 7;

/**
 * The deposit flow itself — method picker → fiat amount pad / crypto network
 * list → QR + bridge status. Container-agnostic: `DepositSheet` below hosts it
 * in a gorhom bottom sheet, and `app/(app)/deposit.tsx` hosts it as a native
 * iOS form sheet route. State is fresh per mount, so hosts reset by remounting.
 */
export function DepositFlow({
  walletAddress,
  dismiss,
  onStepChange,
  host = 'gorhom',
  depositAddresses: hostDepositAddresses,
}: FlowProps) {
  const s = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const nativeHost = host === 'native';
  const { height: windowHeight } = useWindowDimensions();
  const networkListMaxHeight = Math.round(windowHeight * 0.5);
  const depositContentMaxHeight = Math.round(windowHeight * 0.68);

  const [step, setStep] = useState<Step>('method');
  const [amount, setAmount] = useState('100');
  const [fiatMethod, setFiatMethod] = useState<FiatMethod>('apple_pay');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // "12.50" once a deposit lands — the success step's headline.
  const [receivedUsd, setReceivedUsd] = useState<string | null>(null);
  // The step rendered last, so a transition knows which way to slide.
  const prevStepRef = useRef<Step>('method');

  // Cross-chain ("From another chain") state.
  const ethWallet = useEmbeddedEthereumWallet();
  const solanaWallet = useEmbeddedSolanaWallet();
  // Privy's fiat on-ramp: opens the Privy funding modal (card / Apple Pay via
  // Coinbase Onramp) to fund the embedded Solana wallet with USDC.
  const { fundWallet } = useFundSolanaWallet();
  const walletStore = useWalletStore();
  const toast = useToast();
  // App-level cache of reusable deposit addresses (Base/Ethereum/Monad/BNB),
  // hydrated from disk at launch so a tapped chain shows its QR instantly.
  const contextDepositAddresses = useOptionalDepositAddresses();
  // Neither (a host that is itself portalled): no instant QR, but a cache miss
  // already mints on tap, so the flow still works rather than crashing.
  const depositAddresses = hostDepositAddresses ?? contextDepositAddresses ?? NO_CACHED_DEPOSIT_ADDRESSES;
  // Stable references so effects don't re-run when the cached addresses update.
  const { getAddress: getCachedDepositAddress, warm: warmDepositAddresses } = depositAddresses;
  const [chain, setChain] = useState<RelaySourceChain>(RELAY_SOURCE_CHAINS[0]);
  const [deposit, setDeposit] = useState<RelayDepositAddressResponse | null>(null);
  const [depositStatus, setDepositStatus] = useState<'idle' | 'waiting' | 'success' | 'failed'>('idle');
  // Relay's granular bridge stage, surfaced under the QR while we wait.
  const [bridgeStage, setBridgeStage] = useState<RelayDepositStatus>('waiting');
  // Human-readable USDC amount that landed (from the Privy deposit webhook),
  // used for the "Received $X" toast once the bridge completes.
  const receivedUsdRef = useRef<string | null>(null);
  // The embedded EVM wallet address used as the Relay refund destination.
  const evmRefundRef = useRef<string | null>(ethWallet.wallets?.[0]?.address ?? null);
  // Cancels in-flight status polling when the sheet closes / resets.
  const pollSignalRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  // Deposit ids already recorded for this wallet when waiting begins, so the
  // Privy-webhook poller only fires on the deposit from *this* bridge.
  const knownDepositIdsRef = useRef<Set<string>>(new Set());

  const recipient = walletAddress ?? solanaWallet.wallets?.[0]?.address ?? null;
  const depositFromOnDeviceWallet = useMwaUsdcDeposit();

  // Keep the refund-address ref in sync as Privy provisions the EVM wallet.
  useEffect(() => {
    evmRefundRef.current = ethWallet.wallets?.[0]?.address ?? null;
  }, [ethWallet.wallets]);

  // Provision the embedded EVM wallet ahead of time (as soon as the user opens
  // the network list) so the refund address is ready the instant they tap a
  // chain and we generate a deposit address.
  useEffect(() => {
    if (step !== 'crypto_network') return;
    if (ethWallet.wallets?.[0]?.address) return;
    void ethWallet.create().catch(() => {});
  }, [step, ethWallet]);

  // Warm the app-level address cache as soon as the user shows intent (opens the
  // network list): provisions the EVM refund wallet and mints/refreshes every
  // chain address so tapping any chain is instant. The addresses are already
  // hydrated from disk at app launch, so this is a no-op (cache hit) after the
  // first ever mint.
  useEffect(() => {
    if (step !== 'crypto_network') return;
    void warmDepositAddresses();
  }, [step, warmDepositAddresses]);

  useEffect(() => {
    onStepChange?.(step);
  }, [step, onStepChange]);

  // Cancel any in-flight status polling when the host closes / unmounts us.
  useEffect(() => {
    const signal = pollSignalRef.current;
    return () => {
      signal.cancelled = true;
    };
  }, []);

  /** Wait briefly for Privy to surface the embedded EVM wallet address. */
  async function ensureEvmRefundAddress(): Promise<string | null> {
    if (evmRefundRef.current) return evmRefundRef.current;
    await ethWallet.create().catch(() => {});
    for (let i = 0; i < 20; i += 1) {
      if (evmRefundRef.current) return evmRefundRef.current;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return evmRefundRef.current;
  }

  /**
   * Mint a Relay deposit address for `targetChain` and move to the QR step. The
   * address is amount-flexible, so we seed the quote with a nominal amount and
   * the user can send whatever they like.
   */
  async function handleGenerateDepositAddress(targetChain: RelaySourceChain) {
    if (!recipient) {
      setError('No Solana wallet found to receive funds.');
      return;
    }
    const smallest = toSmallestUnits(RELAY_QUOTE_SEED_USDC, targetChain.usdcDecimals);
    if (!smallest) {
      setError('Could not create a deposit address. Try again.');
      return;
    }

    // Start a fresh poll cycle (a prior back-navigation may have cancelled the
    // previous one).
    pollSignalRef.current.cancelled = true;
    pollSignalRef.current = { cancelled: false };

    // Paint the QR INSTANTLY from the app-level cache (hydrated from disk at
    // launch) — synchronously, before any await — so there's no loading flash.
    const cached = getCachedDepositAddress(targetChain.id);

    setChain(targetChain);
    setDeposit(cached);
    setDepositStatus(cached ? 'waiting' : 'idle');
    setBridgeStage('waiting');
    receivedUsdRef.current = null;
    setError(null);
    setLoading(!cached);
    setStep('chain_deposit');

    try {
      // Snapshot known deposits so the poller only fires on the new one (no
      // refund wallet needed for this — it only matters when we have to mint a
      // fresh address below).
      knownDepositIdsRef.current = new Set(
        (await getWalletDeposits(recipient).catch(() => [])).map((d) => d.id),
      );

      // Cold miss only: mint now (needs the embedded EVM refund wallet), show it,
      // and warm the cache so next time is instant.
      let result = cached;
      if (!result) {
        const refundTo = await ensureEvmRefundAddress();
        if (!refundTo) {
          setError('Could not prepare a refund wallet. Try again.');
          return;
        }
        result = await createRelayDepositAddress({
          recipient,
          refundTo,
          originChainId: targetChain.id,
          originCurrency: targetChain.usdcAddress,
          amount: smallest,
        });
        setDeposit(result);
        setDepositStatus('waiting');
        void warmDepositAddresses();
      }

      void watchDeposit({ relayDepositAddress: result.depositAddress });
    } catch (e) {
      // Keep a cached address on screen; only surface errors when we had nothing.
      if (!cached) setError(humanizeErrorMessage(e, 'Could not create a deposit address.'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Watch for a deposit to land and run the shared success handling (toast +
   * balance refresh — the funds land as liquid, spendable cash). For
   * cross-chain deposits, pass `relayDepositAddress` to also track Relay's
   * bridge progress; same-chain Solana deposits omit it and rely solely on
   * Privy's `funds_deposited` webhook.
   */
  async function watchDeposit({ relayDepositAddress }: { relayDepositAddress?: string }) {
    const signal = pollSignalRef.current;

    // Race two independent "the deposit arrived" signals; whichever fires first
    // wins. This gives real-time progress driven by Privy's funds_deposited
    // webhook (the authoritative "USDC is in your Solana wallet" event, polled
    // from our backend) while keeping Relay's own bridge status as a fallback
    // for when webhooks aren't configured.
    let relayFailure: 'refund' | 'failure' | null = null;
    const outcome = await new Promise<'success' | 'failed'>((resolve) => {
      let settled = false;
      const finish = (result: 'success' | 'failed') => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      if (relayDepositAddress) {
        void pollRelayDeposit({
          depositAddress: relayDepositAddress,
          signal,
          // Narrate the bridge under the hood: confirming → bridging → almost there.
          onStatus: (status) => {
            if (status !== 'success' && status !== 'refund' && status !== 'failure') {
              setBridgeStage(status);
            }
          },
        }).then((status) => {
          if (status === 'success') finish('success');
          else if (status === 'refund' || status === 'failure') {
            relayFailure = status;
            finish('failed');
          }
          // A timeout (still 'waiting'/'pending') defers to the webhook signal.
        });
      }

      if (recipient) {
        void pollWalletDepositLanded({
          walletAddress: recipient,
          knownIds: knownDepositIdsRef.current,
          // Capture the credited amount for the "Received $X" toast. The webhook
          // reports USDC in smallest units (6 decimals).
          onFound: ({ amount }) => {
            const usd = Number(amount) / 1e6;
            if (Number.isFinite(usd) && usd > 0) {
              receivedUsdRef.current = usd.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
            }
          },
          signal,
        }).then((landed) => {
          if (landed) finish('success');
        });
      }
    });

    if (signal.cancelled) return;

    if (outcome === 'failed') {
      setDepositStatus('failed');
      toast.showToast(
        relayFailure === 'refund' ? 'Deposit refunded to your source wallet.' : 'Deposit failed.',
        'error',
      );
      return;
    }

    setDepositStatus('success');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // The sheet stays up on a success step rather than vanishing behind a
    // toast. If the user already closed it, this flow is unmounted and the
    // app-level deposit toast (useDepositToasts) announces it instead.
    setReceivedUsd(receivedUsdRef.current);
    setStep('success');
    void walletStore.refresh();
  }

  /**
   * Same-chain Solana deposit: the address is the user's own wallet, so there's
   * no Relay bridge — we just watch for Privy's `funds_deposited` webhook and
   * run the same success handling as the cross-chain flow, so both screens
   * behave identically.
   */
  async function handleStartSolanaDeposit() {
    if (!recipient) {
      setError('No Solana wallet found to receive funds.');
      setStep('solana_deposit');
      return;
    }

    // Start a fresh poll cycle (a prior back-navigation may have cancelled it).
    pollSignalRef.current.cancelled = true;
    pollSignalRef.current = { cancelled: false };

    setDepositStatus('waiting');
    setBridgeStage('waiting');
    receivedUsdRef.current = null;
    setError(null);
    setStep('solana_deposit');

    // Snapshot known deposits so the poller only fires on the new one.
    knownDepositIdsRef.current = new Set(
      (await getWalletDeposits(recipient).catch(() => [])).map((d) => d.id),
    );

    void watchDeposit({});
  }

  /** Copy the address in view; the primary button flips to "Copied" for 2s. */
  async function handleCopyText(text: string | null | undefined) {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function tapDigit(digit: string) {
    setError(null);
    void Haptics.selectionAsync();
    if (digit === 'del') {
      setAmount((prev) => (prev.length <= 1 ? '0' : prev.slice(0, -1)));
      return;
    }
    if (digit === '.') {
      setAmount((prev) => (prev.includes('.') ? prev : prev === '' ? '0.' : prev + '.'));
      return;
    }
    setAmount((prev) => (prev === '0' || prev === '' ? digit : prev + digit));
  }

  /** Open the Privy card / Apple Pay on-ramp pre-filled with the chosen amount. */
  async function handleFiatOnramp() {
    if (!recipient) {
      toast.showToast('No wallet found to fund.', 'error');
      return;
    }
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      setError('Enter a valid amount.');
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Dismiss our sheet first so Privy's funding modal isn't stacked behind
    // it. PrivyElements (mounted at the app root) renders the modal.
    dismiss();

    try {
      await fundWallet({
        address: recipient,
        asset: 'USDC',
        amount,
        defaultPaymentMethod: 'card',
        // Coinbase Onramp surfaces card, Apple Pay and bank inside its own
        // checkout. Requires Coinbase Onramp to be enabled for the app in the
        // Privy dashboard.
        card: { preferredProvider: 'coinbase' },
      });
    } catch (e) {
      // The user dismissing the funding modal can reject the promise — only
      // surface a toast for genuine errors, not cancellations.
      const message = e instanceof Error ? e.message : '';
      if (message && !/cancel|dismiss|close/i.test(message)) {
        toast.showToast('Could not start the checkout. Please try again.', 'error');
      }
    }
  }

  /** Pull USDC from an on-device wallet over Mobile Wallet Adapter. */
  async function handleOnDeviceWalletDeposit() {
    if (!recipient) {
      toast.showToast('No wallet found to fund.', 'error');
      return;
    }
    if (!(Number(amount) > 0)) {
      setError('Enter a valid amount.');
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setError(null);
    setLoading(true);
    try {
      await depositFromOnDeviceWallet({ to: recipient, amountUsd: amount });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReceivedUsd(Number(amount).toFixed(2));
      setStep('success');
      void walletStore.refresh();
    } catch (e) {
      if (isWalletCancellation(e)) return;
      if (isNoWalletInstalled(e)) {
        setError('No Solana wallet found on this phone.');
      } else if (e instanceof Error && /insufficient|0x1\b/i.test(e.message)) {
        setError('Not enough USDC (or SOL for fees) in that wallet.');
      } else {
        console.error('[deposit] MWA deposit failed', e);
        setError(e instanceof Error && e.message.length < 80 ? e.message : 'Deposit failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  const header = (title: React.ReactNode, onBack?: () => void) => (
    <SheetHeader title={title} onBack={onBack} onClose={dismiss} />
  );

  /**
   * Shared deposit screen for BOTH Solana and cross-chain deposits: QR tile,
   * the full address (tap to copy), live status, and a Copy button pinned at
   * the bottom. `onRetry` enables the error/retry state for routes whose
   * address has to be minted (cross-chain); Solana passes null.
   */
  function renderDepositView(opts: {
    networkName: string;
    address: string | null;
    bridged: boolean;
    onRetry: (() => void) | null;
  }) {
    const showError = Boolean(opts.onRetry) && Boolean(error) && !opts.address;
    // Once Relay reports movement, the one-line "watching" hint becomes a
    // three-step tracker so the user can see where their money is.
    const inFlight = depositStatus === 'waiting' && bridgeStage !== 'waiting';

    const body = showError ? (
      <View style={s.centerBlock}>
        <View style={[s.stateIcon, { backgroundColor: `${colors.negative}24` }]}>
          <Ionicons name="alert" size={30} color={colors.negative} />
        </View>
        <Text style={[s.stepTitle, s.textCenter]}>Couldn&apos;t load this address</Text>
        <Text style={[s.stepSubtitle, s.textCenter]}>{error}</Text>
      </View>
    ) : (
      <>
        <View style={s.sendLine}>
          <Text style={[s.stepSubtitle, s.textCenter]}>
            Send{' '}
            <Image source={USDC_LOGO} style={s.inlineCoin} />{' '}
            <Text style={s.sendStrong}>USDC on {opts.networkName}</Text> to add it to your cash. Other tokens
            can&apos;t be recovered.
          </Text>
        </View>

        <View style={s.qrFrame}>
          {/* Rounded, glued modules with soft eyes, inked in the theme's text
              colour on the card: dark on light, white on dark. */}
          {opts.address ? (
            <QRCodeStyled
              data={opts.address}
              style={s.qrCode}
              padding={0}
              pieceSize={QR_PIECE}
              pieceBorderRadius={QR_PIECE / 2}
              isPiecesGlued
              pieceLiquidRadius={QR_PIECE / 2}
              color={colors.text}
              outerEyesOptions={{ borderRadius: QR_PIECE * 2.2, color: colors.text }}
              innerEyesOptions={{ borderRadius: QR_PIECE * 1.3, color: colors.text }}
            />
          ) : (
            <View style={s.qrPlaceholder}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          )}
        </View>

        {opts.address ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy deposit address"
            onPress={() => void handleCopyText(opts.address)}
            style={({ pressed }) => [s.addressTap, pressed && s.pressedFade]}>
            <Text style={s.addressText}>{opts.address}</Text>
          </Pressable>
        ) : null}

        {depositStatus === 'failed' ? (
          <View style={s.callout}>
            <Ionicons name="alert-circle" size={18} color={colors.negative} />
            <Text style={s.calloutText}>
              {opts.bridged
                ? `The bridge couldn't finish, so your USDC was sent back to your ${opts.networkName} wallet.`
                : 'Something went wrong with this deposit.'}
            </Text>
          </View>
        ) : inFlight ? (
          <DepositStepper stage={bridgeStage} networkName={opts.networkName} bridged={opts.bridged} />
        ) : null}
      </>
    );

    return (
      <View style={s.stepContainer}>
        {header(`Deposit on ${opts.networkName}`, () => {
          pollSignalRef.current.cancelled = true;
          setStep('crypto_network');
        })}

        {/* The native form sheet sizes itself to its content, and a ScrollView
            inside it was laid out at the wrong origin, so the native host gets a
            plain view; the gorhom sheet keeps its capped scroller. */}
        {nativeHost ? (
          <View style={s.depositScroll}>{body}</View>
        ) : (
          <ScrollView
            style={[s.depositScrollOuter, { maxHeight: depositContentMaxHeight }]}
            contentContainerStyle={s.depositScroll}
            showsVerticalScrollIndicator={false}>
            {body}
          </ScrollView>
        )}

        {showError || depositStatus === 'failed' ? (
          opts.onRetry ? (
            <PrimaryButton
              label="Try again"
              icon="refresh"
              disabled={loading}
              onPress={() => opts.onRetry?.()}
            />
          ) : null
        ) : (
          <>
            <PrimaryButton
              label={copied ? 'Copied' : 'Copy wallet address'}
              icon={copied ? 'checkmark' : 'copy-outline'}
              disabled={!opts.address}
              onPress={() => void handleCopyText(opts.address)}
            />
            {!inFlight ? (
              <View style={s.watchingRow}>
                <View style={s.watchingDot} />
                <Text style={s.watchingText}>Watching for your deposit · safe to close</Text>
              </View>
            ) : null}
          </>
        )}
      </View>
    );
  }

  // Recorded after commit (not during render) so a double render can't erase
  // the step we're arriving from.
  useEffect(() => {
    prevStepRef.current = step;
  }, [step]);

  let content: React.ReactNode = null;

  if (step === 'method') {
    content = (
      <View style={s.stepContainer}>
        {header('Add cash')}
        <View style={s.methodList}>
          <MethodRow
            title="Wallet on this phone"
            subtitle={ON_DEVICE_WALLET_SUBTITLE}
            trailing={<Ionicons name="wallet" size={24} color={colors.text} />}
            onPress={() => {
              setError(null);
              setAmount('100');
              setStep('wallet_amount');
            }}
          />
          <MethodRow
            title="Crypto"
            subtitle="Send USDC from any wallet"
            trailing={
              <View style={s.coinPair}>
                <Image source={USDT_LOGO} style={[s.coin, s.coinBack]} />
                <Image source={USDC_LOGO} style={s.coin} />
              </View>
            }
            onPress={() => {
              setError(null);
              setStep('crypto_network');
            }}
          />
          <MethodRow
            title="Card"
            subtitle="Debit card or Google Pay"
            trailing={<Ionicons name="card" size={24} color={colors.text} />}
            onPress={() => {
              setError(null);
              setFiatMethod('apple_pay');
              setAmount('100');
              setStep('fiat_amount');
            }}
          />
          <MethodRow
            title="Bank transfer"
            subtitle="From your bank · US and EU"
            trailing={<Text style={s.bankEmoji}>🏦</Text>}
            onPress={() => {
              setError(null);
              setFiatMethod('debit');
              setAmount('100');
              setStep('fiat_amount');
            }}
          />
        </View>
      </View>
    );
  } else if (step === 'crypto_network') {
    content = (
      <View style={s.stepContainer}>
        {header('Deposit crypto', () => setStep('method'))}
        <Text style={[s.stepSubtitle, s.textCenter]}>Which network are you sending from?</Text>
        <ScrollView
          style={[s.chainListScroll, { maxHeight: networkListMaxHeight }]}
          showsVerticalScrollIndicator={false}>
          <View style={s.chainList}>
            <NetworkRow
              name={SOLANA_NETWORK.name}
              logoUrl={SOLANA_NETWORK.logoUrl}
              onPress={() => void handleStartSolanaDeposit()}
            />
            {RELAY_SOURCE_CHAINS.map((c) => (
              <NetworkRow
                key={c.id}
                name={c.name}
                logoUrl={c.logoUrl}
                disabled={loading}
                onPress={() => void handleGenerateDepositAddress(c)}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    );
  } else if (step === 'solana_deposit') {
    content = renderDepositView({
      networkName: 'Solana',
      address: recipient,
      bridged: false,
      onRetry: null,
    });
  } else if (step === 'chain_deposit') {
    content = renderDepositView({
      networkName: chain.name,
      address: deposit?.depositAddress ?? null,
      bridged: true,
      onRetry: () => void handleGenerateDepositAddress(chain),
    });
  } else if (step === 'success') {
    content = (
      <View style={s.stepContainer}>
        {header('')}
        <View style={s.centerBlock}>
          <View style={s.successBadge}>
            <Ionicons name="checkmark" size={40} color={colors.textInverse} />
          </View>
          <Text style={s.successAmount}>{receivedUsd ? `+$${receivedUsd}` : 'Deposit received'}</Text>
          <Text style={s.successSub}>added to your cash</Text>
        </View>
        <PrimaryButton label="Done" onPress={dismiss} />
      </View>
    );
  } else if (step === 'fiat_amount') {
    content = (
      // The buy sheet's own amount pad, so the keypad + layout match exactly.
      <View style={[s.padHost, { height: Math.round(windowHeight * 0.78) }]}>
        <TradeAmountPad
          onBack={() => setStep('method')}
          title={fiatMethod === 'apple_pay' ? 'Card' : 'Bank transfer'}
          subtitleLabel="Checkout by Coinbase · fee shown before you pay"
          accentColor={colors.actionBuy}
          amount={amount}
          amountUnitSymbol="$"
          amountUnitLabel="dollars"
          presets={['50', '100', '250', '500']}
          message={error}
          submitting={loading}
          canConfirm={Number(amount) > 0 && !loading}
          confirmLabel="Continue"
          submittingLabel="Opening…"
          onTapDigit={tapDigit}
          onTapPreset={(value) => {
            void Haptics.selectionAsync();
            setAmount(value);
            setError(null);
          }}
          onSubmit={handleFiatOnramp}
        />
      </View>
    );
  }

  if (step === 'wallet_amount') {
    content = (
      <View style={[s.padHost, { height: Math.round(windowHeight * 0.78) }]}>
        <TradeAmountPad
          onBack={() => setStep('method')}
          title="Wallet on this phone"
          subtitleLabel="USDC on Solana · your wallet pays the network fee"
          accentColor={colors.actionBuy}
          amount={amount}
          amountUnitSymbol="$"
          amountUnitLabel="dollars"
          presets={['25', '50', '100', '250']}
          message={error}
          submitting={loading}
          canConfirm={Number(amount) > 0 && !loading}
          confirmLabel="Continue in wallet"
          submittingLabel="Waiting for wallet…"
          onTapDigit={tapDigit}
          onTapPreset={(value) => {
            void Haptics.selectionAsync();
            setAmount(value);
            setError(null);
          }}
          onSubmit={handleOnDeviceWalletDeposit}
        />
      </View>
    );
  }

  // Forward steps slide in from the right, back steps from the left; the
  // sheet's height animates with its content, so the flow reads as one surface.
  const forward = STEP_DEPTH[step] >= STEP_DEPTH[prevStepRef.current];
  return (
    <Animated.View
      key={step}
      entering={(forward ? FadeInRight : FadeInLeft)
        .duration(Motion.duration.base)
        .easing(Motion.easing.enter)
        .reduceMotion(ReduceMotion.System)}>
      {content}
    </Animated.View>
  );
}

/** How deep each step sits in the flow — decides the slide direction. */
const STEP_DEPTH: Record<Step, number> = {
  method: 0,
  crypto_network: 1,
  fiat_amount: 1,
  wallet_amount: 1,
  solana_deposit: 2,
  chain_deposit: 2,
  success: 3,
};

/** Back · centred title · close. The back slot is a spacer on the first step. */
function SheetHeader({
  title,
  onBack,
  onClose,
}: {
  title: React.ReactNode;
  onBack?: () => void;
  onClose: () => void;
}) {
  const s = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  return (
    <View style={s.header}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={10}
          style={({ pressed }) => [s.iconBtn, pressed && s.pressedFade]}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
      ) : (
        <View style={s.headerSpacer} />
      )}
      {typeof title === 'string' ? (
        <Text style={s.headerTitle} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        title
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        hitSlop={10}
        style={({ pressed }) => [s.iconBtn, pressed && s.pressedFade]}>
        <Ionicons name="close" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

/** A payment method: title + subtitle on the left, its brand mark on the right. */
function MethodRow({
  title,
  subtitle,
  trailing,
  onPress,
}: {
  title: string;
  subtitle: string;
  /** The method's own mark: coin pair, Apple Pay lockup, bank. */
  trailing: React.ReactNode;
  onPress: () => void;
}) {
  const s = useThemedStyles(makeStyles);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      scaleTo={0.98}
      onPress={onPress}
      style={s.methodRow}>
      <View style={s.grow}>
        <Text style={s.methodTitle}>{title}</Text>
        <Text style={s.methodSub}>{subtitle}</Text>
      </View>
      {trailing}
    </PressableScale>
  );
}

/** A source network: name on the left, logo on the right. */
function NetworkRow({
  name,
  logoUrl,
  disabled,
  onPress,
}: {
  name: string;
  logoUrl: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const s = useThemedStyles(makeStyles);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Deposit from ${name}`}
      scaleTo={0.98}
      disabled={disabled}
      onPress={onPress}
      style={s.networkRow}>
      <Text style={[s.grow, s.networkName]}>{name}</Text>
      <Image source={{ uri: logoUrl }} style={s.networkLogo} resizeMode="contain" />
    </PressableScale>
  );
}

function PrimaryButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  onPress: () => void;
}) {
  const s = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[s.primaryBtn, disabled && s.primaryBtnDisabled]}>
      {icon ? <Ionicons name={icon} size={18} color={colors.background} /> : null}
      <Text style={s.primaryBtnText}>{label}</Text>
    </PressableScale>
  );
}

/** Received → moving to Solana → added, driven by Relay's bridge stage. */
function DepositStepper({
  stage,
  networkName,
  bridged,
}: {
  stage: RelayDepositStatus;
  networkName: string;
  bridged: boolean;
}) {
  const s = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const steps = [
    { title: `Received on ${networkName}`, sub: 'Deposit confirmed' },
    ...(bridged
      ? [{ title: 'Moving to Solana', sub: stage === 'delayed' ? 'Taking a little longer than usual' : 'Usually a minute or two' }]
      : []),
    { title: 'Added to your cash', sub: "We'll let you know when it lands" },
  ];
  // `depositing` = seen, still confirming; later stages = confirmed + bridging.
  const current = stage === 'depositing' ? 0 : 1;
  return (
    <View style={s.stepperCard}>
      {steps.map((item, i) => {
        const done = i < current;
        const active = i === current;
        const last = i === steps.length - 1;
        return (
          <View key={item.title} style={s.stepperRow}>
            <View style={s.stepperRail}>
              <View
                style={[
                  s.stepperDot,
                  done && { backgroundColor: colors.positive, borderColor: colors.positive },
                  active && { borderColor: colors.positive },
                ]}>
                {done ? <Ionicons name="checkmark" size={14} color={colors.textInverse} /> : null}
                {active ? <ActivityIndicator size="small" color={colors.positive} style={s.stepperSpinner} /> : null}
              </View>
              {!last ? <View style={[s.stepperLine, done && { backgroundColor: colors.positive }]} /> : null}
            </View>
            <View style={[s.stepperTextCol, !last && s.stepperTextGap]}>
              <Text style={[s.stepperTitle, !done && !active && { color: colors.textTertiary }]}>{item.title}</Text>
              <Text style={s.stepperSub}>{item.sub}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Gorhom bottom-sheet host for `DepositFlow`, dressed like the buy sheet. */
export const DepositSheet = forwardRef<DepositSheetRef, Props>(function DepositSheet({ walletAddress }, ref) {
  const s = useThemedStyles(makeStyles);
  const { scheme } = useThemeStore();
  const sheetRef = useRef<BottomSheetModal>(null);
  const { height: windowHeight } = useWindowDimensions();
  const maxSheetContentHeight = Math.round(windowHeight * 0.9);
  // Bumped on every open so the flow remounts with fresh state.
  const [flowKey, setFlowKey] = useState(0);
  // Read here, in the host's body: the modal's content is portalled above the
  // provider (see `FlowProps.depositAddresses`).
  const depositAddresses = useOptionalDepositAddresses() ?? undefined;

  useImperativeHandle(ref, () => ({
    open() {
      setFlowKey((k) => k + 1);
      sheetRef.current?.present();
    },
  }));

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BlurBackdrop
        {...props}
        intensity={6}
        dimColor={scheme === 'dark' ? 'rgba(0, 0, 0, 0.4)' : 'rgba(15, 23, 42, 0.16)'}
      />
    ),
    [scheme],
  );
  const renderBackground = useCallback(
    (props: BottomSheetBackgroundProps) => (
      <Animated.View {...props}>
        <GlassSheetSurface
          topRadius={SHEET_RADIUS}
          forceScheme={scheme === 'dark' ? 'dark' : 'light'}
          scrimColor={scheme === 'dark' ? TRADE_PAD_SCRIM_DARK : TRADE_PAD_SCRIM}
        />
      </Animated.View>
    ),
    [scheme],
  );
  const dismiss = useCallback(() => sheetRef.current?.dismiss(), []);

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      maxDynamicContentSize={maxSheetContentHeight}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundComponent={renderBackground}
      handleComponent={null}
      backgroundStyle={s.sheetBg}
      style={s.sheetBg}>
      <BottomSheetView style={s.sheet}>
        <DepositFlow
          key={flowKey}
          walletAddress={walletAddress}
          dismiss={dismiss}
          depositAddresses={depositAddresses}
        />
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const SHEET_RADIUS = 22;
const F = Fonts.rounded;

/**
 * Themed. Only the QR tile keeps fixed colours — it has to stay dark-on-white
 * for a camera to read it. Rows, radii and type follow the buy sheet.
 */
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheetBg: {
    backgroundColor: 'transparent',
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    overflow: 'hidden',
  },
  sheet: {
    // Grab pill removed app-wide; the spacing it created is kept.
    paddingTop: 22,
    paddingBottom: 30,
  },
  stepContainer: {
    paddingHorizontal: 20,
  },
  // The buy sheet's inset around the same pad.
  padHost: {
    paddingHorizontal: 16,
  },
  grow: {
    flex: 1,
    minWidth: 0,
  },
  pressedFade: {
    opacity: 0.6,
  },
  textCenter: {
    textAlign: 'center',
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surfaceAlt,
  },
  headerSpacer: {
    width: 36,
    height: 36,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: F,
    color: c.text,
    fontSize: 17,
    fontWeight: '800',
  },
  stepTitle: {
    fontFamily: F,
    color: c.text,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginTop: 16,
  },
  stepSubtitle: {
    fontFamily: F,
    color: c.textSecondary,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },

  /* ── Method step ── */
  methodList: {
    gap: 12,
    marginTop: 10,
    marginBottom: 8,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 84,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
  },
  methodTitle: {
    fontFamily: F,
    color: c.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  methodSub: {
    fontFamily: F,
    color: c.textTertiary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  coinPair: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  coin: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  // USDT tucks behind USDC, overlapping by a third.
  coinBack: {
    marginRight: -12,
  },
  applePayMark: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: c.text,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  applePayGlyph: {
    marginTop: -2,
  },
  applePayText: {
    color: c.text,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  bankEmoji: {
    fontSize: 32,
  },

  /* ── Network step ── */
  chainListScroll: {
    marginTop: 18,
  },
  chainList: {
    gap: 10,
  },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 62,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: c.surfaceAlt,
  },
  networkName: {
    fontFamily: F,
    color: c.text,
    fontSize: 17,
    fontWeight: '800',
  },
  networkLogo: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },

  /* ── Deposit step ── */
  depositScrollOuter: {
    flexGrow: 0,
  },
  depositScroll: {
    alignItems: 'center',
    paddingBottom: 18,
  },
  sendLine: {
    paddingHorizontal: 12,
  },
  sendStrong: {
    color: c.text,
    fontWeight: '800',
  },
  inlineCoin: {
    width: 16,
    height: 16,
    // An inline image sits on the text's top edge; drop it onto the baseline.
    transform: [{ translateY: 3 }],
  },
  qrFrame: {
    marginTop: 20,
    padding: 22,
    borderRadius: 28,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
  },
  qrCode: {
    backgroundColor: 'transparent',
  },
  qrPlaceholder: {
    width: 190,
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressTap: {
    marginTop: 18,
    paddingHorizontal: 12,
  },
  addressText: {
    fontFamily: F,
    color: c.textSecondary,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 24,
    textAlign: 'center',
  },
  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    alignSelf: 'stretch',
    marginTop: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: c.backgroundAlt,
    borderWidth: 1,
    borderColor: c.border,
  },
  calloutText: {
    flex: 1,
    fontFamily: F,
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  watchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 14,
  },
  watchingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.positive,
    borderWidth: 0,
    shadowColor: c.positive,
    shadowOpacity: 0.6,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  watchingText: {
    fontFamily: F,
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: '700',
  },

  /* ── Stepper ── */
  stepperCard: {
    alignSelf: 'stretch',
    marginTop: 18,
    padding: 16,
    borderRadius: 18,
    backgroundColor: c.backgroundAlt,
    borderWidth: 1,
    borderColor: c.border,
  },
  stepperRow: {
    flexDirection: 'row',
    gap: 14,
  },
  stepperRail: {
    alignItems: 'center',
  },
  stepperDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: c.surfaceSelected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperSpinner: {
    transform: [{ scale: 0.6 }],
  },
  stepperLine: {
    width: 2,
    flex: 1,
    minHeight: 16,
    marginVertical: 3,
    backgroundColor: c.surfaceSelected,
  },
  stepperTextCol: {
    flex: 1,
    paddingTop: 2,
  },
  stepperTextGap: {
    paddingBottom: 14,
  },
  stepperTitle: {
    fontFamily: F,
    color: c.text,
    fontSize: 15,
    fontWeight: '800',
  },
  stepperSub: {
    fontFamily: F,
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },

  /* ── Success / error ── */
  centerBlock: {
    alignItems: 'center',
    paddingVertical: 18,
  },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successBadge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.positive,
  },
  successAmount: {
    fontFamily: 'Rubik_900Black',
    color: c.positive,
    fontSize: 48,
    letterSpacing: -1,
    marginTop: 20,
  },
  successSub: {
    fontFamily: F,
    color: c.text,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 2,
  },

  /* ── Buttons ── */
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    borderRadius: 18,
    backgroundColor: c.text,
    marginTop: 4,
  },
  primaryBtnDisabled: {
    backgroundColor: c.surfaceSelected,
  },
  primaryBtnText: {
    fontFamily: F,
    color: c.background,
    fontSize: 16,
    fontWeight: '800',
  },
});
