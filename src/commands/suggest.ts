import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  TextChannel,
} from 'discord.js';
import { searchMovies, getMovieDetails, findByImdbId, extractImdbId } from '../services/tmdb.service.js';
import { addMovieToBacklog } from '../services/movie.service.js';
import { buildMovieEmbed } from '../utils/discordHelpers.js';
import { config } from '../config.js';

export const suggestCommand = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Suggest a movie to the movie night watchlist')
    .addStringOption(option =>
      option
        .setName('movie')
        .setDescription('Movie title to search on TMDB, or paste an IMDb URL / IMDb ID (tt...)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addBooleanOption(option =>
      option
        .setName('rewatch')
        .setDescription('Allow adding even if already watched previously')
        .setRequired(false)
    ),

  async autocomplete(interaction: AutocompleteInteraction) {
    const focusedValue = interaction.options.getFocused();
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
        value: String(m.id),
      };
    });

    await interaction.respond(choices);
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const input = interaction.options.getString('movie', true);
    const allowRewatch = interaction.options.getBoolean('rewatch') || false;

    await interaction.deferReply();

    let details = null;
    const imdbId = extractImdbId(input);

    if (imdbId) {
      details = await findByImdbId(imdbId);
    } else if (/^\d+$/.test(input.trim())) {
      details = await getMovieDetails(input.trim());
    } else {
      // If user typed free text without selecting autocomplete
      const searchResults = await searchMovies(input);
      if (searchResults.length > 0) {
        details = await getMovieDetails(searchResults[0].id);
      }
    }

    if (!details) {
      await interaction.editReply({
        content: `❌ Could not find a movie matching "${input}". Please check the spelling or provide an IMDb link.`,
      });
      return;
    }

    const userName = interaction.member && 'displayName' in interaction.member
      ? (interaction.member.displayName as string)
      : interaction.user.username;

    const result = await addMovieToBacklog(details, interaction.user.id, userName, allowRewatch);

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
    await interaction.editReply({
      content: `🎉 **${result.movie.title}** was added to the movie night backlog!`,
      embeds: [embed],
    });
  },
};
