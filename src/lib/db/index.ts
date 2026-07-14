import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { env } from 'cloudflare:workers';
import * as schema from './schema';

// Runtime secrets come from the encrypted Worker environment. Keeping the
// connection string out of import.meta.env prevents Vite from writing it into
// the generated Worker bundle during a production build.
const connectionString = env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Add it to your .env file.');
}

const sql = neon(connectionString);
export const db = drizzle(sql, { schema });
