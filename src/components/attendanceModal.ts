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
} from 'discord.js';
import { Movie } from '../db/schema.js';
import { CandidateAttendee, recordAttendance } from '../services/attendance.service.js';
import { dispatchRatingRequests } from '../services/rating.service.js';

interface PendingConfirmation {
  movieId: number;
  movie: Movie;
  attendees: Map<string, string>; // userId -> userName
  adminUserId: string;
  channelId: string;
  timer: NodeJS.Timeout;
  resolved: boolean;
}

const pendingConfirmations = new Map<string, PendingConfirmation>();

/**
 * Initiates the 10-second attendance confirmation workflow for the Admin.
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
      `Detected potential attendees from voice/scheduling:\n${initialList}\n\n⏱ **10-Second Auto-Confirmation Window Active**\nClick **Confirm Now** or adjust the list below. If no changes are made, this list will auto-confirm in 10 seconds.`
    )
    .setFooter({ text: '10-second confirmation timer running...' });

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

  const reply = await interaction.reply({
    embeds: [embed],
    components: [selectRow, buttonRow],
    ephemeral: true,
  });

  const sessionKey = `${interaction.guildId}:${movie.id}`;

  // 10-second auto-confirmation timer
  const timer = setTimeout(async () => {
    const pending = pendingConfirmations.get(sessionKey);
    if (!pending || pending.resolved) return;

    pending.resolved = true;
    pendingConfirmations.delete(sessionKey);

    const finalAttendees = Array.from(pending.attendees.entries()).map(([userId, userName]) => ({
      userId,
      userName,
    }));

    await recordAttendance(pending.movieId, finalAttendees);
    await dispatchRatingRequests(interaction.client, pending.movie, finalAttendees, targetChannel);

    try {
      await interaction.editReply({
        content: `✅ **10-second confirmation window elapsed.**\nAutomatically confirmed **${finalAttendees.length}** attendees and dispatched rating requests to DMs and #${targetChannel?.name || 'shows-n-movies'}!`,
        embeds: [],
        components: [],
      });
    } catch (e) {
      console.error('[Attendance] Could not update ephemeral reply after timeout:', e);
    }
  }, 10_000);

  pendingConfirmations.set(sessionKey, {
    movieId: movie.id,
    movie,
    attendees: attendeeMap,
    adminUserId: interaction.user.id,
    channelId: interaction.channelId,
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

  // Clear and update with selected users
  pending.attendees.clear();
  for (const [userId, user] of interaction.users) {
    pending.attendees.set(userId, user.displayName || user.username);
  }

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
    const finalAttendees = Array.from(pending.attendees.entries()).map(([userId, userName]) => ({
      userId,
      userName,
    }));

    await recordAttendance(pending.movieId, finalAttendees);
    await dispatchRatingRequests(interaction.client, pending.movie, finalAttendees, targetChannel);

    await interaction.update({
      content: `✅ Confirmed **${finalAttendees.length}** attendees! Rating requests have been dispatched to DMs and #${targetChannel?.name || 'shows-n-movies'}.`,
      embeds: [],
      components: [],
    });
  }
}
