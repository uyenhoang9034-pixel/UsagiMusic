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

    // Riffy normally resolves through one node. Public Lavalink nodes can stay
    // websocket-connected while their REST/loadtracks endpoint is unhealthy.
    // Wrap resolve so every /play can fail over across the currently connected
    // nodes instead of hanging on that one node.
    const originalResolve = client.riffy.resolve.bind(client.riffy);
    const RESOLVE_NODE_TIMEOUT_MS = 7_000;

    client.riffy.resolve = async (options) => {
        const connectedNodes = [...client.riffy.nodeMap.values()]
            .filter((node) => node.connected);

        if (!connectedNodes.length) {
            return originalResolve(options);
        }

        const errors = [];

        for (const node of connectedNodes) {
            try {
                const attempt = node.rest.resolve(options.query);
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

                if (result) {
                    // Keep requester metadata compatible with Riffy's normal
                    // resolve() output.
                    if (Array.isArray(result.tracks)) {
                        for (const track of result.tracks) {
                            track.info ??= {};
                            track.info.requester = options.requester;
                        }
                    }
                    return result;
                }
            } catch (error) {
                errors.push(`${node.name}: ${error?.message || error}`);
                logger.warn(
                    `Lavalink resolve failed on "${node.name}", trying next node: ${error?.message || error}`,
                );
            }
        }

        throw new Error(
            `All connected Lavalink nodes failed to resolve the request. ${errors.join(' | ')}`,
        );
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
