// Per-guild music session state (in-memory). Adapted from Musicify playerStore (Apache-2.0).

export class GuildMusicData {
    constructor() {
        this.playerMessageId = null;
        this.playerChannelId = null;
        this.autoplay = false;
        this.loop = 'none';
        this.volume = 75;
        this.shuffle = false;
        this.previousTracks = [];
        this.twentyFourSeven = false;
        this.queuePages = new Map();
        this.updateInterval = null;
        this.idleTimeout = null;
        this.autoPaused = false;
        this.stopConfirmPending = null;
    }
}

export function clearUpdateInterval(guildData) {
    if (guildData.updateInterval) {
        clearInterval(guildData.updateInterval);
        guildData.updateInterval = null;
    }
}

const fallbackGuildStore = new Map();

export function getGuildMusicData(guildId, client) {
    if (client) {
        if (!client._guildMusicStore) {
            client._guildMusicStore = new Map();
        }
        if (!client._guildMusicStore.has(guildId)) {
            client._guildMusicStore.set(guildId, new GuildMusicData());
        }
        return client._guildMusicStore.get(guildId);
    }

    if (!fallbackGuildStore.has(guildId)) {
        fallbackGuildStore.set(guildId, new GuildMusicData());
    }
    return fallbackGuildStore.get(guildId);
}

export function deleteGuildMusicData(guildId, client) {
    if (client?._guildMusicStore) {
        const guildData = client._guildMusicStore.get(guildId);
        if (guildData) {
            clearUpdateInterval(guildData);
            if (guildData.idleTimeout) {
                clearTimeout(guildData.idleTimeout);
            }
        }
        client._guildMusicStore.delete(guildId);
    }

    const fallbackData = fallbackGuildStore.get(guildId);
    if (fallbackData) {
        clearUpdateInterval(fallbackData);
        if (fallbackData.idleTimeout) {
            clearTimeout(fallbackData.idleTimeout);
        }
        fallbackGuildStore.delete(guildId);
    }
}

