import { rawClient } from './client.js';

export async function initDatabase() {
  console.log('[DB] Ensuring database tables are initialized...');

  await rawClient.execute(`
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id TEXT UNIQUE,
      imdb_id TEXT,
      title TEXT NOT NULL,
      release_year INTEGER,
      runtime_minutes INTEGER,
      overview TEXT,
      poster_path TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      suggested_by_user_id TEXT NOT NULL,
      suggested_by_username TEXT NOT NULL,
      created_at TEXT NOT NULL,
      watched_at TEXT
    );
  `);

  await rawClient.execute(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await rawClient.execute(`
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      rating REAL NOT NULL,
      review_text TEXT,
      submitted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await rawClient.execute(`
    CREATE TABLE IF NOT EXISTS scheduling_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'active',
      candidate_days TEXT NOT NULL,
      default_time TEXT NOT NULL DEFAULT '8:00 PM',
      planned_movie_id INTEGER REFERENCES movies(id),
      message_id TEXT,
      channel_id TEXT,
      finalized_slot TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await rawClient.execute(`
    CREATE TABLE IF NOT EXISTS availability_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES scheduling_sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      selected_days TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  console.log('[DB] Database tables verified successfully.');
}

initDatabase().then(() => {
  console.log('[DB] Migration complete.');
}).catch(err => {
  console.error('[DB] Migration failed:', err);
  process.exit(1);
});
