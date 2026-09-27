import { config } from '../config.js';

export interface TmdbMovieSearchResult {
  id: number;
  title: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  releaseYear: number | null;
  runtimeMinutes: number | null;
  overview: string | null;
  posterUrl: string | null;
  imdbId: string | null;
  tmdbUrl: string;
  imdbUrl: string | null;
}

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';

/**
 * Extracts an IMDb ID (e.g. "tt0111161") from a string or URL.
 */
export function extractImdbId(input: string): string | null {
  const match = input.match(/tt\d{7,10}/i);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Searches TMDB for movies matching a query string.
 */
export async function searchMovies(query: string): Promise<TmdbMovieSearchResult[]> {
  if (!config.tmdbApiKey) {
    console.warn('[TMDB] No TMDB API key provided. Skipping search.');
    return [];
  }

  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const url = `${TMDB_BASE_URL}/search/movie?api_key=${encodeURIComponent(config.tmdbApiKey)}&query=${encodeURIComponent(trimmed)}&include_adult=false`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[TMDB] Search error: HTTP ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json() as { results?: TmdbMovieSearchResult[] };
    return data.results?.slice(0, 10) || [];
  } catch (err) {
    console.error('[TMDB] Search request failed:', err);
    return [];
  }
}

/**
 * Fetches movie details from TMDB by TMDB movie ID, including external IMDb ID.
 */
export async function getMovieDetails(tmdbId: number | string): Promise<TmdbMovieDetails | null> {
  if (!config.tmdbApiKey) {
    throw new Error('TMDB_API_KEY is not configured in .env');
  }

  try {
    const url = `${TMDB_BASE_URL}/movie/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(config.tmdbApiKey)}&append_to_response=external_ids`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`TMDB HTTP error ${response.status}`);
    }

    const data = await response.json() as {
      id: number;
      title: string;
      release_date?: string;
      runtime?: number;
      overview?: string;
      poster_path?: string | null;
      external_ids?: { imdb_id?: string | null };
    };

    const releaseYear = data.release_date ? parseInt(data.release_date.split('-')[0], 10) || null : null;
    const imdbId = data.external_ids?.imdb_id || null;
    const posterUrl = data.poster_path ? `${POSTER_BASE_URL}${data.poster_path}` : null;

    return {
      id: data.id,
      title: data.title,
      releaseYear,
      runtimeMinutes: data.runtime || null,
      overview: data.overview || null,
      posterUrl,
      imdbId,
      tmdbUrl: `https://www.themoviedb.org/movie/${data.id}`,
      imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : null,
    };
  } catch (err) {
    console.error(`[TMDB] Failed to fetch movie details for ID ${tmdbId}:`, err);
    return null;
  }
}

/**
 * Finds a movie by its IMDb ID using TMDB's /find endpoint.
 */
export async function findByImdbId(imdbId: string): Promise<TmdbMovieDetails | null> {
  if (!config.tmdbApiKey) {
    throw new Error('TMDB_API_KEY is not configured in .env');
  }

  try {
    const normalized = imdbId.toLowerCase();
    const url = `${TMDB_BASE_URL}/find/${encodeURIComponent(normalized)}?api_key=${encodeURIComponent(config.tmdbApiKey)}&external_source=imdb_id`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json() as {
      movie_results?: { id: number }[];
    };

    if (data.movie_results && data.movie_results.length > 0) {
      return getMovieDetails(data.movie_results[0].id);
    }
    return null;
  } catch (err) {
    console.error(`[TMDB] Failed to find movie by IMDb ID ${imdbId}:`, err);
    return null;
  }
}
