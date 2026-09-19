import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, MessageFlags, REST, Routes } from 'discord.js';
import { initializeMusic, initRiffyAfterReady } from './services/music/riffySetup.js';
import playCommand from './commands/Music/play.js';
import musicButtons from './interactions/buttons/music/music.js';
import { playQuery } from './services/music/musicActions.js';
import { handleInteractionError } from './utils/errorHandler.js';
import { logger } from './utils/logger.js';

const index = Number(process.env.USAGI_MUSIC_WORKER || 0);
const token = process.env.USAGI_MUSIC_TOKEN;
if (!index || !token) throw new Error('Worker requires USAGI_MUSIC_WORKER and USAGI_MUSIC_TOKEN.');

const pendingInteractions = new Map();

class UsagiMusicWorker extends Client {
  constructor() {
    super({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    this.workerIndex = index;
    this.commands = new Collection([[playCommand.data.name, playCommand]]);
    this.config = { features: { music: true } };
    initializeMusic(this);
  }

  async start() {
    await this.login(token);
    initRiffyAfterReady(this);

    // Only Music 1 exposes the shared slash command. Workers 2/3 stay invisible
    // at command level and are selected by the controller.
    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(
      Routes.applicationCommands(this.user.id),
      { body: index === 1 ? [playCommand.data.toJSON()] : [] },
    );

    this.riffy.on('playerDisconnect', (player) => {
      process.send?.({ type: 'release', index, guildId: player.guildId });
    });

    logger.info(`[Usagi Music ${index}] online as ${this.user.tag}`);
    process.send?.({ type: 'ready', index, tag: this.user.tag });
  }
}

const client = new UsagiMusicWorker();

async function handleSharedPlay(interaction) {
  if (index !== 1) return;

  const voiceChannelId = interaction.member?.voice?.channel?.id;
  if (!voiceChannelId) {
    await interaction.reply({ content: 'Bạn cần vào một kênh voice trước.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const requestId = interaction.id;
  pendingInteractions.set(requestId, interaction);

  process.send?.({
    type: 'routePlay',
    requestId,
    guildId: interaction.guild.id,
    voiceChannelId,
    textChannelId: interaction.channel.id,
    userId: interaction.user.id,
    query: interaction.options.getString('query'),
  });

  setTimeout(() => {
    const pending = pendingInteractions.get(requestId);
    if (!pending) return;
    pendingInteractions.delete(requestId);
    pending.editReply({ content: 'Usagi Music phản hồi quá lâu. Hãy thử lại.' }).catch(() => {});
  }, 25_000).unref();
}

async function executeRoutedPlay(message) {
  const { requestId, guildId, voiceChannelId, textChannelId, userId, query } = message;
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Bot nhạc được chọn không có trong server này.');

    const voiceChannel = guild.channels.cache.get(voiceChannelId);
    const textChannel = guild.channels.cache.get(textChannelId);
    const member = guild.members.cache.get(userId);
    const user = member?.user || client.users.cache.get(userId);

    if (!voiceChannel || !textChannel || !member || !user) {
      throw new Error('Không lấy được thông tin voice/người dùng. Hãy thử lại.');
    }

    // Adapter shaped like the fields Music core actually uses.
    const routedInteraction = {
      guild,
      channel: textChannel,
      member: { ...member, voice: { channel: voiceChannel } },
      user,
    };

    const result = await playQuery(client, routedInteraction, query);
    process.send?.({
      type: 'playResult',
      requestId,
      index,
      ok: true,
      guildId,
      voiceChannelId,
      embed: result.embed.toJSON(),
    });
  } catch (error) {
    process.send?.({
      type: 'playResult',
      requestId,
      index,
      ok: false,
      guildId,
      voiceChannelId,
      error: error?.userMessage || error?.message || 'Không thể phát bài hát.',
    });
  }
}

process.on('message', async (message) => {
  if (message?.type === 'playOnWorker') {
    await executeRoutedPlay(message);
    return;
  }

  if (message?.type === 'routeResult' && index === 1) {
    const interaction = pendingInteractions.get(message.requestId);
    if (!interaction) return;
    pendingInteractions.delete(message.requestId);

    if (message.ok) {
      await interaction.editReply({ embeds: [message.embed] }).catch(() => {});
    } else {
      await interaction.editReply({ content: message.error || 'Không thể phát bài hát.' }).catch(() => {});
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'play') {
      await handleSharedPlay(interaction);
      return;
    }

    // Dashboard belongs to the worker that is actually playing, so its buttons
    // are handled locally by that worker.
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
