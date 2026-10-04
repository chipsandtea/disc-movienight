import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { config } from '../config.js';

export const rawClient = createClient({
  url: config.databaseUrl,
});

// Configure SQLite pragmas for durability and performance on Raspberry Pi
export async function configurePragmas(): Promise<void> {
  try {
    await rawClient.execute('PRAGMA journal_mode = WAL;');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[DB] Could not set WAL mode (might already be configured):', msg);
  }
  await rawClient.execute('PRAGMA synchronous = NORMAL;').catch(() => {});
  await rawClient.execute('PRAGMA busy_timeout = 5000;').catch(() => {});
  await rawClient.execute('PRAGMA foreign_keys = ON;').catch(() => {});
}

export const db = drizzle(rawClient, { schema });
