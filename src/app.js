import 'dotenv/config';
import express from 'express';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logger } from './utils/logger.js';

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

const workerFile = fileURLToPath(new URL('./worker.js', import.meta.url));
const workers = new Map();

function startWorker(index, token) {
  const state = {
    index,
    ready: false,
    tag: null,
    restarts: 0,
    process: null,
  };
  workers.set(index, state);

  const spawn = () => {
    const child = fork(workerFile, [], {
      env: {
        ...process.env,
        USAGI_MUSIC_WORKER: String(index),
        USAGI_MUSIC_TOKEN: token,
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });

    state.process = child;
    state.ready = false;

    child.on('message', (message) => {
      if (message?.type === 'ready') {
        state.ready = true;
        state.tag = message.tag || null;
        return;
      }

      if (message?.type === 'routePlay') {
        routePlayRequest(message);
        return;
      }

      if (message?.type === 'playResult') {
        handlePlayResult(message);
        return;
      }

      if (message?.type === 'release') {
        const guildAssignments = assignments.get(message.guildId);
        if (guildAssignments?.get(message.index)) {
          guildAssignments.delete(message.index);
          if (!guildAssignments.size) assignments.delete(message.guildId);
        }
      }
    });

    child.on('exit', (code, signal) => {
      state.ready = false;
      state.process = null;

      if (shuttingDown) return;

      state.restarts += 1;
      logger.warn(
        `[Usagi Music ${index}] worker exited (code=${code}, signal=${signal}); restarting in 5s.`,
      );
      setTimeout(spawn, 5000);
    });
  };

  spawn();
}

let shuttingDown = false;

// guildId -> Map(workerIndex -> voiceChannelId)
const assignments = new Map();
const pendingRoutes = new Map();

function sendToWorker(index, payload) {
  const worker = workers.get(index);
  if (!worker?.ready || !worker.process?.connected) return false;
  worker.process.send(payload);
  return true;
}

function routePlayRequest(message) {
  const { requestId, guildId, voiceChannelId } = message;
  let guildAssignments = assignments.get(guildId);
  if (!guildAssignments) {
    guildAssignments = new Map();
    assignments.set(guildId, guildAssignments);
  }

  // Same voice always keeps the same Music bot.
  let selected = [...guildAssignments.entries()]
    .find(([, channelId]) => channelId === voiceChannelId)?.[0];

  // Otherwise choose the first ready bot not already serving another voice
  // in this guild.
  if (!selected) {
    selected = [1, 2, 3].find(
      (workerIndex) => workers.get(workerIndex)?.ready && !guildAssignments.has(workerIndex),
    );
  }

  if (!selected) {
    sendToWorker(1, {
      type: 'routeResult',
      requestId,
      ok: false,
      error: 'Cả 3 Usagi Music đều đang được sử dụng ở các phòng voice khác.',
    });
    return;
  }

  guildAssignments.set(selected, voiceChannelId);
  pendingRoutes.set(requestId, { selected, guildId, voiceChannelId });

  if (!sendToWorker(selected, { ...message, type: 'playOnWorker' })) {
    guildAssignments.delete(selected);
    pendingRoutes.delete(requestId);
    sendToWorker(1, {
      type: 'routeResult',
      requestId,
      ok: false,
      error: `Usagi Music ${selected} chưa sẵn sàng. Hãy thử lại.`,
    });
  }
}

function handlePlayResult(message) {
  const pending = pendingRoutes.get(message.requestId);
  pendingRoutes.delete(message.requestId);

  if (!message.ok && pending) {
    const guildAssignments = assignments.get(pending.guildId);
    if (guildAssignments?.get(pending.selected) === pending.voiceChannelId) {
      guildAssignments.delete(pending.selected);
      if (!guildAssignments.size) assignments.delete(pending.guildId);
    }
  }

  sendToWorker(1, {
    type: 'routeResult',
    requestId: message.requestId,
    ok: message.ok,
    embed: message.embed,
    error: message.error,
    workerIndex: message.index,
  });
}

tokens.forEach((token, i) => startWorker(i + 1, token));

const app = express();
const port = Number(process.env.PORT || 3000);

app.get('/', (_req, res) => {
  res.json({
    status: 'online',
    bots: [...workers.values()].map(({ index, ready, tag, restarts }) => ({
      index,
      ready,
      tag,
      restarts,
    })),
  });
});

app.get('/health', (_req, res) => {
  const states = [...workers.values()];
  const readyBots = states.filter((state) => state.ready).length;
  res.status(readyBots === 3 ? 200 : 503).json({
    status: readyBots === 3 ? 'healthy' : 'starting',
    readyBots,
    totalBots: 3,
  });
});

const server = app.listen(port, '0.0.0.0', () => {
  logger.info(`UsagiMusic controller listening on :${port}`);
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`UsagiMusic controller shutting down (${signal})`);

  for (const state of workers.values()) {
    state.process?.kill('SIGTERM');
  }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
