import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { getBacklogMovies, removeMovieFromBacklog } from '../services/movie.service.js';
import { formatWheelExport } from '../utils/wheelHelper.js';
import { formatRuntime } from '../utils/discordHelpers.js';
import { db } from '../db/client.js';
import { movies } from '../db/schema.js';
import { eq, desc, or } from 'drizzle-orm';

export const watchlistCommand = {
  data: new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage and view the movie watchlist and spinner wheel')
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('View movies currently in the backlog')
        .addStringOption(opt =>
          opt
            .setName('filter')
            .setDescription('Filter movies by status')
            .addChoices(
              { name: 'Backlog (To be watched)', value: 'backlog' },
              { name: 'Watched (Past history)', value: 'watched' }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a movie from the backlog')
        .addStringOption(opt =>
          opt
            .setName('movie')
            .setDescription('Select the movie to remove')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('wheel-export')
        .setDescription('Export backlog movies formatted for Wheel of Names or manual copy-pasting')
    ),

  async autocomplete(interaction: AutocompleteInteraction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const backlog = await getBacklogMovies();

    const filtered = backlog.filter(m =>
      m.title.toLowerCase().includes(focusedValue) || (m.releaseYear && String(m.releaseYear).includes(focusedValue))
    );

    const choices = filtered.slice(0, 25).map(m => ({
      name: `[#${m.id}] ${m.title} (${m.releaseYear || 'N/A'})`.slice(0, 100),
      value: String(m.id),
    }));

    await interaction.respond(choices);
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'view') {
      const filter = interaction.options.getString('filter') || 'backlog';
      const statusCondition = filter === 'backlog'
        ? or(eq(movies.status, 'backlog'), eq(movies.status, 'planned'))
        : eq(movies.status, 'watched');

      const movieList = await db
        .select()
        .from(movies)
        .where(statusCondition)
        .orderBy(desc(movies.createdAt))
        .limit(20);

      if (movieList.length === 0) {
        await interaction.reply({
          content: `No movies currently found in \`${filter}\`. Use \`/suggest\` to add some!`,
          ephemeral: true,
        });
        return;
      }

      // Sort planned movies to the very top if in backlog view
      if (filter === 'backlog') {
        movieList.sort((a, b) => (b.status === 'planned' ? 1 : 0) - (a.status === 'planned' ? 1 : 0));
      }

      const embed = new EmbedBuilder()
        .setTitle(filter === 'backlog' ? '📋 Movie Night Watchlist (Backlog)' : '🍿 Past Watched Movies')
        .setColor(filter === 'backlog' ? 0x3B82F6 : 0x10B981)
        .setDescription(
          movieList
            .map((m, idx) => {
              const badge = m.status === 'planned' ? ' 🎯 `[PLANNED NEXT]`' : '';
              return `**${idx + 1}. [${m.title}](https://www.imdb.com/title/${m.imdbId || ''})** (${m.releaseYear || 'N/A'})${badge}\n⏱ ${formatRuntime(m.runtimeMinutes)} • Suggested by <@${m.suggestedByUserId}>`;
            })
            .join('\n\n')
        )
        .setFooter({ text: `Showing up to 20 entries • Total in list: ${movieList.length}` });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'remove') {
      const movieIdStr = interaction.options.getString('movie', true);
      const movieId = parseInt(movieIdStr, 10);

      const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || false;
      const result = await removeMovieFromBacklog(movieId, interaction.user.id, isAdmin);

      if (!result.success) {
        await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
        return;
      }

      await interaction.reply({
        content: `🗑 Removed **${result.movie?.title}** from the watchlist.`,
      });
      return;
    }

    if (subcommand === 'wheel-export') {
      const backlog = await getBacklogMovies();
      if (backlog.length === 0) {
        await interaction.reply({
          content: 'The watchlist is currently empty. Use `/suggest` to add movies first!',
          ephemeral: true,
        });
        return;
      }

      const exportData = formatWheelExport(backlog);

      const embed = new EmbedBuilder()
        .setTitle('🎡 Spinner Wheel Export')
        .setColor(0xEC4899)
        .setDescription(
          `Exported **${exportData.titles.length}** movie titles from the backlog!\n\n` +
          `🎡 **[Open Pre-Populated Wheel of Names](${exportData.wheelOfNamesUrl})**\n\n` +
          `**Raw List (Click to copy):**\n\`\`\`\n${exportData.plainText.slice(0, 1500)}\n\`\`\``
        )
        .setFooter({ text: 'Use /movie set after spinning the wheel to lock in the winner!' });

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};
