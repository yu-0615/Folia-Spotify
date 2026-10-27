import { OnlineProviderError } from '../../../../types/onlineMusic';
import type { ProviderNotice } from '../../../../types/onlineMusic';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { spotifyWebAccessToken } from './spotifyWebAuth';
import { callSpotifyWeb } from './spotifyWebApi';

// src/services/onlineMusic/spotify/web/spotifyWebPlayback.ts
// The web version plays Spotify through Spotify's Web Playback SDK, which sounds protected audio in
// a frame of its own and gives no URL. So the app's deck is handed a stand-in instead
// (`ProviderAudioSource.standIn`): silence exactly as long as the song. The deck stays the clock of
// the song, and the player here follows it: a deck that starts playing a stand-in has the player
// start that track at the deck's time; pausing, seeking and ending the deck do the same to the
// player; and every few seconds the player is put back where the deck is, if it has drifted.
// The decks are found by their media events, caught on the document (`data-playback-deck`, App.tsx).
// What follows from it: the visualizer and automix see silence, and nothing of the song is stored.

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const PLAYER_NAME = 'Folia';
const CONNECT_LIMIT_MS = 15_000;
// The stand-in's sound: 8-bit mono at 8 kHz, 8 KB a second (2.4 MB for five minutes).
const SAMPLE_RATE = 8000;
const KEPT_STAND_INS = 4;
// How far the player may be from the deck before it is moved, and how often that is looked at.
const DRIFT_MS = 800;
const DRIFT_CHECK_MS = 2000;
// After a command, the player's state is not read as its own doing for this long.
const SETTLE_MS = 4000;
// Spotify may not know the player for a moment after it is ready: a start is asked again this often.
const START_TRIES = 3;
const START_RETRY_MS = 1000;

interface SdkTrack { id: string | null; linked_from?: { id: string | null } }
interface SdkState { paused: boolean; position: number; track_window: { current_track: SdkTrack } }
interface SdkError { message: string }
interface SdkPlayer {
    connect(): Promise<boolean>;
    disconnect(): void;
    addListener(event: 'ready' | 'not_ready', listener: (device: { device_id: string }) => void): boolean;
    addListener(event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error', listener: (error: SdkError) => void): boolean;
    addListener(event: 'player_state_changed', listener: (state: SdkState | null) => void): boolean;
    getCurrentState(): Promise<SdkState | null>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    setVolume(volume: number): Promise<void>;
    activateElement(): Promise<void>;
}
interface SdkNamespace {
    Player: new (options: { name: string; getOAuthToken: (give: (token: string) => void) => void; volume?: number }) => SdkPlayer;
}
type SdkWindow = Window & { Spotify?: SdkNamespace; onSpotifyWebPlaybackSDKReady?: () => void };
interface Connected { player: SdkPlayer; deviceId: string }

let tell: ((notice: ProviderNotice) => void) | null = null;
let installed = false;
let sdkLoading: Promise<SdkNamespace> | null = null;
let connecting: Promise<Connected> | null = null;
let connected: Connected | null = null;
let activated = false;
// The deck the player follows, and the track the player was last told to play.
let deck: HTMLMediaElement | null = null;
let playingTrack: string | null = null;
let lastCommandAt = 0;
let driftTimer: ReturnType<typeof setInterval> | null = null;
// The deck's events are answered one after another.
let turn: Promise<void> = Promise.resolve();
// Stand-in URL → Spotify track id, oldest first.
const standIns = new Map<string, string>();

const volumeNow = (): number => {
    const { volume, isMuted } = useAudioSettingsStore.getState();
    return isMuted ? 0 : Math.min(1, Math.max(0, Number(volume) || 0));
};

const loadSdk = (): Promise<SdkNamespace> => {
    if (sdkLoading) return sdkLoading;
    const loading = new Promise<SdkNamespace>((resolve, reject) => {
        const sdkWindow = window as SdkWindow;
        if (sdkWindow.Spotify) {
            resolve(sdkWindow.Spotify);
            return;
        }
        sdkWindow.onSpotifyWebPlaybackSDKReady = () => {
            if (sdkWindow.Spotify) resolve(sdkWindow.Spotify);
            else reject(new OnlineProviderError('unavailable', 'The Spotify player did not load', 'spotify'));
        };
        const script = document.createElement('script');
        script.src = SDK_URL;
        script.async = true;
        script.onerror = () => {
            script.remove();
            reject(new OnlineProviderError('network', 'The Spotify player could not be loaded', 'spotify'));
        };
        document.head.appendChild(script);
    });
    sdkLoading = loading;
    loading.catch(() => { if (sdkLoading === loading) sdkLoading = null; });
    return loading;
};

// The player is dropped after an error that ends it; the next song connects a new one.
const dropPlayer = (player: SdkPlayer): void => {
    if (connected?.player === player) connected = null;
    player.disconnect();
};

const connect = async (): Promise<Connected> => {
    const Sdk = await loadSdk();
    return new Promise<Connected>((resolve, reject) => {
        let settled = false;
        let ended = false;
        const player = new Sdk.Player({
            name: PLAYER_NAME,
            volume: volumeNow(),
            getOAuthToken: (give) => {
                spotifyWebAccessToken().then(give, error => console.warn('[Spotify] Web player has no token', error));
            },
        });
        const timer = setTimeout(() => fail(new OnlineProviderError('network', 'The Spotify player did not start in time', 'spotify')), CONNECT_LIMIT_MS);
        // Before the player is ready, an error is the answer to the song that asked for it; after,
        // it ends the player, and the song playing is stopped with a notice. The SDK can follow one
        // error with others (a player that cannot start also fails its sign-in and its connect):
        // the first ends the player, and the rest are not told.
        const fail = (error: OnlineProviderError) => {
            if (ended) return;
            ended = true;
            clearTimeout(timer);
            if (!settled) {
                settled = true;
                player.disconnect();
                reject(error);
                return;
            }
            console.warn(`[Spotify] Web player stopped: ${error.message}`, error);
            dropPlayer(player);
            stopDeck(error);
        };
        player.addListener('ready', ({ device_id }) => {
            if (settled) {
                if (connected?.player === player) connected.deviceId = device_id;
                return;
            }
            settled = true;
            clearTimeout(timer);
            console.log('[Spotify] Web player is ready');
            resolve({ player, deviceId: device_id });
        });
        player.addListener('not_ready', () => console.warn('[Spotify] Web player went offline'));
        player.addListener('initialization_error', ({ message }) => fail(new OnlineProviderError('unavailable', 'This browser cannot play Spotify', 'spotify', message)));
        player.addListener('authentication_error', ({ message }) => fail(new OnlineProviderError('auth-required', 'Spotify did not accept the sign-in for playback', 'spotify', message)));
        player.addListener('account_error', ({ message }) => fail(new OnlineProviderError('subscription-required', 'Spotify plays for Premium accounts only', 'spotify', message)));
        player.addListener('playback_error', ({ message }) => console.warn(`[Spotify] Web player could not play: ${message}`));
        player.connect().then((ok) => {
            if (!ok) fail(new OnlineProviderError('unavailable', 'The Spotify player did not connect', 'spotify'));
        }, () => fail(new OnlineProviderError('unavailable', 'The Spotify player did not connect', 'spotify')));
    });
};

/**
 * The player, connected. Asked before a song's stand-in is handed out, so that a browser that
 * cannot play Spotify, or an account without Premium, is told as the song's failure.
 */
export const ensureSpotifyWebPlayer = async (): Promise<Connected> => {
    install();
    if (connected) return connected;
    if (!connecting) {
        connecting = connect()
            .then((made) => {
                connected = made;
                // Within the click that asked for the song, this lets the player's frame sound.
                made.player.activateElement().then(() => { activated = true; }, () => undefined);
                return made;
            })
            .finally(() => { connecting = null; });
    }
    return connecting;
};

// A WAV file of silence `durationMs` long.
const silentWav = (durationMs: number): Blob => {
    const samples = Math.max(1, Math.ceil((durationMs / 1000) * SAMPLE_RATE));
    const buffer = new ArrayBuffer(44 + samples);
    const view = new DataView(buffer);
    const text = (at: number, value: string) => [...value].forEach((letter, index) => view.setUint8(at + index, letter.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    text(36, 'data');
    view.setUint32(40, samples, true);
    new Uint8Array(buffer, 44).fill(128);
    return new Blob([buffer], { type: 'audio/wav' });
};

const onDeck = (url: string): boolean => (
    typeof document !== 'undefined' && [...document.querySelectorAll<HTMLMediaElement>('[data-playback-deck]')].some(element => element.currentSrc === url || element.getAttribute('src') === url)
);

/** The stand-in URL for a track: the one made for it before, or a new one. */
export const spotifyWebStandIn = (trackId: string, durationMs: number): string => {
    install();
    const known = [...standIns].find(([, id]) => id === trackId)?.[0];
    if (known) {
        standIns.delete(known);
        standIns.set(known, trackId);
        return known;
    }
    const url = URL.createObjectURL(silentWav(durationMs));
    standIns.set(url, trackId);
    // The oldest go, except one a deck still holds.
    for (const old of [...standIns.keys()]) {
        if (standIns.size <= KEPT_STAND_INS) break;
        if (old === url || onDeck(old)) continue;
        standIns.delete(old);
        URL.revokeObjectURL(old);
    }
    return url;
};

const trackOnDeck = (element: HTMLMediaElement): string | null => (
    standIns.get(element.currentSrc) ?? standIns.get(element.getAttribute('src') ?? '') ?? null
);

const command = async (run: (player: SdkPlayer) => Promise<void>): Promise<void> => {
    if (!connected) return;
    lastCommandAt = Date.now();
    await run(connected.player);
};

const startTrack = async (deviceId: string, trackId: string, positionMs: number): Promise<void> => {
    for (let attempt = 1; ; attempt += 1) {
        try {
            lastCommandAt = Date.now();
            await callSpotifyWeb('/me/player/play', {
                method: 'PUT', query: { device_id: deviceId }, body: { uris: [`spotify:track:${trackId}`], position_ms: positionMs },
            });
            console.log(`[Spotify] Web player starts ${trackId} at ${Math.round(positionMs / 1000)}s`);
            return;
        } catch (error) {
            const unknownDevice = error instanceof OnlineProviderError && error.httpStatus === 404;
            if (!unknownDevice || attempt >= START_TRIES) throw error;
            await new Promise(resolve => setTimeout(resolve, START_RETRY_MS));
        }
    }
};

const isSameTrack = (state: SdkState | null, trackId: string): state is SdkState => {
    const current = state?.track_window.current_track;
    return Boolean(current && (current.id === trackId || current.linked_from?.id === trackId));
};

// The deck `element` plays the stand-in of `trackId`: the player plays that track where the deck is.
const follow = async (element: HTMLMediaElement, trackId: string): Promise<void> => {
    const { player, deviceId } = await ensureSpotifyWebPlayer();
    if (element !== deck || element.paused) return;
    const atMs = Math.round(element.currentTime * 1000);
    const state = await player.getCurrentState();
    if (playingTrack === trackId && isSameTrack(state, trackId)) {
        lastCommandAt = Date.now();
        if (Math.abs(state.position - atMs) > DRIFT_MS) await player.seek(atMs);
        if (state.paused) await player.resume();
    } else {
        playingTrack = trackId;
        await startTrack(deviceId, trackId, atMs);
    }
    startDriftCheck();
};

// The player could not follow the deck: the deck stops too, so that silence does not play on.
const stopDeck = (error: unknown): void => {
    const element = deck;
    deck = null;
    playingTrack = null;
    stopDriftCheck();
    element?.pause();
    const premium = error instanceof OnlineProviderError && (error.code === 'subscription-required' || error.httpStatus === 403);
    tell?.({ type: 'error', textKey: premium ? 'status.spotifyWebPremiumOnly' : 'status.spotifyWebPlaybackFailed' });
};

const enqueue = (work: () => Promise<void>): void => {
    turn = turn.then(work).catch((error: unknown) => {
        console.warn('[Spotify] Web player could not follow the song', error);
        stopDeck(error);
    });
};

const checkDrift = async (): Promise<void> => {
    if (!connected || !deck || deck.paused || !playingTrack || Date.now() - lastCommandAt < SETTLE_MS) return;
    const element = deck;
    const state = await connected.player.getCurrentState();
    if (element !== deck || element.paused) return;
    // The track plays somewhere else now (moved to another device in a Spotify app).
    if (!isSameTrack(state, playingTrack)) {
        console.log('[Spotify] Web player no longer plays the song: the deck pauses');
        deck = null;
        playingTrack = null;
        stopDriftCheck();
        element.pause();
        return;
    }
    // Paused from a Spotify app that controls this player: the deck pauses with it.
    if (state.paused) {
        element.pause();
        return;
    }
    const atMs = element.currentTime * 1000;
    if (Math.abs(state.position - atMs) > DRIFT_MS) {
        lastCommandAt = Date.now();
        await connected.player.seek(Math.round(atMs));
    }
};

function startDriftCheck(): void {
    if (driftTimer) return;
    driftTimer = setInterval(() => { enqueue(checkDrift); }, DRIFT_CHECK_MS);
}

function stopDriftCheck(): void {
    if (driftTimer) clearInterval(driftTimer);
    driftTimer = null;
}

const deckOf = (event: Event): HTMLMediaElement | null => (
    event.target instanceof HTMLMediaElement && event.target.hasAttribute('data-playback-deck') ? event.target : null
);

const onPlaying = (event: Event): void => {
    const element = deckOf(event);
    if (!element) return;
    const trackId = trackOnDeck(element);
    if (!trackId) {
        // Another song plays: the player stops.
        if (deck) {
            deck = null;
            playingTrack = null;
            stopDriftCheck();
            enqueue(() => command(player => player.pause()));
        }
        return;
    }
    deck = element;
    enqueue(() => follow(element, trackId));
};

const onPause = (event: Event): void => {
    const element = deckOf(event);
    if (!element || element !== deck) return;
    stopDriftCheck();
    enqueue(() => command(player => player.pause()));
};

const onSeeked = (event: Event): void => {
    const element = deckOf(event);
    if (!element || element !== deck || element.paused) return;
    enqueue(() => command(player => player.seek(Math.round(element.currentTime * 1000))));
};

// The deck took up another source.
const onEmptied = (event: Event): void => {
    const element = deckOf(event);
    if (!element || element !== deck || trackOnDeck(element) === playingTrack) return;
    deck = null;
    playingTrack = null;
    stopDriftCheck();
    enqueue(() => command(player => player.pause()));
};

// A click or a key lets the player's frame sound, once.
const onGesture = (): void => {
    if (activated || !connected) return;
    connected.player.activateElement().then(() => { activated = true; }, () => undefined);
};

function install(): void {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    // Media events do not bubble; they are caught on the way down.
    document.addEventListener('playing', onPlaying, true);
    document.addEventListener('pause', onPause, true);
    document.addEventListener('ended', onPause, true);
    document.addEventListener('seeked', onSeeked, true);
    document.addEventListener('emptied', onEmptied, true);
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    useAudioSettingsStore.subscribe((state, previous) => {
        if (state.volume === previous.volume && state.isMuted === previous.isMuted) return;
        void connected?.player.setVolume(volumeNow()).catch(() => undefined);
    });
}

/** What the player has to tell the listener goes through `notify` while the app is open. */
export const watchSpotifyWebPlayback = (notify: (notice: ProviderNotice) => void): (() => void) => {
    tell = notify;
    install();
    return () => {
        if (tell === notify) tell = null;
    };
};

/** Signing out: the player leaves, and the song playing stops. */
export const disconnectSpotifyWebPlayer = (): void => {
    const element = deck;
    deck = null;
    playingTrack = null;
    stopDriftCheck();
    if (connected) dropPlayer(connected.player);
    activated = false;
    element?.pause();
};
