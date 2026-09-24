import 'dotenv/config';
import express from 'express';
import { MessageFlags } from 'discord.js';
import { logger } from './utils/logger.js';
import { UsagiMusicWorker } from './worker.js';

const isBot3Disabled =
  process.env.DISABLE_BOT_3 === 'true' ||
  process.env.ENABLE_BOT_3 === 'false';

const tokenConfigs = [
  { index: 1, token: process.env.MUSIC_BOT_1_TOKEN, required: true },
  { index: 2, token: process.env.MUSIC_BOT_2_TOKEN, required: false },
  { index: 3, token: isBot3Disabled ? null : process.env.MUSIC_BOT_3_TOKEN, required: false },
];

const activeTokens = tokenConfigs.filter((cfg) => {
  const val = String(cfg.token || '').trim();
  if (!val && cfg.required) {
    throw new Error('MUSIC_BOT_1_TOKEN is required as the primary music controller.');
  }
  return Boolean(val);
});

if (activeTokens.length === 0) {
  throw new Error('No music bot tokens configured. Set at least MUSIC_BOT_1_TOKEN.');
}

const tokenValues = activeTokens.map((t) => t.token);
if (new Set(tokenValues).size !== tokenValues.length) {
  throw new Error('The configured MUSIC_BOT_*_TOKEN values must belong to different bots.');
}

if (isBot3Disabled) {
  logger.info('[UsagiMusic Coordinator] Bot 3 is explicitly disabled (DISABLE_BOT_3=true). Running with Bot 1 & 2.');
} else {
  logger.info(`[UsagiMusic Coordinator] Active workers configured: ${activeTokens.map((t) => `Bot ${t.index}`).join(', ')}`);
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
      selectedIndex = [...bots.keys()].find(
        (idx) => bots.get(idx)?.ready && !guildAssignments.has(idx),
      );
    }

    if (!selectedIndex) {
      await interaction.editReply({
        content: `Cả ${bots.size} Usagi Music đều đang được sử dụng ở các phòng voice khác.`,
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

// Start all configured bots concurrently in this single Node.js process
for (const { index, token } of activeTokens) {
  const bot = new UsagiMusicWorker(index, token, coordinator);
  bots.set(index, bot);
  bot.start().catch((err) => {
    logger.error(`[Usagi Music ${index}] failed to start:`, err);
  });
}

function getMemoryStats() {
  const m = process.memoryUsage();
  return {
    rss: `${(m.rss / 1024 / 1024).toFixed(1)} MB`,
    heapUsed: `${(m.heapUsed / 1024 / 1024).toFixed(1)} MB`,
    heapTotal: `${(m.heapTotal / 1024 / 1024).toFixed(1)} MB`,
    external: `${(m.external / 1024 / 1024).toFixed(1)} MB`,
  };
}

// Periodic garbage collection & memory monitoring (every 10 minutes)
setInterval(() => {
  if (global.gc) {
    try {
      global.gc();
    } catch {}
  }
  const mem = getMemoryStats();
  logger.info(`[Memory Monitor] RSS: ${mem.rss} | Heap: ${mem.heapUsed} / ${mem.heapTotal}`);
}, 10 * 60 * 1000).unref();

// Run an initial GC cleanup 15 seconds after boot once bots are connected
setTimeout(() => {
  if (global.gc) {
    try {
      global.gc();
      const mem = getMemoryStats();
      logger.info(`[Startup GC] All ${bots.size} bot(s) ready. Baseline RAM: RSS ${mem.rss} | Heap ${mem.heapUsed}`);
    } catch {}
  }
}, 15000).unref();

const app = express();
const port = Number(process.env.PORT || 3000);

app.get('/', (_req, res) => {
  res.json({
    status: 'online',
    mode: 'single-process',
    activeBotsCount: bots.size,
    memory: getMemoryStats(),
    bots: [...bots.entries()].map(([index, bot]) => ({
      index,
      ready: bot.ready,
      tag: bot.tag,
    })),
  });
});

app.get('/health', (_req, res) => {
  const totalBots = bots.size;
  const readyBots = [...bots.values()].filter((bot) => bot.ready).length;
  const isHealthy = totalBots > 0 && readyBots === totalBots;
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'starting',
    readyBots,
    totalBots,
    activeWorkers: [...bots.keys()],
    memory: getMemoryStats(),
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
