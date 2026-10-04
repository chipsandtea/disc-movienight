import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase } from '../src/db/migrate.js';
import {
  createSchedulingSession,
  getActiveSchedulingSession,
  getLatestSchedulingSession,
  finalizeSchedulingSession,
  cancelSchedulingSession,
  toggleUserAvailability,
  getSessionVotes,
  updateSessionPlannedMovie,
} from '../src/services/schedule.service.js';
import { addMovieToBacklog, setPlannedMovie, getPlannedMovie } from '../src/services/movie.service.js';

describe('Scheduling Service & Modification Lifecycle', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  it('manages scheduling lifecycle: start, vote, finalize, modify, and cancel', async () => {
    // 1. Add and set a planned movie
    const testTmdbId = 999000 + Math.floor(Math.random() * 1000);
    const movieDetails = {
      id: testTmdbId,
      title: `Scheduled Feature ${testTmdbId}`,
      releaseYear: 2026,
      runtimeMinutes: 110,
      overview: 'Movie for scheduling test.',
      posterUrl: null,
      imdbId: `tt${testTmdbId}`,
      tmdbUrl: `https://themoviedb.org/movie/${testTmdbId}`,
      imdbUrl: null,
    };

    const addResult = await addMovieToBacklog(movieDetails, 'suggester_1', 'Suggester');
    const plannedMovie = await setPlannedMovie(addResult.movie.id);
    expect(plannedMovie).not.toBeNull();

    // 2. Start a scheduling session
    const candidateDays = ['Friday', 'Saturday', 'Sunday'];
    const session = await createSchedulingSession(candidateDays, '8:00 PM', plannedMovie!.id, 'channel_123');
    expect(session.status).toBe('active');
    expect(session.plannedMovieId).toBe(plannedMovie!.id);

    // 3. User votes
    await toggleUserAvailability(session.id, 'user_1', 'User One', 'Friday');
    await toggleUserAvailability(session.id, 'user_1', 'User One', 'Saturday');
    await toggleUserAvailability(session.id, 'user_2', 'User Two', 'Saturday');

    const votes = await getSessionVotes(session.id);
    expect(votes.length).toBe(2);
    const user1Votes = votes.find(v => v.userId === 'user_1');
    expect(user1Votes?.selectedDays).toEqual(['Friday', 'Saturday']);

    // 4. Finalize the scheduling session
    const mockDiscordEventId = 'event_snowflake_123';
    const mockStartTime = '2026-10-17T20:00:00.000Z';
    const finalized = await finalizeSchedulingSession(
      session.id,
      'Saturday',
      '8:00 PM',
      mockDiscordEventId,
      mockStartTime
    );
    expect(finalized?.status).toBe('finalized');
    expect(finalized?.finalizedSlot).toBe('Saturday @ 8:00 PM');
    expect(finalized?.discordEventId).toBe(mockDiscordEventId);
    expect(finalized?.scheduledStartTime).toBe(mockStartTime);

    // 5. Modify the finalized schedule to Sunday at 7:30 PM
    const newStartTime = '2026-10-18T19:30:00.000Z';
    const modified = await finalizeSchedulingSession(
      session.id,
      'Sunday',
      '7:30 PM',
      mockDiscordEventId,
      newStartTime
    );
    expect(modified?.status).toBe('finalized');
    expect(modified?.finalizedSlot).toBe('Sunday @ 7:30 PM');
    expect(modified?.scheduledStartTime).toBe(newStartTime);

    // 6. Test updating planned movie for this session
    const movie2Details = {
      id: testTmdbId + 1,
      title: `Replacement Feature ${testTmdbId + 1}`,
      releaseYear: 2026,
      runtimeMinutes: 130,
      overview: 'New planned movie.',
      posterUrl: null,
      imdbId: `tt${testTmdbId + 1}`,
      tmdbUrl: `https://themoviedb.org/movie/${testTmdbId + 1}`,
      imdbUrl: null,
    };
    const addResult2 = await addMovieToBacklog(movie2Details, 'suggester_2', 'Suggester 2');
    const newPlanned = await setPlannedMovie(addResult2.movie.id);

    await updateSessionPlannedMovie(session.id, newPlanned!.id);
    const updatedSession = await getLatestSchedulingSession();
    expect(updatedSession?.plannedMovieId).toBe(newPlanned!.id);

    // 7. Cancel the scheduling session
    await cancelSchedulingSession(session.id);
    const cancelled = await getLatestSchedulingSession();
    // Since session was cancelled, getLatestSchedulingSession (which filters for active/finalized) should return null or a different session
    expect(cancelled?.id !== session.id || cancelled?.status === 'cancelled').toBe(true);
  });
});
