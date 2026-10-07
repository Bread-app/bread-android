import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SvgCss } from 'react-native-svg/css';

import { hyperliquidCoinLogoUri } from '@/lib/hyperliquid-perp-market';

/** Hyperliquid's mark, drawn from its own one-path SVG (144×144 viewBox). */
export function HyperliquidLogo({ size = 16, color = '#97FCE4' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 144 144" fill="none" accessibilityLabel="Hyperliquid">
      <Path
        d="M144 71.6991C144 119.306 114.866 134.582 99.5156 120.98C86.8804 109.889 83.1211 86.4521 64.116 84.0456C39.9942 81.0113 37.9057 113.133 22.0334 113.133C3.5504 113.133 0 86.2428 0 72.4315C0 58.3063 3.96809 39.0542 19.736 39.0542C38.1146 39.0542 39.1588 66.5722 62.132 65.1073C85.0007 63.5379 85.4184 34.8689 100.247 22.6271C113.195 12.0593 144 23.4641 144 71.6991Z"
        fill={color}
      />
    </Svg>
  );
}

/**
 * SVG text per URL, fetched once per app session. `null` records a miss —
 * Hyperliquid answers an unknown coin with its HTML app shell, not a 404 — so a
 * failed logo is never re-requested on every scroll.
 */
const svgCache = new Map<string, string | null>();
const svgInFlight = new Map<string, Promise<string | null>>();

function loadSvg(uri: string): Promise<string | null> {
  if (svgCache.has(uri)) return Promise.resolve(svgCache.get(uri) ?? null);
  const pending = svgInFlight.get(uri);
  if (pending) return pending;
  const request = fetch(uri)
    .then(async (response) => {
      if (!response.ok) return null;
      const text = await response.text();
      return /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text) ? text : null;
    })
    .catch(() => null)
    .then((xml) => {
      svgCache.set(uri, xml);
      svgInFlight.delete(uri);
      return xml;
    });
  svgInFlight.set(uri, request);
  return request;
}

/**
 * Hyperliquid's own artwork for a market. It's SVG, which `<Image>` can't draw,
 * and many of these files style their shapes with a `<style>` block — the CSS
 * renderer is what keeps those from drawing as solid black. Anything missing or
 * unparseable falls back to the market's first letter, quietly.
 */
export function HyperliquidCoinLogo({
  coin,
  label,
  size,
  backgroundColor,
  letterColor,
}: {
  coin: string;
  label: string;
  size: number;
  backgroundColor: string;
  letterColor: string;
}) {
  const uri = hyperliquidCoinLogoUri(coin);
  const [xml, setXml] = useState<string | null | undefined>(() =>
    svgCache.has(uri) ? (svgCache.get(uri) ?? null) : undefined,
  );
  useEffect(() => {
    let cancelled = false;
    if (svgCache.has(uri)) {
      setXml(svgCache.get(uri) ?? null);
      return;
    }
    void loadSvg(uri).then((next) => {
      if (!cancelled) setXml(next);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const frame = { width: size, height: size, borderRadius: size / 2, backgroundColor };
  const letter = (
    <View style={[styles.center, frame]}>
      <Text style={[styles.letter, { color: letterColor }]}>{label.slice(0, 1)}</Text>
    </View>
  );
  if (xml === undefined) return <View style={frame} />;
  if (xml === null) return letter;
  return (
    <View style={[styles.center, frame, styles.clip]}>
      <SvgCss
        xml={xml}
        width={size}
        height={size}
        fallback={letter}
        onError={() => {
          svgCache.set(uri, null);
          setXml(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  clip: { overflow: 'hidden' },
  letter: { fontSize: 13, fontWeight: '800' },
});
