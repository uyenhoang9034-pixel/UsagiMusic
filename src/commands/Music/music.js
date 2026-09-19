import { SlashCommandBuilder } from 'discord.js';

async function loadMusicRuntime() {
  const [actions, prefixSupport] = await Promise.all([
    import('../../services/music/musicActions.js'),
    import('../../services/music/prefixSupport.js'),
  ]);

  return {
    ...actions,
    deferMusicCommand: prefixSupport.deferMusicCommand,
  };
}

function getSubcommand(interaction) {
  return interaction.options?.getSubcommand?.(false) || null;
}

async function safeReplyUnknownSubcommand(interaction) {
  const payload = {
    content: 'Không tìm thấy thao tác music tương ứng.',
  };

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
      return;
    }

    await interaction.reply(payload);
  } catch {
    // Không để lỗi trả lời phụ làm hỏng command handler.
  }
}

export default {
  category: 'Music',

  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Manage playback, queue, and voice session settings')
    .addSubcommand((sub) =>
      sub.setName('pause').setDescription('Pause playback'),
    )
    .addSubcommand((sub) =>
      sub.setName('resume').setDescription('Resume playback'),
    )
    .addSubcommand((sub) =>
      sub.setName('skip').setDescription('Skip the current track'),
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Stop playback and clear the queue'),
    )
    .addSubcommand((sub) =>
      sub.setName('shuffle').setDescription('Shuffle the queue'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('loop')
        .setDescription('Set loop mode')
        .addStringOption((opt) =>
          opt
            .setName('mode')
            .setDescription('Loop mode')
            .setRequired(true)
            .addChoices(
              { name: 'Off', value: 'none' },
              { name: 'Track', value: 'track' },
              { name: 'Queue', value: 'queue' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('volume')
        .setDescription('Set playback volume')
        .addIntegerOption((opt) =>
          opt
            .setName('level')
            .setDescription('Volume (0-100)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(100),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('seek')
        .setDescription('Seek to a position in the current track')
        .addIntegerOption((opt) =>
          opt
            .setName('seconds')
            .setDescription('Position in seconds')
            .setRequired(true)
            .setMinValue(0),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a track from the queue')
        .addIntegerOption((opt) =>
          opt
            .setName('position')
            .setDescription('Queue position')
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('move')
        .setDescription('Move a track in the queue')
        .addIntegerOption((opt) =>
          opt
            .setName('from')
            .setDescription('Current position')
            .setRequired(true)
            .setMinValue(1),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('to')
            .setDescription('New position')
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('clear').setDescription('Clear the queue'),
    )
    .addSubcommand((sub) =>
      sub.setName('leave').setDescription('Disconnect the bot from the voice channel'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('247')
        .setDescription('Toggle 24/7 mode')
        .addBooleanOption((opt) =>
          opt
            .setName('enabled')
            .setDescription('Enable or disable 24/7 mode')
            .setRequired(true),
        ),
    ),

  async execute(interaction, config, client) {
    const music = await loadMusicRuntime();
    const deferred = await music.deferMusicCommand(interaction);

    if (!deferred) {
      return;
    }

    const subcommand = getSubcommand(interaction);
    let embed = null;

    switch (subcommand) {
      case 'pause':
        embed = await music.pausePlayback(client, interaction);
        break;

      case 'resume':
        embed = await music.resumePlayback(client, interaction);
        break;

      case 'skip':
        embed = await music.skipTrack(client, interaction);
        break;

      case 'stop':
        embed = await music.stopPlayback(client, interaction);
        break;

      case 'shuffle':
        embed = await music.shuffleQueue(client, interaction);
        break;

      case 'loop':
        embed = await music.setLoopMode(
          client,
          interaction,
          interaction.options.getString('mode'),
        );
        break;

      case 'volume':
        embed = await music.setVolume(
          client,
          interaction,
          interaction.options.getInteger('level'),
        );
        break;

      case 'seek':
        embed = await music.seekTrack(
          client,
          interaction,
          interaction.options.getInteger('seconds'),
        );
        break;

      case 'remove':
        embed = await music.removeFromQueue(
          client,
          interaction,
          interaction.options.getInteger('position'),
        );
        break;

      case 'move':
        embed = await music.moveInQueue(
          client,
          interaction,
          interaction.options.getInteger('from'),
          interaction.options.getInteger('to'),
        );
        break;

      case 'clear':
        embed = await music.clearQueue(client, interaction);
        break;

      case 'leave':
        embed = await music.leaveVoiceChannel(client, interaction);
        break;

      case '247':
        embed = await music.setTwentyFourSeven(
          client,
          interaction,
          interaction.options.getBoolean('enabled'),
        );
        break;

      default:
        await safeReplyUnknownSubcommand(interaction);
        return;
    }

    await music.replyMusicSuccess(interaction, embed);
  },
};
