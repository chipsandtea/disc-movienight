import { Client, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { movies, attendance, ratings, Movie, Rating } from '../db/schema.js';
import { buildMovieEmbed, buildRevealEmbed } from '../utils/discordHelpers.js';
import { getAttendeesForMovie } from './attendance.service.js';

export interface RatingStatusResult {
  movie: Movie;
  totalAttendees: number;
  submittedCount: number;
  submittedUsers: { userId: string; userName: string; rating: number }[];
  pendingUsers: { userId: string; userName: string }[];
}

export interface FinalizeResult {
  movie: Movie;
  averageRating: number | null;
  submittedRatings: { userId: string; userName: string; rating: number; reviewText: string | null }[];
  unratedAttendees: { userId: string; userName: string }[];
}

/**
 * Dispatches rating forms to attendees via DM and simultaneously posts an in-channel
 * fallback button in #shows-n-movies with an ephemeral modal.
 */
export async function dispatchRatingRequests(
  client: Client,
  movie: Movie,
  attendees: { userId: string; userName: string }[],
  targetChannel?: TextChannel | null
): Promise<{ dmsSent: number; dmsFailed: number }> {
  let dmsSent = 0;
  let dmsFailed = 0;

  const rateButton = new ButtonBuilder()
    .setCustomId(`rate:open:${movie.id}`)
    .setLabel('⭐ Submit Your Rating & Review')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(rateButton);

  const dmEmbed = buildMovieEmbed(movie, '🍿 How was the movie?')
    .setDescription(
      `Hope you enjoyed **${movie.title}**!\nClick the button below to submit your rating (0.0 to 10.0) and an optional review.\nYour rating is kept strictly private until the grand reveal!`
    );

  // 1. Dispatch DMs
  for (const attendee of attendees) {
    try {
      const user = await client.users.fetch(attendee.userId);
      await user.send({
        embeds: [dmEmbed],
        components: [row],
      });
      dmsSent++;
    } catch (err: any) {
      // 50007: Cannot send messages to this user (DMs disabled)
      dmsFailed++;
    }
  }

  // 2. Post in-channel fallback in #shows-n-movies
  if (targetChannel) {
    const channelEmbed = new EmbedBuilder()
      .setTitle(`🎬 That's a wrap on ${movie.title}!`)
      .setColor(0x10B981)
      .setDescription(
        `Rating requests have been sent to DMs for all attendees.\n\n**Have DMs disabled?** Click the button below to submit your rating right here in the channel! *(Responses are submitted privately through an ephemeral modal)*`
      );

    await targetChannel.send({
      embeds: [channelEmbed],
      components: [row],
    });
  }

  return { dmsSent, dmsFailed };
}

/**
 * Records or updates a user's rating in the database.
 */
export async function recordUserRating(
  movieId: number,
  userId: string,
  userName: string,
  score: number,
  reviewText?: string
): Promise<{ isUpdate: boolean; rating: Rating }> {
  const existing = await db
    .select()
    .from(ratings)
    .where(and(eq(ratings.movieId, movieId), eq(ratings.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(ratings)
      .set({
        rating: score,
        reviewText: reviewText || null,
        userName,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(ratings.id, existing[0].id))
      .returning();

    return { isUpdate: true, rating: updated };
  }

  const [inserted] = await db
    .insert(ratings)
    .values({
      movieId,
      userId,
      userName,
      rating: score,
      reviewText: reviewText || null,
    })
    .returning();

  return { isUpdate: false, rating: inserted };
}

/**
 * Checks the current submission progress for a movie's ratings.
 */
export async function getRatingProgress(movieId: number): Promise<RatingStatusResult | null> {
  const target = await db.select().from(movies).where(eq(movies.id, movieId)).limit(1);
  if (target.length === 0) return null;

  const movie = target[0];
  const attendees = await getAttendeesForMovie(movieId);
  const submitted = await db.select().from(ratings).where(eq(ratings.movieId, movieId));

  const submittedUserIds = new Set(submitted.map(r => r.userId));

  const submittedUsers = submitted.map(r => ({
    userId: r.userId,
    userName: r.userName,
    rating: r.rating,
  }));

  const pendingUsers = attendees
    .filter(a => !submittedUserIds.has(a.userId))
    .map(a => ({ userId: a.userId, userName: a.userName }));

  return {
    movie,
    totalAttendees: attendees.length,
    submittedCount: submitted.length,
    submittedUsers,
    pendingUsers,
  };
}

/**
 * Finalizes ratings for a movie: updates status to 'watched', records watchedAt,
 * and compiles the grand reveal dataset.
 */
export async function finalizeMovieRatings(movieId: number): Promise<FinalizeResult | null> {
  const target = await db.select().from(movies).where(eq(movies.id, movieId)).limit(1);
  if (target.length === 0) return null;

  const movie = target[0];

  // Update movie status to watched
  const [watchedMovie] = await db
    .update(movies)
    .set({
      status: 'watched',
      watchedAt: new Date().toISOString(),
    })
    .where(eq(movies.id, movieId))
    .returning();

  const submitted = await db
    .select()
    .from(ratings)
    .where(eq(ratings.movieId, movieId));

  const attendees = await getAttendeesForMovie(movieId);
  const submittedIds = new Set(submitted.map(s => s.userId));
  const unratedAttendees = attendees.filter(a => !submittedIds.has(a.userId));

  const averageRating = submitted.length > 0
    ? Math.round((submitted.reduce((sum, r) => sum + r.rating, 0) / submitted.length) * 100) / 100
    : null;

  return {
    movie: watchedMovie,
    averageRating,
    submittedRatings: submitted.map(s => ({
      userId: s.userId,
      userName: s.userName,
      rating: s.rating,
      reviewText: s.reviewText,
    })),
    unratedAttendees: unratedAttendees.map(u => ({
      userId: u.userId,
      userName: u.userName,
    })),
  };
}
