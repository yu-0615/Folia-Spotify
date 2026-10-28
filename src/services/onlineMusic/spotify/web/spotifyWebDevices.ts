import type { ProviderPlaybackDevice } from '../../../../types/onlineMusic';
import { getStoredString, removeStoredKey, setStoredString } from '../../../../stores/storagePrimitives';
import { callSpotifyWeb } from './spotifyWebApi';

// src/services/onlineMusic/spotify/web/spotifyWebDevices.ts
// The Spotify Connect devices the web version can play on: this window's own player (the Web
// Playback SDK), or another device of the account on now (a phone, the Spotify app on a computer,
// a speaker), which Folia then controls through the Web API. The device chosen is kept in this
// browser; playing on it is spotifyWebPlayback.ts.

const CHOSEN_KEY = 'folia_spotify_web_device';

// GET /me/player/devices: `is_restricted` devices take no commands from the Web API.
interface WireDevice { id?: string | null; name?: string; type?: string; is_restricted?: boolean }

const THIS_WINDOW: ProviderPlaybackDevice = { id: null, name: 'Folia', kind: 'this' };
/** This window's own player (in the desktop app, the app's own). */
export const spotifyThisDevice = THIS_WINDOW;

const KINDS: Record<string, ProviderPlaybackDevice['kind']> = {
    computer: 'computer', smartphone: 'phone', tablet: 'phone',
    speaker: 'speaker', avr: 'speaker', stb: 'speaker', audiodongle: 'speaker', castaudio: 'speaker', automobile: 'speaker',
    tv: 'tv', castvideo: 'tv', gameconsole: 'tv',
};

const readChosen = (): ProviderPlaybackDevice => {
    try {
        const kept = JSON.parse(getStoredString(CHOSEN_KEY, 'null')) as ProviderPlaybackDevice | null;
        return kept?.id && kept.name ? { id: kept.id, name: kept.name, kind: kept.kind ?? 'other' } : THIS_WINDOW;
    } catch {
        return THIS_WINDOW;
    }
};

let chosen = readChosen();
const listeners = new Set<() => void>();

/** The device chosen: this window's own player (id null) until another is chosen. */
export const chosenSpotifyWebDevice = (): ProviderPlaybackDevice => chosen;

/** Keeps `device` as the one chosen, and tells those listening. */
export const keepChosenSpotifyWebDevice = (device: ProviderPlaybackDevice): void => {
    chosen = device.id === null ? THIS_WINDOW : { id: device.id, name: device.name, kind: device.kind };
    if (chosen.id === null) removeStoredKey(CHOSEN_KEY);
    else setStoredString(CHOSEN_KEY, JSON.stringify(chosen));
    console.log(`[Spotify] Web playback device: ${chosen.id === null ? 'this window' : chosen.kind}`);
    listeners.forEach(listener => listener());
};

export const subscribeSpotifyWebDevice = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/**
 * This window's own player, then the account's other devices on now that take commands. The
 * player of this window is left out of the others (`ownDeviceId`), where it is connected.
 */
export const listSpotifyWebDevices = async (ownDeviceId: string | null): Promise<ProviderPlaybackDevice[]> => {
    const answer = await callSpotifyWeb<{ devices?: WireDevice[] }>('/me/player/devices');
    const others = (answer?.devices ?? [])
        .filter(device => device.id && device.id !== ownDeviceId && !device.is_restricted)
        .map(device => ({
            id: device.id as string,
            name: device.name || device.type || 'Spotify',
            kind: KINDS[(device.type ?? '').toLowerCase()] ?? 'other',
        }));
    return [THIS_WINDOW, ...others];
};
