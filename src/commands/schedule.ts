import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import {
  createSchedulingSession,
  getActiveSchedulingSession,
  getLatestSchedulingSession,
  finalizeSchedulingSession,
  cancelSchedulingSession,
  updateSessionMessageId,
} from '../services/schedule.service.js';
import { getPlannedMovie, getMovieById } from '../services/movie.service.js';
import { buildScheduleEmbed, formatRuntime, disableMessageComponents } from '../utils/discordHelpers.js';
import { syncDiscordEvent, deleteDiscordEvent } from '../services/discordEvent.service.js';
import { calculateEventDate } from '../utils/dateHelper.js';
import { isUserAdmin } from '../utils/auth.js';

export const scheduleCommand = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Manage weekly movie night availability polls and scheduling')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Start a new availability solicitation poll (requires a planned movie)')
        .addStringOption(opt =>
          opt
            .setName('days')
            .setDescription('Comma-separated candidate days (default: Friday, Saturday, Sunday)')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt
            .setName('time')
            .setDescription('Default start time (default: 8:00 PM)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('finalize')
        .setDescription('Declare the winning day/time and create or update the Discord Scheduled Event')
        .addStringOption(opt =>
          opt
            .setName('day')
            .setDescription('The winning day or date (e.g. Saturday, Oct 15, Tomorrow)')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('time')
            .setDescription('Start time (e.g. 8:00 PM, 20:30)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('modify')
        .setDescription('Modify a finalized or active schedule, updating the Discord Scheduled Event')
        .addStringOption(opt =>
          opt
            .setName('day')
            .setDescription('The new day or date (e.g. Saturday, Oct 15, Tomorrow)')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('time')
            .setDescription('The new start time (e.g. 8:30 PM, 20:00)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('cancel')
        .setDescription('Cancel the movie night schedule and delete the Discord Scheduled Event')
    )
    .addSubcommand(sub =>
      sub
        .setName('current')
        .setDescription('View the current movie night schedule status')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand !== 'current' && !isUserAdmin(interaction)) {
      await interaction.reply({
        content: '❌ Only administrators can manage movie night scheduling polls and events.',
        ephemeral: true,
      });
      return;
    }

    // ==========================================
    // 1. /schedule start
    // ==========================================
    if (subcommand === 'start') {
      const plannedMovie = await getPlannedMovie();
      if (!plannedMovie) {
        await interaction.reply({
          content: '❌ **Cannot start schedule**: No movie is currently planned for Movie Night!\n' +
            'Please select and lock in a movie first using `/movie set <movie>` before starting the availability poll.',
          ephemeral: true,
        });
        return;
      }

      const daysInput = interaction.options.getString('days') || 'Friday, Saturday, Sunday';
      const defaultTime = interaction.options.getString('time') || '8:00 PM';

      const candidateDays = daysInput
        .split(',')
        .map(d => d.trim())
        .filter(d => d.length > 0);

      if (candidateDays.length === 0) {
        await interaction.reply({ content: '❌ Please provide at least one candidate day.', ephemeral: true });
        return;
      }

      const session = await createSchedulingSession(
        candidateDays,
        defaultTime,
        plannedMovie.id,
        interaction.channelId
      );

      // Build day buttons
      const buttons: ButtonBuilder[] = candidateDays.map(day =>
        new ButtonBuilder()
          .setCustomId(`sched:toggle:${session.id}:${day}`)
          .setLabel(day)
          .setStyle(ButtonStyle.Primary)
      );

      // Add "Cannot make it" button
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`sched:toggle:${session.id}:NONE`)
          .setLabel('❌ Cannot make it')
          .setStyle(ButtonStyle.Secondary)
      );

      // Split buttons into rows of up to 5
      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      for (let i = 0; i < buttons.length; i += 5) {
        const slice = buttons.slice(i, i + 5);
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(slice));
      }

      const embed = buildScheduleEmbed(candidateDays, defaultTime, [], plannedMovie);

      const message = await interaction.reply({
        embeds: [embed],
        components: rows,
        fetchReply: true,
      });

      await updateSessionMessageId(session.id, message.id);
      return;
    }

    // ==========================================
    // 2. /schedule finalize
    // ==========================================
    if (subcommand === 'finalize') {
      const session = await getLatestSchedulingSession();
      if (!session) {
        await interaction.reply({
          content: '❌ No active or recent scheduling session found. Use `/schedule start` to start one!',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      const winningDay = interaction.options.getString('day', true);
      const timeOverride = interaction.options.getString('time') || session.defaultTime;
      const plannedMovie = session.plannedMovieId ? await getMovieById(session.plannedMovieId) : null;

      // Disable buttons on the original poll message if accessible
      await disableMessageComponents(interaction.client, session.channelId, session.messageId);

      // Calculate target date for Discord Scheduled Event
      const targetDate = calculateEventDate(winningDay, timeOverride);

      let eventNotice = '';
      let eventId: string | null = session.discordEventId || null;

      if (interaction.guild && plannedMovie) {
        const syncedEvent = await syncDiscordEvent({
          guild: interaction.guild,
          session,
          movie: plannedMovie,
          targetDate,
        });
        if (syncedEvent) {
          eventId = syncedEvent.id;
          eventNotice = `\n📅 *Native Discord Scheduled Event created: [${syncedEvent.name}](${syncedEvent.url || ''})*`;
        }
      }

      await finalizeSchedulingSession(
        session.id,
        winningDay,
        timeOverride,
        eventId,
        targetDate.toISOString()
      );

      await interaction.editReply({
        content: `🎉 **Movie Night is officially scheduled for ${winningDay} at ${timeOverride}!**${eventNotice}\nGet the popcorn ready! 🍿`,
      });
      return;
    }

    // ==========================================
    // 3. /schedule modify
    // ==========================================
    if (subcommand === 'modify') {
      const session = await getLatestSchedulingSession();
      if (!session) {
        await interaction.reply({
          content: '❌ No active or finalized schedule found to modify. Use `/schedule start` to begin a poll!',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      const newDay = interaction.options.getString('day', true);
      const newTime = interaction.options.getString('time') || session.defaultTime;
      const plannedMovie = session.plannedMovieId ? await getMovieById(session.plannedMovieId) : null;

      // Disable buttons on any open poll message if it was still active
      if (session.status === 'active') {
        await disableMessageComponents(interaction.client, session.channelId, session.messageId);
      }

      const targetDate = calculateEventDate(newDay, newTime);
      let eventNotice = '';
      let eventId = session.discordEventId || null;

      if (interaction.guild && plannedMovie) {
        const syncedEvent = await syncDiscordEvent({
          guild: interaction.guild,
          session,
          movie: plannedMovie,
          targetDate,
        });
        if (syncedEvent) {
          eventId = syncedEvent.id;
          eventNotice = `\n📅 *Updated native Discord Scheduled Event to **${newDay} at ${newTime}**!*`;
        }
      }

      await finalizeSchedulingSession(
        session.id,
        newDay,
        newTime,
        eventId,
        targetDate.toISOString()
      );

      await interaction.editReply({
        content: `🔄 **Movie Night Schedule Modified!**\n` +
          `Movie Night has been updated to **${newDay} at ${newTime}**!${eventNotice}\n` +
          `${plannedMovie ? `Watching: **${plannedMovie.title}** (${formatRuntime(plannedMovie.runtimeMinutes)})` : ''}`,
      });
      return;
    }

    // ==========================================
    // 4. /schedule cancel
    // ==========================================
    if (subcommand === 'cancel') {
      const session = await getLatestSchedulingSession();
      if (!session) {
        await interaction.reply({
          content: 'No active or finalized scheduling session found to cancel.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      // Delete Discord Scheduled Event if one exists
      let eventRemoved = false;
      if (session.discordEventId && interaction.guild) {
        eventRemoved = await deleteDiscordEvent(interaction.guild, session.discordEventId);
      }

      // Disable poll buttons if message is accessible
      await disableMessageComponents(interaction.client, session.channelId, session.messageId);

      await cancelSchedulingSession(session.id);

      const eventNote = eventRemoved
        ? '\n📅 *The corresponding Discord Scheduled Event was also removed.*'
        : '';

      await interaction.editReply({
        content: `🚫 **The movie night schedule has been cancelled.**${eventNote}`,
      });
      return;
    }

    // ==========================================
    // 5. /schedule current
    // ==========================================
    if (subcommand === 'current') {
      const session = await getLatestSchedulingSession();
      if (!session) {
        await interaction.reply({
          content: 'No active or finalized movie night schedule found.',
          ephemeral: true,
        });
        return;
      }

      const plannedMovie = session.plannedMovieId ? await getMovieById(session.plannedMovieId) : null;

      const embed = new EmbedBuilder()
        .setTitle('📅 Current Movie Night Schedule')
        .setColor(session.status === 'finalized' ? 0x10B981 : 0x8B5CF6)
        .addFields(
          { name: '📌 Status', value: `\`${session.status.toUpperCase()}\``, inline: true },
          { name: '🕒 Slot', value: session.finalizedSlot || `Poll active (${session.defaultTime})`, inline: true }
        );

      if (plannedMovie) {
        embed.addFields({
          name: '🎬 Planned Feature',
          value: `**${plannedMovie.title}** (${plannedMovie.releaseYear || 'N/A'})\n⏱ Runtime: ${formatRuntime(plannedMovie.runtimeMinutes)}`,
          inline: false,
        });
        if (plannedMovie.posterPath) {
          embed.setThumbnail(plannedMovie.posterPath);
        }
      }

      if (session.discordEventId) {
        embed.addFields({
          name: '📅 Discord Event',
          value: `Linked to Discord Event ID: \`${session.discordEventId}\``,
          inline: false,
        });
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};
