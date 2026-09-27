import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} from 'discord.js';
import {
  createSchedulingSession,
  getActiveSchedulingSession,
  finalizeSchedulingSession,
  cancelSchedulingSession,
  updateSessionMessageId,
  getSessionVotes,
} from '../services/schedule.service.js';
import { getPlannedMovie } from '../services/movie.service.js';
import { buildScheduleEmbed } from '../utils/discordHelpers.js';

export const scheduleCommand = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Manage weekly movie night availability polls and scheduling')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Start a new availability solicitation poll')
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
        .setDescription('Finalize availability and declare the winning day/time')
        .addStringOption(opt =>
          opt
            .setName('day')
            .setDescription('The winning day (e.g. Saturday)')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('time')
            .setDescription('Optional start time override (e.g. 8:30 PM)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('cancel')
        .setDescription('Cancel the currently active availability poll')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'start') {
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

      const plannedMovie = await getPlannedMovie();
      const session = await createSchedulingSession(
        candidateDays,
        defaultTime,
        plannedMovie?.id || null,
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

    if (subcommand === 'finalize') {
      const active = await getActiveSchedulingSession();
      if (!active) {
        await interaction.reply({ content: '❌ No active scheduling session found.', ephemeral: true });
        return;
      }

      const winningDay = interaction.options.getString('day', true);
      const timeOverride = interaction.options.getString('time') || active.defaultTime;

      const finalized = await finalizeSchedulingSession(active.id, winningDay, timeOverride);
      const plannedMovie = active.plannedMovieId ? await getPlannedMovie() : null;

      // Lock buttons on original poll message if accessible
      if (active.channelId && active.messageId) {
        try {
          const channel = await interaction.client.channels.fetch(active.channelId);
          if (channel && channel.isTextBased()) {
            const originalMsg = await channel.messages.fetch(active.messageId);
            if (originalMsg) {
              await originalMsg.edit({ components: [] });
            }
          }
        } catch (e) {
          console.warn('[Schedule] Could not disable buttons on original poll message:', e);
        }
      }

      // Try creating native Discord Scheduled Event
      let eventNotice = '';
      if (interaction.guild && interaction.guild.scheduledEvents) {
        try {
          // Estimate scheduled start date
          const now = new Date();
          const targetDate = new Date(now.getTime() + 24 * 60 * 60 * 1000 * 2); // default 2 days out
          const eventTitle = plannedMovie ? `🎬 Movie Night: ${plannedMovie.title}` : '🎬 Weekly Movie Night';

          await interaction.guild.scheduledEvents.create({
            name: eventTitle,
            scheduledStartTime: targetDate,
            privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
            entityType: GuildScheduledEventEntityType.Voice,
            channel: interaction.guild.channels.cache.find(c => c.isVoiceBased())?.id || undefined,
            description: plannedMovie
              ? `Watching ${plannedMovie.title} (${plannedMovie.releaseYear || ''}). Runtime: ${plannedMovie.runtimeMinutes || 'N/A'} mins.`
              : 'Weekly Movie Night with friends!',
          });
          eventNotice = '\n📅 *Native Discord Scheduled Event created!*';
        } catch (err: any) {
          console.warn('[Schedule] Could not create Discord Scheduled Event:', err.message);
        }
      }

      await interaction.reply({
        content: `🎉 **Movie Night is officially scheduled for ${winningDay} at ${timeOverride}!**${eventNotice}\nGet the popcorn ready! 🍿`,
      });
      return;
    }

    if (subcommand === 'cancel') {
      const active = await getActiveSchedulingSession();
      if (!active) {
        await interaction.reply({ content: 'No active scheduling session found.', ephemeral: true });
        return;
      }

      await cancelSchedulingSession(active.id);
      await interaction.reply({ content: '🚫 The active scheduling session has been cancelled.' });
      return;
    }
  },
};
