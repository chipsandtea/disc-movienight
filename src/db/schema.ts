import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const movies = sqliteTable('movies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tmdbId: text('tmdb_id').unique(),
  imdbId: text('imdb_id'),
  title: text('title').notNull(),
  releaseYear: integer('release_year'),
  runtimeMinutes: integer('runtime_minutes'),
  overview: text('overview'),
  posterPath: text('poster_path'),
  status: text('status', { enum: ['backlog', 'planned', 'watched'] }).notNull().default('backlog'),
  suggestedByUserId: text('suggested_by_user_id').notNull(),
  suggestedByUsername: text('suggested_by_username').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  watchedAt: text('watched_at'),
});

export const attendance = sqliteTable(
  'attendance',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    movieId: integer('movie_id').notNull().references(() => movies.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  table => ({
    movieUserIdx: uniqueIndex('idx_attendance_movie_user').on(table.movieId, table.userId),
  })
);

export const ratings = sqliteTable(
  'ratings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    movieId: integer('movie_id').notNull().references(() => movies.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    rating: real('rating').notNull(),
    reviewText: text('review_text'),
    submittedAt: text('submitted_at').notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  table => ({
    movieUserIdx: uniqueIndex('idx_ratings_movie_user').on(table.movieId, table.userId),
  })
);

export const schedulingSessions = sqliteTable('scheduling_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  status: text('status', { enum: ['active', 'finalized', 'cancelled'] }).notNull().default('active'),
  candidateDays: text('candidate_days').notNull(), // JSON array string e.g. '["Friday", "Saturday", "Sunday"]'
  defaultTime: text('default_time').notNull().default('8:00 PM'),
  plannedMovieId: integer('planned_movie_id').references(() => movies.id),
  messageId: text('message_id'),
  channelId: text('channel_id'),
  finalizedSlot: text('finalized_slot'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const availabilityVotes = sqliteTable(
  'availability_votes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id').notNull().references(() => schedulingSessions.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    selectedDays: text('selected_days').notNull(), // JSON array string e.g. '["Friday"]'
    updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  table => ({
    sessionUserIdx: uniqueIndex('idx_votes_session_user').on(table.sessionId, table.userId),
  })
);

export type Movie = typeof movies.$inferSelect;
export type NewMovie = typeof movies.$inferInsert;
export type Attendance = typeof attendance.$inferSelect;
export type NewAttendance = typeof attendance.$inferInsert;
export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;
export type SchedulingSession = typeof schedulingSessions.$inferSelect;
export type NewSchedulingSession = typeof schedulingSessions.$inferInsert;
export type AvailabilityVote = typeof availabilityVotes.$inferSelect;
export type NewAvailabilityVote = typeof availabilityVotes.$inferInsert;
