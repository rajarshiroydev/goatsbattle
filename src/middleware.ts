import { defineMiddleware } from 'astro:middleware';
import { auth } from './lib/auth';

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
  if (context.isPrerendered) return next();
  if (!context.request.headers.has('cookie')) return next();

  try {
    const data = await auth.api.getSession({ headers: context.request.headers });
    context.locals.user = data?.user ?? null;
    context.locals.session = data?.session ?? null;
  } catch {
    // leave the logged-out defaults set above
  }

  return next();
});
