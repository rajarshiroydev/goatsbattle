import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../../src/lib/db/schema';

// Database maintenance scripts run in Node via tsx, where the Worker's
// `cloudflare:workers` environment module is unavailable. Keep this adapter
// separate from the application runtime adapter and require an explicit URL
// supplied by the command's --env-file.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set for this database script.');
}

export const db = drizzle(neon(connectionString), { schema });
