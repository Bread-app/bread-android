# Publishing Bread to the Solana dApp Store

Source: https://docs.solanamobile.com/llms.txt (Build and Sign an APK, Submit a
New App, dApp Publishing CLI, Publisher Policy).

The dApp Store takes a **signed APK** (not an .aab), signed with a key that is
**different from the Google Play key**. Package name: `com.breadapp.fun`.

## 1. One-time: signing key

```bash
./scripts/create-dapp-store-keystore.sh
cp credentials.example.json credentials.json   # fill in both passwords
```

`keystores/`, `*.keystore` and `credentials.json` are gitignored. Back the
keystore + passwords up outside the repo — losing them means no more updates.

## 2. One-time: Digital Asset Links on breadapp.fun

`bread-landing` serves `https://breadapp.fun/.well-known/assetlinks.json` from
`ANDROID_SHA256_CERT_FINGERPRINTS` (comma-separated). Set it on the
bread-landing Vercel project to **every** key that signs a shipped build:

- the dApp Store key (printed by the keystore script), and
- the Play **app signing** key (Play Console → Setup → App signing), if Bread is
  on Play too.

This does two jobs:

1. Verifies the `https://breadapp.fun/s/*` App Links (`autoVerify`), so shared
   Sandwich links open the app.
2. Lets MWA wallets (Seed Vault, Phantom, …) verify Bread's identity
   (`uri: https://breadapp.fun` in `src/lib/solana-mobile/identity.ts`).

Check it after deploying:

```bash
curl -s https://breadapp.fun/.well-known/assetlinks.json
```

## 3. Build the APK

```bash
npm run build:dapp-store          # EAS cloud, `dapp-store` profile → .apk
npm run build:dapp-store:local    # same, on this machine (needs JDK 17 + Android SDK)
```

The profile extends `production`, sets `EXPO_PUBLIC_DISTRIBUTION=dapp-store`,
auto-increments `versionCode` (every dApp Store update needs a higher one), and
signs with the local keystore from `credentials.json`.

Verify the signature:

```bash
apksigner verify --print-certs build-*.apk
```

## 4. First release: Publisher Portal

1. https://publish.solanamobile.com — sign up, fill in the publisher profile,
   submit KYC/KYB.
2. Connect the **publisher wallet** (browser extension: Phantom, Solflare,
   Backpack) holding ~0.2 SOL for fees + ArDrive storage. Every future
   submission of Bread needs this same wallet — don't lose it.
3. Pick a storage provider (ArDrive recommended; top up its balance if the
   estimator goes negative).
4. "Add a dApp" → "New dApp": name, description, icon, screenshots (see the
   portal's Listing Page Guidelines for exact sizes).
5. App **Home** → "New Version" → upload the APK → Submit, then approve
   **every** signing prompt (Arweave uploads + release NFT mint). Skipping one
   leaves assets missing from the submission.

Review takes 3–5 business days; results come from
`publishersupport@dappstore.solanamobile.com`. Stalled past 5 days → App Review
Inquiry in `#dev-answers` on the Solana Mobile Discord.

The listing must follow the Publisher Policy. Bread surfaces tokenized equities
and prediction markets, so keep geo-restricted features gated exactly as in the
app and avoid return/yield claims in the copy.

## 5. Updates: publishing CLI

```bash
export DAPP_STORE_API_KEY=...   # https://publish.solanamobile.com/dashboard/settings/api-keys
npm run publish:dapp-store -- \
  --apk ./build-XXXX.apk \
  --keypair ./dapp-store-keypair.json \
  --whats-new "What changed in this version"
```

`dapp-store-keypair.json` is the Solana CLI keypair of the publisher signer
(gitignored). The portal matches the APK to the app by package name.
