import 'dotenv/config';
import express from 'express';
import { MessageFlags } from 'discord.js';
import { logger } from './utils/logger.js';
import { UsagiMusicWorker } from './worker.js';

const tokens = [
  process.env.MUSIC_BOT_1_TOKEN,
  process.env.MUSIC_BOT_2_TOKEN,
  process.env.MUSIC_BOT_3_TOKEN,
];

if (tokens.some((token) => !String(token || '').trim())) {
  throw new Error('Set MUSIC_BOT_1_TOKEN, MUSIC_BOT_2_TOKEN and MUSIC_BOT_3_TOKEN.');
}

if (new Set(tokens).size !== 3) {
  throw new Error('The three MUSIC_BOT_*_TOKEN values must belong to three different bots.');
}

// guildId -> Map(workerIndex -> voiceChannelId)
const assignments = new Map();
const bots = new Map();

const coordinator = {
  releaseAssignment(workerIndex, guildId) {
    const guildAssignments = assignments.get(guildId);
    if (guildAssignments?.get(workerIndex)) {
      guildAssignments.delete(workerIndex);
      if (!guildAssignments.size) assignments.delete(guildId);
      logger.info(`[UsagiMusic Coordinator] Released bot ${workerIndex} from guild ${guildId}`);
    }
  },

  async handlePlayCommand(interaction) {
    const voiceChannelId = interaction.member?.voice?.channel?.id;
    if (!voiceChannelId) {
      await interaction.reply({
        content: 'Bạn cần vào một kênh voice trước.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guild.id;
    let guildAssignments = assignments.get(guildId);
    if (!guildAssignments) {
      guildAssignments = new Map();
      assignments.set(guildId, guildAssignments);
    }

    // Same voice always keeps the same Music bot
    let selectedIndex = [...guildAssignments.entries()]
      .find(([, channelId]) => channelId === voiceChannelId)?.[0];

    // Otherwise choose the first ready bot not already serving another voice in this guild
    if (!selectedIndex) {
      selectedIndex = [1, 2, 3].find(
        (idx) => bots.get(idx)?.ready && !guildAssignments.has(idx),
      );
    }

    if (!selectedIndex) {
      await interaction.editReply({
        content: 'Cả 3 Usagi Music đều đang được sử dụng ở các phòng voice khác.',
      }).catch(() => {});
      return;
    }

    const selectedBot = bots.get(selectedIndex);
    if (!selectedBot?.ready) {
      await interaction.editReply({
        content: `Usagi Music ${selectedIndex} chưa sẵn sàng. Hãy thử lại.`,
      }).catch(() => {});
      return;
    }

    guildAssignments.set(selectedIndex, voiceChannelId);

    try {
      const result = await selectedBot.executeRoutedPlay({
        guildId,
        voiceChannelId,
        textChannelId: interaction.channel.id,
        userId: interaction.user.id,
        query: interaction.options.getString('query'),
      });

      await interaction.editReply({ embeds: [result.embed] }).catch(() => {});
    } catch (error) {
      if (guildAssignments.get(selectedIndex) === voiceChannelId) {
        const player = selectedBot.riffy?.players?.get(guildId);
        if (!player || !player.playing) {
          guildAssignments.delete(selectedIndex);
          if (!guildAssignments.size) assignments.delete(guildId);
        }
      }

      const message = error?.userMessage || error?.message || 'Không thể phát bài hát.';
      await interaction.editReply({ content: message }).catch(() => {});
    }
  },
};

// Start all 3 bots concurrently in this single Node.js process
for (let i = 0; i < tokens.length; i++) {
  const index = i + 1;
  const bot = new UsagiMusicWorker(index, tokens[i], coordinator);
  bots.set(index, bot);
  bot.start().catch((err) => {
    logger.error(`[Usagi Music ${index}] failed to start:`, err);
  });
}

const app = express();
const port = Number(process.env.PORT || 3000);

app.get('/', (_req, res) => {
  res.json({
    status: 'online',
    mode: 'single-process',
    bots: [...bots.entries()].map(([index, bot]) => ({
      index,
      ready: bot.ready,
      tag: bot.tag,
    })),
  });
});

app.get('/health', (_req, res) => {
  const readyBots = [...bots.values()].filter((bot) => bot.ready).length;
  res.status(readyBots === 3 ? 200 : 503).json({
    status: readyBots === 3 ? 'healthy' : 'starting',
    readyBots,
    totalBots: 3,
  });
});

const server = app.listen(port, '0.0.0.0', () => {
  logger.info(`UsagiMusic single-process controller listening on :${port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`UsagiMusic controller shutting down (${signal})`);

  for (const bot of bots.values()) {
    try {
      bot.destroy();
    } catch {}
  }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
