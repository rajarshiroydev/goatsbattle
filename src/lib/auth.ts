import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { user, session, account, verification } from './db/schema';
import { betterAuthRateLimitStorage } from './ratelimit';

const secret = env.BETTER_AUTH_SECRET;
const baseURL = env.BETTER_AUTH_URL;
const googleClientId = env.GOOGLE_CLIENT_ID;
const googleClientSecret = env.GOOGLE_CLIENT_SECRET;
const googleConfigured = Boolean(googleClientId && googleClientSecret);

// Only wire Google when both creds exist so local dev works without them.
const socialProviders =
  googleConfigured
    ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
    : {};

/**
 * Auto-generate a unique handle from the display name / email at signup, checking
 * availability against the unique `username` column and retrying with a fresh
 * suffix a few times before falling back to a longer random one. Avoids raw DB
 * unique-constraint errors surfacing to the user on a rare collision.
 */
async function generateUsername(name: string, email: string): Promise<string> {
  const base =
    (name || email.split('@')[0] || 'goat')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || 'goat';

  for (let i = 0; i < 5; i++) {
    const candidate = `${base}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const [taken] = await db.select({ id: user.id }).from(user).where(eq(user.username, candidate)).limit(1);
    if (!taken) return candidate;
  }
  // Extremely unlikely: fall back to a much larger suffix.
  return `${base}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
}

export const auth = betterAuth({
  // The drizzle adapter defaults to transaction:false (runs sequentially),
  // which is required for the neon-http driver (no interactive transactions).
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),
  secret,
  baseURL,
  // Derive from the deployment origin (baseURL) so it never diverges from env;
  // localhost is always allowed for local dev.
  trustedOrigins: Array.from(new Set([baseURL, 'http://localhost:4321'].filter(Boolean))) as string[],
  account: {
    // Google is the only deployed identity provider. Implicit linking is still
    // restricted to the exact same email, and Better Auth's local-email
    // verification gate remains enabled to prevent pre-registration takeover.
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
      allowDifferentEmails: false,
    },
  },
  session: {
    // Validate the session from a short-lived signed cookie instead of hitting
    // the DB on every request. The middleware runs getSession on EVERY request
    // that carries a cookie (so every API call a logged-in user makes), and the
    // neon-http driver pays a full network round-trip per query — that DB hop
    // was what made the vote button + rankings feel laggy only when logged in.
    // maxAge keeps revocation reasonably fresh; logout clears the cookie locally.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: {
    ipAddress: {
      // Cloudflare overwrites this header at the edge. Using it avoids the
      // spoofable X-Forwarded-For fallback and gives the auth limiter the real
      // viewer IP on Workers.
      ipAddressHeaders: ['cf-connecting-ip'],
    },
  },
  rateLimit: {
    enabled: true,
    customStorage: betterAuthRateLimitStorage,
    window: 60,
    max: 100,
    customRules: {
      // OAuth initiation is intentionally low-frequency. Keep automated
      // traffic from turning its crypto/state work into a Free-plan CPU risk.
      '/sign-in/social': { window: 60, max: 10 },
    },
  },
  emailAndPassword: {
    // Password hashing measured 155–179 ms of actual Worker CPU. When Google
    // is configured, keep the deployed auth surface OAuth-only so those public
    // endpoints cannot be abused into repeated Free-plan CPU overruns. Local
    // development without Google retains email/password for convenience.
    enabled: !googleConfigured,
    minPasswordLength: 10,
    maxPasswordLength: 128,
  },
  socialProviders,
  user: {
    // Extra app column; not accepted from signup input — set by the hook below.
    additionalFields: {
      username: { type: 'string', required: false, input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (u) => ({
          data: { ...u, username: await generateUsername(u.name, u.email) },
        }),
      },
    },
  },
});
