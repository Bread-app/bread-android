import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

/* ─── Types ─── */

/** One OHLC bar. `time` is UNIX **seconds**, UTC — lightweight-charts' native unit. */
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/** Optional pin drawn above a bar. `time` must line up with a candle's `time`. */
export type ChartMarker = {
  id: string;
  time: number;
  text?: string;
  color?: string;
};

export type ChartTheme = {
  /** The chart canvas itself — bright by default, independent of the app theme. */
  background?: string;
  textColor?: string;
  gridColor?: string;
  borderColor?: string;
  upColor?: string;
  downColor?: string;
  crosshairColor?: string;
  /** Background of the price/time pills the crosshair drops on each axis. */
  crosshairLabelColor?: string;
  /** Live-price rule + its pill when the newest candle is bullish. */
  livePriceUpColor?: string;
  /** …and when it's bearish. */
  livePriceDownColor?: string;
};

export type TradingViewCandlestickChartHandle = {
  /**
   * Realtime tick. Mutates the last bar when `time` matches it and appends a new
   * bar when it moves forward — the chart is never redrawn. Safe to call before
   * the page is ready; the newest pending candle is flushed on the handshake.
   */
  update: (candle: Candle) => void;
  /** Replace the whole series (a timeframe switch, a different asset). */
  setData: (candles: Candle[]) => void;
  fitContent: () => void;
};

type Props = {
  data: Candle[];
  theme?: ChartTheme;
  /** Fires with the hovered bar while the crosshair is over the plot, `null` when it leaves. */
  onCrosshair?: (bar: Candle | null) => void;
  markers?: ChartMarker[];
  style?: StyleProp<ViewStyle>;
};

/* ─── Theme ─── */

const DEFAULT_THEME: Required<ChartTheme> = {
  background: '#FFFFFF',
  textColor: '#131722',
  gridColor: '#EEF1F5',
  borderColor: '#E3E6EB',
  upColor: '#089981',
  downColor: '#F23645',
  crosshairColor: '#9598A1',
  // Deliberately light: it has to read as a different thing from the coloured
  // live-price pill sitting on the same scale.
  crosshairLabelColor: '#E9EDF5',
  livePriceUpColor: '#02ED45',
  livePriceDownColor: '#D2042D',
};

/**
 * v5 standalone UMD build — exposes the `LightweightCharts` global and carries
 * its own dependencies, which is what makes it loadable from a plain script tag
 * inside a WebView. The `@5` range is deliberate: the v5 API used below
 * (`addSeries`, `CandlestickSeries`) does not exist in v4.
 */
const LIB_URL = 'https://unpkg.com/lightweight-charts@5/dist/lightweight-charts.standalone.production.js';

/* ─── Page ─── */

/**
 * Built once per theme and never per data change: re-rendering the HTML would
 * reload the page and throw away the series, which is exactly what realtime
 * updates must not do. Data arrives over `injectJavaScript` instead.
 */
function buildChartHtml(theme: Required<ChartTheme>): string {
  const t = JSON.stringify(theme);
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>
  html,body{margin:0;padding:0;height:100%;width:100%;overflow:hidden;background:${theme.background};
    overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
  #chart{position:absolute;inset:0}
</style></head><body>
<div id="chart"></div>
<script src="${LIB_URL}"></script>
<script>
var T = ${t};
var post = function (msg) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
};

function boot() {
  if (!window.LightweightCharts) { post({ type: 'error', message: 'lightweight-charts failed to load' }); return; }
  var LC = window.LightweightCharts;

  // Bars are intraday until \`setData\` says otherwise — decides whether the
  // crosshair's time pill carries a clock.
  var intraday = true;

  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Pinned rather than left to the library default, because the width
  // measurement below has to use the exact font the scale renders with.
  var FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
  var FONT_SIZE = 10;

  var formatPrice = function (v) {
    var abs = Math.abs(v);
    // Sub-dollar assets need the extra places; large caps look absurd with them.
    var d = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
    // Group the integer part only — running the separator regex over the whole
    // fixed string lets the decimals break the lookahead. The backslashes are
    // doubled because this page is a template literal: a lone \d reaches the
    // WebView as a bare "d" and the grouping silently stops working.
    var parts = v.toFixed(d).split('.');
    parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
    return '$' + parts.join('.');
  };

  var chart = LC.createChart(document.getElementById('chart'), {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: T.background },
      textColor: T.textColor,
      // The tick builder spaces price levels off the font metrics, so this is
      // the only lever on how many of them the ladder shows. 10 gets the
      // reference's density without the labels touching.
      fontSize: FONT_SIZE,
      fontFamily: FONT_FAMILY,
      attributionLogo: false
    },
    grid: {
      vertLines: { color: T.gridColor },
      horzLines: { color: T.gridColor }
    },
    crosshair: {
      mode: LC.CrosshairMode.Normal,
      vertLine: {
        color: T.crosshairColor,
        width: 1,
        style: LC.LineStyle.Dashed,
        labelVisible: true,
        labelBackgroundColor: T.crosshairLabelColor
      },
      horzLine: {
        color: T.crosshairColor,
        width: 1,
        style: LC.LineStyle.Dashed,
        labelVisible: true,
        labelBackgroundColor: T.crosshairLabelColor
      }
    },
    rightPriceScale: {
      visible: true,
      // A hairline rule between plot and scale reads as chrome on a phone. The
      // labels alone are enough separation.
      borderVisible: false,
      ticksVisible: false,
      // \`true\` drops the top and bottom labels whenever they'd be clipped,
      // which is exactly where the extremes of the range live — the levels
      // most worth reading.
      entireTextOnly: false,
      // Sized at runtime by reserveScaleWidth — see there for why the library's
      // own sizing isn't enough.
      minimumWidth: 76,
      scaleMargins: { top: 0.12, bottom: 0.12 }
    },
    timeScale: {
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 4,
      lockVisibleTimeRangeOnResize: true
    },
    localization: {
      priceFormatter: formatPrice,
      timeFormatter: function (t) {
        var d = new Date(t * 1000);
        var day = WD[d.getDay()] + ' ' + d.getDate() + ' ' + MO[d.getMonth()] +
          " '" + String(d.getFullYear()).slice(-2);
        return intraday ? day + '  ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : day;
      }
    },
    // Scrub-first, like the SVG chart this replaces. Leaving \`horzTouchDrag\` at
    // its default means a finger drag PANS the plot and the crosshair only
    // shows up after a long-press — which reads as lag, not as a crosshair.
    // With touch drag off, a touch enters tracking mode immediately and the
    // crosshair follows the finger 1:1.
    handleScroll: { horzTouchDrag: false, vertTouchDrag: false, mouseWheel: false, pressedMouseMove: false },
    handleScale: false,
    // Momentum would keep the plot sliding after the finger lifts, dragging the
    // crosshair readout along with it.
    kineticScroll: { touch: false, mouse: false },
    trackingMode: { exitMode: LC.TrackingModeExitMode.OnTouchEnd }
  });

  // v5 API. \`addCandlestickSeries\` was removed — series types are values now.
  var series = chart.addSeries(LC.CandlestickSeries, {
    upColor: T.upColor,
    downColor: T.downColor,
    borderVisible: false,
    wickUpColor: T.upColor,
    wickDownColor: T.downColor,
    // The built-in live-price line takes the candle colours and offers no way
    // to diverge from them, so it's off in favour of the managed price line
    // below — that one gets its own bullish/bearish palette.
    priceLineVisible: false,
    lastValueVisible: false
  });

  // Perceived brightness, so a pill's text stays legible whatever colour the
  // caller themes it. Kept regex-free: this page is a template literal.
  var lum = function (hex) {
    var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  };
  var textOn = function (hex) { return lum(hex) > 0.6 ? '#0B0D11' : '#FFFFFF'; };

  // The crosshair and live-price pills are wider than the plain tick labels
  // they sit among: each adds horizontal padding and a pointer tail. But the
  // scale sizes its column to the TEXT alone, so the pills overflow left, out
  // of the column and onto the candles. Reserve the difference explicitly.
  var PILL_PADDING = 34;
  var scaleFont = FONT_SIZE + 'px ' + FONT_FAMILY;
  var meas = document.createElement('canvas').getContext('2d');
  var widest = 0;

  var reserveScaleWidth = function (values) {
    meas.font = scaleFont;
    var w = widest;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (typeof v === 'number' && isFinite(v)) {
        w = Math.max(w, meas.measureText(formatPrice(v)).width);
      }
    }
    if (w <= widest) return;
    widest = w;
    chart.priceScale('right').applyOptions({ minimumWidth: Math.ceil(w) + PILL_PADDING });
  };

  var priceLine = null;

  // The live-price rule tracks the newest candle's direction, not the series'
  // candle colours — bullish reads green, bearish reads pink.
  var syncPriceLine = function (bar) {
    if (!bar) return;
    var color = bar.close >= bar.open ? T.livePriceUpColor : T.livePriceDownColor;
    var opts = {
      price: bar.close,
      color: color,
      lineWidth: 1,
      lineStyle: LC.LineStyle.Dotted,
      axisLabelVisible: true,
      axisLabelColor: color,
      axisLabelTextColor: textOn(color)
    };
    if (priceLine) priceLine.applyOptions(opts);
    else priceLine = series.createPriceLine(opts);
  };

  var markersApi = null;
  var lastBar = null;

  window.__setData = function (json) {
    var rows = JSON.parse(json);
    if (rows.length > 1) intraday = rows[rows.length - 1].time - rows[rows.length - 2].time < 86400;
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].low < lo) lo = rows[i].low;
      if (rows[i].high > hi) hi = rows[i].high;
    }
    // From scratch: the previous asset may have been orders of magnitude away.
    widest = 0;
    reserveScaleWidth([lo, hi]);
    series.setData(rows);
    lastBar = rows.length ? rows[rows.length - 1] : null;
    syncPriceLine(lastBar);
    chart.timeScale().fitContent();
  };

  window.__update = function (json) {
    var bar = JSON.parse(json);
    // \`update\` rejects a bar older than the last one; dropping it keeps a
    // late-arriving tick from tearing down the series with an exception.
    if (lastBar && bar.time < lastBar.time) return;
    reserveScaleWidth([bar.high, bar.low]);
    series.update(bar);
    lastBar = bar;
    syncPriceLine(bar);
  };

  window.__setMarkers = function (json) {
    var rows = JSON.parse(json);
    if (!markersApi) {
      if (!LC.createSeriesMarkers) return;
      markersApi = LC.createSeriesMarkers(series, rows);
      return;
    }
    markersApi.setMarkers(rows);
  };

  window.__fit = function () { chart.timeScale().fitContent(); };

  var lastSent = null;
  var queued;
  var frame = 0;

  // Two stages of throttling, because the crosshair itself must stay at canvas
  // framerate while the bridge must not. Stage one drops everything that isn't
  // a new bar; stage two collapses whatever survives into one message per
  // frame, so a fast scrub across the series can't outrun the native side.
  var flush = function () {
    frame = 0;
    if (queued === undefined) return;
    var bar = queued;
    queued = undefined;
    post({ type: 'crosshair', bar: bar });
  };

  var send = function (bar) {
    queued = bar;
    if (!frame) frame = requestAnimationFrame(flush);
  };

  chart.subscribeCrosshairMove(function (param) {
    var bar = param && param.time != null ? param.seriesData.get(series) : null;
    if (!bar) {
      if (lastSent !== null) { lastSent = null; send(null); }
      return;
    }
    if (lastSent === bar.time) return;
    lastSent = bar.time;
    send({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
  });

  post({ type: 'ready' });
}

if (window.LightweightCharts) boot();
else {
  document.querySelector('script[src]').addEventListener('load', boot);
  document.querySelector('script[src]').addEventListener('error', function () {
    post({ type: 'error', message: 'lightweight-charts failed to load' });
  });
}
</script></body></html>`;
}

/* ─── Component ─── */

/** Serialise once, pass as a JS string literal, `JSON.parse` on the far side. */
const asArg = (value: unknown) => JSON.stringify(JSON.stringify(value));

/**
 * TradingView's own renderer, in a WebView. This is the real
 * `lightweight-charts` canvas — its crosshair, its price/time scales, its
 * candle geometry — rather than an SVG lookalike.
 *
 * The component owns no data: it renders `data`, streams ticks through the
 * `update` handle, and reports the hovered bar through `onCrosshair` so the
 * caller can draw a native OHLC legend over it.
 */
const TradingViewCandlestickChartImpl = forwardRef<
  TradingViewCandlestickChartHandle,
  Props
>(function TradingViewCandlestickChart({ data, theme, onCrosshair, markers, style }, ref) {
  const webViewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  // A tick that arrived before the handshake. Only the newest is worth keeping —
  // `setData` on ready already carries everything older.
  const pendingUpdateRef = useRef<Candle | null>(null);

  const resolvedTheme = useMemo<Required<ChartTheme>>(
    () => ({ ...DEFAULT_THEME, ...theme }),
    [theme],
  );
  const html = useMemo(() => buildChartHtml(resolvedTheme), [resolvedTheme]);

  const inject = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(`${script} true;`);
  }, []);

  // A new page means the old readiness describes a chart that no longer exists.
  useEffect(() => {
    setReady(false);
  }, [html]);

  useEffect(() => {
    if (!ready) return;
    inject(`window.__setData(${asArg(data)});`);
    const pending = pendingUpdateRef.current;
    if (pending) {
      pendingUpdateRef.current = null;
      inject(`window.__update(${asArg(pending)});`);
    }
  }, [ready, data, inject]);

  useEffect(() => {
    if (!ready) return;
    inject(
      `window.__setMarkers(${asArg(
        (markers ?? []).map((m) => ({
          time: m.time,
          position: 'aboveBar',
          shape: 'circle',
          color: m.color ?? resolvedTheme.textColor,
          text: m.text ?? '',
        })),
      )});`,
    );
  }, [ready, markers, inject, resolvedTheme.textColor]);

  useImperativeHandle(
    ref,
    () => ({
      update: (candle: Candle) => {
        if (!ready) {
          pendingUpdateRef.current = candle;
          return;
        }
        inject(`window.__update(${asArg(candle)});`);
      },
      setData: (candles: Candle[]) => {
        if (!ready) return;
        inject(`window.__setData(${asArg(candles)});`);
      },
      fitContent: () => inject('window.__fit();'),
    }),
    [ready, inject],
  );

  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      let msg: { type?: string; bar?: Candle | null };
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'ready') setReady(true);
      else if (msg.type === 'crosshair') onCrosshair?.(msg.bar ?? null);
    },
    [onCrosshair],
  );

  return (
    <View style={[styles.root, { backgroundColor: resolvedTheme.background }, style]}>
      <WebView
        ref={webViewRef}
        source={{ html, baseUrl: 'https://breadapp.fun' }}
        style={[styles.webview, { backgroundColor: resolvedTheme.background }]}
        javaScriptEnabled
        // Full-bleed and inert: every scroll gesture belongs to the chart or to
        // the screen behind it, never to the WebView's own document.
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        setSupportMultipleWindows={false}
        androidLayerType="hardware"
        onMessage={handleMessage}
      />
    </View>
  );
});

// Memoized because the caller re-renders on every crosshair bar to redraw its
// legend. Without this, each scrub step re-renders the WebView subtree — cheap
// on its own, but it lands on the same JS frame the crosshair is animating in.
export const TradingViewCandlestickChart = React.memo(TradingViewCandlestickChartImpl);

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  webview: { flex: 1 },
});
