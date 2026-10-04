import { Client, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { movies, attendance, ratings, Movie, Rating } from '../db/schema.js';
import { buildMovieEmbed, buildRevealEmbed, buildRatingProgressEmbed } from '../utils/discordHelpers.js';
import { getAttendeesForMovie } from './attendance.service.js';
import { updateMovieRatingMessage } from './movie.service.js';

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
 * live progress card in #shows-n-movies with an ephemeral modal button.
 */
export async function dispatchRatingRequests(
  client: Client,
  movie: Movie,
  attendees: { userId: string; userName: string }[],
  targetChannel?: TextChannel | null
): Promise<{ dmsSent: number; dmsFailed: number; ratingMessageId?: string }> {
  let dmsSent = 0;
  let dmsFailed = 0;
  let ratingMessageId: string | undefined;

  const rateButton = new ButtonBuilder()
    .setCustomId(`rate:open:${movie.id}`)
    .setLabel('⭐ Submit / Edit Your Rating')
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

  // 2. Post Live Rating Dashboard in #shows-n-movies
  if (targetChannel) {
    const progress = await getRatingProgress(movie.id);
    const progressEmbed = progress
      ? buildRatingProgressEmbed(progress)
      : new EmbedBuilder()
          .setTitle(`🎬 Rating Collection: ${movie.title}`)
          .setColor(0x3B82F6)
          .setDescription(`Rating requests have been dispatched to DMs for all attendees.\nHave DMs disabled? Click the button below to submit privately here!`);

    const channelMessage = await targetChannel.send({
      embeds: [progressEmbed],
      components: [row],
    });

    ratingMessageId = channelMessage.id;
    await updateMovieRatingMessage(movie.id, channelMessage.id, targetChannel.id);
  }

  return { dmsSent, dmsFailed, ratingMessageId };
}

/**
 * Refreshes the live rating progress card in the designated channel
 * whenever a rating is submitted or updated.
 */
export async function updateLiveRatingProgressMessage(client: Client, movieId: number): Promise<void> {
  const [movie] = await db.select().from(movies).where(eq(movies.id, movieId)).limit(1);
  if (!movie || !movie.ratingMessageId || !movie.ratingChannelId) return;

  try {
    const channel = await client.channels.fetch(movie.ratingChannelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await (channel as TextChannel).messages.fetch(movie.ratingMessageId);
    if (!message) return;

    const progress = await getRatingProgress(movieId);
    if (!progress) return;

    const updatedEmbed = buildRatingProgressEmbed(progress);
    await message.edit({ embeds: [updatedEmbed] });
  } catch (err: any) {
    console.warn('[Rating] Could not update live rating message:', err.message);
  }
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
  // Ensure user is recorded in attendance table idempotently
  await db
    .insert(attendance)
    .values({
      movieId,
      userId,
      userName,
    })
    .onConflictDoNothing();

  const existing = await db
    .select({ id: ratings.id })
    .from(ratings)
    .where(and(eq(ratings.movieId, movieId), eq(ratings.userId, userId)))
    .limit(1);

  const isUpdate = existing.length > 0;

  const [rating] = await db
    .insert(ratings)
    .values({
      movieId,
      userId,
      userName,
      rating: score,
      reviewText: reviewText || null,
    })
    .onConflictDoUpdate({
      target: [ratings.movieId, ratings.userId],
      set: {
        rating: score,
        reviewText: reviewText || null,
        userName,
        updatedAt: new Date().toISOString(),
      },
    })
    .returning();

  return { isUpdate, rating };
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
 * disables the live rating card, and compiles the grand reveal dataset.
 */
export async function finalizeMovieRatings(movieId: number, client?: Client): Promise<FinalizeResult | null> {
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

  // Disable live rating card buttons and update footer
  if (client && watchedMovie.ratingMessageId && watchedMovie.ratingChannelId) {
    try {
      const channel = await client.channels.fetch(watchedMovie.ratingChannelId);
      if (channel && channel.isTextBased()) {
        const msg = await (channel as TextChannel).messages.fetch(watchedMovie.ratingMessageId);
        if (msg) {
          const progress = await getRatingProgress(movieId);
          if (progress) {
            const finalEmbed = buildRatingProgressEmbed(progress)
              .setTitle(`🎬 Rating Collection: ${watchedMovie.title} [FINALIZED]`)
              .setFooter({ text: '✅ Ratings finalized! Official results revealed below.' });
            await msg.edit({ embeds: [finalEmbed], components: [] });
          }
        }
      }
    } catch (e) {
      console.warn('[Rating] Could not update completed rating message:', e);
    }
  }

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
