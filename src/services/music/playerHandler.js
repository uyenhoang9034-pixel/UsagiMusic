// Player event handlers for Riffy.
// Adapted from Musicify playerHandler (Apache-2.0).

import { logger } from '../../utils/logger.js';
import {
    getGuildMusicData,
    clearUpdateInterval,
} from './playerStore.js';

import {
    buildNowPlayingEmbed,
    buildPlayerButtonRows,
} from './musicEmbeds.js';

const UPDATE_INTERVAL_MS = 15 * 1000;
const IDLE_DISCONNECT_MS = 30 * 1000;

/**
 * =========================================================
 * MUSIC PLAYER MESSAGE
 * =========================================================
 */

async function editOrSendPlayerMessage(
    client,
    guildData,
    channelId,
    embed,
    components,
) {
    if (!channelId) {
        return;
    }

    const channel =
        client.channels.cache.get(
            channelId,
        );

    if (!channel) {
        guildData.playerMessageId = null;
        guildData.playerChannelId = null;

        clearUpdateInterval(
            guildData,
        );

        return;
    }

    const payload = {
        embeds: [embed],
        components,
    };

    /**
     * Try to edit the existing Music message.
     */
    if (guildData.playerMessageId) {
        try {
            const msg =
                await channel.messages.fetch(
                    guildData.playerMessageId,
                );

            await msg.edit(payload);

            return;
        } catch {
            guildData.playerMessageId = null;
            guildData.playerChannelId = null;

            clearUpdateInterval(
                guildData,
            );
        }
    }

    /**
     * Create a new Music player message.
     */
    try {
        const newMsg =
            await channel.send(payload);

        guildData.playerMessageId =
            newMsg.id;

        guildData.playerChannelId =
            channel.id;
    } catch (error) {
        logger.error(
            'Failed to send music player message:',
            error,
        );
    }
}

/**
 * =========================================================
 * REFRESH MUSIC PLAYER MESSAGE
 * =========================================================
 */

export async function refreshPlayerMessage(
    client,
    guildId,
) {
    try {
        const player =
            client.riffy?.players?.get(
                guildId,
            );

        if (
            !player ||
            !player.current
        ) {
            return;
        }

        const guildData =
            getGuildMusicData(
                guildId,
            );

        const embed =
            buildNowPlayingEmbed(
                player.current,
                player,
                guildData,
            );

        const components =
            buildPlayerButtonRows(
                player,
                guildData,
            );

        const channelId =
            guildData.playerChannelId ||
            player.textChannel;

        await editOrSendPlayerMessage(
            client,
            guildData,
            channelId,
            embed,
            components,
        );
    } catch (error) {
        logger.error(
            'Failed to refresh music player message:',
            error,
        );
    }
}

/**
 * =========================================================
 * MUSIC UPDATE INTERVAL
 * =========================================================
 */

function startUpdateInterval(
    client,
    guildId,
) {
    const guildData =
        getGuildMusicData(
            guildId,
        );

    clearUpdateInterval(
        guildData,
    );

    guildData.updateInterval =
        setInterval(
            () => {
                refreshPlayerMessage(
                    client,
                    guildId,
                );
            },
            UPDATE_INTERVAL_MS,
        );
}

/**
 * =========================================================
 * SETUP MUSIC PLAYER EVENTS
 * =========================================================
 */

export function setupPlayerHandler(
    client,
) {
    if (!client.riffy) {
        logger.warn(
            'Riffy not initialized; music player handlers not attached.',
        );

        return;
    }

    /**
     * =====================================================
     * LAVALINK NODE LOGGING
     * =====================================================
     */

    const nodeLogState =
        new Map();

    const NODE_LOG_INTERVAL_MS =
        5 * 60 * 1000;

    const shouldLogNodeEvent = (
        nodeName,
    ) => {
        const previous =
            nodeLogState.get(
                nodeName,
            ) ?? {
                lastLogAt: 0,
                hasConnected: false,
            };

        const now =
            Date.now();

        if (
            now -
                previous.lastLogAt <
            NODE_LOG_INTERVAL_MS
        ) {
            return false;
        }

        nodeLogState.set(
            nodeName,
            {
                ...previous,
                lastLogAt: now,
            },
        );

        return true;
    };

    const markNodeConnected = (
        nodeName,
    ) => {
        const previous =
            nodeLogState.get(
                nodeName,
            ) ?? {
                lastLogAt: 0,
                hasConnected: false,
            };

        nodeLogState.set(
            nodeName,
            {
                ...previous,
                hasConnected: true,
            },
        );
    };

    client.riffy.on(
        'nodeConnect',
        (node) => {
            const previous =
                nodeLogState.get(
                    node.name,
                ) ?? {
                    lastLogAt: 0,
                    hasConnected: false,
                };

            if (
                previous.hasConnected
            ) {
                return;
            }

            markNodeConnected(
                node.name,
            );

            logger.info(
                `Lavalink node "${node.name}" connected.`,
            );
        },
    );

    client.riffy.on(
        'nodeReconnect',
        () => {
            /**
             * Intentionally silent.
             */
        },
    );

    client.riffy.on(
        'nodeError',
        (
            node,
            error,
        ) => {
            if (
                !shouldLogNodeEvent(
                    node.name,
                )
            ) {
                return;
            }

            logger.warn(
                `Lavalink node "${node.name}" error: ${
                    error?.message ||
                    error
                }`,
            );
        },
    );

    client.riffy.on(
        'nodeDisconnect',
        (node) => {
            if (
                !shouldLogNodeEvent(
                    node.name,
                )
            ) {
                return;
            }

            logger.warn(
                `Lavalink node "${node.name}" disconnected.`,
            );
        },
    );

    /**
     * =====================================================
     * TRACK START
     * =====================================================
     */

    client.riffy.on(
        'trackStart',
        async (
            player,
            track,
        ) => {
            try {
                const guildData =
                    getGuildMusicData(
                        player.guildId,
                    );

                /**
                 * Keep Lavalink loop mode
                 * synchronized with Music settings.
                 */
                if (
                    guildData.loop &&
                    player.loop !==
                        guildData.loop
                ) {
                    player.setLoop(
                        guildData.loop,
                    );
                }

                /**
                 * Save previous Music tracks.
                 */
                if (
                    player.previous
                ) {
                    guildData.previousTracks.push(
                        player.previous,
                    );

                    if (
                        guildData
                            .previousTracks
                            .length > 20
                    ) {
                        guildData.previousTracks.shift();
                    }
                }

                /**
                 * Cancel idle disconnect.
                 */
                if (
                    guildData.idleTimeout
                ) {
                    clearTimeout(
                        guildData.idleTimeout,
                    );

                    guildData.idleTimeout =
                        null;
                }

                /**
                 * Build Music dashboard.
                 */
                const embed =
                    buildNowPlayingEmbed(
                        track,
                        player,
                        guildData,
                    );

                const components =
                    buildPlayerButtonRows(
                        player,
                        guildData,
                    );

                const channelId =
                    guildData.playerChannelId ||
                    player.textChannel;

                await editOrSendPlayerMessage(
                    client,
                    guildData,
                    channelId,
                    embed,
                    components,
                );

                startUpdateInterval(
                    client,
                    player.guildId,
                );
            } catch (error) {
                logger.error(
                    'Music trackStart error:',
                    error,
                );
            }
        },
    );

    /**
     * =====================================================
     * QUEUE END
     * =====================================================
     */

    client.riffy.on(
        'queueEnd',
        async (player) => {
            try {
                const guildData =
                    getGuildMusicData(
                        player.guildId,
                    );

                clearUpdateInterval(
                    guildData,
                );

                /**
                 * Music autoplay.
                 */
                if (
                    guildData.autoplay
                ) {
                    try {
                        player.autoplay(
                            player,
                        );
                    } catch (error) {
                        logger.error(
                            'Music autoplay error:',
                            error,
                        );
                    }

                    return;
                }

                /**
                 * Delete Music dashboard.
                 */
                if (
                    guildData.playerMessageId &&
                    guildData.playerChannelId
                ) {
                    try {
                        const channel =
                            client.channels.cache.get(
                                guildData.playerChannelId,
                            );

                        if (channel) {
                            const msg =
                                await channel.messages.fetch(
                                    guildData.playerMessageId,
                                );

                            await msg.delete();
                        }
                    } catch {
                        /**
                         * Message already deleted.
                         */
                    }

                    guildData.playerMessageId =
                        null;

                    guildData.playerChannelId =
                        null;
                }

                /**
                 * Schedule Music player
                 * disconnect when idle.
                 */
                if (
                    !guildData.twentyFourSeven
                ) {
                    if (
                        guildData.idleTimeout
                    ) {
                        clearTimeout(
                            guildData.idleTimeout,
                        );
                    }

                    guildData.idleTimeout =
                        setTimeout(
                            () => {
                                try {
                                    const currentPlayer =
                                        client.riffy.players.get(
                                            player.guildId,
                                        );

                                    if (
                                        currentPlayer &&
                                        !currentPlayer.playing &&
                                        !currentPlayer.paused &&
                                        !currentPlayer.current
                                    ) {
                                        currentPlayer.destroy();
                                    }
                                } catch {
                                    /**
                                     * Player already destroyed.
                                     */
                                }

                                guildData.idleTimeout =
                                    null;
                            },
                            IDLE_DISCONNECT_MS,
                        );
                }
            } catch (error) {
                logger.error(
                    'Music queueEnd error:',
                    error,
                );
            }
        },
    );

    /**
     * =====================================================
     * PLAYER DISCONNECT
     * =====================================================
     */

    client.riffy.on(
        'playerDisconnect',
        async (player) => {
            try {
                const guildData =
                    getGuildMusicData(
                        player.guildId,
                    );

                clearUpdateInterval(
                    guildData,
                );

                if (
                    guildData.playerMessageId &&
                    guildData.playerChannelId
                ) {
                    try {
                        const channel =
                            client.channels.cache.get(
                                guildData.playerChannelId,
                            );

                        if (channel) {
                            const msg =
                                await channel.messages.fetch(
                                    guildData.playerMessageId,
                                );

                            await msg.delete();
                        }
                    } catch {
                        /**
                         * Message already deleted.
                         */
                    }
                }

                guildData.playerMessageId =
                    null;

                guildData.playerChannelId =
                    null;

                guildData.previousTracks =
                    [];

                guildData.autoPaused =
                    false;

                if (
                    guildData.idleTimeout
                ) {
                    clearTimeout(
                        guildData.idleTimeout,
                    );

                    guildData.idleTimeout =
                        null;
                }
            } catch (error) {
                logger.error(
                    'Music playerDisconnect error:',
                    error,
                );
            }
        },
    );

    /**
     * =====================================================
     * TRACK ERROR
     * =====================================================
     */

    client.riffy.on(
        'trackError',
        async (
            player,
            track,
            payload,
        ) => {
            try {
                const guildData =
                    getGuildMusicData(
                        player.guildId,
                    );

                const title =
                    track?.info?.title ||
                    'Unknown track';

                logger.error(
                    `Track error in ${player.guildId} for "${title}":`,
                    payload?.error ||
                        payload,
                );

                // Retry only once. This prevents an endless fallback loop.
                if (!track?.info?.__usagiFallbackTried) {
                    try {
                        const author =
                            track?.info?.author ||
                            '';

                        const fallbackResult =
                            await client.riffy.resolve({
                                query:
                                    `scsearch:${title} ${author}`.trim(),
                                requester:
                                    track?.info?.requester ||
                                    null,
                            });

                        const fallbackTrack =
                            Array.isArray(
                                fallbackResult?.tracks,
                            )
                                ? fallbackResult.tracks[0]
                                : null;

                        if (fallbackTrack) {
                            fallbackTrack.info ??= {};
                            fallbackTrack.info.requester =
                                track?.info?.requester ||
                                null;
                            fallbackTrack.info.__usagiFallbackTried =
                                true;

                            if (
                                typeof player.queue?.add ===
                                'function'
                            ) {
                                player.queue.add(
                                    fallbackTrack,
                                );
                            } else {
                                player.queue?.push?.(
                                    fallbackTrack,
                                );
                            }

                            player.stop();

                            const channel =
                                client.channels.cache.get(
                                    guildData.playerChannelId ||
                                        player.textChannel,
                                );

                            await channel
                                ?.send(
                                    `YouTube source failed for **${title}** — trying another audio source automatically...`,
                                )
                                .catch(() => null);

                            return;
                        }
                    } catch (fallbackError) {
                        logger.warn(
                            `Music fallback failed for "${title}":`,
                            fallbackError,
                        );
                    }
                }

                const channel =
                    client.channels.cache.get(
                        guildData.playerChannelId ||
                            player.textChannel,
                    );

                await channel
                    ?.send(
                        `Failed to play **${title}**. Skipping...`,
                    )
                    .catch(() => null);
            } catch (error) {
                logger.error(
                    'Music trackError handler error:',
                    error,
                );
            }
        },
    );

    /**
     * =====================================================
     * TRACK STUCK
     * =====================================================
     */

    client.riffy.on(
        'trackStuck',
        async (
            player,
            track,
            payload,
        ) => {
            logger.warn(
                `Track stuck in ${player.guildId} for "${
                    track?.info?.title ||
                    'Unknown track'
                }" (${
                    payload?.thresholdMs ||
                    'unknown'
                }ms)`,
            );
        },
    );

    logger.info(
        'Music player event handlers attached.',
    );
}

/**
 * =========================================================
 * SHUTDOWN MUSIC
 * =========================================================
 */

export async function shutdownMusic(
    client,
) {
    if (
        !client.riffy?.players
    ) {
        return;
    }

    for (
        const player of
            client.riffy.players.values()
    ) {
        try {
            player.destroy();
        } catch (error) {
            logger.debug(
                'Error destroying music player during shutdown:',
                error?.message ||
                    error,
            );
        }
    }
}
