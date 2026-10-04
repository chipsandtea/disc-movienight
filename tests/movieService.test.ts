import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { initDatabase } from '../src/db/migrate.js';
import {
  addMovieToBacklog,
  getBacklogMovies,
  setPlannedMovie,
  getUserStats,
  getLeaderboard,
  updateMovieSuggester,
  deleteMovie,
} from '../src/services/movie.service.js';
import { recordAttendance } from '../src/services/attendance.service.js';
import { recordUserRating, finalizeMovieRatings } from '../src/services/rating.service.js';
import { createSchedulingSession } from '../src/services/schedule.service.js';
import { db } from '../src/db/client.js';
import { movies, attendance, ratings, schedulingSessions } from '../src/db/schema.js';

describe('Movie Service & Rating Lifecycle', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  it('adds movie, handles duplicates, records attendance and ratings, and calculates user recommendation stats', async () => {
    // 1. Add movie to backlog
    const testTmdbId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000);
    const movieDetails = {
      id: testTmdbId,
      title: `Test Sci-Fi Feature ${testTmdbId}`,
      releaseYear: 2025,
      runtimeMinutes: 125,
      overview: 'A test film about space exploration.',
      posterUrl: 'https://example.com/poster.jpg',
      imdbId: `tt${testTmdbId}`,
      tmdbUrl: `https://themoviedb.org/movie/${testTmdbId}`,
      imdbUrl: `https://imdb.com/title/tt${testTmdbId}/`,
    };

    const userAlice = `alice_${testTmdbId}`;
    const userBob = `bob_${testTmdbId}`;
    const userCharlie = `charlie_${testTmdbId}`;
    const userDave = `dave_${testTmdbId}`;

    const addResult = await addMovieToBacklog(movieDetails, userAlice, 'Alice');
    expect(addResult.status).toBe('added');
    expect(addResult.movie.title).toBe(movieDetails.title);

    // 2. Duplicate check on backlog
    const dupResult = await addMovieToBacklog(movieDetails, userBob, 'Bob');
    expect(dupResult.status).toBe('already_in_backlog');

    // 3. Set as planned movie
    const planned = await setPlannedMovie(addResult.movie.id);
    expect(planned?.status).toBe('planned');

    // 4. Record attendance
    const attendees = [
      { userId: userAlice, userName: 'Alice' },
      { userId: userBob, userName: 'Bob' },
      { userId: userCharlie, userName: 'Charlie' },
    ];
    await recordAttendance(addResult.movie.id, attendees);

    // 5. Submit ratings
    await recordUserRating(addResult.movie.id, userAlice, 'Alice', 9.0, 'Loved the space visuals!');
    await recordUserRating(addResult.movie.id, userBob, 'Bob', 8.0, 'Pacing was a bit slow.');
    await recordUserRating(addResult.movie.id, userCharlie, 'Charlie', 8.5);

    // 6. Finalize movie
    const finalization = await finalizeMovieRatings(addResult.movie.id);
    expect(finalization).not.toBeNull();
    expect(finalization?.movie.status).toBe('watched');
    // Average of 9.0, 8.0, 8.5 is 8.5
    expect(finalization?.averageRating).toBe(8.5);

    // 7. Check Alice's user stats
    // Alice suggested this movie! Group average on Alice's recommendations should be 8.5!
    const aliceStats = await getUserStats(userAlice);
    expect(aliceStats.attendanceCount).toBe(1);
    expect(aliceStats.ratingsGivenCount).toBe(1);
    expect(aliceStats.highestRated).toEqual({ title: movieDetails.title, rating: 9.0 });
    // Alice only has 1 rating so lowestRated should not duplicate highestRated
    expect(aliceStats.lowestRated).toBeUndefined();
    expect(aliceStats.recommendations.totalSuggested).toBe(1);
    expect(aliceStats.recommendations.watchedSuggestedCount).toBe(1);
    expect(aliceStats.recommendations.groupAverageScore).toBe(8.5);

    // 8. Check leaderboard
    const leaderboard = await getLeaderboard();
    const found = leaderboard.find(l => l.movie.id === addResult.movie.id);
    expect(found).toBeDefined();
    expect(found?.averageRating).toBe(8.5);

    // 9. Test rewatch capability
    // Attempting to re-add without rewatch flag should warn
    const duplicateWatched = await addMovieToBacklog(movieDetails, userDave, 'Dave', false);
    expect(duplicateWatched.status).toBe('already_watched');
    expect(duplicateWatched.pastScore).toBe(8.5);

    // Re-adding with allowRewatch=true should succeed and reactivate as backlog without unique constraint error
    const rewatchResult = await addMovieToBacklog(movieDetails, userDave, 'Dave', true);
    expect(rewatchResult.status).toBe('added');
    expect(rewatchResult.movie.status).toBe('backlog');

    // 10. Test auto-attendance when submitting a rating
    const lateJoinerId = `late_${testTmdbId}`;
    await recordUserRating(addResult.movie.id, lateJoinerId, 'Late Joiner', 7.0);
    const attendeesUpdated = await db.select().from(attendance).where(eq(attendance.movieId, addResult.movie.id));
    const lateJoinerFound = attendeesUpdated.find(a => a.userId === lateJoinerId);
    expect(lateJoinerFound).toBeDefined();
    expect(lateJoinerFound?.userName).toBe('Late Joiner');
  });

  it('allows admins to reassign movie suggester and updates recommendation statistics', async () => {
    const tmdbId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 100000);
    const userOriginal = `user_orig_${tmdbId}`;
    const userNew = `user_new_${tmdbId}`;

    const movieDetails = {
      id: tmdbId,
      title: `Admin Reassign Test ${tmdbId}`,
      releaseYear: 2024,
      runtimeMinutes: 100,
      overview: 'Testing admin reattribution.',
      posterUrl: null,
      imdbId: `tt${tmdbId}`,
      tmdbUrl: `https://themoviedb.org/movie/${tmdbId}`,
      imdbUrl: `https://imdb.com/title/tt${tmdbId}/`,
    };

    // 1. Suggest movie as userOriginal
    const addResult = await addMovieToBacklog(movieDetails, userOriginal, 'OriginalSuggester');
    expect(addResult.status).toBe('added');
    const movieId = addResult.movie.id;

    // 2. Non-admin cannot reassign
    const nonAdminResult = await updateMovieSuggester(movieId, userNew, 'NewSuggester', false);
    expect(nonAdminResult.success).toBe(false);
    expect(nonAdminResult.error).toContain('Only administrators');

    // Verify DB was unchanged
    const unchanged = await db.select().from(movies).where(eq(movies.id, movieId)).limit(1);
    expect(unchanged[0].suggestedByUserId).toBe(userOriginal);

    // 3. Admin reassigns successfully
    const adminResult = await updateMovieSuggester(movieId, userNew, 'NewSuggester', true);
    expect(adminResult.success).toBe(true);
    expect(adminResult.movie?.suggestedByUserId).toBe(userNew);
    expect(adminResult.movie?.suggestedByUsername).toBe('NewSuggester');

    // 4. Verify DB updated
    const updated = await db.select().from(movies).where(eq(movies.id, movieId)).limit(1);
    expect(updated[0].suggestedByUserId).toBe(userNew);
    expect(updated[0].suggestedByUsername).toBe('NewSuggester');

    // 5. Verify stats reflection
    const originalStats = await getUserStats(userOriginal);
    const newStats = await getUserStats(userNew);
    expect(originalStats.recommendations.totalSuggested).toBe(0);
    expect(newStats.recommendations.totalSuggested).toBe(1);
  });

  it('permanently deletes watched movies and cascades cleanup across ratings, attendance, and stats', async () => {
    const tmdbId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 50000);
    const movieDetails = {
      id: tmdbId,
      title: `Delete Test Movie ${tmdbId}`,
      releaseYear: 2025,
      runtimeMinutes: 110,
      overview: 'Testing cascading deletion.',
      posterUrl: null,
      imdbId: `tt${tmdbId}`,
      tmdbUrl: `https://themoviedb.org/movie/${tmdbId}`,
      imdbUrl: null,
    };

    // 1. Add and mark watched with attendance and ratings
    const addResult = await addMovieToBacklog(movieDetails, 'suggester_del', 'SuggesterDel');
    const movieId = addResult.movie.id;

    await recordAttendance(movieId, [
      { userId: 'user_a', userName: 'User A' },
      { userId: 'user_b', userName: 'User B' },
    ]);
    await recordUserRating(movieId, 'user_a', 'User A', 9.0);
    await recordUserRating(movieId, 'user_b', 'User B', 7.0);
    await finalizeMovieRatings(movieId);

    // Verify presence in leaderboard and user stats
    const leaderboardBefore = await getLeaderboard();
    expect(leaderboardBefore.some(l => l.movie.id === movieId)).toBe(true);

    const statsBefore = await getUserStats('suggester_del');
    expect(statsBefore.recommendations.watchedSuggestedCount).toBeGreaterThanOrEqual(1);

    // 2. Perform deleteMovie
    const deleteResult = await deleteMovie(movieId);
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.deletedRatingsCount).toBe(2);
    expect(deleteResult.deletedAttendanceCount).toBe(2);

    // 3. Verify movie is deleted from database
    const movieCheck = await db.select().from(movies).where(eq(movies.id, movieId));
    expect(movieCheck.length).toBe(0);

    // 4. Verify attendance & ratings rows are purged
    const attendanceCheck = await db.select().from(attendance).where(eq(attendance.movieId, movieId));
    expect(attendanceCheck.length).toBe(0);

    const ratingsCheck = await db.select().from(ratings).where(eq(ratings.movieId, movieId));
    expect(ratingsCheck.length).toBe(0);

    // 5. Verify leaderboard no longer contains the movie
    const leaderboardAfter = await getLeaderboard();
    expect(leaderboardAfter.some(l => l.movie.id === movieId)).toBe(false);

    // 6. Verify recommender stats recalculated without ghost data
    const statsAfter = await getUserStats('suggester_del');
    expect(statsAfter.recommendations.watchedSuggestedCount).toBe(0);

    // 7. Non-existent movie deletion returns failure
    const nonExistentResult = await deleteMovie(999999);
    expect(nonExistentResult.success).toBe(false);
    expect(nonExistentResult.error).toBe('Movie not found.');
  });

  it('unlinks active scheduling session when planned movie is deleted without FK error', async () => {
    const tmdbId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 50000);
    const movieDetails = {
      id: tmdbId,
      title: `Planned Delete Test ${tmdbId}`,
      releaseYear: 2026,
      runtimeMinutes: 120,
      overview: 'Testing planned deletion unlinking.',
      posterUrl: null,
      imdbId: `tt${tmdbId}`,
      tmdbUrl: `https://themoviedb.org/movie/${tmdbId}`,
      imdbUrl: null,
    };

    const addResult = await addMovieToBacklog(movieDetails, 'planner_user', 'PlannerUser');
    const planned = await setPlannedMovie(addResult.movie.id);
    expect(planned).not.toBeNull();

    // Create a scheduling session referencing this movie
    const session = await createSchedulingSession(['Friday', 'Saturday'], '8:00 PM', planned!.id);
    expect(session.plannedMovieId).toBe(planned!.id);

    // Delete the planned movie
    const deleteResult = await deleteMovie(planned!.id);
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.unlinkedSchedulingSession).toBe(true);

    // Verify session still exists but plannedMovieId is set to null
    const sessionAfter = await db.select().from(schedulingSessions).where(eq(schedulingSessions.id, session.id)).limit(1);
    expect(sessionAfter[0].plannedMovieId).toBeNull();
  });
});
