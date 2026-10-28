import type { OnlineMusicProvider } from '../../../types/onlineMusic';
import { spotifyProvider } from './spotifyProvider';
import { getSpotifyTransportAvailability } from './spotifyTransport';
import { spotifyWebProvider } from './web/spotifyWebProvider';

// src/services/onlineMusic/spotify/spotifyRuntimeProvider.ts
// The Spotify adapter this build registers: the desktop one where the desktop app's bridge is there;
// in a browser the web one (spotify/web/), which asks for the listener's own Spotify app at sign-in;
// and without either (the unit tests) the desktop one, which says it needs the desktop app.
// Both are the provider `spotify`, with the same songs and collections. Asked at every use rather
// than once at load: in the app the answer never changes, and a test that sets up the desktop bridge
// after the modules load gets the desktop adapter.

const current = (): OnlineMusicProvider => (
    !getSpotifyTransportAvailability().configured && typeof window !== 'undefined' ? spotifyWebProvider : spotifyProvider
);

export const spotifyRuntimeProvider: OnlineMusicProvider = new Proxy(spotifyProvider, {
    get: (_target, key) => Reflect.get(current(), key),
    has: (_target, key) => Reflect.has(current(), key),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(current(), key);
        return descriptor && { ...descriptor, configurable: true };
    },
});
