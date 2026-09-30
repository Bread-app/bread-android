import React from "react";
import Svg, { Path } from "react-native-svg";

type Props = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

/**
 * Remix glyph: two looping arrows chasing each other around a plus — "take
 * this and make your own". Drawn on the same 24px grid and stroke as
 * {@link ShareIcon} so the two sit evenly in an action row.
 */
export function RemixIcon({ size = 24, color = "#000", strokeWidth = 1.75 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Top loop, arrow turning down on the right */}
      <Path
        d="M4 12.5V8.5C4 6.57 5.57 5 7.5 5H16C17.2 5 18.25 5.6 18.9 6.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M19.5 3V7.5H15.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom loop, arrow turning up on the left */}
      <Path
        d="M20 11.5V15.5C20 17.43 18.43 19 16.5 19H8C6.8 19 5.75 18.4 5.1 17.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4.5 21V16.5H8.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Plus */}
      <Path
        d="M12 9V15M9 12H15"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}
