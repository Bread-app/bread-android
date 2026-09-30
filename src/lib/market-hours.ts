import { isDemoMode } from './demo/demo-config';

export const ONDO_MARKET_HOURS_URL =
  'https://docs.ondo.finance/ondo-global-markets/market-hours-and-trading-availability';

/** Short, user-facing copy for a live Jupiter/Ondo availability refusal. */
export const ONDO_TRADE_UNAVAILABLE_MESSAGE =
  'Ondo trading is unavailable right now. It usually runs 24/5, Sunday 8 PM–Friday 8 PM ET.';

/**
 * US equity market hours (9:30 AM–4:00 PM ET, Mon–Fri).
 *
 * This describes the underlying cash session only. It must not be used as an
 * Ondo availability gate: Ondo's secondary market generally runs 24/5, and the
 * live Jupiter response remains the authority on whether a trade can fill.
 *
 * DST is handled by formatting the current instant in America/New_York.
 * Market holidays are NOT modeled — on a holiday the check reads "open", and
 * the order just behaves like any other RFQ miss.
 */
export function isUsEquityMarketOpen(now: Date = new Date()): boolean | null {
  // A shoot happens when the light is right, not when the bell rings. Demo mode
  // reports the session open so the buy sheet never wears a closed-market note.
  if (isDemoMode()) return true;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const weekday = get('weekday');
    const hour = Number(get('hour'));
    const minute = Number(get('minute'));
    if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (weekday === 'Sat' || weekday === 'Sun') return false;
    // Some engines report midnight as hour 24 — the % keeps it in range.
    const minutes = (hour % 24) * 60 + minute;
    return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  } catch {
    // Intl/timezone data unavailable — caller falls back to the generic note.
    return null;
  }
}
