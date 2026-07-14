import { createHash } from 'node:crypto';
import { env } from 'cloudflare:workers';

const SALT = env.IP_HASH_SALT;

/**
 * Client IP only from a header paired with evidence that the request traversed
 * a supported trusted edge. This prevents direct/local clients from choosing an
 * arbitrary forwarding value. Cloudflare overwrites cf-connecting-ip and adds
 * cf-ray for Worker requests.
 */
export function getClientIp(headers: Headers): string {
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

/** ISO country from Cloudflare request metadata, uppercased. Null when absent. */
export function getCountry(headers: Headers): string | null {
  const c = headers.get('cf-ipcountry');
  return c ? c.toUpperCase() : null;
}
