import { createHash } from 'node:crypto';

// process.env (Vercel / node) first; falls back to Vite's static
// import.meta.env replacement for the dev SSR runtime. See db/index.ts.
const SALT = process.env.IP_HASH_SALT ?? import.meta.env.IP_HASH_SALT;

/**
 * Best-effort client IP from proxy headers. Vercel sets `x-forwarded-for`
 * (client first) and `x-real-ip`. Falls back to a constant so hashing never
 * throws — the unique constraint still dedups within that bucket.
 */
export function getClientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return headers.get('x-real-ip') ?? '0.0.0.0';
}

/**
 * SHA-256 of (ip + server salt) — a stable, non-reversible fingerprint for
 * per-battle vote dedup. GDPR-safe: the raw IP is never stored. See
 * [[project-goatsbattle]].
 */
export function hashIp(ip: string): string {
  if (!SALT) throw new Error('IP_HASH_SALT is not set.');
  return createHash('sha256').update(`${ip}${SALT}`).digest('hex');
}

/** ISO country from Vercel's geo header, uppercased. Null when absent. */
export function getCountry(headers: Headers): string | null {
  const c = headers.get('x-vercel-ip-country');
  return c ? c.toUpperCase() : null;
}
