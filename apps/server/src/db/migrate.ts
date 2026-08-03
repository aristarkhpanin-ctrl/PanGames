import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { loadConfig } from '../config';

const config = loadConfig();

// max: 1 — миграции идут одним соединением, иначе postgres.js оставит пул открытым.
const sql = postgres(config.DATABASE_URL, { max: 1 });

try {
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  console.info('Миграции применены');
} finally {
  await sql.end();
}
