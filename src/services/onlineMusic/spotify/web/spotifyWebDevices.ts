import { OnlineProviderError } from '../../../../types/onlineMusic';
import type { ProviderPlaybackDevice } from '../../../../types/onlineMusic';
import { getStoredString, setStoredString } from '../../../../stores/storagePrimitives';
import { callSpotifyWeb } from './spotifyWebApi';

// src/services/onlineMusic/spotify/web/spotifyWebDevices.ts
// The Spotify Connect device the songs sound on: always one of the account's own Spotify apps (a
// phone, the Spotify app on a computer, a speaker), which Folia controls through the Web API. Nothing
// is chosen here: it is the device Spotify plays on now, as last seen (the listener moves the playback
// in a Spotify app), and with none playing, the one last seen, else a computer, else any on now.
// The device last seen is kept in this browser; playing on it is spotifyWebPlayback.ts.

const DEVICE_KEY = 'folia_spotify_web_device';

// GET /me/player/devices, and the device of GET /me/player: `is_restricted` devices take no
// commands from the Web API.
export interface WireDevice { id?: string | null; name?: string; type?: string; is_restricted?: boolean }

const KINDS: Record<string, ProviderPlaybackDevice['kind']> = {
    computer: 'computer', smartphone: 'phone', tablet: 'phone',
    speaker: 'speaker', avr: 'speaker', stb: 'speaker', audiodongle: 'speaker', castaudio: 'speaker', automobile: 'speaker',
    tv: 'tv', castvideo: 'tv', gameconsole: 'tv',
};

const deviceOf = (wire: WireDevice | null | undefined): ProviderPlaybackDevice | null => (
    wire?.id && !wire.is_restricted
        ? { id: wire.id, name: wire.name || wire.type || 'Spotify', kind: KINDS[(wire.type ?? '').toLowerCase()] ?? 'other' }
        : null
);

const readKept = (): ProviderPlaybackDevice | null => {
    try {
        const kept = JSON.parse(getStoredString(DEVICE_KEY, 'null')) as ProviderPlaybackDevice | null;
        return kept?.id && kept.name ? { id: kept.id, name: kept.name, kind: kept.kind ?? 'other' } : null;
    } catch {
        return null;
    }
};

let current = readKept();
const listeners = new Set<() => void>();

/** The device the songs sound on, as last seen; null before one is seen. */
export const currentSpotifyWebDevice = (): ProviderPlaybackDevice | null => current;

/** Spotify said it plays on `wire`: it is kept as the device, and those listening are told of a new one. */
export const noteSpotifyWebDevice = (wire: WireDevice | null | undefined): ProviderPlaybackDevice | null => {
    const device = deviceOf(wire);
    if (!device || (device.id === current?.id && device.name === current.name)) return device;
    current = device;
    setStoredString(DEVICE_KEY, JSON.stringify(device));
    console.log(`[Spotify] Plays on a ${device.kind} now`);
    listeners.forEach(listener => listener());
    return device;
};

export const subscribeSpotifyWebDevice = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/**
 * The device to play on now: the one Spotify plays on, else the one last seen if it is on, else a
 * computer that is on, else any device on. Without a Spotify app open anywhere, there is none.
 */
export const findSpotifyWebDevice = async (): Promise<ProviderPlaybackDevice> => {
    const playing = noteSpotifyWebDevice((await callSpotifyWeb<{ device?: WireDevice } | undefined>('/me/player'))?.device);
    if (playing) return playing;
    const on = ((await callSpotifyWeb<{ devices?: WireDevice[] }>('/me/player/devices'))?.devices ?? []).filter(device => deviceOf(device));
    const wire = on.find(device => device.id === current?.id)
        ?? on.find(device => (device.type ?? '').toLowerCase() === 'computer')
        ?? on[0];
    const device = noteSpotifyWebDevice(wire);
    if (!device) throw new OnlineProviderError('unavailable', 'Spotify is not open on any device', 'spotify', 'no-device');
    return device;
};
