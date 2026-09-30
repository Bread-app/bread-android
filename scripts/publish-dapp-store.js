#!/usr/bin/env node
/**
 * Publish a new Bread version to the Solana dApp Store with the portal-backed
 * CLI (https://docs.solanamobile.com/dapp-store/publishing-cli).
 *
 *   DAPP_STORE_API_KEY=... npm run publish:dapp-store -- \
 *     --apk ./build-123.apk --whats-new "Bug fixes"
 *
 * The first release must go through https://publish.solanamobile.com (it mints
 * the App NFT); the CLI only publishes versions of an app that already exists.
 * The portal matches the APK to the app by its package name (com.breadapp.fun).
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const apk = arg('apk');
const apkUrl = arg('apk-url');
const whatsNew = arg('whats-new');
const keypair = arg('keypair') ?? process.env.DAPP_STORE_KEYPAIR ?? './dapp-store-keypair.json';

function fail(message) {
  console.error(`publish-dapp-store: ${message}`);
  process.exit(1);
}

if (!apk && !apkUrl) fail('pass --apk <file> or --apk-url <url>');
if (apk && !fs.existsSync(apk)) fail(`APK not found: ${apk}`);
if (!whatsNew) fail('pass --whats-new "<release notes>"');
if (!fs.existsSync(keypair)) fail(`signer keypair not found: ${keypair} (set --keypair or DAPP_STORE_KEYPAIR)`);
if (!process.env.DAPP_STORE_API_KEY) {
  fail('set DAPP_STORE_API_KEY (https://publish.solanamobile.com/dashboard/settings/api-keys)');
}

const cliArgs = [
  '--yes',
  '-p',
  '@solana-mobile/dapp-store-cli@1',
  'dapp-store',
  ...(apk ? ['--apk-file', apk] : ['--apk-url', apkUrl]),
  '--keypair',
  keypair,
  '--whats-new',
  whatsNew,
];

const result = spawnSync('npx', cliArgs, { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
