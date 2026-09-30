#!/usr/bin/env bash
# Creates the Solana dApp Store signing key for Bread.
#
# The dApp Store must NOT reuse the Google Play signing key
# (https://docs.solanamobile.com/dapp-store/build-and-sign-an-apk), so this is
# a separate keystore. Losing it means Bread can never ship another dApp Store
# update — back it up (and its passwords) somewhere outside this repo.
set -euo pipefail

KEYSTORE="${1:-keystores/bread-dapp-store.keystore}"
ALIAS="${2:-bread-dapp-store}"

if [[ -e "$KEYSTORE" ]]; then
  echo "Refusing to overwrite existing keystore at $KEYSTORE" >&2
  exit 1
fi

mkdir -p "$(dirname "$KEYSTORE")"
keytool -genkey -v -keystore "$KEYSTORE" -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000

echo
echo "SHA-256 fingerprint (add it to ANDROID_SHA256_CERT_FINGERPRINTS on the bread-landing Vercel project):"
keytool -list -v -keystore "$KEYSTORE" -alias "$ALIAS" | awk '/SHA256:/ {print $2}'
echo
echo "Next: cp credentials.example.json credentials.json and fill in the passwords."
