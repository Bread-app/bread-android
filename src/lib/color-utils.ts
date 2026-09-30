export type RgbaColor = { r: number; g: number; b: number; a: number };
export type HsvaColor = { h: number; s: number; v: number; a: number };

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

export function parseColor(value: string): RgbaColor | null {
  const input = value.trim();
  const hex = input.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const expanded =
      hex.length === 3 || hex.length === 4
        ? hex.split('').map((part) => `${part}${part}`).join('')
        : hex;
    if (expanded.length !== 6 && expanded.length !== 8) return null;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
      a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgba = input.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/i,
  );
  if (!rgba) return null;
  const channels = rgba.slice(1, 4).map(Number);
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) {
    return null;
  }
  const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
  return { r: channels[0], g: channels[1], b: channels[2], a: alpha };
}

export function rgbaToHsva({ r, g, b, a }: RgbaColor): HsvaColor {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max, a };
}

export function hsvaToRgba({ h, s, v, a }: HsvaColor): RgbaColor {
  const hue = ((h % 360) + 360) % 360;
  const chroma = clamp(v) * clamp(s);
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = clamp(v) - chroma;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [chroma, x, 0];
  else if (hue < 120) rgb = [x, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, x];
  else if (hue < 240) rgb = [0, x, chroma];
  else if (hue < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
    a: clamp(a),
  };
}

export function formatColor(color: RgbaColor): string {
  if (color.a < 0.999) {
    const alpha = Number(color.a.toFixed(2));
    return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`;
  }
  return `#${[color.r, color.g, color.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

export function hsvaToColor(color: HsvaColor): string {
  return formatColor(hsvaToRgba(color));
}

export function withAlpha(color: string, alpha: number): string {
  const parsed = parseColor(color);
  if (!parsed) return color;
  return formatColor({ ...parsed, a: clamp(parsed.a * alpha) });
}

/**
 * Resolves a translucent foreground treatment into an opaque color. This is
 * useful for native controls that flatten or ignore alpha in tint colors.
 */
export function blendColors(
  foreground: string,
  background: string,
  foregroundAmount: number,
): string {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return foreground;
  const amount = clamp(foregroundAmount);
  return formatColor({
    r: bg.r + (fg.r - bg.r) * amount,
    g: bg.g + (fg.g - bg.g) * amount,
    b: bg.b + (fg.b - bg.b) * amount,
    a: 1,
  });
}

/**
 * A light→deep pair around `color` for a subtle same-hue gradient fill.
 * `spread` is how far each stop moves toward white / black.
 */
export function shadeStops(color: string, spread = 0.18): [string, string] {
  return [blendColors(color, '#FFFFFF', 1 - spread), blendColors(color, '#000000', 1 - spread)];
}

export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return null;
  const luminance = (color: RgbaColor) => {
    const channels = [color.r, color.g, color.b].map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const first = luminance(fg);
  const second = luminance(bg);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
