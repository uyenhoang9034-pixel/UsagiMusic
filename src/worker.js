import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, Options, REST, Routes } from 'discord.js';
import { initializeMusic, initRiffyAfterReady } from './services/music/riffySetup.js';
import playCommand from './commands/Music/play.js';
import musicButtons from './interactions/buttons/music/music.js';
import { playQuery } from './services/music/musicActions.js';
import { handleInteractionError } from './utils/errorHandler.js';
import { logger } from './utils/logger.js';

export class UsagiMusicWorker extends Client {
  constructor(index, token, coordinator = null) {
    super({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
      makeCache: Options.cacheWithLimits({
        MessageManager: 0,
        PresenceManager: 0,
        ReactionManager: 0,
        StageInstanceManager: 0,
        ThreadManager: 0,
        ThreadMemberManager: 0,
        AutoModerationRuleManager: 0,
        GuildScheduledEventManager: 0,
        GuildBanManager: 0,
        GuildInviteManager: 0,
        GuildEmojiManager: 0,
        GuildStickerManager: 0,
        VoiceStateManager: 100,
        GuildMemberManager: 100,
        UserManager: 100,
      }),
      sweepers: {
        ...Options.DefaultSweeperSettings,
        messages: {
          interval: 3600,
          lifetime: 1800,
        },
        users: {
          interval: 3600,
          filter: () => (user) => user.id !== this.user?.id,
        },
        guildMembers: {
          interval: 1800,
          filter: () => (member) => member.id !== this.user?.id,
        },
      },
    });

    this.workerIndex = Number(index);
    this.token = token;
    this.coordinator = coordinator;
    this.commands = new Collection([[playCommand.data.name, playCommand]]);
    this.config = { features: { music: true } };
    this.ready = false;
    this.tag = null;

    initializeMusic(this);
    this.setupListeners();
  }

  setupListeners() {
    this.on('interactionCreate', async (interaction) => {
      try {
        if (interaction.isChatInputCommand() && interaction.commandName === 'play') {
          if (this.workerIndex === 1 && this.coordinator) {
            await this.coordinator.handlePlayCommand(interaction);
          }
          return;
        }

        // Dashboard belongs to the worker that is actually playing, so its buttons
        // are handled locally by that worker.
        if (interaction.isButton()) {
          const handler = musicButtons.find((entry) => entry.name === interaction.customId);
          if (!handler) return;

          if (interaction.guild && interaction.user?.id) {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (member) {
              Object.defineProperty(interaction, 'member', {
                value: member,
                configurable: true,
              });
            }
          }

          await handler.execute(interaction, this);
        }
      } catch (error) {
        logger.error(`[Usagi Music ${this.workerIndex}] interaction error:`, error);
        await handleInteractionError(interaction, error);
      }
    });
  }

  async start() {
    await this.login(this.token);
    initRiffyAfterReady(this);

    // Only Music 1 exposes the shared slash command. Workers 2/3 stay invisible
    // at command level and are selected by the controller.
    const rest = new REST({ version: '10' }).setToken(this.token);
    await rest.put(
      Routes.applicationCommands(this.user.id),
      { body: this.workerIndex === 1 ? [playCommand.data.toJSON()] : [] },
    );

    this.riffy.on('playerDisconnect', (player) => {
      this.coordinator?.releaseAssignment(this.workerIndex, player.guildId);
    });

    this.ready = true;
    this.tag = this.user.tag;
    logger.info(`[Usagi Music ${this.workerIndex}] online as ${this.user.tag}`);
  }

  async executeRoutedPlay({ guildId, voiceChannelId, textChannelId, userId, query }) {
    const guild = this.guilds.cache.get(guildId) || await this.guilds.fetch(guildId).catch(() => null);
    if (!guild) throw new Error('Bot nhạc được chọn không có trong server này.');

    const voiceChannel =
      guild.channels.cache.get(voiceChannelId) ||
      await guild.channels.fetch(voiceChannelId).catch(() => null);
    const textChannel =
      guild.channels.cache.get(textChannelId) ||
      await guild.channels.fetch(textChannelId).catch(() => null);
    const member =
      guild.members.cache.get(userId) ||
      await guild.members.fetch(userId).catch(() => null);
    const user =
      member?.user ||
      this.users.cache.get(userId) ||
      await this.users.fetch(userId).catch(() => null);

    if (!voiceChannel || !textChannel || !member || !user) {
      throw new Error('Không lấy được thông tin voice/người dùng. Hãy thử lại.');
    }

    // Keep the real GuildMember. Spreading it into a plain object drops
    // Discord.js getters used by voice/permission checks.
    const routedInteraction = {
      guild,
      channel: textChannel,
      member,
      user,
      client: this,
    };

    const result = await playQuery(this, routedInteraction, query);
    return { ok: true, embed: result.embed.toJSON() };
  }
}

export default UsagiMusicWorker;
