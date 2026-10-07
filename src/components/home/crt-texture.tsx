import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

/**
 * Scanline pitch in points. Three is the sweet spot on a 3x screen: it lands on
 * whole device pixels, so the lines stay crisp instead of shimmering as the
 * board scrolls.
 */
const PITCH = 3;
const LINE = 'rgba(255, 255, 255, 0.05)';

type Props = {
  /**
   * Unique per mount. SVG pattern ids share one document namespace, so two
   * textures on screen with the same id would both resolve to whichever
   * rendered last.
   */
  id?: string;
};

/**
 * A CRT scanline wash for the dark header.
 *
 * Drawn as one repeating SVG pattern rather than a stack of hairline `View`s —
 * a header this tall would otherwise need a couple of hundred nodes, all of
 * them laid out and composited on every scroll frame.
 *
 * Meant to be the LAST child of the board so it lies over everything, the way a
 * real shadow mask sits in front of the phosphor. `pointerEvents="none"` is
 * load-bearing: a full-bleed overlay would otherwise swallow every tap on the
 * balance, the Add cash button and the tape underneath it.
 */
export function CrtTexture({ id = 'crt-scanlines' }: Props) {
  // Measured rather than sized with `100%`. A percentage on the <Svg> resolves
  // against the SVG viewport, not the padded View around it, so the canvas came
  // up short and left the status-bar band at the top of the header unlit.
  // Explicit points cover the whole box, safe-area padding included.
  const [box, setBox] = useState({ width: 0, height: 0 });

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBox((current) =>
          current.width === width && current.height === height
            ? current
            : { width, height },
        );
      }}
    >
      {box.width > 0 && box.height > 0 ? (
        <Svg width={box.width} height={box.height}>
          <Defs>
            <Pattern
              id={id}
              width={PITCH}
              height={PITCH}
              patternUnits="userSpaceOnUse"
            >
              <Rect x={0} y={0} width={PITCH} height={1} fill={LINE} />
            </Pattern>
          </Defs>
          <Rect x={0} y={0} width={box.width} height={box.height} fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}
