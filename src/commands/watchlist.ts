import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { getBacklogMovies, removeMovieFromBacklog } from '../services/movie.service.js';
import { formatWheelExport } from '../utils/wheelHelper.js';
import { isUserAdmin } from '../utils/auth.js';

export const watchlistCommand = {
  data: new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage the movie watchlist and spinner wheel')
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
        .setDescription('Export backlog movies formatted for Picker Wheel or manual copy-pasting')
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

    if (subcommand === 'remove') {
      const movieIdStr = interaction.options.getString('movie', true);
      const movieId = parseInt(movieIdStr, 10);

      const isAdmin = isUserAdmin(interaction);
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
          content: 'The watchlist is currently empty. Use `/movie suggest` to add movies first!',
          ephemeral: true,
        });
        return;
      }

      const exportData = formatWheelExport(backlog);

      const embed = new EmbedBuilder()
        .setTitle('🎡 Picker Wheel Export')
        .setColor(0xEC4899)
        .setDescription(
          `Exported **${exportData.titles.length}** movie titles from the backlog!\n\n` +
          `🎡 **[Open Picker Wheel](${exportData.pickerWheelUrl})**\n\n` +
          `**Raw List (Click to copy & paste into Picker Wheel inputs):**\n\`\`\`\n${exportData.plainText.slice(0, 1500)}\n\`\`\``
        )
        .setFooter({ text: 'Use /movie set after spinning the wheel to lock in the winner!' });

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};
