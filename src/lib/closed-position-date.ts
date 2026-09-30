/**
 * Compact timestamp used under closed holdings, matching the history-list
 * treatment: `18 Feb at 1:48 AM`. The year is included only for older trades.
 */
export function formatClosedPositionDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const sameYear = date.getFullYear() === now.getFullYear();
  const day = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${day} at ${time}`;
}
