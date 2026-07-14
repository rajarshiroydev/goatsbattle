import { defineConfig } from 'drizzle-kit';

if (process.env.DB_TARGET !== 'development') {
  throw new Error('Drizzle Kit is development-only. Run the explicit db:studio:dev command.');
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set.');
}

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
