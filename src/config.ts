import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  clientId: process.env.DISCORD_CLIENT_ID || '',
  guildId: process.env.DISCORD_GUILD_ID || '',
  tmdbApiKey: process.env.TMDB_API_KEY || '',
  channelName: process.env.MOVIE_CHANNEL_NAME || 'shows-n-movies',
  databaseUrl: process.env.DATABASE_URL || 'file:movienight.db',
  adminRoleId: process.env.ADMIN_ROLE_ID || '',
};

export function validateConfig() {
  const missing: string[] = [];
  if (!config.discordToken) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('DISCORD_CLIENT_ID');
  
  if (missing.length > 0) {
    console.warn(`[Config] Warning: Missing environment variables: ${missing.join(', ')}`);
  }
}
