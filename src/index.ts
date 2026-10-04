import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  Interaction,
  TextChannel,
} from 'discord.js';
import { config, validateConfig } from './config.js';
import { initDatabase } from './db/migrate.js';
import { commands, registerCommands, BotCommand } from './commands/index.js';
import { handleScheduleButtonClick } from './components/scheduleButtons.js';
import { handleRateButtonClick, handleRateModalSubmit } from './components/ratingModal.js';
import { handleAttendanceButtonClick, handleAttendeeSelect } from './components/attendanceModal.js';
import { resolveMovieChannel } from './utils/discordHelpers.js';

validateConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const commandMap = new Map<string, BotCommand>();
for (const cmd of commands) {
  commandMap.set(cmd.data.name, cmd);
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`[Bot] Logged in successfully as ${readyClient.user.tag}!`);
  console.log(`[Bot] Active in ${readyClient.guilds.cache.size} server(s).`);

  // Initialize DB tables
  await initDatabase();

  // Register slash commands with Discord
  await registerCommands();

  console.log('[Bot] Movie Night Bot is fully ready and listening for events.');
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    // 1. Slash Commands
    if (interaction.isChatInputCommand()) {
      const command = commandMap.get(interaction.commandName);
      if (!command) {
        console.warn(`[Interaction] Unknown slash command: ${interaction.commandName}`);
        return;
      }
      await command.execute(interaction);
      return;
    }

    // 2. Autocomplete
    if (interaction.isAutocomplete()) {
      const command = commandMap.get(interaction.commandName);
      await command?.autocomplete?.(interaction);
      return;
    }

    // 3. Button Interactions
    if (interaction.isButton()) {
      const { customId } = interaction;

      if (customId.startsWith('sched:toggle:')) {
        await handleScheduleButtonClick(interaction);
        return;
      }

      if (customId.startsWith('rate:open:')) {
        await handleRateButtonClick(interaction);
        return;
      }

      if (customId.startsWith('attend:')) {
        const targetChannel = resolveMovieChannel(interaction.guild, config.channelName);
        await handleAttendanceButtonClick(interaction, targetChannel);
        return;
      }
    }

    // 4. User Select Menus
    if (interaction.isUserSelectMenu()) {
      const { customId } = interaction;
      if (customId.startsWith('attend:select:')) {
        await handleAttendeeSelect(interaction);
        return;
      }
    }

    // 5. Modal Submissions
    if (interaction.isModalSubmit()) {
      const { customId } = interaction;
      if (customId.startsWith('rate:submit:')) {
        await handleRateModalSubmit(interaction);
        return;
      }
    }
  } catch (err: unknown) {
    console.error('[Interaction] Error while processing interaction:', err);

    if (interaction.isRepliable()) {
      if (interaction.deferred) {
        await interaction.editReply({
          content: '⚠️ An unexpected error occurred while executing this command.',
        }).catch(() => {});
      } else if (!interaction.replied) {
        await interaction.reply({
          content: '⚠️ An unexpected error occurred while executing this command.',
          ephemeral: true,
        }).catch(() => {});
      }
    }
  }
});

// Handle graceful shutdown
const shutdown = () => {
  console.log('[Bot] Shutting down gracefully...');
  client.destroy();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (config.discordToken) {
  client.login(config.discordToken).catch(err => {
    console.error('[Bot] Failed to log in with DISCORD_TOKEN:', err);
  });
} else {
  console.log('[Bot] DISCORD_TOKEN is not configured yet in .env.');
  console.log('[Bot] Please set up your .env file with your Discord bot credentials to connect to Discord.');
}
