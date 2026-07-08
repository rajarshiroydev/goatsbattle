/** ISO-3166 alpha-2 country code → emoji flag (regional indicator symbols). */
export function flagEmoji(countryCode: string): string {
  const cc = countryCode.trim().toUpperCase();
  if (cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) return '';
  const base = 0x1f1e6; // 🇦
  return String.fromCodePoint(
    base + (cc.charCodeAt(0) - 65),
    base + (cc.charCodeAt(1) - 65),
  );
}

/** Compact vote count, e.g. 1234 → "1.2K", 2_300_000 → "2.3M". */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`.replace('.0', '');
  return `${(n / 1_000_000).toFixed(1)}M`.replace('.0', '');
}

/** Compact relative time from an ISO/Date, e.g. "just now", "5m", "3h", "2d". */
export function relativeTime(input: string | Date): string {
  const then = typeof input === 'string' ? new Date(input) : input;
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 604_800) return `${Math.floor(secs / 86_400)}d`;
  if (secs < 2_592_000) return `${Math.floor(secs / 604_800)}w`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
