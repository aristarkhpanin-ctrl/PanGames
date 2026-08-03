import { config as loadEnvFiles } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadEnvFiles({ path: ['.env', '../../.env'], quiet: true });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
