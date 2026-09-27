import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase } from '../src/db/migrate.js';
import {
  addMovieToBacklog,
  getBacklogMovies,
  setPlannedMovie,
  getUserStats,
  getLeaderboard,
} from '../src/services/movie.service.js';
import { recordAttendance } from '../src/services/attendance.service.js';
import { recordUserRating, finalizeMovieRatings } from '../src/services/rating.service.js';
import { db } from '../src/db/client.js';
import { movies, attendance, ratings } from '../src/db/schema.js';

describe('Movie Service & Rating Lifecycle', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  it('adds movie, handles duplicates, records attendance and ratings, and calculates user recommendation stats', async () => {
    // 1. Add movie to backlog
    const movieDetails = {
      id: 999999,
      title: 'Test Sci-Fi Feature',
      releaseYear: 2025,
      runtimeMinutes: 125,
      overview: 'A test film about space exploration.',
      posterUrl: 'https://example.com/poster.jpg',
      imdbId: 'tt9999999',
      tmdbUrl: 'https://themoviedb.org/movie/999999',
      imdbUrl: 'https://imdb.com/title/tt9999999/',
    };

    const addResult = await addMovieToBacklog(movieDetails, 'user_alice', 'Alice');
    expect(addResult.status).toBe('added');
    expect(addResult.movie.title).toBe('Test Sci-Fi Feature');

    // 2. Duplicate check on backlog
    const dupResult = await addMovieToBacklog(movieDetails, 'user_bob', 'Bob');
    expect(dupResult.status).toBe('already_in_backlog');

    // 3. Set as planned movie
    const planned = await setPlannedMovie(addResult.movie.id);
    expect(planned?.status).toBe('planned');

    // 4. Record attendance
    const attendees = [
      { userId: 'user_alice', userName: 'Alice' },
      { userId: 'user_bob', userName: 'Bob' },
      { userId: 'user_charlie', userName: 'Charlie' },
    ];
    await recordAttendance(addResult.movie.id, attendees);

    // 5. Submit ratings
    await recordUserRating(addResult.movie.id, 'user_alice', 'Alice', 9.0, 'Loved the space visuals!');
    await recordUserRating(addResult.movie.id, 'user_bob', 'Bob', 8.0, 'Pacing was a bit slow.');
    await recordUserRating(addResult.movie.id, 'user_charlie', 'Charlie', 8.5);

    // 6. Finalize movie
    const finalization = await finalizeMovieRatings(addResult.movie.id);
    expect(finalization).not.toBeNull();
    expect(finalization?.movie.status).toBe('watched');
    // Average of 9.0, 8.0, 8.5 is 8.5
    expect(finalization?.averageRating).toBe(8.5);

    // 7. Check Alice's user stats
    // Alice suggested this movie! Group average on Alice's recommendations should be 8.5!
    const aliceStats = await getUserStats('user_alice');
    expect(aliceStats.attendanceCount).toBeGreaterThanOrEqual(1);
    expect(aliceStats.ratingsGivenCount).toBeGreaterThanOrEqual(1);
    expect(aliceStats.recommendations.totalSuggested).toBeGreaterThanOrEqual(1);
    expect(aliceStats.recommendations.watchedSuggestedCount).toBeGreaterThanOrEqual(1);
    expect(aliceStats.recommendations.groupAverageScore).toBe(8.5);

    // 8. Check leaderboard
    const leaderboard = await getLeaderboard();
    const found = leaderboard.find(l => l.movie.id === addResult.movie.id);
    expect(found).toBeDefined();
    expect(found?.averageRating).toBe(8.5);
  });
});
