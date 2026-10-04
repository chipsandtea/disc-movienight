import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase } from '../src/db/migrate.js';
import { addMovieToBacklog, setPlannedMovie } from '../src/services/movie.service.js';
import { finalizeMovieRatings } from '../src/services/rating.service.js';
import { db } from '../src/db/client.js';
import { movies } from '../src/db/schema.js';
import { eq, and, or, desc } from 'drizzle-orm';

describe('Movie List Filters', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  it('filters movies accurately by status and suggested user', async () => {
    const uniqueTag = Math.floor(Math.random() * 100000);

    // Movie 1: Backlog by User A
    const m1 = await addMovieToBacklog({
      id: 888001 + uniqueTag,
      title: `List Test M1 ${uniqueTag}`,
      releaseYear: 2024,
      runtimeMinutes: 90,
      overview: null,
      posterUrl: null,
      imdbId: null,
      tmdbUrl: '',
      imdbUrl: null,
    }, 'user_list_a', 'Alice');

    // Movie 2: Watched by User B
    const m2 = await addMovieToBacklog({
      id: 888002 + uniqueTag,
      title: `List Test M2 ${uniqueTag}`,
      releaseYear: 2023,
      runtimeMinutes: 100,
      overview: null,
      posterUrl: null,
      imdbId: null,
      tmdbUrl: '',
      imdbUrl: null,
    }, 'user_list_b', 'Bob');

    await finalizeMovieRatings(m2.movie.id);

    // 1. Filter backlog: should include m1, not m2
    const backlogQuery = await db
      .select()
      .from(movies)
      .where(or(eq(movies.status, 'backlog'), eq(movies.status, 'planned')));

    expect(backlogQuery.some(m => m.id === m1.movie.id)).toBe(true);
    expect(backlogQuery.some(m => m.id === m2.movie.id)).toBe(false);

    // 2. Filter watched: should include m2, not m1
    const watchedQuery = await db
      .select()
      .from(movies)
      .where(eq(movies.status, 'watched'));

    expect(watchedQuery.some(m => m.id === m2.movie.id)).toBe(true);
    expect(watchedQuery.some(m => m.id === m1.movie.id)).toBe(false);

    // 3. Filter by User A
    const userAQuery = await db
      .select()
      .from(movies)
      .where(eq(movies.suggestedByUserId, 'user_list_a'));

    expect(userAQuery.some(m => m.id === m1.movie.id)).toBe(true);
    expect(userAQuery.some(m => m.id === m2.movie.id)).toBe(false);

    // 4. Combined: Watched by User B
    const watchedUserBQuery = await db
      .select()
      .from(movies)
      .where(and(eq(movies.status, 'watched'), eq(movies.suggestedByUserId, 'user_list_b')));

    expect(watchedUserBQuery.some(m => m.id === m2.movie.id)).toBe(true);
  });
});
