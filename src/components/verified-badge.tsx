import React from "react";
import Svg, { Path } from "react-native-svg";

type Props = {
  size?: number;
  /** Themes the scalloped seal; the checkmark stays white. */
  color?: string;
};

/**
 * Bread verified badge — the scalloped seal + white checkmark, drawn as an SVG
 * (no bundled PNG) so it stays crisp at any size.
 */
export function VerifiedBadge({ size = 15, color = "#1D9BF0" }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484z"
      />
      <Path
        fill="#FFFFFF"
        d="M9.99 16.19l-3.61-3.6 1.42-1.42 2.19 2.19 5.19-5.2 1.42 1.42-6.6 6.61z"
      />
    </Svg>
  );
}
