import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getPaginationRow } from '../../utils/components.js';

const QUEUE_PAGE_SIZE = 10;

const EMOJI_HEART = '<a:heartg3:1546047728314884226>';
const EMOJI_VOLUME = '<a:trangtrig1:1546040442548654140>';
const EMOJI_INFO = '<a:trangtrig19:1546068350030053406>';
const EMOJI_TITLE_LEFT = '<a:trangtrig2:1546040703375904801>';
const EMOJI_TITLE_RIGHT = '<a:trangtrig3:1546040818261954610>';

const BUTTON_HEART = { id: '1546047728314884226', name: 'heartg3', animated: true };
const BUTTON_VOLUME = { id: '1546040442548654140', name: 'trangtrig1', animated: true };

export const MUSIC_BUTTON_IDS = {
    PAUSE: 'music_pause',
    RESUME: 'music_resume',
    SKIP: 'music_skip',
    STOP: 'music_stop',
    SHUFFLE: 'music_shuffle',
    LOOP: 'music_loop',
    VOL_DOWN: 'music_vol_down',
    VOL_UP: 'music_vol_up',
    QUEUE: 'music_queue',
    QUEUE_FIRST: 'music_queue_first',
    QUEUE_PREV: 'music_queue_prev',
    QUEUE_NEXT: 'music_queue_next',
    QUEUE_LAST: 'music_queue_last',
};

export function formatDuration(ms) {
    if (!ms || Number.isNaN(ms)) {
        return 'Live';
    }
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getTrackArtwork(track) {
    const info = track?.info || {};
    const directArtwork =
        info.artworkUrl ||
        info.artworkURL ||
        info.thumbnail ||
        info.thumbnailUrl ||
        info.thumbnailURL;

    if (directArtwork) {
        return directArtwork;
    }

    const identifier =
        info.identifier ||
        info.videoId ||
        info.videoID;

    const sourceName =
        String(info.sourceName || '').toLowerCase();

    if (
        identifier &&
        (sourceName.includes('youtube') ||
            /(?:youtube\.com|youtu\.be)/i.test(info.uri || ''))
    ) {
        return `https://i.ytimg.com/vi/${identifier}/hqdefault.jpg`;
    }

    const uri =
        String(info.uri || info.url || '');

    const youtubeMatch =
        uri.match(
            /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([A-Za-z0-9_-]{6,})/i,
        );

    if (youtubeMatch?.[1]) {
        return `https://i.ytimg.com/vi/${youtubeMatch[1]}/hqdefault.jpg`;
    }

    return null;
}

function getLoopLabel(loop) {
    switch (loop) {
        case 'track':
            return 'Track';
        case 'queue':
            return 'Queue';
        default:
            return 'Off';
    }
}

export function buildNowPlayingEmbed(track, player, guildData) {
    const requester = track?.info?.requester;
    const requesterLabel = requester
        ? (requester.username || requester.tag || 'Unknown')
        : 'Unknown';

    const position = formatDuration(player?.position || 0);
    const duration = formatDuration(track?.info?.length || 0);
    const title = track?.info?.title || 'Unknown track';
    const artist = track?.info?.author || 'Unknown';
    const queueLength = player?.queue?.length || 0;

    const embed = createEmbed({
        title: `${EMOJI_TITLE_LEFT} 𝓤𝓼𝓪𝓰𝓲 𝓜𝓾𝓼𝓲𝓬 ${EMOJI_TITLE_RIGHT}`,
        description: [
            `### ♪ ${title}`,
            `*${artist}*`,
            '',
            `\`━━━━━━━●━━\` **${position} / ${duration}**`,
            '',
            `${EMOJI_INFO} **Yêu cầu:** ${requesterLabel}`,
            `${EMOJI_VOLUME} **Âm lượng:** ${guildData?.volume ?? 75}%`,
            `${EMOJI_INFO} **Lặp lại:** ${getLoopLabel(guildData?.loop)}`,
            `${EMOJI_INFO} **Hàng chờ:** ${queueLength} bài`,
        ].join(String.fromCharCode(10)),
        color: 0xffb7d5,
        footer: player?.paused ? 'Paused' : 'Playing',
    });

    const artwork = getTrackArtwork(track);
    if (artwork) {
        embed.setThumbnail(artwork);
    }

    return embed;
}
export function buildQueueEmbed(queue, currentTrack, page = 0) {
    const totalTracks = queue?.length || 0;
    const totalPages = Math.max(1, Math.ceil(totalTracks / QUEUE_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = safePage * QUEUE_PAGE_SIZE;
    const slice = queue?.slice(start, start + QUEUE_PAGE_SIZE) || [];

    let description = '';
    if (currentTrack) {
        description += `**Now Playing**\n${currentTrack.info?.title || 'Unknown'} — ${currentTrack.info?.author || 'Unknown'}\n\n`;
    }

    if (slice.length === 0) {
        description += 'The queue is empty.';
    } else {
        description += slice
            .map((track, index) => {
                const num = start + index + 1;
                return `${num}. ${track.info?.title || 'Unknown'} — ${track.info?.author || 'Unknown'}`;
            })
            .join('\n');
    }

    return createEmbed({
        title: 'Music Queue',
        description: description.substring(0, 4096),
        color: 'info',
        footer: `Page ${safePage + 1} of ${totalPages} • ${totalTracks} queued`,
    });
}

export function buildPlayerButtonRows(player, guildData) {
    const paused = player?.paused;
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.PAUSE)
            .setLabel('Pause')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(BUTTON_HEART)
            .setDisabled(Boolean(paused)),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.RESUME)
            .setLabel('Resume')
            .setStyle(ButtonStyle.Success)
            .setEmoji(BUTTON_HEART)
            .setDisabled(!paused),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.SKIP)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(BUTTON_HEART),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.STOP)
            .setLabel('Stop')
            .setStyle(ButtonStyle.Danger)
            .setEmoji(BUTTON_HEART),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.SHUFFLE)
            .setLabel('Shuffle')
            .setStyle(guildData?.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji(BUTTON_HEART),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.LOOP)
            .setLabel('Loop')
            .setStyle(guildData?.loop !== 'none' ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji(BUTTON_HEART),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.VOL_DOWN)
            .setLabel('Vol -')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(BUTTON_VOLUME),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.VOL_UP)
            .setLabel('Vol +')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(BUTTON_VOLUME),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.QUEUE)
            .setLabel('Queue')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(BUTTON_HEART),
    );

    return [row1, row2];
}

export function buildQueuePaginationRow(page, totalPages) {
    return getPaginationRow('music_queue', page + 1, totalPages);
}

export function getQueuePageSize() {
    return QUEUE_PAGE_SIZE;
}
