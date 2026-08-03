import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export type Database = ReturnType<typeof createDb>['db'];

export function createDb(url: string) {
  const sql = postgres(url);
  const db = drizzle(sql, { schema });
  return { sql, db };
}
