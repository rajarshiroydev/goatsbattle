import { defineMiddleware } from 'astro:middleware';
import { auth } from './lib/auth';

const devConnections = import.meta.env.DEV ? ' ws://localhost:*' : '';
const upgradeInsecure = import.meta.env.PROD ? '; upgrade-insecure-requests' : '';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data:; connect-src 'self'${devConnections}${upgradeInsecure}`,
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const secured = (response: Response) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
};

/**
 * Attach the better-auth session/user to `context.locals` for on-demand routes
 * (API routes + SSR pages read `locals.user`). Short-circuits to null when the
 * request has no cookie so prerendered/anonymous hits skip the DB round-trip.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  // Default to logged-out without touching headers (avoids Astro's
  // "request.headers on a prerendered page" warning at build time).
  context.locals.user = null;
  context.locals.session = null;

  // Prerendered pages have no per-request session; skip the header read + DB hit.
  if (context.isPrerendered) return secured(await next());
  if (!context.request.headers.has('cookie')) return secured(await next());

  try {
    // Bound the lookup so a slow auth/DB backend can't stall every request;
    // on timeout or error we fall through to the logged-out defaults above.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('session lookup timed out')), 5000),
    );
    const data = await Promise.race([
      auth.api.getSession({ headers: context.request.headers }),
      timeout,
    ]);
    context.locals.user = data?.user ?? null;
    context.locals.session = data?.session ?? null;
  } catch {
    // leave the logged-out defaults set above
  }

  return secured(await next());
});
