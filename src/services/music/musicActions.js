import { MessageFlags, PermissionFlagsBits } from 'discord.js';

import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { botHasPermission } from '../../utils/permissionGuard.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';

import {
  getGuildMusicData,
  clearUpdateInterval,
} from './playerStore.js';

import {
  canControlMusic,
  requireVoiceChannel,
  VOICE_CHANNEL_DENIAL,
} from './permissions.js';

import {
  buildNowPlayingEmbed,
  buildQueueEmbed,
  buildQueuePaginationRow,
  getQueuePageSize,
} from './musicEmbeds.js';

import {
  refreshPlayerMessage,
} from './playerHandler.js';

const YOUTUBE_URL_PATTERN = /(?:youtube\.com|youtu\.be)/i;
const PLAYER_CONNECT_TIMEOUT_MS = 12_000;

function getConnectedLavalinkNodes(client) {
  if (!client.riffy?.nodeMap) {
    return [];
  }

  return [...client.riffy.nodeMap.values()].filter((node) => node.connected);
}

export function assertLavalinkNodeAvailable(client) {
  if (!getConnectedLavalinkNodes(client).length) {
    throw new TitanBotError(
      'Lavalink unavailable',
      ErrorTypes.CONFIGURATION,
      'Music is temporarily unavailable — no Lavalink nodes are connected. Try again shortly.',
    );
  }
}

function assertBotVoicePermissions(channel) {
  if (!channel) {
    throw new TitanBotError(
      'Voice channel unavailable',
      ErrorTypes.CONFIGURATION,
      'Could not access that voice channel.',
    );
  }

  if (
    !botHasPermission(channel, [
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
    ])
  ) {
    throw new TitanBotError(
      'Missing voice permissions',
      ErrorTypes.PERMISSION,
      'I need **Connect** and **Speak** permissions in your voice channel.',
    );
  }
}

export async function startPlayback(player) {
  // Riffy 1.0.12 handles the initial Discord voice handshake internally.
  // Waiting for "connectionRestored" here blocks first playback because that
  // event is for a restored connection, not the normal initial connection.
  await player.play();
}

