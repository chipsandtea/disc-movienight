import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  TextChannel,
  GuildMember,
} from 'discord.js';
import {
  getBacklogMovies,
  getPlannedMovie,
  setPlannedMovie,
  getRandomBacklogMovies,
  getUserStats,
  getLeaderboard,
} from '../services/movie.service.js';
import { detectPotentialAttendees } from '../services/attendance.service.js';
import { getRatingProgress, finalizeMovieRatings } from '../services/rating.service.js';
import { startAttendanceConfirmation } from '../components/attendanceModal.js';
import { buildMovieEmbed, buildRevealEmbed, buildUserStatsEmbed, formatRuntime } from '../utils/discordHelpers.js';
import { extractImdbId, findByImdbId } from '../services/tmdb.service.js';
import { config } from '../config.js';

export const movieCommand = {
  data: new SlashCommandBuilder()
    .setName('movie')
    .setDescription('Manage movie night states, attendance, ratings, and stats')
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Set the planned movie for the upcoming movie night (typo-proof selection)')
        .addStringOption(opt =>
          opt
            .setName('movie')
            .setDescription('Select from backlog via autocomplete, or paste an IMDb ID/URL')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('current')
        .setDescription('View the currently planned movie for this week')
    )
    .addSubcommand(sub =>
      sub
        .setName('random')
        .setDescription('Draw random movie candidates from the backlog for inspiration or spinner wheel')
        .addIntegerOption(opt =>
          opt
            .setName('count')
            .setDescription('Number of random movies to draw (1 to 5, default: 3)')
            .setMinValue(1)
            .setMaxValue(5)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('finish')
        .setDescription('Mark the movie as finished, auto-detect voice attendance, and start rating collection')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Check rating submission progress for the current movie')
    )
    .addSubcommand(sub =>
      sub
        .setName('nudge')
        .setDescription('Send a friendly reminder to members who have not submitted their rating')
    )
    .addSubcommand(sub =>
      sub
        .setName('finalize-ratings')
        .setDescription('Finalize all ratings and post the grand results card to #shows-n-movies')
    )
    .addSubcommand(sub =>
      sub
        .setName('leaderboard')
        .setDescription('View all watched movies ranked by group average score')
    )
    .addSubcommand(sub =>
      sub
        .setName('stats')
        .setDescription('View a member\'s attendance, ratings, and recommendation track record')
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('User to view stats for (defaults to yourself)')
            .setRequired(false)
        )
    ),

  async autocomplete(interaction: AutocompleteInteraction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const backlog = await getBacklogMovies();

    const filtered = backlog.filter(m =>
      m.title.toLowerCase().includes(focusedValue) || (m.releaseYear && String(m.releaseYear).includes(focusedValue))
    );

    const choices = filtered.slice(0, 25).map(m => ({
      name: `[#${m.id}] ${m.title} (${m.releaseYear || 'N/A'})${m.imdbId ? ` - ${m.imdbId}` : ''}`.slice(0, 100),
      value: String(m.id),
    }));

    await interaction.respond(choices);
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'set') {
      const input = interaction.options.getString('movie', true);
      let targetMovieId: number | null = null;

      if (/^\d+$/.test(input.trim())) {
        targetMovieId = parseInt(input.trim(), 10);
      } else {
        const imdbId = extractImdbId(input);
        if (imdbId) {
          const details = await findByImdbId(imdbId);
          if (details) {
            targetMovieId = details.id;
          }
        }
      }

      if (!targetMovieId) {
        await interaction.reply({
          content: '❌ Could not find that movie. Please pick an option from the autocomplete list or provide a valid ID.',
          ephemeral: true,
        });
        return;
      }

      const planned = await setPlannedMovie(targetMovieId);
      if (!planned) {
        await interaction.reply({ content: '❌ Could not set planned movie.', ephemeral: true });
        return;
      }

      const embed = buildMovieEmbed(planned, '🎯 Planned Feature Locked In');
      await interaction.reply({
        content: `🍿 **${planned.title}** is now scheduled as the next movie night feature!`,
        embeds: [embed],
      });
      return;
    }

    if (subcommand === 'current') {
      const planned = await getPlannedMovie();
      if (!planned) {
        await interaction.reply({
          content: 'No movie is currently planned for this week. Use `/movie set` or `/movie random` to pick one!',
          ephemeral: true,
        });
        return;
      }

      const embed = buildMovieEmbed(planned, '🎬 Upcoming Feature');
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'random') {
      const count = interaction.options.getInteger('count') || 3;
      const candidates = await getRandomBacklogMovies(count);

      if (candidates.length === 0) {
        await interaction.reply({
          content: 'The watchlist is empty! Use `/suggest` to add movies first.',
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`🎲 Random Movie Draw (${candidates.length})`)
        .setColor(0x8B5CF6)
        .setDescription(
          candidates
            .map(
              (m, idx) =>
                `**${idx + 1}. ${m.title}** (${m.releaseYear || 'N/A'})\n⏱ ${formatRuntime(m.runtimeMinutes)} • Suggested by <@${m.suggestedByUserId}>`
            )
            .join('\n\n')
        )
        .setFooter({ text: 'Run /movie set to lock in a choice!' });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'finish') {
      const planned = await getPlannedMovie();
      if (!planned) {
        await interaction.reply({
          content: '❌ No movie is currently marked as "planned". Use `/movie set` to pick a movie before finishing.',
          ephemeral: true,
        });
        return;
      }

      // Check voice channel of the calling admin
      const member = interaction.member as GuildMember;
      const voiceChannel = member?.voice?.channel;

      const detected = await detectPotentialAttendees(voiceChannel);

      // Find target #shows-n-movies channel
      const targetChannel = interaction.guild?.channels.cache.find(
        c => c.name === config.channelName && c.isTextBased()
      ) as TextChannel | undefined;

      await startAttendanceConfirmation(interaction, planned, detected, targetChannel);
      return;
    }

    if (subcommand === 'status') {
      const planned = await getPlannedMovie();
      if (!planned) {
        await interaction.reply({ content: 'No active or planned movie session found.', ephemeral: true });
        return;
      }

      const progress = await getRatingProgress(planned.id);
      if (!progress) {
        await interaction.reply({ content: 'No attendance or rating records found for this movie.', ephemeral: true });
        return;
      }

      const submittedList = progress.submittedUsers.length > 0
        ? progress.submittedUsers.map(u => `✅ <@${u.userId}>`).join(', ')
        : '_None yet_';

      const pendingList = progress.pendingUsers.length > 0
        ? progress.pendingUsers.map(u => `⏳ <@${u.userId}>`).join(', ')
        : '_Everyone has submitted!_';

      const embed = new EmbedBuilder()
        .setTitle(`📊 Rating Progress: ${progress.movie.title}`)
        .setColor(0x3B82F6)
        .setDescription(
          `**Submitted**: ${progress.submittedCount} / ${progress.totalAttendees}\n\n` +
          `**Submitted**:\n${submittedList}\n\n` +
          `**Pending**:\n${pendingList}`
        )
        .setFooter({ text: 'Use /movie finalize-ratings to reveal results at any time.' });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'nudge') {
      const planned = await getPlannedMovie();
      if (!planned) {
        await interaction.reply({ content: 'No active movie night found.', ephemeral: true });
        return;
      }

      const progress = await getRatingProgress(planned.id);
      if (!progress || progress.pendingUsers.length === 0) {
        await interaction.reply({ content: 'All attendees have already submitted their ratings!', ephemeral: true });
        return;
      }

      const pings = progress.pendingUsers.map(u => `<@${u.userId}>`).join(' ');
      await interaction.reply({
        content: `🔔 Friendly reminder for ${pings}: Don't forget to submit your rating and review for **${planned.title}**! Check your DMs or click the rating button in this channel.`,
      });
      return;
    }

    if (subcommand === 'finalize-ratings') {
      const planned = await getPlannedMovie();
      if (!planned) {
        await interaction.reply({ content: '❌ No active planned movie to finalize.', ephemeral: true });
        return;
      }

      await interaction.deferReply();

      const result = await finalizeMovieRatings(planned.id);
      if (!result) {
        await interaction.editReply({ content: '❌ Failed to compile ratings.' });
        return;
      }

      const revealEmbed = buildRevealEmbed(
        result.movie,
        result.averageRating,
        result.submittedRatings,
        result.unratedAttendees
      );

      await interaction.editReply({
        content: `🎉 **The ratings are in! Here are the official results for ${result.movie.title}:**`,
        embeds: [revealEmbed],
      });
      return;
    }

    if (subcommand === 'leaderboard') {
      const leaderboard = await getLeaderboard();
      if (leaderboard.length === 0) {
        await interaction.reply({ content: 'No watched movies recorded yet! Complete your first movie night to start the leaderboard.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🏆 Movie Night Hall of Fame')
        .setColor(0xF59E0B)
        .setDescription(
          leaderboard.slice(0, 15).map((item, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `\`#${idx + 1}\``;
            const scoreStr = item.averageRating !== null ? `⭐ **${item.averageRating.toFixed(2)} / 10**` : 'Unrated';
            return `${medal} **${item.movie.title}** (${item.movie.releaseYear || 'N/A'})\n> ${scoreStr} • ${item.ratingCount} reviews • Suggested by <@${item.movie.suggestedByUserId}>`;
          }).join('\n\n')
        )
        .setFooter({ text: `Total movies watched: ${leaderboard.length}` });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'stats') {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const stats = await getUserStats(targetUser.id);
      const embed = buildUserStatsEmbed(targetUser.toString(), stats);

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};
