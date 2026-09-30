import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { useFocusEffect } from '@react-navigation/native';

export type YouTubeClipPlayerHandle = {
  /**
   * Seek the live player to a window of the video. Safe to call before the page
   * is ready — the request is held and flushed on `ready`.
   *
   * Pass `endMs` only when playback SHOULD stop there. YouTube honours
   * `endSeconds` by halting the video dead, which is right for "play just this
   * call" and wrong for "start here and keep listening".
   */
  seek: (startMs: number, endMs?: number | null) => void;
  play: () => void;
  pause: () => void;
  setMuted: (muted: boolean) => void;
};

type Props = {
  videoId: string;
  /** Where playback begins on first load. Omit or 0 for the top of the video. */
  initialStartMs?: number | null;
  initialEndMs?: number | null;
  /** false loads the player paused behind its poster. */
  autoplay?: boolean;
  /** true hides YouTube's own chrome, for the inline hero look. */
  hideControls?: boolean;
  posterUri?: string | null;
  /** Rendered in place of the player once the embed reports a failure. */
  renderFallback?: () => React.ReactNode;
  /**
   * The embed was refused (age-gated, owner-disabled, unavailable). Callers that
   * own their own fallback chrome — a thumbnail that deep-links out — listen
   * here instead of passing `renderFallback`.
   */
  onError?: () => void;
  onStateChange?: (state: 'playing' | 'paused' | 'ended') => void;
  style?: StyleProp<ViewStyle>;
};

/** Pad the end of a clip so a sentence isn't cut mid-word. */
const CLIP_END_PAD_S = 2;

/**
 * Self-contained page driving the YouTube IFrame API.
 *
 * A bare `youtube.com/embed/...` URL in a WebView is served to a null origin,
 * which YouTube answers with its mobile homepage instead of the player — so the
 * page is loaded as HTML under a real https `baseUrl`. Do not "simplify" this
 * into a `uri:` source.
 *
 * `startSeconds` goes into the constructor rather than a post-`ready` seek so
 * the very first frame is already at the moment; seeking after ready shows 0:00
 * first and then jumps.
 */
function buildPlayerHtml(
  videoId: string,
  opts: { autoplay: boolean; hideControls: boolean; startSeconds: number; endSeconds: number | null },
): string {
  const id = JSON.stringify(videoId);
  const start = Math.max(0, Math.floor(opts.startSeconds));
  const end = opts.endSeconds != null && opts.endSeconds > start ? Math.floor(opts.endSeconds) : null;
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}
#player{position:absolute;top:0;left:0;width:100%;height:100%}</style></head><body>
<div id="player"></div>
<script>
var tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';document.head.appendChild(tag);
var player;
function post(t){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(t)}
function onYouTubeIframeAPIReady(){
  player=new YT.Player('player',{
    videoId:${id},
    playerVars:{
      autoplay:${opts.autoplay ? 1 : 0},
      // Muted is the only autoplay iOS honours; the RN side unmutes on a tap.
      mute:1,
      playsinline:1,
      controls:${opts.hideControls ? 0 : 1},
      rel:0,modestbranding:1,iv_load_policy:3,
      start:${start}${end != null ? `,end:${end}` : ''}
    },
    events:{
      onReady:function(e){
        e.target.mute();
        ${opts.autoplay ? 'e.target.playVideo();' : ''}
        post('ready');
      },
      onStateChange:function(e){
        if(e.data===1)post('playing');
        else if(e.data===2)post('paused');
        else if(e.data===0){post('ended');post('paused')}
      },
      onError:function(e){post('error:'+e.data)}
    }
  });
}
// Load a bounded window of the video. endSeconds is only sent when it is
// actually past the start, otherwise YouTube discards the whole cue.
window.__clip=function(s,e){
  if(!player||!player.loadVideoById)return;
  var o={videoId:${id},startSeconds:s};
  if(e&&e>s)o.endSeconds=e;
  player.loadVideoById(o);
  player.playVideo();
  // A clip is always the result of an explicit tap, so try for sound. If the
  // platform refuses, the player's own controls still offer unmute.
  player.unMute();player.setVolume(100);
};
window.__cmd=function(c){
  if(!player||!player.playVideo)return;
  if(c==='play')player.playVideo();
  else if(c==='pause')player.pauseVideo();
  else if(c==='mute')player.mute();
  else if(c==='unmute'){player.unMute();player.setVolume(100)}
};
</script></body></html>`;
}

/**
 * The one YouTube player in the app. Three screens embed a video — the podcast
 * moments feed, the episode detail screen and the sandwich detail hero — and
 * all three need to start at, or jump to, the timestamp a call was made at.
 */
export const YouTubeClipPlayer = forwardRef<YouTubeClipPlayerHandle, Props>(function YouTubeClipPlayer(
  {
    videoId,
    initialStartMs,
    initialEndMs,
    autoplay = true,
    hideControls = false,
    posterUri,
    renderFallback,
    onError,
    onStateChange,
    style,
  },
  ref,
) {
  const webViewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // Held until the first `playing` frame so there is no white or error flash.
  const [started, setStarted] = useState(false);
  // A seek requested before the page was ready. The IFrame API can only be
  // driven once it reports `ready`, so callers never have to think about it.
  const pendingSeekRef = useRef<{ startMs: number; endMs: number | null } | null>(null);

  const startSeconds = Math.max(0, Math.floor((initialStartMs ?? 0) / 1000));
  const html = useMemo(
    () =>
      buildPlayerHtml(videoId, {
        autoplay,
        hideControls,
        startSeconds,
        endSeconds: initialEndMs != null ? Math.floor(initialEndMs / 1000) + CLIP_END_PAD_S : null,
      }),
    // `initialStartMs` is baked into the page, so changing it rebuilds the HTML
    // and reloads the player — correct when the screen switches to a different
    // sandwich, and never hit during a normal seek (which goes through `seek`).
    [videoId, autoplay, hideControls, startSeconds, initialEndMs],
  );

  const inject = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(`${script} true;`);
  }, []);

  const runSeek = useCallback(
    (startMs: number, endMs: number | null) => {
      const start = Math.max(0, Math.floor(startMs / 1000));
      const end = endMs != null ? Math.floor(endMs / 1000) + CLIP_END_PAD_S : 0;
      inject(`window.__clip(${start}, ${end});`);
    },
    [inject],
  );

  useImperativeHandle(
    ref,
    () => ({
      seek: (startMs: number, endMs: number | null = null) => {
        if (!ready) {
          pendingSeekRef.current = { startMs, endMs };
          return;
        }
        runSeek(startMs, endMs);
      },
      play: () => inject(`window.__cmd('play');`),
      pause: () => inject(`window.__cmd('pause');`),
      setMuted: (muted: boolean) => inject(`window.__cmd('${muted ? 'mute' : 'unmute'}');`),
    }),
    [inject, ready, runSeek],
  );

  // A new `html` remounts the page (a different video, or a different moment on
  // the same one), so the old readiness no longer describes what is loaded.
  // Without this reset a seek fired during the reload would be injected into a
  // page whose IFrame API hasn't booted and be dropped on the floor; queuing it
  // instead means it lands as soon as the new page reports in.
  useEffect(() => {
    setReady(false);
    setStarted(false);
  }, [html]);

  useEffect(() => {
    if (!ready) return;
    const pending = pendingSeekRef.current;
    if (pending) {
      pendingSeekRef.current = null;
      runSeek(pending.startMs, pending.endMs);
      return;
    }
    // iOS occasionally ignores the constructor's `start` and begins at 0. This
    // is idempotent when the player is already in the right place, and turns a
    // rare silently-wrong position into a visible seek.
    if (startSeconds > 0 && autoplay) {
      runSeek(startSeconds * 1000, initialEndMs ?? null);
    }
    // Only on the ready edge — re-running this on every prop change would yank
    // the video back to the start mid-watch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Expo Router keeps pushed screens mounted, so a user who drills from the
  // episode screen into a sandwich has two players alive at once and would hear
  // both. Pausing on blur is what keeps only the visible one audible; nothing
  // resumes automatically, since coming back to a screen is not a request to
  // start playing.
  useFocusEffect(
    useCallback(() => {
      return () => inject(`window.__cmd('pause');`);
    }, [inject]),
  );

  if (failed) return <>{renderFallback?.()}</>;

  return (
    <View style={[styles.root, style]}>
      <WebView
        ref={webViewRef}
        // A real https origin, never about:blank — YouTube serves a null-origin
        // embed its mobile homepage instead of a player.
        source={{ html, baseUrl: 'https://breadapp.fun' }}
        style={styles.webview}
        javaScriptEnabled
        scrollEnabled={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo={false}
        setSupportMultipleWindows={false}
        onMessage={(event) => {
          const data = event.nativeEvent.data;
          if (data === 'ready') {
            setReady(true);
          } else if (data === 'playing') {
            setStarted(true);
            onStateChange?.('playing');
          } else if (data === 'paused') {
            onStateChange?.('paused');
          } else if (data === 'ended') {
            onStateChange?.('ended');
          } else if (data.startsWith('error:')) {
            setFailed(true);
            onError?.();
          }
        }}
      />
      {!started ? (
        // Never swallows a tap: with `controls`, YouTube's own play button sits
        // underneath and has to stay reachable until the first frame arrives.
        <View pointerEvents="none" style={styles.poster}>
          <Image
            source={{ uri: posterUri ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }}
            style={styles.posterImage}
            resizeMode="cover"
          />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: '#000' },
  poster: { ...StyleSheet.absoluteFillObject },
  posterImage: { width: '100%', height: '100%' },
});
