import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the app's PURE logic only — PnL signs, moment windows,
 * formatting. Nothing here renders a component or touches the React Native
 * runtime, so no RN preset or jsdom is needed; anything importing `react-native`
 * belongs in a device build, not here.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': new URL('./src/', import.meta.url).pathname,
    },
  },
});
