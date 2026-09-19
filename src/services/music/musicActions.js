import { once } from 'node:events';
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

async function waitForPlayerConnection(player) {
  if (player.connected) {
    return;
  }

  try {
    await player.connection?.resolve?.();
  } catch {
    // Fall through to event-based wait.
  }

  if (player.connected) {
    return;
  }

  try {
    await once(player, 'connectionRestored', {
      signal: AbortSignal.timeout(PLAYER_CONNECT_TIMEOUT_MS),
    });
  } catch {
    // Timed out waiting for Lavalink to confirm the voice session.
  }

  if (!player.connected) {
    throw new TitanBotError(
      'Voice connection failed',
      ErrorTypes.CONFIGURATION,
      'Could not connect to the voice channel. Ensure Lavalink is online and the bot has Connect/Speak permission.',
    );
  }
}

export async function startPlayback(player) {
  await waitForPlayerConnection(player);
  await player.play();
}

export function getPlayer(client, guildId) {
  return client.riffy?.players?.get(guildId) || null;
}

export function assertRiffyAvailable(client) {
  if (!client.riffy) {
    throw new TitanBotError(
      'Lavalink not configured',
      ErrorTypes.CONFIGURATION,
      'Music is unavailable — Lavalink is not configured.',
    );
  }
}

export function assertInVoice(member) {
  if (!requireVoiceChannel(member)) {
    throw new TitanBotError(
      'Not in voice channel',
      ErrorTypes.USER_INPUT,
      'You need to be in a voice channel.',
    );
  }
}

export function assertCanControl(member, player) {
  if (!canControlMusic(member, player)) {
    throw new TitanBotError(
      'Wrong voice channel',
      ErrorTypes.PERMISSION,
      VOICE_CHANNEL_DENIAL,
    );
  }
}

function getQueueLength(player) {
  return Number(player?.queue?.length || 0);
}

function getQueueTrack(player, index) {
  return player?.queue?.[index] || null;
}

function clearPlayerQueue(player) {
  if (typeof player?.queue?.clear === 'function') {
    player.queue.clear();
    return;
  }

  if (Array.isArray(player?.queue)) {
    player.queue.length = 0;
  }
}

function addTrackToQueue(player, track) {
  if (typeof player?.queue?.add === 'function') {
    player.queue.add(track);
    return;
  }

  player.queue.push(track);
}

function removeTrackFromQueue(player, index) {
  if (typeof player?.queue?.remove === 'function') {
    player.queue.remove(index);
    return;
  }

  player.queue.splice(index, 1);
}

function insertTrackInQueue(player, index, track) {
  if (typeof player?.queue?.splice === 'function') {
    player.queue.splice(index, 0, track);
  }
}

function isDuplicateTrack(player, track) {
  const uri = track?.info?.uri;

  if (!uri) {
    return false;
  }

  if (player.current?.info?.uri === uri) {
    return true;
  }

  if (typeof player.queue?.some === 'function') {
    return player.queue.some((existing) => existing.info?.uri === uri);
  }

  return false;
}

export async function ensurePlayer(client, interaction) {
  assertRiffyAvailable(client);
  assertInVoice(interaction.member);

  const guildId = interaction.guild.id;
  const guildData = getGuildMusicData(guildId);

  let player = getPlayer(client, guildId);

  if (!player) {
    player = client.riffy.createConnection({
      guildId,
      voiceChannel: interaction.member.voice.channel.id,
      textChannel: interaction.channel.id,
      deaf: true,
    });

    guildData.playerChannelId = interaction.channel.id;
  }

  player.setVolume(guildData.volume);

  return {
    player,
    guildData,
  };
}

export async function joinVoiceChannel(client, interaction) {
  assertRiffyAvailable(client);
  assertInVoice(interaction.member);

  const guildId = interaction.guild.id;
  const guildData = getGuildMusicData(guildId);
  const channel = interaction.member.voice.channel;

  assertBotVoicePermissions(channel);

  let player = getPlayer(client, guildId);

  if (player && player.voiceChannel !== channel.id) {
    try {
      player.destroy();
    } catch {
      // Player may already be gone.
    }

    player = null;
  }

  if (!player) {
    player = client.riffy.createConnection({
      guildId,
      voiceChannel: channel.id,
      textChannel: interaction.channel.id,
      deaf: true,
    });

    guildData.playerChannelId = interaction.channel.id;
  }

  player.setVolume(guildData.volume);

  return successEmbed(
    'Joined Voice Channel',
    `Connected to **${channel.name}**. Use /play to start music, or /music for playback controls.`,
  );
}

export async function playQuery(client, interaction, query) {
  const cleanQuery = String(query || '').trim();

  const isExplicitPlaylist =
    /(?:[?&]list=|youtube\.com\/playlist)/i.test(cleanQuery);

  if (!cleanQuery) {
    throw new TitanBotError(
      'Empty query',
      ErrorTypes.USER_INPUT,
      'Please provide a song name or YouTube URL.',
    );
  }

  const { player } = await ensurePlayer(client, interaction);

  const result = await client.riffy.resolve({
    query: cleanQuery,
    requester: interaction.user,
  });

  const loadType = String(result?.loadType || '').toUpperCase();
  const tracks = Array.isArray(result?.tracks) ? result.tracks : [];
  const playlistInfo = result?.playlistInfo;

  if (
    loadType === 'NO_MATCHES' ||
    loadType === 'NO_MATCH' ||
    loadType === 'EMPTY' ||
    !tracks.length
  ) {
    throw new TitanBotError(
      'No results',
      ErrorTypes.USER_INPUT,
      YOUTUBE_URL_PATTERN.test(cleanQuery)
        ? 'Lavalink could not resolve this YouTube URL. Try another YouTube video.'
        : 'No results found for that query.',
    );
  }

  if (
    (loadType === 'PLAYLIST' || loadType === 'PLAYLIST_LOADED') &&
    isExplicitPlaylist
  ) {
    let added = 0;
    let skipped = 0;

    for (const track of tracks) {
      if (!track) {
        continue;
      }

      track.info ??= {};
      track.info.requester = interaction.user;

      if (isDuplicateTrack(player, track)) {
        skipped += 1;
        continue;
      }

      addTrackToQueue(player, track);
      added += 1;
    }

    if (added > 0 && !player.playing && !player.paused) {
      await startPlayback(player);
    }

    return {
      embed: successEmbed(
        'Playlist Added',
        `**${playlistInfo?.name || 'Playlist'}**\nAdded ${added} of ${tracks.length} track(s).${
          skipped ? ` Skipped ${skipped} duplicate(s).` : ''
        }`,
      ),
    };
  }

  if (
    loadType === 'TRACK_LOADED' ||
    loadType === 'SEARCH_RESULT' ||
    loadType === 'SEARCH' ||
    loadType === 'TRACK' ||
    ((loadType === 'PLAYLIST' || loadType === 'PLAYLIST_LOADED') &&
      !isExplicitPlaylist)
  ) {
    const track = tracks[0];

    if (!track) {
      throw new TitanBotError(
        'No results',
        ErrorTypes.USER_INPUT,
        'No results found for that query.',
      );
    }

    if (isDuplicateTrack(player, track)) {
      throw new TitanBotError(
        'Duplicate track',
        ErrorTypes.USER_INPUT,
        `**${track.info?.title || 'This track'}** is already in the queue or playing.`,
      );
    }

    track.info ??= {};
    track.info.requester = interaction.user;

    const willPlayNow = !player.playing && !player.paused;

    addTrackToQueue(player, track);

    const queuePosition = getQueueLength(player);

    if (willPlayNow) {
      await startPlayback(player);
      // trackStart owns creation of the single public Music dashboard.
    }

    return {
      embed: successEmbed(
        willPlayNow ? 'Now Playing' : 'Track Added',
        willPlayNow
          ? `**${track.info?.title || 'Unknown'}**\n${track.info?.author || 'Unknown'}`
          : `**${track.info?.title || 'Unknown'}**\n${track.info?.author || 'Unknown'}\nPosition: #${queuePosition} in queue`,
      ),
    };
  }

  throw new TitanBotError(
    'No results',
    ErrorTypes.USER_INPUT,
    `No results found. (loadType: ${result?.loadType || 'unknown'})`,
  );
}

export async function skipTrack(client, interaction) {
  const player = getPlayer(client, interaction.guild.id);

  if (!player?.current) {
    throw new TitanBotError(
      'No player',
      ErrorTypes.USER_INPUT,
      'Nothing is playing right now.',
    );
  }

  assertCanControl(interaction.member, player);

  const title = player.current.info?.title || 'Unknown';

  if (player.loop === 'track') {
    player.setLoop('none');
  }

  player.stop();

  return successEmbed('Skipped', `Skipped **${title}**.`);
}

export async function stopPlayback(client, interaction) {
  const player = getPlayer(client, interaction.guild.id);

  if (!player) {
    throw new TitanBotError(
      'No player',
      ErrorTypes.USER_INPUT,
      'No active music player.',
    );
  }

  assertCanControl(interaction.member, player);

  const guildData = getGuildMusicData(interaction.guild.id);
  const queueLength = getQueueLength(player);

  if (queueLength >= 5 && guildData.stopConfirmPending !== interaction.user.id) {
    guildData.stopConfirmPending = interaction.user.id;

    setTimeout(() => {
      if (guildData.stopConfirmPending === interaction.user.id) {
        guildData.stopConfirmPending = null;
      }
    }, 15000);

    return successEmbed(
      'Confirm Stop',
      `There are **${queueLength}** tracks in the queue. Run **/music stop** again within 15 seconds to confirm.`,
    );
  }

  guildData.stopConfirmPending = null;

  await destroyPlayerSession(client, interaction.guild.id, player, guildData);

  return successEmbed('Stopped', 'Playback stopped and the queue was cleared.');
}

export async function applyPause(client, guildId) {
  const player = getPlayer(client, guildId);

  if (!player?.current || player.paused) {
    return false;
  }

  player.pause(true);
  await refreshPlayerMessage(client, guildId);
  return true;
}

export async function applyResume(client, guildId) {
  const player = getPlayer(client, guildId);

  if (!player?.current || !player.paused) {
    return false;
  }

  player.pause(false);
  await refreshPlayerMessage(client, guildId);
  return true;
}

export async function pausePlayback(client, interaction) {
  const player = getPlayer(client, interaction.guild.id);

  if (!player?.current) {
    throw new TitanBotError(
      'No player',
      ErrorTypes.USER_INPUT,
      'Nothing is playing right now.',
    );
  }

  assertCanControl(interaction.member, player);

  if (player.paused) {
    throw new TitanBotError(
      'Already paused',
      ErrorTypes.USER_INPUT,
      'Playback is already paused.',
    );
  }

  await applyPause(client, interaction.guild.id);
  return successEmbed('Paused', 'Playback paused.');
}

export async function resumePlayback(client, interaction) {
  const player = getPlayer(client, interaction.guild.id);

  if (!player?.current) {
    throw new TitanBotError(
      'No player',
      ErrorTypes.USER_INPUT,
      'Nothing is playing right now.',
    );
  }

  assertCanControl(interaction.member, player);

  if (!player.paused) {
    throw new TitanBotError(
      'Not paused',
      ErrorTypes.USER_INPUT,
      'Playback is not paused.',
    );
  }

  await applyResume(client, interaction.guild.id);
  return successEmbed('Resumed', 'Playback resumed.');
}

export async function shuffleQueue(client, interaction) {
  const player = getPlayer(client, interaction.guild.id);

  if (!getQueueLength(player)) {
    throw new TitanBotError(
      'Empty queue',
      ErrorTypes.USER_INPUT,
      'The queue is empty.',
    );
  }

  assertCanControl(interaction.member, player);

  player.queue.shuffle?.();
  getGuildMusicData(interaction.guild.id).shuffle = true;

  await refreshPlayerMessage(client, interaction.guild.id);
  return successEmbed('Shuffled', 'The queue has been shuffled.');
}

export async function setLoopMode(client, interaction, mode) {
  const player = getPlayer(client, interaction.guild.id);

  if (!player) {
    throw new TitanBotError(
      'No player',
      ErrorTypes.USER_INPUT,
      'No active music player.',
    );
  }

  assertCanControl(interaction.member, player);

  const guildData = getGuildMusicData(interaction.guild.id);
  const safeMode = ['none', 'track', 'queue'].includes(mode) ? mode : 'none';

  guildData.loop = safeMode;
  player.setLoop(safeMode);

  const labels = {
    none: 'Off',
    track: 'Track',
    queue: 'Queue',
  };

  await refreshPlayerMessage(client, interaction.guild.id);

  return successEmbed('Loop Updated', `Loop mode set to **${labels[safeMode]}**.`);
}

export async function toggleLoop(client, interaction) {
  const guildData = getGuildMusicData(interaction.guild.id);
  const next = guildData.loop === 'none'
    ? 'track'
    : guildData.loop === 'track'
      ? 'queue'
      : 'none';

  return setLoopMode(client, interaction, next);
}

export async function setVolume(client, interaction, volume) {
  const player = getPlayer(client, interaction.guild.id);

  if (!player) {
    throw new TitanBotError(
      'No player',
      ErrorTypes.USER_INPUT,
      'No active music player.',
    );
  }

  assertCanControl(interaction.member, player);

  const guildData = getGuildMusicData(interaction.guild.id);
  guildData.volume = Math.max(0, Math.min(100, Number(volume) || 0));

  player.setVolume(guildData.volume);

  await refreshPlayerMessage(client, interaction.guild.id);
  return successEmbed('Volume Updated', `Volume set to **${guildData.volume}%**.`);
}

export async function adjustVolume(client, interaction, delta) {
  const guildData = getGuildMusicData(interaction.guild.id);
  return setVolume(client, interaction, guildData.volume + delta);
}

export async function seekTrack(client, interaction, seconds) {
  const player = getPlayer(client, interaction.guild.id);

  if (!player?.current) {
    throw new TitanBotError(
      'No player',
      ErrorTypes.USER_INPUT,
      'Nothing is playing right now.',
    );
  }

  assertCanControl(interaction.member, player);

  const info = player.current.info || {};

  if (info.isStream || info.isSeekable === false) {
    throw new TitanBotError(
      'Not seekable',
      ErrorTypes.USER_INPUT,
      'This track cannot be seeked; it may be a live stream.',
    );
  }

  const position = Math.max(0, Number(seconds || 0) * 1000);

  if (info.length && position > info.length) {
    throw new TitanBotError(
      'Seek out of range',
      ErrorTypes.USER_INPUT,
      `You can only seek up to ${Math.floor(info.length / 1000)}s for this track.`,
    );
  }

  player.seek(position);

  await refreshPlayerMessage(client, interaction.guild.id);
  return successEmbed('Seeked', `Seeked to **${Math.floor(position / 1000)}s**.`);
}

export async function removeFromQueue(client, interaction, index) {
  const player = getPlayer(client, interaction.guild.id);
  const queueLength = getQueueLength(player);

  if (!queueLength) {
    throw new TitanBotError(
      'Empty queue',
      ErrorTypes.USER_INPUT,
      'The queue is empty.',
    );
  }

  assertCanControl(interaction.member, player);

  const queueIndex = Number(index) - 1;

  if (queueIndex < 0 || queueIndex >= queueLength) {
    throw new TitanBotError(
      'Invalid index',
      ErrorTypes.USER_INPUT,
      `Invalid queue position. Queue has ${queueLength} track(s).`,
    );
  }

  const removed = getQueueTrack(player, queueIndex);
  removeTrackFromQueue(player, queueIndex);

  await refreshPlayerMessage(client, interaction.guild.id);

  return successEmbed(
    'Removed',
    `Removed **${removed?.info?.title || 'track'}** from the queue.`,
  );
}

export async function moveInQueue(client, interaction, from, to) {
  const player = getPlayer(client, interaction.guild.id);
  const queueLength = getQueueLength(player);

  if (!queueLength) {
    throw new TitanBotError(
      'Empty queue',
      ErrorTypes.USER_INPUT,
      'The queue is empty.',
    );
  }

  assertCanControl(interaction.member, player);

  const fromIndex = Number(from) - 1;
  const toIndex = Number(to) - 1;

  if (
    fromIndex < 0 ||
    fromIndex >= queueLength ||
    toIndex < 0 ||
    toIndex >= queueLength
  ) {
    throw new TitanBotError(
      'Invalid index',
      ErrorTypes.USER_INPUT,
      'Invalid queue positions.',
    );
  }

  const track = getQueueTrack(player, fromIndex);
  removeTrackFromQueue(player, fromIndex);
  insertTrackInQueue(player, toIndex, track);

  await refreshPlayerMessage(client, interaction.guild.id);

  return successEmbed(
    'Moved',
    `Moved **${track?.info?.title || 'track'}** to position #${to}.`,
  );
}

export async function clearQueue(client, interaction) {
  const player = getPlayer(client, interaction.guild.id);

  if (!getQueueLength(player)) {
    throw new TitanBotError(
      'Empty queue',
      ErrorTypes.USER_INPUT,
      'The queue is already empty.',
    );
  }

  assertCanControl(interaction.member, player);

  clearPlayerQueue(player);
  await refreshPlayerMessage(client, interaction.guild.id);

  return successEmbed('Queue Cleared', 'All queued tracks were removed.');
}

export async function setTwentyFourSeven(client, interaction, enabled) {
  const guildData = getGuildMusicData(interaction.guild.id);
  guildData.twentyFourSeven = Boolean(enabled);

  return successEmbed(
    '24/7 Mode',
    guildData.twentyFourSeven
      ? '24/7 mode enabled. The bot will stay in the voice channel when the queue ends.'
      : '24/7 mode disabled. The bot will leave after 30 seconds of idle time.',
  );
}

export function buildNowPlayingReply(client, guildId) {
  const player = getPlayer(client, guildId);

  if (!player?.current) {
    throw new TitanBotError(
      'No player',
      ErrorTypes.USER_INPUT,
      'Nothing is playing right now.',
    );
  }

  const guildData = getGuildMusicData(guildId);

  return {
    embeds: [
      buildNowPlayingEmbed(player.current, player, guildData),
    ],
  };
}

export function buildQueueReply(client, guildId, page = 0) {
  const player = getPlayer(client, guildId);

  if (!player) {
    throw new TitanBotError(
      'No player',
      ErrorTypes.USER_INPUT,
      'No active music player.',
    );
  }

  const totalPages = Math.max(
    1,
    Math.ceil(getQueueLength(player) / getQueuePageSize()),
  );

  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);

  return {
    embeds: [
      buildQueueEmbed(player.queue, player.current, safePage),
    ],
    components: totalPages > 1
      ? [buildQueuePaginationRow(safePage, totalPages)]
      : [],
    page: safePage,
    totalPages,
  };
}

export async function destroyPlayerSession(
  client,
  guildId,
  player,
  guildData,
  {
    forceDisconnect = false,
  } = {},
) {
  clearUpdateInterval(guildData);

  if (guildData.idleTimeout) {
    clearTimeout(guildData.idleTimeout);
    guildData.idleTimeout = null;
  }

  guildData.previousTracks = [];
  guildData.stopConfirmPending = null;
  guildData.autoPaused = false;
  guildData.queuePages?.clear();

  if (guildData.playerMessageId && guildData.playerChannelId) {
    try {
      const channel = client.channels.cache.get(guildData.playerChannelId);
      const msg = await channel?.messages.fetch(guildData.playerMessageId);
      await msg?.delete();
    } catch {
      // Message already deleted or unavailable.
    }
  }

  guildData.playerMessageId = null;
  guildData.playerChannelId = null;

  if (player) {
    try {
      clearPlayerQueue(player);
      player.stop();
    } catch {
      // Player may already be stopped.
    }

    if (forceDisconnect || !guildData.twentyFourSeven) {
      try {
        player.destroy();
      } catch {
        // Player may already be destroyed.
      }
    }
  }
}

export async function leaveVoiceChannel(client, interaction) {
  assertRiffyAvailable(client);

  const guildId = interaction.guild.id;
  const player = getPlayer(client, guildId);

  if (!player) {
    throw new TitanBotError(
      'No player',
      ErrorTypes.USER_INPUT,
      'I am not in a voice channel.',
    );
  }

  assertCanControl(interaction.member, player);

  const channel = interaction.guild.channels.cache.get(player.voiceChannel);
  const channelName = channel?.name || 'voice channel';
  const guildData = getGuildMusicData(guildId);

  await destroyPlayerSession(client, guildId, player, guildData, {
    forceDisconnect: true,
  });

  return successEmbed('Left Voice Channel', `Disconnected from **${channelName}**.`);
}

export async function replyMusicSuccess(interaction, embed) {
  const options = {
    embeds: [embed],
  };

  if (!interaction._isPrefixCommand) {
    options.flags = MessageFlags.Ephemeral;
  }

  await InteractionHelper.safeReply(interaction, options);
}
