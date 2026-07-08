import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { user, session, account, verification } from './db/schema';

// Same env pattern as db/index.ts: process.env (Vercel/tsx) first, falling back
// to Vite's static import.meta.env replacement in the dev SSR runtime. Each key
// is referenced literally — no dynamic bracket access or `?.`, which would
// defeat Vite's compile-time substitution. auth.ts is server-only (middleware +
// /api routes), so these secrets never reach the client bundle.
const secret = process.env.BETTER_AUTH_SECRET ?? import.meta.env.BETTER_AUTH_SECRET;
const baseURL = process.env.BETTER_AUTH_URL ?? import.meta.env.BETTER_AUTH_URL;
const googleClientId = process.env.GOOGLE_CLIENT_ID ?? import.meta.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? import.meta.env.GOOGLE_CLIENT_SECRET;

// Only wire Google when both creds exist so local dev works without them.
const socialProviders =
  googleClientId && googleClientSecret
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
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const [taken] = await db.select({ id: user.id }).from(user).where(eq(user.username, candidate)).limit(1);
    if (!taken) return candidate;
  }
  // Extremely unlikely: fall back to a much larger suffix.
  return `${base}-${Math.random().toString(36).slice(2, 12)}`;
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
  emailAndPassword: { enabled: true },
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
