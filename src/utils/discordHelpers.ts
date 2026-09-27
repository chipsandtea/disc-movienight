import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Movie } from '../db/schema.js';
import { WatchedMovieSummary, UserStatsResult } from '../services/movie.service.js';

/**
 * Converts minutes into a friendly string like "2h 16m".
 */
export function formatRuntime(minutes: number | null): string {
  if (!minutes || minutes <= 0) return 'Unknown runtime';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Creates a rich embed for a movie in the backlog or planned list.
 */
export function buildMovieEmbed(movie: Movie, titlePrefix: string = '🎬 Movie'): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${titlePrefix}: ${movie.title}${movie.releaseYear ? ` (${movie.releaseYear})` : ''}`)
    .setColor(movie.status === 'planned' ? 0xF59E0B : 0x3B82F6)
    .setDescription(movie.overview || 'No synopsis available.')
    .addFields(
      { name: '⏱ Runtime', value: formatRuntime(movie.runtimeMinutes), inline: true },
      { name: '👤 Suggested By', value: `<@${movie.suggestedByUserId}>`, inline: true },
      { name: '📌 Status', value: `\`${movie.status.toUpperCase()}\``, inline: true }
    );

  if (movie.imdbId) {
    embed.addFields({
      name: '🔗 Links',
      value: `[IMDb](https://www.imdb.com/title/${movie.imdbId}/) • [TMDB](https://www.themoviedb.org/movie/${movie.tmdbId})`,
      inline: false,
    });
  }

  if (movie.posterPath) {
    embed.setThumbnail(movie.posterPath);
  }

  return embed;
}

/**
 * Builds the interactive weekly availability dashboard embed.
 */
export function buildScheduleEmbed(
  candidateDays: string[],
  defaultTime: string,
  votes: { userId: string; userName: string; selectedDays: string[] }[],
  plannedMovie: Movie | null
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('📅 Weekly Movie Night Availability')
    .setColor(0x8B5CF6)
    .setDescription(
      `Cast your availability for this week! Default start time is **${defaultTime}**.\nClick the buttons below to toggle your availability on or off.`
    );

  if (plannedMovie) {
    embed.addFields({
      name: '🎬 Planned Feature',
      value: `**${plannedMovie.title}** (${plannedMovie.releaseYear || 'N/A'})\n⏱ **Runtime**: ${formatRuntime(plannedMovie.runtimeMinutes)}`,
      inline: false,
    });
    if (plannedMovie.posterPath) {
      embed.setThumbnail(plannedMovie.posterPath);
    }
  }

  // Group voters by day
  for (const day of candidateDays) {
    const availableUsers = votes.filter(v => v.selectedDays.includes(day));
    const userList = availableUsers.length > 0
      ? availableUsers.map(u => `<@${u.userId}>`).join(', ')
      : '_No votes yet_';

    embed.addFields({
      name: `${day} (${availableUsers.length} available)`,
      value: userList,
      inline: false,
    });
  }

  const cannotMakeItUsers = votes.filter(v => v.selectedDays.includes('NONE'));
  if (cannotMakeItUsers.length > 0) {
    embed.addFields({
      name: `❌ Cannot Make It (${cannotMakeItUsers.length})`,
      value: cannotMakeItUsers.map(u => `<@${u.userId}>`).join(', '),
      inline: false,
    });
  }

  embed.setFooter({ text: 'Reboot-proof: Voting persists across bot updates.' });
  embed.setTimestamp();

  return embed;
}

/**
 * Builds the Grand Reveal embed after ratings are finalized.
 */
export function buildRevealEmbed(
  movie: Movie,
  averageRating: number | null,
  submittedRatings: { userId: string; userName: string; rating: number; reviewText: string | null }[],
  unratedAttendees: { userId: string; userName: string }[]
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`🏆 MOVIE NIGHT RESULTS: ${movie.title} (${movie.releaseYear || 'N/A'})`)
    .setColor(0x10B981)
    .setDescription(movie.overview ? `*${movie.overview.slice(0, 200)}...*` : 'No synopsis.')
    .addFields(
      {
        name: '⭐ Group Average Score',
        value: averageRating !== null ? `## **${averageRating.toFixed(2)} / 10**` : 'No scores submitted',
        inline: true,
      },
      { name: '⏱ Runtime', value: formatRuntime(movie.runtimeMinutes), inline: true },
      { name: '👤 Suggested By', value: `<@${movie.suggestedByUserId}>`, inline: true }
    );

  if (movie.imdbId) {
    embed.addFields({
      name: '🔗 Reference',
      value: `[View on IMDb](https://www.imdb.com/title/${movie.imdbId}/)`,
      inline: true,
    });
  }

  // Highlights: Highs & Lows
  if (submittedRatings.length >= 2) {
    const sorted = [...submittedRatings].sort((a, b) => b.rating - a.rating);
    const highest = sorted[0];
    const lowest = sorted[sorted.length - 1];

    embed.addFields({
      name: '🎯 Score Highlights',
      value: `👑 **Critic\'s Choice**: <@${highest.userId}> gave **${highest.rating}/10**\n📉 **The Tough Crowd**: <@${lowest.userId}> gave **${lowest.rating}/10**`,
      inline: false,
    });
  }

  // Individual Reviews
  if (submittedRatings.length > 0) {
    const reviewLines = submittedRatings.map(r => {
      const reviewPart = r.reviewText ? `\n> *"${r.reviewText}"*` : '';
      return `• <@${r.userId}>: **${r.rating} / 10**${reviewPart}`;
    });

    embed.addFields({
      name: `💬 Member Ratings & Reviews (${submittedRatings.length})`,
      value: reviewLines.join('\n\n'),
      inline: false,
    });
  }

  if (unratedAttendees.length > 0) {
    embed.addFields({
      name: '💤 Attended Without Review',
      value: unratedAttendees.map(u => `<@${u.userId}>`).join(', '),
      inline: false,
    });
  }

  if (movie.posterPath) {
    embed.setThumbnail(movie.posterPath);
  }

  embed.setTimestamp();
  return embed;
}

/**
 * Builds the User Stats embed.
 */
export function buildUserStatsEmbed(userMention: string, stats: UserStatsResult): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📊 Movie Night Stats: ${userMention}`)
    .setColor(0x3B82F6)
    .addFields(
      { name: '🎟 Movies Attended', value: `${stats.attendanceCount}`, inline: true },
      { name: '📝 Ratings Given', value: `${stats.ratingsGivenCount}`, inline: true },
      {
        name: '⭐ Personal Average Rating',
        value: stats.personalAverageRating !== null ? `${stats.personalAverageRating} / 10` : 'N/A',
        inline: true,
      }
    );

  if (stats.highestRated && stats.lowestRated) {
    embed.addFields({
      name: '🎬 Personal Favorites & Lows',
      value: `❤️ **Favorite**: ${stats.highestRated.title} (${stats.highestRated.rating}/10)\n💔 **Lowest**: ${stats.lowestRated.title} (${stats.lowestRated.rating}/10)`,
      inline: false,
    });
  }

  const recs = stats.recommendations;
  const recGroupAvgStr = recs.groupAverageScore !== null ? `**${recs.groupAverageScore} / 10**` : 'N/A';

  embed.addFields({
    name: '💡 Recommendation Track Record',
    value: `• **Total Suggested**: ${recs.totalSuggested}\n• **Watched on Movie Night**: ${recs.watchedSuggestedCount}\n• **Group Reception Average**: ${recGroupAvgStr}`,
    inline: false,
  });

  if (recs.watchedMovies.length > 0) {
    const list = recs.watchedMovies.map(m => `• **${m.title}**: ${m.groupScore !== null ? `⭐ ${m.groupScore}/10` : 'Not scored'}`).join('\n');
    embed.addFields({
      name: '🎥 Watched Recommendations',
      value: list,
      inline: false,
    });
  }

  return embed;
}
