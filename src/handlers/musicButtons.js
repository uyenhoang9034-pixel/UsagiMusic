import { MessageFlags } from 'discord.js';

import { logger } from '../utils/logger.js';
import {
  ErrorTypes,
  TitanBotError,
  handleInteractionError,
  replyUserError,
} from '../utils/errorHandler.js';

import { getGuildMusicData } from '../services/music/playerStore.js';
import {
  applyPause,
  applyResume,
  buildQueueReply,
  destroyPlayerSession,
  getPlayer,
  setLoopMode,
} from '../services/music/musicActions.js';
import {
  VOICE_CHANNEL_DENIAL,
  canControlMusic,
} from '../services/music/permissions.js';
import { refreshPlayerMessage } from '../services/music/playerHandler.js';
import { MUSIC_BUTTON_IDS } from '../services/music/musicEmbeds.js';

const QUEUE_PAGINATION_IDS = new Set([
  MUSIC_BUTTON_IDS.QUEUE_FIRST,
  MUSIC_BUTTON_IDS.QUEUE_PREV,
  MUSIC_BUTTON_IDS.QUEUE_NEXT,
  MUSIC_BUTTON_IDS.QUEUE_LAST,
]);

const CURRENT_TRACK_REQUIRED_IDS = new Set([
  MUSIC_BUTTON_IDS.PAUSE,
  MUSIC_BUTTON_IDS.RESUME,
  MUSIC_BUTTON_IDS.SKIP,
  MUSIC_BUTTON_IDS.LOOP,
  MUSIC_BUTTON_IDS.VOL_DOWN,
  MUSIC_BUTTON_IDS.VOL_UP,
]);

export function getMusicButtonHandlerIds() {
  return [
    MUSIC_BUTTON_IDS.PAUSE,
    MUSIC_BUTTON_IDS.RESUME,
    MUSIC_BUTTON_IDS.SKIP,
    MUSIC_BUTTON_IDS.STOP,
    MUSIC_BUTTON_IDS.SHUFFLE,
    MUSIC_BUTTON_IDS.LOOP,
    MUSIC_BUTTON_IDS.VOL_DOWN,
    MUSIC_BUTTON_IDS.VOL_UP,
    MUSIC_BUTTON_IDS.QUEUE,
    MUSIC_BUTTON_IDS.QUEUE_FIRST,
    MUSIC_BUTTON_IDS.QUEUE_PREV,
    MUSIC_BUTTON_IDS.QUEUE_NEXT,
    MUSIC_BUTTON_IDS.QUEUE_LAST,
  ].filter(Boolean);
}

function getGuildId(interaction) {
  return interaction.guildId || interaction.guild?.id || null;
}

async function sendButtonError(interaction, error, context = {}) {
  logger.error('Music button error:', {
    customId: interaction?.customId,
    guildId: interaction?.guildId,
    userId: interaction?.user?.id,
    error: error?.message || String(error),
    stack: error?.stack,
    ...context,
  });

  if (interaction?.deferred || interaction?.replied) {
    const message =
      error instanceof TitanBotError
        ? error.userMessage || error.message
        : 'Có lỗi xảy ra khi xử lý nút Music. Thử lại sau nha.';

    try {
      await interaction.followUp({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
      return;
    } catch (followUpError) {
      logger.warn('Could not send music button follow-up error:', followUpError);
      return;
    }
  }

  await handleInteractionError(interaction, error, {
    type: 'button',
    handler: 'musicButton',
    customId: interaction?.customId,
    ...context,
  });
}

async function replyMusicButtonError(interaction, type, message) {
  return replyUserError(interaction, {
    type,
    message,
    context: {
      handler: 'musicButton',
      customId: interaction.customId,
    },
  });
}

function assertMusicReady(client) {
  if (!client?.riffy) {
    throw new TitanBotError(
      'Riffy is not available',
      ErrorTypes.CONFIGURATION,
      'Music chưa sẵn sàng — Lavalink/Riffy chưa được cấu hình hoặc chưa kết nối.',
    );
  }
}

async function openQueue(interaction, client, player, guildData, guildId) {
  if (!player?.current) {
    return replyMusicButtonError(
      interaction,
      ErrorTypes.USER_INPUT,
      'Hiện tại chưa có bài nào đang phát.',
    );
  }

  if (!canControlMusic(interaction.member, player)) {
    return replyMusicButtonError(
      interaction,
      ErrorTypes.PERMISSION,
      VOICE_CHANNEL_DENIAL,
    );
  }

  guildData.queuePages.set(interaction.user.id, 0);

  const payload = buildQueueReply(client, guildId, 0);

  return interaction.reply({
    embeds: payload.embeds,
    components: payload.components,
    flags: MessageFlags.Ephemeral,
  });
}

async function updateQueuePage(interaction, client, player, guildData, guildId) {
  if (!player?.current) {
    return replyMusicButtonError(
      interaction,
      ErrorTypes.USER_INPUT,
      'Hiện tại chưa có bài nào đang phát.',
    );
  }

  if (!canControlMusic(interaction.member, player)) {
    return replyMusicButtonError(
      interaction,
      ErrorTypes.PERMISSION,
      VOICE_CHANNEL_DENIAL,
    );
  }

  await interaction.deferUpdate();

  const currentPayload = buildQueueReply(
    client,
    guildId,
    guildData.queuePages.get(interaction.user.id) || 0,
  );

  let page = currentPayload.page;

  switch (interaction.customId) {
    case MUSIC_BUTTON_IDS.QUEUE_FIRST:
      page = 0;
      break;
    case MUSIC_BUTTON_IDS.QUEUE_PREV:
      page = Math.max(0, page - 1);
      break;
    case MUSIC_BUTTON_IDS.QUEUE_NEXT:
      page = Math.min(currentPayload.totalPages - 1, page + 1);
      break;
    case MUSIC_BUTTON_IDS.QUEUE_LAST:
      page = currentPayload.totalPages - 1;
      break;
    default:
      break;
  }

  guildData.queuePages.set(interaction.user.id, page);

  const updated = buildQueueReply(client, guildId, page);

  return interaction.editReply({
    embeds: updated.embeds,
    components: updated.components,
  });
}

async function handlePlayerControl(interaction, client, player, guildData, guildId) {
  if (!player) {
    return replyMusicButtonError(
      interaction,
      ErrorTypes.USER_INPUT,
      'Chưa có bài nào đang phát. Dùng `/play` trước nha.',
    );
  }

  if (!canControlMusic(interaction.member, player)) {
    return replyMusicButtonError(
      interaction,
      ErrorTypes.PERMISSION,
      VOICE_CHANNEL_DENIAL,
    );
  }

  if (CURRENT_TRACK_REQUIRED_IDS.has(interaction.customId) && !player.current) {
    return replyMusicButtonError(
      interaction,
      ErrorTypes.USER_INPUT,
      'Hiện tại chưa có bài nào đang phát.',
    );
  }

  if (interaction.customId === MUSIC_BUTTON_IDS.SHUFFLE && !player.queue?.length) {
    return replyMusicButtonError(
      interaction,
      ErrorTypes.USER_INPUT,
      'Queue đang trống, không có gì để trộn.',
    );
  }

  await interaction.deferUpdate();

  switch (interaction.customId) {
    case MUSIC_BUTTON_IDS.PAUSE:
      await applyPause(client, guildId);
      break;

    case MUSIC_BUTTON_IDS.RESUME:
      await applyResume(client, guildId);
      break;

    case MUSIC_BUTTON_IDS.SKIP:
      if (player.loop === 'track') {
        player.setLoop('none');
      }
      player.stop();
      break;

    case MUSIC_BUTTON_IDS.STOP:
      await destroyPlayerSession(client, guildId, player, guildData);
      break;

    case MUSIC_BUTTON_IDS.SHUFFLE:
      player.queue.shuffle();
      guildData.shuffle = true;
      await refreshPlayerMessage(client, guildId);
      break;

    case MUSIC_BUTTON_IDS.LOOP: {
      const next =
        guildData.loop === 'none'
          ? 'track'
          : guildData.loop === 'track'
            ? 'queue'
            : 'none';

      await setLoopMode(client, interaction, next);
      break;
    }

    case MUSIC_BUTTON_IDS.VOL_DOWN:
      guildData.volume = Math.max(0, guildData.volume - 10);
      player.setVolume(guildData.volume);
      await refreshPlayerMessage(client, guildId);
      break;

    case MUSIC_BUTTON_IDS.VOL_UP:
      guildData.volume = Math.min(100, guildData.volume + 10);
      player.setVolume(guildData.volume);
      await refreshPlayerMessage(client, guildId);
      break;

    default:
      break;
  }
}

async function handleMusicButton(interaction, client) {
  assertMusicReady(client);

  const guildId = getGuildId(interaction);

  if (!guildId) {
    return replyMusicButtonError(
      interaction,
      ErrorTypes.USER_INPUT,
      'Nút Music chỉ dùng được trong server.',
    );
  }

  const player = getPlayer(client, guildId);
  const guildData = getGuildMusicData(guildId);

  if (interaction.customId === MUSIC_BUTTON_IDS.QUEUE) {
    return openQueue(interaction, client, player, guildData, guildId);
  }

  if (QUEUE_PAGINATION_IDS.has(interaction.customId)) {
    return updateQueuePage(interaction, client, player, guildData, guildId);
  }

  return handlePlayerControl(interaction, client, player, guildData, guildId);
}

export const musicButtonHandler = {
  name: 'music_buttons',

  async execute(interaction, client) {
    try {
      await handleMusicButton(interaction, client);
    } catch (error) {
      await sendButtonError(interaction, error);
    }
  },
};

export default musicButtonHandler;
