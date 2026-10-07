import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { ed25519 } from '@noble/curves/ed25519';
import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { buildV1SingleInstruction, wrapV1Transaction } from '@/lib/solana-v1';

/**
 * Dev-only probe: can the Privy embedded wallet sign a Solana V1 transaction?
 *
 * Open with `bread://dev-v1-probe`. Builds a one-memo V1 transaction with the
 * user's wallet as fee payer, has Privy sign it, verifies the signature locally,
 * and asks mainnet to verify it via `simulateTransaction` (sigVerify on).
 * Nothing is ever sent, so nothing is spent. A zero-SOL wallet fails simulation
 * on the fee — that still proves the signature, because signatures are checked
 * before fees are.
 */
const RPC = 'https://api.mainnet-beta.solana.com';
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result as T;
}

export default function DevV1Probe() {
  const insets = useSafeAreaInsets();
  const solanaWallet = useEmbeddedSolanaWallet();
  const wallet = solanaWallet.wallets?.[0] ?? null;
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  if (!__DEV__) return null;

  const log = (line: string) => {
    console.log(`[v1-probe] ${line}`);
    setLines((previous) => [...previous, line]);
  };

  const run = async () => {
    if (!wallet || running) return;
    setRunning(true);
    setLines([]);
    try {
      const signer = new PublicKey(wallet.address);
      log(`wallet ${wallet.address}`);
      const { value } = await rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [
        { commitment: 'confirmed' },
      ]);
      const wire = buildV1SingleInstruction({
        signer,
        programId: MEMO,
        data: new TextEncoder().encode('bread v1 probe'),
        recentBlockhash: new PublicKey(value.blockhash),
        computeUnitLimit: 50_000,
        loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
      });
      log(`built V1 tx: ${wire.length} bytes, first byte 0x${wire[0].toString(16)}`);

      const transaction = wrapV1Transaction(wire);
      const provider = await wallet.getProvider();
      const { signedTransaction } = await provider.request({
        method: 'signTransaction',
        // Privy only calls message.serialize() and addSignature() on this.
        params: { transaction: transaction as never },
      });
      const signed = (signedTransaction as unknown as typeof transaction).serialize();
      const signature = signed.subarray(signed.length - 64);
      log(`Privy signed: ${signature.some((byte) => byte !== 0) ? 'yes' : 'NO (empty slot)'}`);

      const valid = ed25519.verify(signature, transaction.message.serialize(), signer.toBytes());
      log(`local ed25519 verify: ${valid ? 'PASS' : 'FAIL'}`);

      const sim = await rpc<{ value: { err: unknown; logs: string[] | null } }>('simulateTransaction', [
        Buffer.from(signed).toString('base64'),
        { encoding: 'base64', sigVerify: true, commitment: 'confirmed' },
      ]);
      const err = JSON.stringify(sim.value.err);
      log(`mainnet sigVerify simulation err: ${err}`);
      const signatureRejected = /Signature/i.test(err ?? '');
      log(
        signatureRejected
          ? 'RESULT: FAIL — mainnet rejected the signature'
          : valid
            ? 'RESULT: PASS — Privy signs V1 transactions'
            : 'RESULT: FAIL — signature did not verify locally',
      );
    } catch (error) {
      log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      log('RESULT: FAIL');
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>V1 transaction probe</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Run V1 signing test"
        onPress={run}
        disabled={!wallet || running}
        style={[styles.button, (!wallet || running) && styles.disabled]}
      >
        <Text style={styles.buttonText}>
          {!wallet ? 'No wallet' : running ? 'Running…' : 'Run V1 signing test'}
        </Text>
      </Pressable>
      <ScrollView style={styles.log}>
        {lines.map((line, index) => (
          <Text key={index} style={styles.line} selectable>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0C', paddingHorizontal: 16 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginBottom: 16 },
  button: { backgroundColor: '#35F046', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#0B0B0C', fontSize: 16, fontWeight: '700' },
  log: { marginTop: 16 },
  line: { color: '#E6E6E6', fontFamily: 'Menlo', fontSize: 12, marginBottom: 6 },
});
