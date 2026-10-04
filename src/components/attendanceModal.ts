import {
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  EmbedBuilder,
  ButtonInteraction,
  UserSelectMenuInteraction,
  TextChannel,
  Client,
} from 'discord.js';
import { Movie } from '../db/schema.js';
import { CandidateAttendee, recordAttendance } from '../services/attendance.service.js';
import { dispatchRatingRequests, getRatingProgress } from '../services/rating.service.js';
import { buildRatingProgressEmbed } from '../utils/discordHelpers.js';
import { isUserAdmin } from '../utils/auth.js';

interface PendingConfirmation {
  movieId: number;
  movie: Movie;
  attendees: Map<string, string>; // userId -> userName
  adminUserId: string;
  channelId: string;
  targetChannel?: TextChannel | null;
  timer: NodeJS.Timeout;
  resolved: boolean;
}

const pendingConfirmations = new Map<string, PendingConfirmation>();

async function executeAttendanceConfirmation(
  pending: PendingConfirmation,
  client: Client
): Promise<{ count: number; progressEmbed: EmbedBuilder | null }> {
  const finalAttendees = Array.from(pending.attendees.entries()).map(([userId, userName]) => ({
    userId,
    userName,
  }));

  await recordAttendance(pending.movieId, finalAttendees);
  await dispatchRatingRequests(client, pending.movie, finalAttendees, pending.targetChannel);
  const progress = await getRatingProgress(pending.movieId);
  const progressEmbed = progress ? buildRatingProgressEmbed(progress) : null;

  return { count: finalAttendees.length, progressEmbed };
}

function scheduleConfirmationTimer(
  sessionKey: string,
  interaction: ChatInputCommandInteraction | UserSelectMenuInteraction,
  durationMs: number
): NodeJS.Timeout {
  return setTimeout(async () => {
    const current = pendingConfirmations.get(sessionKey);
    if (!current || current.resolved) return;

    current.resolved = true;
    pendingConfirmations.delete(sessionKey);

    const { count, progressEmbed } = await executeAttendanceConfirmation(current, interaction.client);

    try {
      await interaction.editReply({
        content: `✅ **Confirmation window completed.**\nConfirmed **${count}** attendees! Rating requests dispatched to DMs and #${current.targetChannel?.name || 'shows-n-movies'}.\n\n` +
          `📊 *Live status below updates in real-time as reviews roll in:*`,
        embeds: progressEmbed ? [progressEmbed] : [],
        components: [],
      });
    } catch (e) {
      console.error('[Attendance] Could not update ephemeral reply after timeout:', e);
    }
  }, durationMs);
}

/**
 * Initiates the attendance confirmation workflow for the Admin.
 */
export async function startAttendanceConfirmation(
  interaction: ChatInputCommandInteraction,
  movie: Movie,
  detected: CandidateAttendee[],
  targetChannel?: TextChannel | null
): Promise<void> {
  const attendeeMap = new Map<string, string>();
  for (const a of detected) {
    attendeeMap.set(a.userId, a.userName);
  }

  const initialList = detected.length > 0
    ? detected.map(a => `<@${a.userId}> (${a.source})`).join(', ')
    : '_None detected automatically (please select below)_';

  const embed = new EmbedBuilder()
    .setTitle(`🎬 Confirm Attendees: ${movie.title}`)
    .setColor(0xF59E0B)
    .setDescription(
      `Detected potential attendees from voice/scheduling:\n${initialList}\n\n⏱ **Auto-Confirmation Window Active (15s)**\nClick **Confirm Now** or adjust the list below. If no changes are made, this list will auto-confirm.`
    )
    .setFooter({ text: 'Confirmation timer running...' });

  const confirmBtn = new ButtonBuilder()
    .setCustomId(`attend:confirm:${movie.id}`)
    .setLabel('✅ Confirm Now & Send Rating Requests')
    .setStyle(ButtonStyle.Success);

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`attend:cancel:${movie.id}`)
    .setLabel('❌ Cancel')
    .setStyle(ButtonStyle.Secondary);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

  const userSelect = new UserSelectMenuBuilder()
    .setCustomId(`attend:select:${movie.id}`)
    .setPlaceholder('Add or adjust attendees')
    .setMinValues(0)
    .setMaxValues(25);

  const initialUserIds = Array.from(attendeeMap.keys()).slice(0, 25);
  if (initialUserIds.length > 0) {
    userSelect.setDefaultUsers(initialUserIds);
  }

  const selectRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect);

  await interaction.reply({
    embeds: [embed],
    components: [selectRow, buttonRow],
    ephemeral: true,
  });

  const sessionKey = `${interaction.guildId}:${movie.id}`;
  const timer = scheduleConfirmationTimer(sessionKey, interaction, 15_000);

  pendingConfirmations.set(sessionKey, {
    movieId: movie.id,
    movie,
    attendees: attendeeMap,
    adminUserId: interaction.user.id,
    channelId: interaction.channelId,
    targetChannel,
    timer,
    resolved: false,
  });
}

/**
 * Handles Admin modifying the attendee user select menu.
 */
export async function handleAttendeeSelect(interaction: UserSelectMenuInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  if (parts.length < 3 || parts[0] !== 'attend' || parts[1] !== 'select') return;

  const movieId = parseInt(parts[2], 10);
  const sessionKey = `${interaction.guildId}:${movieId}`;
  const pending = pendingConfirmations.get(sessionKey);

  if (!pending || pending.resolved) {
    await interaction.reply({ content: 'This confirmation window has already expired.', ephemeral: true });
    return;
  }

  if (interaction.user.id !== pending.adminUserId && !isUserAdmin(interaction)) {
    await interaction.reply({ content: '❌ Only administrators can modify movie attendees.', ephemeral: true });
    return;
  }

  // Clear and update with selected users
  pending.attendees.clear();
  for (const [userId, user] of interaction.users) {
    pending.attendees.set(userId, user.displayName || user.username);
  }

  // Reset the timer to give the admin 20 seconds after editing
  clearTimeout(pending.timer);
  pending.timer = scheduleConfirmationTimer(sessionKey, interaction, 20_000);

  const updatedList = Array.from(pending.attendees.keys()).map(id => `<@${id}>`).join(', ') || '_No attendees selected_';

  const embed = new EmbedBuilder()
    .setTitle(`🎬 Confirm Attendees: ${pending.movie.title}`)
    .setColor(0xF59E0B)
    .setDescription(
      `Updated attendees list:\n${updatedList}\n\n⏱ Click **Confirm Now** to dispatch rating forms, or wait for timer.`
    );

  await interaction.update({ embeds: [embed] });
}

/**
 * Handles Admin clicking Confirm or Cancel button.
 */
export async function handleAttendanceButtonClick(
  interaction: ButtonInteraction,
  targetChannel?: TextChannel | null
): Promise<void> {
  const parts = interaction.customId.split(':');
  if (parts.length < 3 || parts[0] !== 'attend') return;

  const action = parts[1];
  const movieId = parseInt(parts[2], 10);
  const sessionKey = `${interaction.guildId}:${movieId}`;
  const pending = pendingConfirmations.get(sessionKey);

  if (!pending || pending.resolved) {
    await interaction.reply({ content: 'This confirmation window has already expired or been resolved.', ephemeral: true });
    return;
  }

  if (interaction.user.id !== pending.adminUserId && !isUserAdmin(interaction)) {
    await interaction.reply({ content: '❌ Only administrators can confirm or cancel attendance.', ephemeral: true });
    return;
  }

  clearTimeout(pending.timer);
  pending.resolved = true;
  pendingConfirmations.delete(sessionKey);

  if (action === 'cancel') {
    await interaction.update({
      content: '❌ Movie finish / attendance confirmation was cancelled.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (action === 'confirm') {
    const { count, progressEmbed } = await executeAttendanceConfirmation(pending, interaction.client);

    await interaction.update({
      content: `✅ Confirmed **${count}** attendees! Rating requests have been dispatched to DMs and #${targetChannel?.name || 'shows-n-movies'}.\n\n` +
        `📊 *Live status below updates in real-time as reviews roll in:*`,
      embeds: progressEmbed ? [progressEmbed] : [],
      components: [],
    });
  }
}
