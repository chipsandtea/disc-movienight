import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  TextChannel,
  GuildMember,
  PermissionFlagsBits,
} from 'discord.js';
import {
  getBacklogMovies,
  getPlannedMovie,
  setPlannedMovie,
  getRandomBacklogMovies,
  getUserStats,
  getLeaderboard,
  addMovieToBacklog,
  getActiveMovieForRating,
  updateMovieSuggester,
} from '../services/movie.service.js';
import { detectPotentialAttendees } from '../services/attendance.service.js';
import { getRatingProgress, finalizeMovieRatings } from '../services/rating.service.js';
import { startAttendanceConfirmation } from '../components/attendanceModal.js';
import { buildMovieEmbed, buildRevealEmbed, buildUserStatsEmbed, buildScheduleEmbed, buildRatingProgressEmbed, formatRuntime, resolveMovieChannel } from '../utils/discordHelpers.js';
import { extractImdbId, findByImdbId, getMovieDetails, searchMovies } from '../services/tmdb.service.js';
import { getLatestSchedulingSession, updateSessionPlannedMovie, getSessionVotes } from '../services/schedule.service.js';
import { syncDiscordEvent } from '../services/discordEvent.service.js';
import { db } from '../db/client.js';
import { movies } from '../db/schema.js';
import { eq, and, or, desc, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { isUserAdmin } from '../utils/auth.js';

export const movieCommand = {
  data: new SlashCommandBuilder()
    .setName('movie')
    .setDescription('Manage movie night states, attendance, ratings, and stats')
    .addSubcommand(sub =>
      sub
        .setName('suggest')
        .setDescription('Suggest a movie to the movie night watchlist')
        .addStringOption(opt =>
          opt
            .setName('movie')
            .setDescription('Search TMDB title or paste an IMDb URL / IMDb ID (tt...)')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addBooleanOption(opt =>
          opt
            .setName('rewatch')
            .setDescription('Allow adding even if already watched previously')
            .setRequired(false)
        )
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('Admin only: Attribute this suggestion to another server member')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('set-suggester')
        .setDescription('Reassign who suggested a movie in the backlog or watch history (Admin only)')
        .addStringOption(opt =>
          opt
            .setName('movie')
            .setDescription('Select movie to reassign')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('The member to attribute the suggestion to')
            .setRequired(true)
        )
    )
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
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('Browse movies with optional filters for status or suggesting user')
        .addStringOption(opt =>
          opt
            .setName('status')
            .setDescription('Filter by movie status (default: backlog)')
            .setRequired(false)
            .addChoices(
              { name: 'Backlog (To be watched)', value: 'backlog' },
              { name: 'Watched (Past history)', value: 'watched' },
              { name: 'Planned (Next up)', value: 'planned' },
              { name: 'All Movies', value: 'all' }
            )
        )
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('Filter by user who suggested the movie')
            .setRequired(false)
        )
    ),

  async autocomplete(interaction: AutocompleteInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const focusedValue = interaction.options.getFocused();

    if (subcommand === 'suggest') {
      if (!focusedValue || focusedValue.trim().length === 0) {
        await interaction.respond([]);
        return;
      }

      const imdbId = extractImdbId(focusedValue);
      if (imdbId) {
        await interaction.respond([
          { name: `IMDb ID Detected: ${imdbId.toUpperCase()}`, value: imdbId }
        ]);
        return;
      }

      const results = await searchMovies(focusedValue);
      const choices = results.slice(0, 25).map(m => {
        const year = m.release_date ? m.release_date.split('-')[0] : 'N/A';
        const label = `${m.title} (${year})`.slice(0, 100);
        return {
          name: label,
          value: `tmdb:${m.id}`,
        };
      });

      await interaction.respond(choices);
      return;
    }

    if (subcommand === 'set') {
      const searchVal = focusedValue.toLowerCase();
      const backlog = await getBacklogMovies();

      const filtered = backlog.filter(m =>
        m.title.toLowerCase().includes(searchVal) || (m.releaseYear && String(m.releaseYear).includes(searchVal))
      );

      const choices = filtered.slice(0, 25).map(m => ({
        name: `[#${m.id}] ${m.title} (${m.releaseYear || 'N/A'})${m.imdbId ? ` - ${m.imdbId}` : ''}`.slice(0, 100),
        value: String(m.id),
      }));

      await interaction.respond(choices);
      return;
    }

    if (subcommand === 'set-suggester') {
      const searchVal = focusedValue.toLowerCase();
      const allMovies = await db
        .select()
        .from(movies)
        .orderBy(desc(movies.createdAt));

      const filtered = allMovies.filter(m =>
        m.title.toLowerCase().includes(searchVal) || (m.releaseYear && String(m.releaseYear).includes(searchVal))
      );

      const choices = filtered.slice(0, 25).map(m => ({
        name: `[#${m.id}] ${m.title} (${m.releaseYear || 'N/A'}) [${m.status.toUpperCase()}]`.slice(0, 100),
        value: String(m.id),
      }));

      await interaction.respond(choices);
      return;
    }
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'set') {
      if (!isUserAdmin(interaction)) {
        await interaction.reply({
          content: '❌ Only administrators can set or change the scheduled movie night feature.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      const input = interaction.options.getString('movie', true);
      let targetMovieId: number | null = null;

      if (/^\d+$/.test(input.trim())) {
        targetMovieId = parseInt(input.trim(), 10);
      } else {
        let details = null;
        const imdbId = extractImdbId(input);
        const tmdbMatch = input.match(/themoviedb\.org\/movie\/(\d+)/i);

        if (imdbId) {
          details = await findByImdbId(imdbId);
        } else if (tmdbMatch) {
          details = await getMovieDetails(tmdbMatch[1]);
        }

        if (details) {
          const userName = interaction.member && 'displayName' in interaction.member
            ? (interaction.member.displayName as string)
            : interaction.user.username;

          const addResult = await addMovieToBacklog(details, interaction.user.id, userName, true);
          targetMovieId = addResult.movie.id;
        }
      }

      if (!targetMovieId) {
        await interaction.editReply({
          content: '❌ Could not find that movie. Please pick an option from the autocomplete list or provide a valid IMDb URL / ID.',
        });
        return;
      }

      const planned = await setPlannedMovie(targetMovieId);
      if (!planned) {
        await interaction.editReply({ content: '❌ Could not set planned movie.' });
        return;
      }

      let extraNotice = '';
      const session = await getLatestSchedulingSession();
      if (session) {
        await updateSessionPlannedMovie(session.id, planned.id);

        // 1. If linked to a Discord Scheduled Event, update it with new movie title, description & runtime
        if (session.discordEventId && interaction.guild) {
          const synced = await syncDiscordEvent({
            guild: interaction.guild,
            session,
            movie: planned,
          });
          if (synced) {
            extraNotice += '\n📅 *Updated the native Discord Scheduled Event with the new movie details!*';
          }
        }

        // 2. If an availability poll is active, update the poll message embed with the new movie
        if (session.status === 'active' && session.channelId && session.messageId) {
          try {
            const channel = await interaction.client.channels.fetch(session.channelId);
            if (channel && channel.isTextBased()) {
              const pollMsg = await channel.messages.fetch(session.messageId);
              if (pollMsg) {
                const candidateDays = JSON.parse(session.candidateDays);
                const votes = await getSessionVotes(session.id);
                const updatedEmbed = buildScheduleEmbed(candidateDays, session.defaultTime, votes, planned);
                await pollMsg.edit({ embeds: [updatedEmbed] });
                extraNotice += '\n🗳️ *Updated the active availability poll with the new movie poster & runtime!*';
              }
            }
          } catch (e) {
            console.warn('[Movie] Could not update active poll message embed:', e);
          }
        }
      }

      const embed = buildMovieEmbed(planned, '🎯 Planned Feature Locked In');
      await interaction.editReply({
        content: `🍿 **${planned.title}** is now scheduled as the next movie night feature!${extraNotice}`,
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
          content: 'The watchlist is empty! Use `/movie suggest` to add movies first.',
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
      if (!isUserAdmin(interaction)) {
        await interaction.reply({
          content: '❌ Only administrators can trigger the movie finish and attendance workflow.',
          ephemeral: true,
        });
        return;
      }

      const activeMovie = await getActiveMovieForRating();
      if (!activeMovie) {
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
      const targetChannel = resolveMovieChannel(interaction.guild, config.channelName);

      await startAttendanceConfirmation(interaction, activeMovie, detected, targetChannel);
      return;
    }

    if (subcommand === 'status') {
      const activeMovie = await getActiveMovieForRating();
      if (!activeMovie) {
        await interaction.reply({ content: 'No active or planned movie session found.', ephemeral: true });
        return;
      }

      const progress = await getRatingProgress(activeMovie.id);
      if (!progress) {
        await interaction.reply({ content: 'No attendance or rating records found for this movie.', ephemeral: true });
        return;
      }

      const embed = buildRatingProgressEmbed(progress);
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'nudge') {
      if (!isUserAdmin(interaction)) {
        await interaction.reply({
          content: '❌ Only administrators can send reminder nudges to pending reviewers.',
          ephemeral: true,
        });
        return;
      }

      const activeMovie = await getActiveMovieForRating();
      if (!activeMovie) {
        await interaction.reply({ content: 'No active movie night found.', ephemeral: true });
        return;
      }

      const progress = await getRatingProgress(activeMovie.id);
      if (!progress || progress.pendingUsers.length === 0) {
        await interaction.reply({ content: 'All attendees have already submitted their ratings!', ephemeral: true });
        return;
      }

      const pings = progress.pendingUsers.map(u => `<@${u.userId}>`).join(' ');
      await interaction.reply({
        content: `🔔 Friendly reminder for ${pings}: Don't forget to submit your rating and review for **${activeMovie.title}**! Check your DMs or click the rating button in this channel.`,
      });
      return;
    }

    if (subcommand === 'finalize-ratings') {
      if (!isUserAdmin(interaction)) {
        await interaction.reply({
          content: '❌ Only administrators can finalize movie ratings and reveal results.',
          ephemeral: true,
        });
        return;
      }

      const activeMovie = await getActiveMovieForRating();
      if (!activeMovie) {
        await interaction.reply({ content: '❌ No active planned movie to finalize.', ephemeral: true });
        return;
      }

      await interaction.deferReply();

      const result = await finalizeMovieRatings(activeMovie.id, interaction.client);
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

    if (subcommand === 'list') {
      const statusFilter = interaction.options.getString('status') || 'backlog';
      const targetUser = interaction.options.getUser('user');

      const conditions = [];

      if (statusFilter === 'backlog') {
        conditions.push(or(eq(movies.status, 'backlog'), eq(movies.status, 'planned')));
      } else if (statusFilter === 'watched') {
        conditions.push(eq(movies.status, 'watched'));
      } else if (statusFilter === 'planned') {
        conditions.push(eq(movies.status, 'planned'));
      }

      if (targetUser) {
        conditions.push(eq(movies.suggestedByUserId, targetUser.id));
      }

      const whereClause = conditions.length > 0
        ? conditions.length === 1 ? conditions[0] : and(...conditions)
        : undefined;

      const orderClauses = (statusFilter === 'backlog' || statusFilter === 'all')
        ? [sql`CASE WHEN ${movies.status} = 'planned' THEN 0 ELSE 1 END`, desc(movies.createdAt)]
        : [desc(movies.createdAt)];

      const movieList = await db
        .select()
        .from(movies)
        .where(whereClause)
        .orderBy(...orderClauses)
        .limit(25);

      if (movieList.length === 0) {
        const userNote = targetUser ? ` suggested by <@${targetUser.id}>` : '';
        await interaction.reply({
          content: `No movies currently found in \`${statusFilter}\`${userNote}. Use \`/movie suggest\` to add some!`,
          ephemeral: true,
        });
        return;
      }

      let title = '📋 Movie List';
      if (statusFilter === 'backlog') title = '📋 Movie Watchlist (Backlog)';
      else if (statusFilter === 'watched') title = '🍿 Watched Movies (Past History)';
      else if (statusFilter === 'planned') title = '🎯 Planned Movie';
      else if (statusFilter === 'all') title = '🎬 All Movies';

      if (targetUser) {
        title += ` • Suggested by ${targetUser.displayName || targetUser.username}`;
      }

      const color = statusFilter === 'watched' ? 0x10B981 : statusFilter === 'planned' ? 0xF59E0B : 0x3B82F6;

      const description = movieList
        .map((m, idx) => {
          const badge = m.status === 'planned'
            ? ' 🎯 `[PLANNED]`'
            : m.status === 'watched'
            ? ' 🍿 `[WATCHED]`'
            : '';
          const titleLink = m.imdbId
            ? `[${m.title}](https://www.imdb.com/title/${m.imdbId}/)`
            : `**${m.title}**`;
          return `**${idx + 1}. ${titleLink}** (${m.releaseYear || 'N/A'})${badge}\n⏱ ${formatRuntime(m.runtimeMinutes)} • Suggested by <@${m.suggestedByUserId}>`;
        })
        .join('\n\n');

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(description)
        .setFooter({ text: `Showing up to 25 entries • Total in view: ${movieList.length}` });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'suggest') {
      const input = interaction.options.getString('movie', true);
      const allowRewatch = interaction.options.getBoolean('rewatch') || false;
      const targetUser = interaction.options.getUser('user');

      const isAdmin = isUserAdmin(interaction);

      if (targetUser && !isAdmin) {
        await interaction.reply({
          content: '❌ Only server administrators can submit movie suggestions on behalf of other members.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      let details = null;
      const imdbId = extractImdbId(input);

      if (imdbId) {
        details = await findByImdbId(imdbId);
      } else if (input.startsWith('tmdb:')) {
        const tmdbId = input.replace('tmdb:', '').trim();
        details = await getMovieDetails(tmdbId);
      } else {
        const searchResults = await searchMovies(input);
        if (searchResults.length > 0) {
          details = await getMovieDetails(searchResults[0].id);
        } else if (/^\d+$/.test(input.trim())) {
          details = await getMovieDetails(input.trim());
        }
      }

      if (!details) {
        await interaction.editReply({
          content: `❌ Could not find a movie matching "${input}". Please check the spelling or provide an IMDb link.`,
        });
        return;
      }

      const creditedUser = targetUser || interaction.user;
      let creditedUsername = creditedUser.username;
      if (interaction.guild && targetUser) {
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (member?.displayName) creditedUsername = member.displayName;
      } else if (interaction.member && 'displayName' in interaction.member) {
        creditedUsername = interaction.member.displayName as string;
      }

      const result = await addMovieToBacklog(details, creditedUser.id, creditedUsername, allowRewatch);

      if (result.status === 'already_watched') {
        const pastScore = result.pastScore !== null ? `⭐ **${result.pastScore} / 10**` : 'an unrecorded score';
        await interaction.editReply({
          content: `⚠️ We already watched **${result.movie.title}** on ${result.movie.watchedAt ? new Date(result.movie.watchedAt).toLocaleDateString() : 'a previous movie night'}! It received a group rating of ${pastScore}.\n*(To add it as a re-watch, include \`rewatch: true\`)*`,
        });
        return;
      }

      if (result.status === 'already_in_backlog') {
        await interaction.editReply({
          content: `ℹ️ **${result.movie.title}** is already in the ${result.movie.status === 'planned' ? 'planned schedule' : 'watchlist'} (suggested by <@${result.movie.suggestedByUserId}>).`,
        });
        return;
      }

      const embed = buildMovieEmbed(result.movie, '✅ Added to Watchlist');
      const onBehalfNotice = targetUser ? ` on behalf of <@${creditedUser.id}>` : '';
      await interaction.editReply({
        content: `🎉 **${result.movie.title}** was added to the movie night backlog${onBehalfNotice}!`,
        embeds: [embed],
      });
      return;
    }

    if (subcommand === 'set-suggester') {
      const isAdmin = isUserAdmin(interaction);

      if (!isAdmin) {
        await interaction.reply({
          content: '❌ Only server administrators can reassign movie suggesters.',
          ephemeral: true,
        });
        return;
      }

      const input = interaction.options.getString('movie', true);
      const targetUser = interaction.options.getUser('user', true);

      let movieId = parseInt(input.trim(), 10);
      if (isNaN(movieId)) {
        const match = await db.select().from(movies).where(eq(movies.title, input.trim())).limit(1);
        if (match.length === 0) {
          await interaction.reply({
            content: `❌ Could not find a movie matching "${input}". Please select from the autocomplete list.`,
            ephemeral: true,
          });
          return;
        }
        movieId = match[0].id;
      }

      let newUsername = targetUser.username;
      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (member?.displayName) newUsername = member.displayName;
      }

      const updateResult = await updateMovieSuggester(movieId, targetUser.id, newUsername, isAdmin);
      if (!updateResult.success || !updateResult.movie) {
        await interaction.reply({
          content: `❌ ${updateResult.error || 'Failed to update movie suggester.'}`,
          ephemeral: true,
        });
        return;
      }

      const embed = buildMovieEmbed(updateResult.movie, '🔄 Suggester Updated');
      await interaction.reply({
        content: `✅ Successfully reassigned suggester for **${updateResult.movie.title}** to <@${targetUser.id}>.`,
        embeds: [embed],
      });
      return;
    }
  },
};
