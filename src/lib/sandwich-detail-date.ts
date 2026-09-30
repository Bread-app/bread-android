/**
 * Absolute local timestamp used above the social actions on a sandwich detail.
 * The compact numeric date mirrors the source-post treatment without making
 * people translate a relative age back into the actual creation time.
 */
export function formatSandwichDetailDateTime(iso: string | null): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);

  return `${time} · ${day}/${month}/${year}`;
}
