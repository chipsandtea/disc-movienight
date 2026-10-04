import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Guild, TextChannel, Client } from 'discord.js';
import { Movie } from '../db/schema.js';
import { WatchedMovieSummary, UserStatsResult } from '../services/movie.service.js';
import { RatingStatusResult } from '../services/rating.service.js';

/**
 * Safely removes components (buttons, select menus) from a Discord message,
 * optionally updating its text content.
 */
export async function disableMessageComponents(
  client: Client,
  channelId?: string | null,
  messageId?: string | null,
  noticeContent?: string
): Promise<void> {
  if (!channelId || !messageId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      const msg = await (channel as TextChannel).messages.fetch(messageId);
      if (msg) {
        const payload: { components: never[]; content?: string } = { components: [] };
        if (noticeContent) payload.content = noticeContent;
        await msg.edit(payload);
      }
    }
  } catch {
    // Silently ignore if message was deleted or inaccessible
  }
}

/**
 * Extracts a user's server nickname / display name from an interaction,
 * gracefully falling back to username.
 */
export function getInteractionDisplayName(
  interaction: { member?: unknown; user: { username: string } },
  fallbackUser?: { username: string; displayName?: string }
): string {
  if (fallbackUser) {
    return fallbackUser.displayName || fallbackUser.username;
  }
  if (interaction.member && typeof interaction.member === 'object' && 'displayName' in interaction.member) {
    const name = (interaction.member as { displayName?: unknown }).displayName;
    if (typeof name === 'string' && name) return name;
  }
  return interaction.user.username;
}

/**
 * Resolves the configured movie channel by snowflake ID, name, or #name (case-insensitive).
 */
export function resolveMovieChannel(guild?: Guild | null, configured?: string): TextChannel | undefined {
  if (!guild || !configured) return undefined;
  const clean = configured.replace(/^#/, '').trim().toLowerCase();
  return guild.channels.cache.find(
    c => (c.id === configured || c.name.toLowerCase() === clean) && c.isTextBased()
  ) as TextChannel | undefined;
}

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

  const links: string[] = [];
  if (movie.imdbId) links.push(`[IMDb](https://www.imdb.com/title/${movie.imdbId}/)`);
  if (movie.tmdbId) links.push(`[TMDB](https://www.themoviedb.org/movie/${movie.tmdbId})`);

  if (links.length > 0) {
    embed.addFields({
      name: '🔗 Links',
      value: links.join(' • '),
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
    let userList = availableUsers.length > 0
      ? availableUsers.map(u => `<@${u.userId}>`).join(', ')
      : '_No votes yet_';

    if (userList.length > 1000) {
      userList = userList.slice(0, 995) + '...';
    }

    embed.addFields({
      name: `${day} (${availableUsers.length} available)`,
      value: userList,
      inline: false,
    });
  }

  const cannotMakeItUsers = votes.filter(v => v.selectedDays.includes('NONE'));
  if (cannotMakeItUsers.length > 0) {
    let cantMakeItList = cannotMakeItUsers.map(u => `<@${u.userId}>`).join(', ');
    if (cantMakeItList.length > 1000) {
      cantMakeItList = cantMakeItList.slice(0, 995) + '...';
    }
    embed.addFields({
      name: `❌ Cannot Make It (${cannotMakeItUsers.length})`,
      value: cantMakeItList,
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
  const synopsis = movie.overview
    ? movie.overview.length > 200
      ? `*${movie.overview.slice(0, 197)}...*`
      : `*${movie.overview}*`
    : 'No synopsis.';

  const embed = new EmbedBuilder()
    .setTitle(`🏆 MOVIE NIGHT RESULTS: ${movie.title} (${movie.releaseYear || 'N/A'})`)
    .setColor(0x10B981)
    .setDescription(synopsis)
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

    if (highest.rating === lowest.rating) {
      embed.addFields({
        name: '🎯 Score Highlights',
        value: `🤝 **Unanimous Consensus**: Everyone rated this movie **${highest.rating}/10**!`,
        inline: false,
      });
    } else {
      embed.addFields({
        name: '🎯 Score Highlights',
        value: `👑 **Critic's Choice**: <@${highest.userId}> gave **${highest.rating}/10**\n📉 **The Tough Crowd**: <@${lowest.userId}> gave **${lowest.rating}/10**`,
        inline: false,
      });
    }
  }

  // Individual Reviews (Chunked to respect Discord 1024-char field limit)
  if (submittedRatings.length > 0) {
    const reviewBlocks: string[] = [];
    let currentBlock = '';

    for (const r of submittedRatings) {
      const truncatedReview = r.reviewText && r.reviewText.length > 500
        ? `${r.reviewText.slice(0, 497)}...`
        : r.reviewText;
      const reviewPart = truncatedReview ? `\n> *"${truncatedReview}"*` : '';
      const line = `• <@${r.userId}>: **${r.rating} / 10**${reviewPart}`;

      if (currentBlock.length + line.length + 2 > 950) {
        reviewBlocks.push(currentBlock);
        currentBlock = line;
      } else {
        currentBlock = currentBlock ? `${currentBlock}\n\n${line}` : line;
      }
    }
    if (currentBlock) reviewBlocks.push(currentBlock);

    reviewBlocks.forEach((block, index) => {
      const title = reviewBlocks.length > 1
        ? `💬 Member Ratings & Reviews (${index + 1}/${reviewBlocks.length})`
        : `💬 Member Ratings & Reviews (${submittedRatings.length})`;
      embed.addFields({ name: title, value: block, inline: false });
    });
  }

  if (unratedAttendees.length > 0) {
    const unratedList = unratedAttendees.map(u => `<@${u.userId}>`).join(', ');
    embed.addFields({
      name: '💤 Attended Without Review',
      value: unratedList.length > 1000 ? `${unratedList.slice(0, 997)}...` : unratedList,
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
  } else if (stats.highestRated) {
    embed.addFields({
      name: '🎬 Personal Favorite',
      value: `❤️ **Favorite**: ${stats.highestRated.title} (${stats.highestRated.rating}/10)`,
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
    let list = recs.watchedMovies.map(m => `• **${m.title}**: ${m.groupScore !== null ? `⭐ ${m.groupScore}/10` : 'Not scored'}`).join('\n');
    if (list.length > 1000) {
      list = list.slice(0, 995) + '...';
    }
    embed.addFields({
      name: '🎥 Watched Recommendations',
      value: list,
      inline: false,
    });
  }

  return embed;
}

/**
 * Builds the real-time live rating progress embed shown in #shows-n-movies.
 */
export function buildRatingProgressEmbed(progress: RatingStatusResult): EmbedBuilder {
  const percent = progress.totalAttendees > 0
    ? Math.round((progress.submittedCount / progress.totalAttendees) * 100)
    : 0;

  const submittedList = progress.submittedUsers.length > 0
    ? progress.submittedUsers.map(u => `✅ <@${u.userId}>`).join(', ')
    : '_None yet_';

  const pendingList = progress.pendingUsers.length > 0
    ? progress.pendingUsers.map(u => `⏳ <@${u.userId}>`).join(', ')
    : '🎉 _Everyone has submitted!_';

  const isAllSubmitted = progress.submittedCount === progress.totalAttendees && progress.totalAttendees > 0;

  const embed = new EmbedBuilder()
    .setTitle(`🎬 Rating Collection: ${progress.movie.title}`)
    .setColor(isAllSubmitted ? 0x10B981 : 0x3B82F6)
    .setDescription(
      `Hope everyone enjoyed **${progress.movie.title}**!\n` +
      `Click the button below to submit your rating (0.0 to 10.0) and optional review.\n` +
      `*Ratings and reviews remain strictly confidential until the grand reveal!*`
    )
    .addFields(
      {
        name: `📊 Live Progress (${progress.submittedCount} / ${progress.totalAttendees} — ${percent}%)`,
        value: `**Submitted**:\n${submittedList}\n\n**Pending**:\n${pendingList}`,
        inline: false,
      }
    )
    .setFooter({
      text: isAllSubmitted
        ? '🎉 All attendees have submitted! Run /movie finalize-ratings to reveal results.'
        : '🔄 Live status: Updates automatically as reviews roll in!',
    })
    .setTimestamp();

  if (progress.movie.posterPath) {
    embed.setThumbnail(progress.movie.posterPath);
  }

  return embed;
}
