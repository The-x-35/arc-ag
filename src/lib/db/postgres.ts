import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL environment variable for Postgres connection');
}

// Use a single shared pool across hot reloads in dev
const globalForPg = global as unknown as { pgPool?: Pool };

export const pgPool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined,
  });

if (!globalForPg.pgPool) {
  globalForPg.pgPool = pgPool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await pgPool.query(text, params);
  return res.rows as T[];
}

