import { defineMiddleware } from 'astro:middleware';

const contentSecurityPolicy = import.meta.env.DEV
  ? "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data:; connect-src 'self' ws://localhost:*"
  : "frame-ancestors 'none'; upgrade-insecure-requests";

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': contentSecurityPolicy,
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const SESSION_FREE_GET_PATHS = new Set([
  '/api/goat-battles',
  '/api/match-moments',
  '/api/rankings',
]);

const secured = (response: Response) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    // Astro's CSP integration generates route-specific hashes/nonces. Preserve
    // that complete policy when present; this fallback covers responses that do
    // not pass through Astro's CSP renderer (for example, early API responses).
    if (name === 'Content-Security-Policy' && response.headers.has(name)) continue;
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
  // Keep the apex hostname canonical while still accepting common `www` links.
  // Both hostnames are attached to the production Worker so this redirect does
  // not depend on a separate DNS redirect service.
  if (context.url.hostname === 'www.goatsbattle.com') {
    const canonical = new URL(context.url);
    canonical.hostname = 'goatsbattle.com';
    return secured(Response.redirect(canonical, 308));
  }

  // Default to logged-out without touching headers (avoids Astro's
  // "request.headers on a prerendered page" warning at build time).
  context.locals.user = null;
  context.locals.session = null;

  // Prerendered pages have no per-request session; skip the header read + DB hit.
  if (context.isPrerendered) return secured(await next());
  const pathname = context.url.pathname;
  // Better Auth validates its own cookies. Running getSession in middleware on
  // the same route would duplicate auth/database work.
  if (pathname.startsWith('/api/auth/')) return secured(await next());
  // These GETs are intentionally identical for every viewer.
  if (context.request.method === 'GET' && SESSION_FREE_GET_PATHS.has(pathname)) {
    return secured(await next());
  }
  if (!context.request.headers.has('cookie')) return secured(await next());

  try {
    // Keep Worker-only environment bindings out of the Node prerender graph.
    const { auth } = await import('./lib/auth');
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
