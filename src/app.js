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
      selectedIndex = [...bots.keys()].find((idx) => {
        const b = bots.get(idx);
        return b?.ready && !guildAssignments.has(idx) && (b.guilds.cache.has(guildId) || idx === 1);
      });
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

app.get('/', (req, res) => {
  const wantsJson = req.query.json === 'true' || req.headers.accept?.includes('application/json');
  const data = {
    status: 'online',
    mode: 'single-process',
    activeBotsCount: bots.size,
    memory: getMemoryStats(),
    uptime: Math.floor(process.uptime()),
    bots: [...bots.entries()].map(([index, bot]) => ({
      index,
      ready: bot.ready,
      tag: bot.tag || 'Connecting...',
    })),
  };

  if (wantsJson) {
    return res.json(data);
  }

  const botCards = data.bots.map((b) => `
    <div class="bot-card">
      <div class="bot-header">
        <span class="bot-badge ${b.ready ? 'ready' : 'starting'}">${b.ready ? 'ONLINE' : 'CONNECTING'}</span>
        <span class="bot-name">Usagi Music ${b.index}</span>
      </div>
      <div class="bot-tag">${b.tag}</div>
    </div>
  `).join('');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Usagi Music · Live Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0f1015;
      --card-bg: rgba(26, 28, 38, 0.7);
      --card-border: rgba(255, 183, 213, 0.15);
      --pink: #ffb7d5;
      --pink-glow: rgba(255, 183, 213, 0.35);
      --text: #e6e8ee;
      --text-muted: #8c90a4;
      --success: #6be28e;
      --warning: #f7b955;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', sans-serif;
      background: radial-gradient(circle at 50% 0%, #201a28, var(--bg));
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 30px 16px;
    }
    .container {
      width: 100%;
      max-width: 720px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .header {
      text-align: center;
      padding: 20px 0;
    }
    .title {
      font-size: 2rem;
      font-weight: 700;
      color: var(--pink);
      text-shadow: 0 0 24px var(--pink-glow);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .subtitle {
      font-size: 0.95rem;
      color: var(--text-muted);
      margin-top: 6px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(14px);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 20px;
      transition: transform 0.2s, border-color 0.2s;
    }
    .card:hover {
      transform: translateY(-2px);
      border-color: rgba(255, 183, 213, 0.3);
    }
    .stat-label {
      font-size: 0.8rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }
    .stat-val {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--pink);
    }
    .bots-section {
      background: var(--card-bg);
      backdrop-filter: blur(14px);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 22px;
    }
    .section-title {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 14px;
      color: var(--pink);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .bots-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .bot-card {
      background: rgba(15, 16, 21, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 14px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .bot-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .bot-name {
      font-weight: 600;
      font-size: 1rem;
    }
    .bot-tag {
      font-size: 0.9rem;
      color: var(--text-muted);
      font-family: monospace;
    }
    .bot-badge {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 20px;
    }
    .bot-badge.ready {
      background: rgba(107, 226, 142, 0.15);
      color: var(--success);
      border: 1px solid rgba(107, 226, 142, 0.3);
    }
    .bot-badge.starting {
      background: rgba(247, 185, 85, 0.15);
      color: var(--warning);
      border: 1px solid rgba(247, 185, 85, 0.3);
    }
    .footer {
      text-align: center;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">🐰 𝓤𝓼𝓪𝓰𝓲 𝓜𝓾𝓼𝓲𝓬</div>
      <div class="subtitle">Single-Process Architecture · Optimized for Railway Hobby</div>
    </div>
    <div class="grid">
      <div class="card">
        <div class="stat-label">RAM Consumption (RSS)</div>
        <div class="stat-val">${data.memory.rss}</div>
      </div>
      <div class="card">
        <div class="stat-label">V8 Heap Memory</div>
        <div class="stat-val">${data.memory.heapUsed}</div>
      </div>
      <div class="card">
        <div class="stat-label">Active Workers</div>
        <div class="stat-val">${data.activeBotsCount} Bot(s)</div>
      </div>
    </div>
    <div class="bots-section">
      <div class="section-title">
        <span>Workers Status</span>
        <span style="font-size: 0.85rem; color: var(--text-muted);">Auto-refreshing</span>
      </div>
      <div class="bots-list">
        ${botCards}
      </div>
    </div>
    <div class="footer">
      Designed with 💖 by Usagi múp rụp cho vợ của Kim Nong
    </div>
  </div>
  <script>
    setTimeout(() => window.location.reload(), 10000);
  </script>
</body>
</html>`);
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
