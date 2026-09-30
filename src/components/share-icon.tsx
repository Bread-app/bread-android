import React from "react";
import Svg, { Path } from "react-native-svg";

type Props = {
  size?: number;
  color?: string;
  /** Stroke weight — raise it to sit beside heavy label text. */
  strokeWidth?: number;
};

/**
 * iOS-style share icon (arrow rising out of a tray), matching the SF Symbols
 * `square.and.arrow.up` shape shown in the design spec.
 */
export function ShareIcon({ size = 24, color = "#000", strokeWidth = 1.75 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Arrow stem */}
      <Path
        d="M12 15V4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Arrow head */}
      <Path
        d="M7.5 8.5L12 4L16.5 8.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Tray */}
      <Path
        d="M5 13.5V20C5 20.55 5.45 21 6 21H18C18.55 21 19 20.55 19 20V13.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
