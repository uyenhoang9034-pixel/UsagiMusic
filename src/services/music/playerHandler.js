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
     * TRACK ERROR / STUCK RECOVERY
     * =====================================================
     */

    const recoveringGuilds = new Set();

    const continueAfterTrackFailure = async (
        player,
        track,
        reason = 'error',
    ) => {
        const guildId = player.guildId;
        if (recoveringGuilds.has(guildId)) return;

        recoveringGuilds.add(guildId);

        try {
            const guildData = getGuildMusicData(guildId);
            const title = track?.info?.title || 'Unknown track';
            const author = track?.info?.author || '';
            const requester = track?.info?.requester || null;

            // A TrackException means the node that is ACTUALLY playing the
            // track is unhealthy for this source. Resolving on another node
            // without moving the player does nothing, because Riffy players
            // are bound to one node. Riffy 1.0.12 has native player migration;
            // use it and resolve the replacement on that same destination.
            player.__usagiFailedNodes ??= new Set();
            if (player.node?.name) {
                player.__usagiFailedNodes.add(player.node.name);
                player.node.__usagiPlaybackFailures =
                    (player.node.__usagiPlaybackFailures || 0) + 1;
            }

            const destinations = [...client.riffy.nodeMap.values()]
                .filter((node) =>
                    node.connected &&
                    node !== player.node &&
                    !player.__usagiFailedNodes.has(node.name)
                )
                .sort((a, b) =>
                    (a.__usagiPlaybackFailures || 0) -
                    (b.__usagiPlaybackFailures || 0)
                );

            let recovered = false;
            let lastError = null;

            for (const destination of destinations) {
                try {
                    logger.warn(
                        `Playback failed on "${player.node?.name || 'unknown'}"; migrating ${guildId} to "${destination.name}".`,
                    );

                    await client.riffy.migrate(player, destination);

                    // moveTo() preserves the old current track. Stop it before
                    // starting a newly encoded replacement on this node.
                    try {
                        player.stop();
                    } catch {}

                    const queries = [
                        `scsearch:${title} ${author}`.trim(),
                        `ytmsearch:${title} ${author}`.trim(),
                        `ytsearch:${title} ${author}`.trim(),
                    ];

                    let replacement = null;
                    for (const query of queries) {
                        const result = await client.riffy.resolve({
                            query,
                            requester,
                            node: destination,
                            __usagiNodeOnly: true,
                        });

                        replacement = Array.isArray(result?.tracks)
                            ? result.tracks[0]
                            : null;

                        if (replacement) break;
                    }

                    if (!replacement) {
                        throw new Error('destination returned no replacement track');
                    }

                    replacement.info ??= {};
                    replacement.info.requester = requester;

                    // Put recovery ahead of the existing queue.
                    if (typeof player.queue?.unshift === 'function') {
                        player.queue.unshift(replacement);
                    } else if (typeof player.queue?.add === 'function') {
                        player.queue.add(replacement);
                    } else {
                        player.queue.push(replacement);
                    }

                    // Riffy's TrackException handler calls stop() immediately
                    // after emitting our event. Let that finish first.
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    await player.play();

                    recovered = true;
                    logger.warn(
                        `Recovered "${title}" by moving playback to "${destination.name}".`,
                    );
                    break;
                } catch (error) {
                    lastError = error;
                    destination.__usagiPlaybackFailures =
                        (destination.__usagiPlaybackFailures || 0) + 1;
                    player.__usagiFailedNodes.add(destination.name);
                    logger.warn(
                        `Playback recovery failed on "${destination.name}" for "${title}": ${error?.message || error}`,
                    );
                }
            }

            if (recovered) return;

            // No node could recover this track. Continue any real queued song
            // rather than crashing the worker or repeatedly retrying the same
            // broken source.
            await new Promise((resolve) => setTimeout(resolve, 350));
            const hasNext = Number(player.queue?.length || 0) > 0;

            if (hasNext) {
                try {
                    await player.play();
                } catch (playError) {
                    logger.warn(
                        `Could not continue queue after "${title}" failed: ${playError?.message || playError}`,
                    );
                }
            }

            const channel = client.channels.cache.get(
                guildData.playerChannelId || player.textChannel,
            );

            await channel
                ?.send(
                    hasNext
                        ? `Không phát được **${title}** — đã tự chuyển sang bài tiếp theo.`
                        : `Không phát được **${title}** trên các nguồn hiện có — hàng chờ đã hết.`,
                )
                .catch(() => null);

            logger.warn(
                `All playback nodes failed for "${title}" (${reason})${lastError ? `: ${lastError.message || lastError}` : ''}.`,
            );
        } finally {
            recoveringGuilds.delete(guildId);
        }
    };

    client.riffy.on(
        'trackError',
        (player, track, payload) => {
            logger.error(
                `Track error in ${player.guildId} for "${track?.info?.title || 'Unknown track'}":`,
                payload?.error || payload,
            );

            void continueAfterTrackFailure(
                player,
                track,
                'error',
            );
        },
    );

    client.riffy.on(
        'trackStuck',
        (player, track, payload) => {
            logger.warn(
                `Track stuck in ${player.guildId} for "${track?.info?.title || 'Unknown track'}" (${payload?.thresholdMs || 'unknown'}ms)`,
            );

            void continueAfterTrackFailure(
                player,
                track,
                'stuck',
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
