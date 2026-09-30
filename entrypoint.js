/* eslint-disable import/first */
// Must stay first: installs the native crypto polyfill MWA and web3.js expect.
import './polyfill';
import 'react-native-get-random-values';
import '@ethersproject/shims';
import { Buffer } from 'buffer';
import 'fast-text-encoding';

if (typeof globalThis.crypto?.getRandomValues === 'function') {
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);

  globalThis.crypto.getRandomValues = (array) => {
    const result = getRandomValues(array);

    // Some shims mutate in place but do not return the array. uuid expects a return value.
    return result ?? array;
  };
}

global.Buffer = Buffer;

import 'expo-router/entry';
