import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { parseRating } from '../utils/ratingParser.js';
import { recordUserRating, updateLiveRatingProgressMessage } from '../services/rating.service.js';
import { db } from '../db/client.js';
import { ratings, movies } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

/**
 * Handles the button click that triggers the rating modal.
 * Works both in private DMs and in-channel as an ephemeral pop-up.
 * Custom ID: `rate:open:<movieId>`
 */
export async function handleRateButtonClick(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  if (parts.length < 3 || parts[0] !== 'rate' || parts[1] !== 'open') return;

  const movieId = parseInt(parts[2], 10);
  const targetMovie = await db.select().from(movies).where(eq(movies.id, movieId)).limit(1);

  if (targetMovie.length === 0) {
    await interaction.reply({ content: 'Movie not found.', ephemeral: true });
    return;
  }

  const movie = targetMovie[0];

  // Check if user already submitted a rating to pre-fill
  const existing = await db
    .select()
    .from(ratings)
    .where(and(eq(ratings.movieId, movieId), eq(ratings.userId, interaction.user.id)))
    .limit(1);

  const existingRating = existing[0];

  const modal = new ModalBuilder()
    .setCustomId(`rate:submit:${movieId}`)
    .setTitle(`Rate: ${movie.title.slice(0, 35)}`);

  const scoreInput = new TextInputBuilder()
    .setCustomId('rating_score')
    .setLabel('Score (0.0 to 10.0, e.g. 8.5)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('8.5')
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(6);

  if (existingRating) {
    scoreInput.setValue(String(existingRating.rating));
  }

  const reviewInput = new TextInputBuilder()
    .setCustomId('rating_review')
    .setLabel('Your Review & Thoughts (Optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('What did you think of the cinematography, story, or pacing?')
    .setRequired(false)
    .setMaxLength(1000);

  if (existingRating && existingRating.reviewText) {
    reviewInput.setValue(existingRating.reviewText);
  }

  const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(scoreInput);
  const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(reviewInput);

  modal.addComponents(row1, row2);
  await interaction.showModal(modal);
}

/**
 * Handles the submission of the rating modal.
 * Custom ID: `rate:submit:<movieId>`
 */
export async function handleRateModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  if (parts.length < 3 || parts[0] !== 'rate' || parts[1] !== 'submit') return;

  const movieId = parseInt(parts[2], 10);
  const scoreRaw = interaction.fields.getTextInputValue('rating_score');
  const reviewRaw = interaction.fields.getTextInputValue('rating_review');

  const parsed = parseRating(scoreRaw);
  if (!parsed.valid || parsed.rating === undefined) {
    await interaction.reply({
      content: `❌ ${parsed.error || 'Invalid score.'}\n(Your review: "${reviewRaw}")`,
      ephemeral: true,
    });
    return;
  }

  const userName = interaction.member && 'displayName' in interaction.member
    ? (interaction.member.displayName as string)
    : interaction.user.username;

  const { isUpdate } = await recordUserRating(
    movieId,
    interaction.user.id,
    userName,
    parsed.rating,
    reviewRaw.trim() || undefined
  );

  // Update live progress card in #shows-n-movies in real-time
  await updateLiveRatingProgressMessage(interaction.client, movieId);

  const actionWord = isUpdate ? 'updated' : 'recorded';
  await interaction.reply({
    content: `✅ Your rating of **${parsed.rating} / 10** has been ${actionWord}!\nYour score and review will remain private until the grand reveal. You can edit your submission anytime before results are finalized by clicking the rate button again.`,
    ephemeral: true,
  });
}
