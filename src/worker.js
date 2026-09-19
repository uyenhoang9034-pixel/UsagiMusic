import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, REST, Routes } from 'discord.js';
import { initializeMusic, initRiffyAfterReady } from './services/music/riffySetup.js';
import playCommand from './commands/Music/play.js';
import musicCommand from './commands/Music/music.js';
import queueCommand from './commands/Music/queue.js';
import nowplayingCommand from './commands/Music/nowplaying.js';
import joinCommand from './commands/Music/join.js';
import musicButtons from './interactions/buttons/music/music.js';
import { handleInteractionError } from './utils/errorHandler.js';
import { logger } from './utils/logger.js';

const index = Number(process.env.USAGI_MUSIC_WORKER || 0);
const token = process.env.USAGI_MUSIC_TOKEN;
const COMMANDS = [playCommand, musicCommand, queueCommand, nowplayingCommand, joinCommand];

if (!index || !token) {
  throw new Error('Worker requires USAGI_MUSIC_WORKER and USAGI_MUSIC_TOKEN.');
}

class UsagiMusicWorker extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });

    this.workerIndex = index;
    this.commands = new Collection(COMMANDS.map((cmd) => [cmd.data.name, cmd]));
    this.config = { features: { music: true } };
    initializeMusic(this);
  }

  async start() {
    await this.login(token);
    initRiffyAfterReady(this);

    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(
      Routes.applicationCommands(this.user.id),
      { body: COMMANDS.map((cmd) => cmd.data.toJSON()) },
    );

    logger.info(`[Usagi Music ${index}] online as ${this.user.tag}`);
    if (process.send) process.send({ type: 'ready', index, tag: this.user.tag });
  }
}

const client = new UsagiMusicWorker();

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction, client.config, client);
      return;
    }

    if (interaction.isButton()) {
      const handler = musicButtons.find((entry) => entry.name === interaction.customId);
      if (handler) await handler.execute(interaction, client);
    }
  } catch (error) {
    logger.error(`[Usagi Music ${index}] interaction error:`, error);
    await handleInteractionError(interaction, error);
  }
});

await client.start();

async function shutdown(signal) {
  logger.info(`[Usagi Music ${index}] shutting down (${signal})`);
  try { client.destroy(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
