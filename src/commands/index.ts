import { REST, Routes } from 'discord.js';
import { watchlistCommand } from './watchlist.js';
import { scheduleCommand } from './schedule.js';
import { movieCommand } from './movie.js';
import { config } from '../config.js';

import { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';

export interface BotCommand {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export const commands: BotCommand[] = [
  movieCommand,
  scheduleCommand,
  watchlistCommand,
];


export async function registerCommands(): Promise<void> {
  if (!config.discordToken || !config.clientId) {
    console.warn('[Commands] Missing DISCORD_TOKEN or DISCORD_CLIENT_ID. Skipping slash command registration.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const commandData = commands.map(c => c.data.toJSON());

  try {
    console.log(`[Commands] Started refreshing ${commandData.length} application (/) commands.`);

    if (config.guildId) {
      // Register for specific guild (instant update)
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commandData }
      );
      console.log(`[Commands] Successfully registered ${commandData.length} commands to guild ${config.guildId}.`);
    } else {
      // Register globally
      await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commandData }
      );
      console.log(`[Commands] Successfully registered ${commandData.length} commands globally.`);
    }
  } catch (error) {
    console.error('[Commands] Failed to register application commands:', error);
  }
}
