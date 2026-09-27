import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { config } from '../config.js';

export const rawClient = createClient({
  url: config.databaseUrl,
});

// Configure SQLite pragmas for durability and performance on Raspberry Pi
rawClient.execute('PRAGMA journal_mode = WAL;').catch(err => {
  console.warn('[DB] Could not set WAL mode (might already be configured):', err.message);
});
rawClient.execute('PRAGMA synchronous = NORMAL;').catch(() => {});
rawClient.execute('PRAGMA busy_timeout = 5000;').catch(() => {});
rawClient.execute('PRAGMA foreign_keys = ON;').catch(() => {});

export const db = drizzle(rawClient, { schema });
