import { createRequire } from 'module';
import { GatewayDispatchEvents } from 'discord.js';
import { logger } from '../../utils/logger.js';
import lavalinkConfig from '../../config/music/lavalink.js';
import { setupPlayerHandler } from './playerHandler.js';

const require = createRequire(import.meta.url);
const { Riffy } = require('riffy');

export function initializeMusic(client) {
    if (!lavalinkConfig.nodes?.length) {
        logger.error('No Lavalink nodes configured. Add lavalink/nodes.json, set LAVALINK_NODES, or set LAVALINK_HOST in your environment.');
        return;
    }

    client.riffy = new Riffy(client, lavalinkConfig.nodes, {
        send: (payload) => {
            const guildId = payload.d?.guild_id;
            if (!guildId) {
                return;
            }

            const guild = client.guilds.cache.get(guildId);
            if (guild?.shard) {
                guild.shard.send(payload);
                return;
            }

            const shardCount = client.ws.shards.size || 1;
            const shardId = Number((BigInt(guildId) >> 22n) % BigInt(shardCount));
            client.ws.shards.get(shardId)?.send(payload);
        },
        defaultSearchPlatform: lavalinkConfig.defaultSearchPlatform,
        restVersion: lavalinkConfig.restVersion,
        bypassChecks: {
            nodeFetchInfo: true,
        },
    });

    setupPlayerHandler(client);

    // Public nodes can remain websocket-connected while their loadtracks
    // endpoint is unhealthy. Try Riffy's own resolver against each connected
    // node so v4 responses are converted into Track objects correctly.
    const originalResolve = client.riffy.resolve.bind(client.riffy);
    const RESOLVE_NODE_TIMEOUT_MS = 10_000;

    client.riffy.resolve = async (options) => {
        const requestedQuery = String(options?.query || '');
        const isIndependentFallback = requestedQuery.toLowerCase().startsWith('scsearch:');

        const connectedNodes = [...client.riffy.nodeMap.values()]
            .filter((node) => node.connected)
            // Prefer healthy nodes. For independent SoundCloud recovery,
            // prefer a remote node over the private Railway node when health
            // is otherwise equal, so playback does not depend on one host.
            .sort((a, b) => {
                const failureDelta =
                    (a.__usagiResolveFailures || 0) -
                    (b.__usagiResolveFailures || 0);
                if (failureDelta !== 0) return failureDelta;

                if (isIndependentFallback) {
                    const aPrivate = a.name === 'Usagi Private' ? 1 : 0;
                    const bPrivate = b.name === 'Usagi Private' ? 1 : 0;
                    return aPrivate - bPrivate;
                }

                return 0;
            });

        if (!connectedNodes.length) {
            return originalResolve(options);
        }

        const failures = [];

        for (const node of connectedNodes) {
            try {
                const attempt = originalResolve({ ...options, node });
                const result = await Promise.race([
                    attempt,
                    new Promise((_, reject) => {
                        const timer = setTimeout(
                            () => reject(new Error(`Lavalink resolve timeout: ${node.name}`)),
                            RESOLVE_NODE_TIMEOUT_MS,
                        );
                        timer.unref?.();
                        attempt.finally(() => clearTimeout(timer)).catch(() => {});
                    }),
                ]);

                const loadType = String(result?.loadType || '').toLowerCase();
                const hasTracks = Array.isArray(result?.tracks) && result.tracks.length > 0;

                if (hasTracks) {
                    node.__usagiResolveFailures = 0;
                    node.__usagiLastResolveOk = Date.now();
                    return result;
                }

                node.__usagiResolveFailures = (node.__usagiResolveFailures || 0) + 1;
                failures.push(`${node.name}: ${loadType || 'empty'}`);
                logger.warn(
                    `Lavalink "${node.name}" returned no tracks (${loadType || 'empty'}), trying next node.`,
                );
            } catch (error) {
                node.__usagiResolveFailures = (node.__usagiResolveFailures || 0) + 1;
                failures.push(`${node.name}: ${error?.message || error}`);
                logger.warn(
                    `Lavalink resolve failed on "${node.name}", trying next node: ${error?.message || error}`,
                );
            }
        }

        logger.warn(`All Lavalink nodes returned no playable result: ${failures.join(' | ')}`);

        return {
            loadType: 'empty',
            exception: null,
            playlistInfo: null,
            pluginInfo: {},
            tracks: [],
        };
    };

    client.on('raw', (packet) => {
        if (
            ![
                GatewayDispatchEvents.VoiceStateUpdate,
                GatewayDispatchEvents.VoiceServerUpdate,
            ].includes(packet.t)
        ) {
            return;
        }
        client.riffy.updateVoiceState(packet);
    });

    client.riffy.on('playerError', (player, error) => {
        logger.error(`Music player error in guild ${player.guildId}:`, error);
    });

    logger.info(`Music initialized with ${lavalinkConfig.nodes.length} Lavalink node(s).`);
}

export function initRiffyAfterReady(client) {
    if (client.riffy && client.user?.id) {
        client.riffy.init(client.user.id);
        logger.info('Riffy voice connection manager initialized.');
    }
}
