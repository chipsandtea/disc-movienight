import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { movies, attendance, ratings, Movie, NewMovie } from '../db/schema.js';
import { TmdbMovieDetails } from './tmdb.service.js';

export interface AddMovieResult {
  status: 'added' | 'already_watched' | 'already_in_backlog';
  movie: Movie;
  pastScore?: number | null;
}

export interface WatchedMovieSummary {
  movie: Movie;
  averageRating: number | null;
  ratingCount: number;
  attendanceCount: number;
}

export interface UserStatsResult {
  userId: string;
  attendanceCount: number;
  ratingsGivenCount: number;
  personalAverageRating: number | null;
  highestRated?: { title: string; rating: number };
  lowestRated?: { title: string; rating: number };
  recommendations: {
    totalSuggested: number;
    watchedSuggestedCount: number;
    groupAverageScore: number | null;
    watchedMovies: { title: string; releaseYear: number | null; groupScore: number | null }[];
  };
}

/**
 * Adds a movie to the backlog, performing duplicate detection against past watches and existing backlog.
 */
export async function addMovieToBacklog(
  details: TmdbMovieDetails,
  suggestedByUserId: string,
  suggestedByUsername: string,
  allowRewatch: boolean = false
): Promise<AddMovieResult> {
  const existing = await db
    .select()
    .from(movies)
    .where(eq(movies.tmdbId, String(details.id)))
    .limit(1);

  if (existing.length > 0) {
    const movie = existing[0];
    if (movie.status === 'watched') {
      if (!allowRewatch) {
        // Calculate past group average rating
        const movieRatings = await db
          .select({ rating: ratings.rating })
          .from(ratings)
          .where(eq(ratings.movieId, movie.id));

        const avg = movieRatings.length > 0
          ? movieRatings.reduce((sum, r) => sum + r.rating, 0) / movieRatings.length
          : null;

        return {
          status: 'already_watched',
          movie,
          pastScore: avg ? Math.round(avg * 10) / 10 : null,
        };
      }

      // Re-activate as backlog for re-watch
      const [updated] = await db
        .update(movies)
        .set({
          status: 'backlog',
          watchedAt: null,
          suggestedByUserId,
          suggestedByUsername,
        })
        .where(eq(movies.id, movie.id))
        .returning();

      return {
        status: 'added',
        movie: updated,
      };
    }

    if (movie.status === 'backlog' || movie.status === 'planned') {
      return {
        status: 'already_in_backlog',
        movie,
      };
    }
  }

  // Insert new movie
  const [newMovie] = await db
    .insert(movies)
    .values({
      tmdbId: String(details.id),
      imdbId: details.imdbId,
      title: details.title,
      releaseYear: details.releaseYear,
      runtimeMinutes: details.runtimeMinutes,
      overview: details.overview,
      posterPath: details.posterUrl,
      status: 'backlog',
      suggestedByUserId,
      suggestedByUsername,
    })
    .returning();

  return {
    status: 'added',
    movie: newMovie,
  };
}

/**
 * Returns all movies currently in the backlog.
 */
export async function getBacklogMovies(): Promise<Movie[]> {
  return db
    .select()
    .from(movies)
    .where(eq(movies.status, 'backlog'))
    .orderBy(desc(movies.createdAt));
}

/**
 * Returns the currently planned movie, if one is selected.
 */
export async function getPlannedMovie(): Promise<Movie | null> {
  const results = await db
    .select()
    .from(movies)
    .where(eq(movies.status, 'planned'))
    .limit(1);

  return results[0] || null;
}

/**
 * Sets a movie as the planned movie for the upcoming movie night.
 * Demotes any currently planned movie back to backlog.
 */
export async function setPlannedMovie(movieId: number): Promise<Movie | null> {
  const target = await db.select().from(movies).where(eq(movies.id, movieId)).limit(1);
  if (target.length === 0) return null;

  // Demote existing planned movies back to backlog
  await db
    .update(movies)
    .set({ status: 'backlog' })
    .where(eq(movies.status, 'planned'));

  // Promote target movie to planned
  const [updated] = await db
    .update(movies)
    .set({ status: 'planned' })
    .where(eq(movies.id, movieId))
    .returning();

  return updated;
}

/**
 * Removes a movie from the backlog. Allowed if requester is original suggester or an admin.
 */
export async function removeMovieFromBacklog(
  movieId: number,
  userId: string,
  isAdmin: boolean
): Promise<{ success: boolean; error?: string; movie?: Movie }> {
  const target = await db.select().from(movies).where(eq(movies.id, movieId)).limit(1);
  if (target.length === 0) {
    return { success: false, error: 'Movie not found.' };
  }

  const movie = target[0];
  if (!isAdmin && movie.suggestedByUserId !== userId) {
    return { success: false, error: 'Only the member who suggested this movie or an admin can remove it.' };
  }

  await db.delete(movies).where(eq(movies.id, movieId));
  return { success: true, movie };
}

/**
 * Picks random candidate movies from the backlog.
 */
export async function getRandomBacklogMovies(count: number = 1): Promise<Movie[]> {
  const backlog = await getBacklogMovies();
  if (backlog.length === 0) return [];

  const shuffled = [...backlog].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Calculates user statistics including attendance, ratings given, and recommendation reception.
 */
export async function getUserStats(userId: string): Promise<UserStatsResult> {
  // 1. Attendance count
  const attended = await db
    .select()
    .from(attendance)
    .where(eq(attendance.userId, userId));

  // 2. Ratings given
  const userRatings = await db
    .select({
      rating: ratings.rating,
      title: movies.title,
      submittedAt: ratings.submittedAt,
    })
    .from(ratings)
    .innerJoin(movies, eq(ratings.movieId, movies.id))
    .where(eq(ratings.userId, userId));

  let personalAvg: number | null = null;
  let highestRated: { title: string; rating: number } | undefined;
  let lowestRated: { title: string; rating: number } | undefined;

  if (userRatings.length > 0) {
    const sum = userRatings.reduce((acc, r) => acc + r.rating, 0);
    personalAvg = Math.round((sum / userRatings.length) * 10) / 10;

    const sorted = [...userRatings].sort((a, b) => b.rating - a.rating);
    highestRated = { title: sorted[0].title, rating: sorted[0].rating };
    lowestRated = { title: sorted[sorted.length - 1].title, rating: sorted[sorted.length - 1].rating };
  }

  // 3. Recommendations track record
  const suggestedMovies = await db
    .select()
    .from(movies)
    .where(eq(movies.suggestedByUserId, userId));

  const watchedSuggested = suggestedMovies.filter(m => m.status === 'watched');
  const watchedSummary: { title: string; releaseYear: number | null; groupScore: number | null }[] = [];
  let totalScoreSum = 0;
  let totalScoreCount = 0;

  for (const wm of watchedSuggested) {
    const movieRatings = await db
      .select({ rating: ratings.rating })
      .from(ratings)
      .where(eq(ratings.movieId, wm.id));

    if (movieRatings.length > 0) {
      const avg = movieRatings.reduce((acc, r) => acc + r.rating, 0) / movieRatings.length;
      const rounded = Math.round(avg * 10) / 10;
      watchedSummary.push({ title: wm.title, releaseYear: wm.releaseYear, groupScore: rounded });
      totalScoreSum += avg;
      totalScoreCount++;
    } else {
      watchedSummary.push({ title: wm.title, releaseYear: wm.releaseYear, groupScore: null });
    }
  }

  const groupAverageScore = totalScoreCount > 0
    ? Math.round((totalScoreSum / totalScoreCount) * 10) / 10
    : null;

  return {
    userId,
    attendanceCount: attended.length,
    ratingsGivenCount: userRatings.length,
    personalAverageRating: personalAvg,
    highestRated,
    lowestRated,
    recommendations: {
      totalSuggested: suggestedMovies.length,
      watchedSuggestedCount: watchedSuggested.length,
      groupAverageScore,
      watchedMovies: watchedSummary,
    },
  };
}

/**
 * Returns watched movies ranked by group average score descending.
 */
export async function getLeaderboard(): Promise<WatchedMovieSummary[]> {
  const watched = await db
    .select()
    .from(movies)
    .where(eq(movies.status, 'watched'))
    .orderBy(desc(movies.watchedAt));

  if (watched.length === 0) return [];

  const allRatings = await db.select().from(ratings);
  const allAttendance = await db.select().from(attendance);

  const ratingsByMovie = new Map<number, number[]>();
  for (const r of allRatings) {
    const list = ratingsByMovie.get(r.movieId) || [];
    list.push(r.rating);
    ratingsByMovie.set(r.movieId, list);
  }

  const attendanceCountByMovie = new Map<number, number>();
  for (const a of allAttendance) {
    attendanceCountByMovie.set(a.movieId, (attendanceCountByMovie.get(a.movieId) || 0) + 1);
  }

  const summaries: WatchedMovieSummary[] = watched.map(movie => {
    const movieRatings = ratingsByMovie.get(movie.id) || [];
    const avg = movieRatings.length > 0
      ? Math.round((movieRatings.reduce((sum, r) => sum + r, 0) / movieRatings.length) * 100) / 100
      : null;

    return {
      movie,
      averageRating: avg,
      ratingCount: movieRatings.length,
      attendanceCount: attendanceCountByMovie.get(movie.id) || 0,
    };
  });

  // Sort by average rating descending, then ratingCount descending
  return summaries.sort((a, b) => {
    if (a.averageRating === null) return 1;
    if (b.averageRating === null) return -1;
    if (b.averageRating !== a.averageRating) return b.averageRating - a.averageRating;
    return b.ratingCount - a.ratingCount;
  });
}
