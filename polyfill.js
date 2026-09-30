// Solana Mobile's React Native setup requires the quick-crypto polyfill to be
// installed before any Solana client library loads:
// https://docs.solanamobile.com/get-started/react-native/installation
import { install } from 'react-native-quick-crypto';

install();
