import { ButtonInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getSchedulingSessionById, toggleUserAvailability, getSessionVotes } from '../services/schedule.service.js';
import { getMovieById } from '../services/movie.service.js';
import { buildScheduleEmbed } from '../utils/discordHelpers.js';

/**
 * Handles clicks on weekly availability buttons.
 * Custom ID format: `sched:toggle:<sessionId>:<dayName>`
 */
export async function handleScheduleButtonClick(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  if (parts.length < 4 || parts[0] !== 'sched' || parts[1] !== 'toggle') {
    return;
  }

  const sessionId = parseInt(parts[2], 10);
  const day = parts[3];

  if (isNaN(sessionId) || !day) return;

  const session = await getSchedulingSessionById(sessionId);
  if (!session || session.status !== 'active') {
    await interaction.reply({
      content: 'This scheduling session has ended or been cancelled.',
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;
  const userName = interaction.member && 'displayName' in interaction.member
    ? (interaction.member.displayName as string)
    : interaction.user.username;

  // Toggle availability in SQLite (returns updated votes)
  const votes = await toggleUserAvailability(sessionId, userId, userName, day);

  const plannedMovie = session.plannedMovieId
    ? await getMovieById(session.plannedMovieId)
    : null;

  let candidateDays: string[] = [];
  try {
    candidateDays = JSON.parse(session.candidateDays) as string[];
  } catch {
    candidateDays = [];
  }

  const updatedEmbed = buildScheduleEmbed(candidateDays, session.defaultTime, votes, plannedMovie);

  // Update original message
  await interaction.update({
    embeds: [updatedEmbed],
  });
}
