import 'dotenv/config';
import express from 'express';
import { Client, Collection, GatewayIntentBits, MessageFlags, REST, Routes } from 'discord.js';
import { initializeMusic, initRiffyAfterReady } from './services/music/riffySetup.js';
import playCommand from './commands/Music/play.js';
import musicCommand from './commands/Music/music.js';
import queueCommand from './commands/Music/queue.js';
import nowplayingCommand from './commands/Music/nowplaying.js';
import joinCommand from './commands/Music/join.js';
import musicButtons from './interactions/buttons/music/music.js';
import { handleInteractionError } from './utils/errorHandler.js';
import { logger } from './utils/logger.js';

const COMMANDS = [playCommand, musicCommand, queueCommand, nowplayingCommand, joinCommand];
const TOKENS = [
  process.env.MUSIC_BOT_1_TOKEN,
  process.env.MUSIC_BOT_2_TOKEN,
  process.env.MUSIC_BOT_3_TOKEN,
].filter(Boolean);

if (TOKENS.length !== 3) {
  throw new Error('Set MUSIC_BOT_1_TOKEN, MUSIC_BOT_2_TOKEN and MUSIC_BOT_3_TOKEN.');
}

const clients = [];
const botById = new Map();

class UsagiMusicBot extends Client {
  constructor(index, token) {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });
    this.workerIndex = index;
    this.tokenValue = token;
    this.commands = new Collection(COMMANDS.map((cmd) => [cmd.data.name, cmd]));
    this.config = { features: { music: true } };
    initializeMusic(this);
  }

  async start() {
    await this.login(this.tokenValue);
    initRiffyAfterReady(this);
    botById.set(this.user.id, this);

    const rest = new REST({ version: '10' }).setToken(this.tokenValue);
    await rest.put(
      Routes.applicationCommands(this.user.id),
      { body: COMMANDS.map((cmd) => cmd.data.toJSON()) },
    );

    logger.info(`[Usagi Music ${this.workerIndex}] online as ${this.user.tag}`);
  }
}

for (let i = 0; i < TOKENS.length; i += 1) {
  const client = new UsagiMusicBot(i + 1, TOKENS[i]);
  clients.push(client);

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
      logger.error(`[Usagi Music ${client.workerIndex}] interaction error:`, error);
      await handleInteractionError(interaction, error);
    }
  });
}

const app = express();
const port = Number(process.env.PORT || 3000);
app.get('/', (_req, res) => res.json({ status: 'online', bots: clients.map((c) => ({ index: c.workerIndex, ready: c.isReady(), tag: c.user?.tag || null })) }));
app.get('/health', (_req, res) => res.json({ status: 'healthy', readyBots: clients.filter((c) => c.isReady()).length, totalBots: clients.length }));
app.listen(port, '0.0.0.0', () => logger.info(`UsagiMusic health server listening on :${port}`));

for (const client of clients) {
  await client.start();
}
