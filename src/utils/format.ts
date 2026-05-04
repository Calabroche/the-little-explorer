// Formatting helpers shared by the UI.

export function formatPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
