import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

// On Vercel + node scripts (seed/migrations) the value lives on process.env.
// In the Astro/Vite dev SSR runtime it is only available as a static
// `import.meta.env.DATABASE_URL` replacement (no optional chaining — `?.`
// defeats Vite's compile-time substitution). process.env is checked first so
// node/tsx short-circuits before touching import.meta.env.
const connectionString =
  process.env.DATABASE_URL ?? import.meta.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Add it to your .env file.');
}

const sql = neon(connectionString);
export const db = drizzle(sql, { schema });
