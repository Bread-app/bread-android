import { AppState, type AppStateStatus } from 'react-native';

/**
 * One app-wide WebSocket to Hyperliquid's public stream, for live market data.
 *
 * Public market data needs no key, so the device connects to Hyperliquid
 * directly. Hydromancer's stream is keyed (the key rides in the URL) and is for
 * the server — never ship that key in the app.
 *
 * Subscriptions are reference-counted by their JSON, so two screens watching
 * one market share one upstream subscription. The socket reconnects with
 * backoff, resubscribes everything on reconnect, pings to stay alive, and closes
 * while the app is backgrounded (a pocketed phone streams nothing).
 */

const URL = 'wss://api.hyperliquid.xyz/ws';
/** Hyperliquid drops a connection idle for 60s. */
const PING_MS = 50_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export type HyperliquidSubscription =
  | { type: 'candle'; coin: string; interval: string }
  | { type: 'activeAssetCtx'; coin: string };

export type HyperliquidCandleMessage = {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  n: number;
};

export type HyperliquidAssetCtxMessage = {
  coin: string;
  ctx: {
    markPx?: string;
    midPx?: string | null;
    oraclePx?: string;
    prevDayPx?: string;
    funding?: string;
    openInterest?: string;
    dayNtlVlm?: string;
  };
};

type Listener = (data: unknown) => void;
type StatusListener = (connected: boolean) => void;

type Entry = { subscription: HyperliquidSubscription; listeners: Set<Listener> };

const entries = new Map<string, Entry>();
const statusListeners = new Set<StatusListener>();
let socket: WebSocket | null = null;
let connected = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let foreground = AppState.currentState === 'active';
let appStateSubscribed = false;

function keyOf(subscription: HyperliquidSubscription): string {
  return subscription.type === 'candle'
    ? `candle|${subscription.coin}|${subscription.interval}`
    : `activeAssetCtx|${subscription.coin}`;
}

/** Which entry an incoming message belongs to. */
function keyOfMessage(channel: string, data: Record<string, unknown>): string | null {
  if (channel === 'candle' && typeof data.s === 'string' && typeof data.i === 'string') {
    return `candle|${data.s}|${data.i}`;
  }
  if (channel === 'activeAssetCtx' && typeof data.coin === 'string') {
    return `activeAssetCtx|${data.coin}`;
  }
  return null;
}

function setConnected(next: boolean) {
  if (connected === next) return;
  connected = next;
  statusListeners.forEach((listener) => listener(next));
}

function send(message: unknown) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function clearTimers() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function closeSocket() {
  clearTimers();
  const current = socket;
  socket = null;
  setConnected(false);
  if (current) {
    current.onopen = null;
    current.onclose = null;
    current.onerror = null;
    current.onmessage = null;
    current.close();
  }
}

function scheduleReconnect() {
  if (reconnectTimer || entries.size === 0 || !foreground) return;
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (socket || entries.size === 0 || !foreground) return;
  const next = new WebSocket(URL);
  socket = next;
  next.onopen = () => {
    reconnectAttempt = 0;
    setConnected(true);
    entries.forEach((entry) => send({ method: 'subscribe', subscription: entry.subscription }));
    pingTimer = setInterval(() => send({ method: 'ping' }), PING_MS);
  };
  next.onmessage = (event) => {
    let message: { channel?: string; data?: unknown };
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!message.channel || !message.data || typeof message.data !== 'object') return;
    const key = keyOfMessage(message.channel, message.data as Record<string, unknown>);
    const entry = key ? entries.get(key) : undefined;
    entry?.listeners.forEach((listener) => listener(message.data));
  };
  next.onerror = () => {
    // onclose follows and owns the retry.
  };
  next.onclose = () => {
    if (socket !== next) return;
    socket = null;
    clearTimers();
    setConnected(false);
    scheduleReconnect();
  };
}

function ensureAppStateListener() {
  if (appStateSubscribed) return;
  appStateSubscribed = true;
  AppState.addEventListener('change', (state: AppStateStatus) => {
    foreground = state === 'active';
    if (foreground) {
      reconnectAttempt = 0;
      connect();
    } else {
      closeSocket();
    }
  });
}

/**
 * Receive `subscription`'s messages until the returned function is called.
 * The first subscriber opens the socket; the last one out closes it.
 */
export function subscribeHyperliquid(
  subscription: HyperliquidSubscription,
  listener: Listener,
): () => void {
  ensureAppStateListener();
  const key = keyOf(subscription);
  let entry = entries.get(key);
  if (!entry) {
    entry = { subscription, listeners: new Set() };
    entries.set(key, entry);
    send({ method: 'subscribe', subscription });
  }
  entry.listeners.add(listener);
  connect();

  return () => {
    const current = entries.get(key);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    entries.delete(key);
    send({ method: 'unsubscribe', subscription });
    if (entries.size === 0) closeSocket();
  };
}

/** Connection state, for callers that fall back to polling while it's down. */
export function onHyperliquidStreamStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(connected);
  return () => statusListeners.delete(listener);
}
