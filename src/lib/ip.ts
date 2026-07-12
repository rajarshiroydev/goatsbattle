import { createHash } from 'node:crypto';

// process.env (Vercel / node) first; falls back to Vite's static
// import.meta.env replacement for the dev SSR runtime. See db/index.ts.
const SALT = process.env.IP_HASH_SALT ?? import.meta.env.IP_HASH_SALT;

/**
 * Client IP only from a header paired with evidence that the request traversed
 * a supported trusted edge. This prevents direct/local clients from choosing an
 * arbitrary X-Forwarded-For value. Vercel overwrites x-vercel-forwarded-for;
 * Cloudflare overwrites cf-connecting-ip for Worker requests.
 */
export function getClientIp(headers: Headers): string {
  if (headers.has('x-vercel-id')) {
    return headers.get('x-vercel-forwarded-for')?.split(',')[0].trim()
      ?? headers.get('x-forwarded-for')?.split(',')[0].trim()
      ?? '0.0.0.0';
  }
  if (headers.has('cf-ray')) {
    return headers.get('cf-connecting-ip') ?? '0.0.0.0';
  }
  return '0.0.0.0';
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
