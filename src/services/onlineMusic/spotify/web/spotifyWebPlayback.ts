import { OnlineProviderError } from '../../../../types/onlineMusic';
import type { ProviderElsewherePlay, ProviderNotice, ProviderPlaybackDevice } from '../../../../types/onlineMusic';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { hasSpotifyWebSession, spotifyWebAccessToken } from './spotifyWebAuth';
import { callSpotifyWeb } from './spotifyWebApi';
import { chosenSpotifyWebDevice, keepChosenSpotifyWebDevice, listSpotifyWebDevices } from './spotifyWebDevices';

// src/services/onlineMusic/spotify/web/spotifyWebPlayback.ts
// The web version plays Spotify through Spotify's Web Playback SDK, which sounds protected audio in
// a frame of its own and gives no URL. So the app's deck is handed a stand-in instead
// (`ProviderAudioSource.standIn`): silence exactly as long as the song. The deck stays the clock of
// the song, and the player here follows it: a deck that starts playing a stand-in has the player
// start that track at the deck's time; pausing, seeking and ending the deck do the same to the
// player. Where the two drift apart (the player starts a moment late, and waits for its sound now
// and then), the deck is put where the player is: moving silence is not heard, while moving the
// player makes it stop to load again, and so drift further.
// The decks are found by their media events, caught on the document (`data-playback-deck`, App.tsx).
// What follows from it: the visualizer and automix see silence, and nothing of the song is stored.
// The song sounds where the listener chose (spotifyWebDevices.ts): in this window's player, or on
// another Spotify Connect device of the account, which is told through the Web API and asked
// where it is less often, as each question is a request.
// That device can be played from its own Spotify app too: a track started or resumed there that the
// deck does not play is told to those watching (`watchSpotifyElsewhere`), and the app plays it on the
// deck, which then follows the device instead of starting it again.

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const PLAYER_NAME = 'Folia';
const CONNECT_LIMIT_MS = 15_000;
// The stand-in's sound: 8-bit mono at 8 kHz, 8 KB a second (2.4 MB for five minutes).
const SAMPLE_RATE = 8000;
const KEPT_STAND_INS = 4;
// How far a resumed player may be from the deck before it is moved to it.
const DRIFT_MS = 800;
// How far the deck may be from the player before it is moved to it (the lyrics follow the deck),
// and how often that is looked at.
const DECK_DRIFT_MS = 250;
const DRIFT_CHECK_MS = 1000;
// The same for another device, whose answers come over the network.
const REMOTE_DECK_DRIFT_MS = 1000;
const REMOTE_CHECK_MS = 3000;
// A volume dragged on is sent to another device once it rests this long.
const REMOTE_VOLUME_WAIT_MS = 400;
// After a command, the player's state is not read as its own doing for this long.
const SETTLE_MS = 4000;
// Spotify may not know the player for a moment after it is ready: a start is asked again this often.
const START_TRIES = 3;
const START_RETRY_MS = 1000;
// Another device that is not the account's active one is first handed the playback, and given this
// long to take it, before a track is started on it.
const TRANSFER_WAIT_MS = 700;
// A track started on another device is looked for this many times, this far apart; not there, it is
// handed over and started once more. How many of the songs next there are told with a track the app
// follows (the app's queue becomes that one and those).
const CONFIRM_TRIES = 3;
const CONFIRM_MS = 800;
const ELSEWHERE_UPCOMING = 20;
// While the deck does not play, the chosen device is asked this often what it plays.
const ELSEWHERE_CHECK_MS = 4000;
// A track told is not told again for this long (the app is loading it).
const ELSEWHERE_AGAIN_MS = 10_000;

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
// Where the deck was moved to follow the player: its seek is not handed back to the player.
let deckMovedTo: number | null = null;
// The deck's events are answered one after another.
let turn: Promise<void> = Promise.resolve();
// Those told what the chosen device plays that the deck does not, and the last track told.
const elsewhereListeners = new Set<(play: ProviderElsewherePlay) => void>();
let elsewhereTold: { trackId: string; at: number } | null = null;
let elsewhereTimer: ReturnType<typeof setInterval> | null = null;
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

// What a device answers it is playing.
interface PlayState { paused: boolean; position: number; trackIds: (string | null | undefined)[] }
// Where the song sounds: what it is told, what it answers, and how closely the deck follows it.
interface Sound {
    deviceId: () => Promise<string>;
    state: () => Promise<PlayState | null>;
    pause: () => Promise<unknown>;
    resume: () => Promise<unknown>;
    seek: (positionMs: number) => Promise<unknown>;
    deckDriftMs: number;
    checkEveryMs: number;
}

const windowSound: Sound = {
    deviceId: async () => (await ensureSpotifyWebPlayer()).deviceId,
    state: async () => {
        const state = connected ? await connected.player.getCurrentState() : null;
        const track = state?.track_window.current_track;
        return state && { paused: state.paused, position: state.position, trackIds: [track?.id, track?.linked_from?.id] };
    },
    pause: async () => connected?.player.pause(),
    resume: async () => connected?.player.resume(),
    seek: async positionMs => connected?.player.seek(positionMs),
    deckDriftMs: DECK_DRIFT_MS,
    checkEveryMs: DRIFT_CHECK_MS,
};

// GET /me/player: what plays on the account now, and where.
interface WirePlayer {
    is_playing?: boolean;
    progress_ms?: number | null;
    device?: { id?: string | null };
    item?: { id?: string | null; linked_from?: { id?: string | null } } | null;
}

// A command a device does not take in the state it is in (pausing one that is paused) is answered
// 403 without a reason of Premium; it changes nothing, so it is let go.
const unlessRestricted = (error: unknown): void => {
    if (error instanceof OnlineProviderError && error.httpStatus === 403 && error.cause !== 'PREMIUM_REQUIRED') return;
    throw error;
};

const deviceSound = (id: string): Sound => ({
    deviceId: async () => id,
    state: async () => {
        const answer = await callSpotifyWeb<WirePlayer | undefined>('/me/player', { query: { additional_types: 'track' } });
        // Nothing plays, or it plays on another device.
        if (!answer?.item || answer.device?.id !== id) return null;
        return { paused: !answer.is_playing, position: answer.progress_ms ?? 0, trackIds: [answer.item.id, answer.item.linked_from?.id] };
    },
    pause: () => callSpotifyWeb('/me/player/pause', { method: 'PUT', query: { device_id: id } }).catch(unlessRestricted),
    resume: () => callSpotifyWeb('/me/player/play', { method: 'PUT', query: { device_id: id } }).catch(unlessRestricted),
    seek: positionMs => callSpotifyWeb('/me/player/seek', { method: 'PUT', query: { position_ms: positionMs, device_id: id } }).catch(unlessRestricted),
    deckDriftMs: REMOTE_DECK_DRIFT_MS,
    checkEveryMs: REMOTE_CHECK_MS,
});

const soundNow = (): Sound => {
    const chosen = chosenSpotifyWebDevice();
    return chosen.id === null ? windowSound : deviceSound(chosen.id);
};

const command = async (run: (sound: Sound) => Promise<unknown>): Promise<void> => {
    // This window's player that never connected has nothing to be told.
    if (chosenSpotifyWebDevice().id === null && !connected) return;
    lastCommandAt = Date.now();
    await run(soundNow());
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

const isSameTrack = (state: PlayState | null, trackId: string): state is PlayState => Boolean(state?.trackIds.includes(trackId));

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The account's playback moves to the device (it is not started there yet).
const handOver = async (deviceId: string): Promise<void> => {
    lastCommandAt = Date.now();
    await callSpotifyWeb('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: false } });
    console.log('[Spotify] Playback handed over to the chosen device');
    await wait(TRANSFER_WAIT_MS);
};

// GET /me/player/queue: the songs next on the account's player.
interface WireQueue { queue?: { id?: string | null }[] | null }

const upcomingTracks = async (): Promise<string[]> => {
    const answer = await callSpotifyWeb<WireQueue | undefined>('/me/player/queue');
    return (answer?.queue ?? []).flatMap(track => (track.id ? [track.id] : [])).slice(0, ELSEWHERE_UPCOMING);
};

// The Spotify app takes a start of a lone track (`uris`) and plays nothing, emptying what it played.
// So a track is started as the next of what plays there (that keeps the list it plays from, and its
// queue), or else in its album, at it (`offset`); only a track without an album is started alone.
const startTrackThere = async (deviceId: string, trackId: string, positionMs: number): Promise<void> => {
    lastCommandAt = Date.now();
    const [next] = await upcomingTracks();
    if (next === trackId) {
        await callSpotifyWeb('/me/player/next', { method: 'POST', query: { device_id: deviceId } });
        if (positionMs > DRIFT_MS) await callSpotifyWeb('/me/player/seek', { method: 'PUT', query: { position_ms: positionMs, device_id: deviceId } });
        console.log(`[Spotify] The chosen device skips to ${trackId}, the next of its own`);
        return;
    }
    const track = await callSpotifyWeb<{ album?: { uri?: string | null } } | undefined>(`/tracks/${trackId}`);
    const uri = `spotify:track:${trackId}`;
    const album = track?.album?.uri;
    lastCommandAt = Date.now();
    await callSpotifyWeb('/me/player/play', {
        method: 'PUT', query: { device_id: deviceId },
        body: album ? { context_uri: album, offset: { uri }, position_ms: positionMs } : { uris: [uri], position_ms: positionMs },
    });
    console.log(`[Spotify] The chosen device starts ${trackId} at ${Math.round(positionMs / 1000)}s${album ? ' in its album' : ''}`);
};

// A Spotify app that is open but is not the account's active device may take a start and play
// nothing. So the playback is handed to it first, and after the start the track is looked for there:
// loaded but paused, it is resumed; not there, it is handed over and started again. A device that
// plays the track already (it went on to it by itself) is left playing it.
const startOnDevice = async (element: HTMLMediaElement, deviceId: string, trackId: string, positionMs: number): Promise<void> => {
    const now = await callSpotifyWeb<WirePlayer | undefined>('/me/player', { query: { additional_types: 'track' } });
    if (now?.device?.id !== deviceId) {
        await handOver(deviceId);
    } else if (now.item?.id === trackId || now.item?.linked_from?.id === trackId) {
        lastCommandAt = Date.now();
        if (!now.is_playing) await deviceSound(deviceId).resume();
        console.log('[Spotify] The chosen device plays the track already');
        return;
    }
    for (let round = 1; ; round += 1) {
        await startTrackThere(deviceId, trackId, positionMs);
        for (let check = 1; check <= CONFIRM_TRIES; check += 1) {
            await wait(CONFIRM_MS);
            if (element !== deck || element.paused) return;
            const state = await deviceSound(deviceId).state();
            if (!isSameTrack(state, trackId)) continue;
            if (state.paused) {
                console.log('[Spotify] The chosen device loaded the track paused: resumed');
                lastCommandAt = Date.now();
                await deviceSound(deviceId).resume();
            }
            return;
        }
        if (round >= 2) {
            console.warn('[Spotify] The chosen device did not start the track');
            throw new OnlineProviderError('unavailable', 'The chosen Spotify device did not start the track', 'spotify');
        }
        console.warn('[Spotify] The chosen device did not start the track: handed over and started again');
        await handOver(deviceId);
        positionMs = Math.round(element.currentTime * 1000);
    }
};

// The deck `element` plays the stand-in of `trackId`: the player plays that track where the deck is.
const follow = async (element: HTMLMediaElement, trackId: string): Promise<void> => {
    const sound = soundNow();
    const deviceId = await sound.deviceId();
    if (element !== deck || element.paused) return;
    const atMs = Math.round(element.currentTime * 1000);
    const state = await sound.state();
    if (playingTrack === trackId && isSameTrack(state, trackId)) {
        // A player still playing is left alone (the drift check moves the deck); a paused one is
        // resumed where the deck is, which may have been sought meanwhile.
        if (!state.paused) {
            startDriftCheck();
            return;
        }
        lastCommandAt = Date.now();
        if (Math.abs(state.position - atMs) > DRIFT_MS) await sound.seek(atMs);
        await sound.resume();
    } else {
        playingTrack = trackId;
        if (sound === windowSound) await startTrack(deviceId, trackId, atMs);
        else await startOnDevice(element, deviceId, trackId, atMs);
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
    const elsewhere = chosenSpotifyWebDevice().id !== null;
    const failure = error instanceof OnlineProviderError ? error : null;
    // A 403 of this window's player is its account (no Premium); another device says so in its reason.
    const premium = failure?.code === 'subscription-required'
        || (failure?.httpStatus === 403 && (!elsewhere || failure.cause === 'PREMIUM_REQUIRED'));
    // The device chosen is not on (its Spotify app was closed, or it went offline).
    const gone = elsewhere && failure?.httpStatus === 404;
    tell?.({ type: 'error', textKey: premium ? 'status.spotifyWebPremiumOnly' : gone ? 'status.spotifyWebDeviceGone' : 'status.spotifyWebPlaybackFailed' });
};

const enqueue = (work: () => Promise<void>): void => {
    turn = turn.then(work).catch((error: unknown) => {
        console.warn('[Spotify] Web player could not follow the song', error);
        stopDeck(error);
    });
};

// The chosen device plays `trackId` (started or resumed in its own Spotify app): the deck lets go of
// the song it holds, so that its pause or its next song is not sent there, and the track is taken as
// the one played, so that the deck playing it follows the device.
// The songs next there are told too, for the app's queue.
const tellElsewhere = async (trackId: string, positionMs: number): Promise<void> => {
    if (elsewhereListeners.size === 0) return;
    if (elsewhereTold?.trackId === trackId && Date.now() - elsewhereTold.at < ELSEWHERE_AGAIN_MS) return;
    elsewhereTold = { trackId, at: Date.now() };
    deck = null;
    playingTrack = trackId;
    stopDriftCheck();
    const upcoming = await upcomingTracks().catch(() => []);
    console.log(`[Spotify] The chosen device plays a track of its own: the app follows it, and the ${upcoming.length} next there`);
    elsewhereListeners.forEach(listener => listener({ mediaId: trackId, positionMs, upcoming }));
};

// While the deck does not play: what the chosen device plays, if anything.
const checkElsewhere = async (): Promise<void> => {
    const chosen = chosenSpotifyWebDevice().id;
    if (chosen === null || !hasSpotifyWebSession() || (deck && !deck.paused)) return;
    if (Date.now() - lastCommandAt < SETTLE_MS) return;
    const state = await deviceSound(chosen).state();
    const trackId = state?.trackIds[0];
    if (!state || state.paused || !trackId || (deck && !deck.paused)) return;
    await tellElsewhere(trackId, state.position);
};

const checkDrift = async (): Promise<void> => {
    if (!deck || deck.paused || !playingTrack) return;
    const sound = soundNow();
    if (sound === windowSound && !connected) return;
    const element = deck;
    const state = await sound.state();
    // (Read again below, where the checks have narrowed `state`.)
    const answered = state;
    if (element !== deck || element.paused) return;
    // The player plays the track: the deck is put where it is.
    if (isSameTrack(state, playingTrack) && !state.paused) {
        const atMs = element.currentTime * 1000;
        if (Math.abs(state.position - atMs) > sound.deckDriftMs) {
            deckMovedTo = state.position / 1000;
            element.currentTime = deckMovedTo;
        }
        return;
    }
    // Shortly after a command, the player may not show it yet.
    if (Date.now() - lastCommandAt < SETTLE_MS) return;
    // The track plays somewhere else now (moved to another device in a Spotify app), or the device
    // chosen plays another track, started in its own Spotify app: that one is followed.
    if (!isSameTrack(state, playingTrack)) {
        console.log('[Spotify] Web player no longer plays the song: the deck pauses');
        deck = null;
        playingTrack = null;
        stopDriftCheck();
        element.pause();
        const other = answered?.trackIds[0];
        if (sound !== windowSound && answered && !answered.paused && other) await tellElsewhere(other, answered.position);
        return;
    }
    // Paused from a Spotify app that controls this player: the deck pauses with it.
    element.pause();
};

function startDriftCheck(): void {
    if (driftTimer) return;
    driftTimer = setInterval(() => { enqueue(checkDrift); }, soundNow().checkEveryMs);
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
            enqueue(() => command(sound => sound.pause()));
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
    // Another device that comes to the end of the track goes on by itself, to the next of its own,
    // which is often the app's next too: it is not paused there, and what it plays is not taken for
    // a song of its own while the app starts its next.
    if (event.type === 'ended' && chosenSpotifyWebDevice().id !== null) {
        lastCommandAt = Date.now();
        return;
    }
    enqueue(() => command(sound => sound.pause()));
};

const onSeeked = (event: Event): void => {
    const element = deckOf(event);
    if (!element || element !== deck) return;
    const moved = deckMovedTo;
    deckMovedTo = null;
    if (moved !== null && Math.abs(element.currentTime - moved) < 0.1) return;
    if (element.paused) return;
    enqueue(() => command(sound => sound.seek(Math.round(element.currentTime * 1000))));
};

// The deck took up another source.
const onEmptied = (event: Event): void => {
    const element = deckOf(event);
    if (!element || element !== deck || trackOnDeck(element) === playingTrack) return;
    deck = null;
    playingTrack = null;
    stopDriftCheck();
    enqueue(() => command(sound => sound.pause()));
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
        const elsewhere = chosenSpotifyWebDevice().id;
        if (elsewhere === null) {
            void connected?.player.setVolume(volumeNow()).catch(() => undefined);
            return;
        }
        // Another device: once the volume rests; one that keeps its own volume answers 403.
        if (volumeTimer) clearTimeout(volumeTimer);
        volumeTimer = setTimeout(() => {
            volumeTimer = null;
            void callSpotifyWeb('/me/player/volume', {
                method: 'PUT', query: { volume_percent: Math.round(volumeNow() * 100), device_id: elsewhere },
            }).catch(() => undefined);
        }, REMOTE_VOLUME_WAIT_MS);
    });
}

let volumeTimer: ReturnType<typeof setTimeout> | null = null;

/** This window's own player, then the account's other devices on now. */
export const listSpotifyWebPlaybackDevices = (): Promise<ProviderPlaybackDevice[]> => listSpotifyWebDevices(connected?.deviceId ?? null);

/**
 * Plays on `device` from now on. A song playing moves there, where the deck is (starting it on
 * another device moves the account's playback there); a paused one starts there when played.
 */
export const chooseSpotifyWebDevice = async (device: ProviderPlaybackDevice): Promise<void> => {
    const before = chosenSpotifyWebDevice().id;
    keepChosenSpotifyWebDevice(device);
    if (before === device.id) return;
    install();
    stopDriftCheck();
    const element = deck;
    const trackId = playingTrack;
    playingTrack = null;
    if (!element || !trackId || element.paused) return;
    enqueue(() => follow(element, trackId));
};

/**
 * Calls `listener` when the device chosen plays a track the deck does not: one started or resumed in
 * its own Spotify app. Answers with the way to stop.
 */
export const watchSpotifyElsewhere = (listener: (play: ProviderElsewherePlay) => void): (() => void) => {
    install();
    elsewhereListeners.add(listener);
    elsewhereTimer ??= setInterval(() => {
        turn = turn.then(checkElsewhere).catch((error: unknown) => console.warn('[Spotify] Could not read what the chosen device plays', error));
    }, ELSEWHERE_CHECK_MS);
    return () => {
        elsewhereListeners.delete(listener);
        if (elsewhereListeners.size > 0 || !elsewhereTimer) return;
        clearInterval(elsewhereTimer);
        elsewhereTimer = null;
    };
};

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
