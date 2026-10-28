import { OnlineProviderError } from '../../../../types/onlineMusic';
import type { ProviderElsewherePlay, ProviderNotice } from '../../../../types/onlineMusic';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { hasSpotifyWebSession } from './spotifyWebAuth';
import { callSpotifyWeb } from './spotifyWebApi';
import { currentSpotifyWebDevice, findSpotifyWebDevice, noteSpotifyWebDevice } from './spotifyWebDevices';
import type { WireDevice } from './spotifyWebDevices';

// src/services/onlineMusic/spotify/web/spotifyWebPlayback.ts
// Spotify's songs sound in the listener's own Spotify app, on the device Spotify plays on (a phone,
// the Spotify app on a computer, a speaker: spotifyWebDevices.ts), which Folia controls through the
// Web API. So the app's deck is handed a stand-in instead (`ProviderAudioSource.standIn`): silence
// exactly as long as the song. The deck stays the clock of the song, and the device follows it: a deck
// that starts playing a stand-in has the device start that track at the deck's time; pausing, seeking
// and ending the deck do the same there. Where the two drift apart, the deck is put where the device
// is: moving silence is not heard, while moving the device makes it stop to load again. The device is
// asked where it is now and then, as each question is a request.
// The decks are found by their media events, caught on the document (`data-playback-deck`, App.tsx).
// What follows from it: the visualizer and automix see silence, and nothing of the song is stored.
// Spotify can be played from its own apps too: a track started or resumed there that the deck does not
// play is told to those watching (`watchSpotifyElsewhere`), and the app plays it on the deck, which then
// follows the device instead of starting it again. Playback moved to another device in a Spotify app
// is followed there.

// The stand-in's sound: 8-bit mono at 8 kHz, 8 KB a second (2.4 MB for five minutes).
const SAMPLE_RATE = 8000;
const KEPT_STAND_INS = 4;
// How far a resumed device may be from the deck before it is moved to it.
const DRIFT_MS = 800;
// How far the deck may be from the device before it is moved to it (the lyrics follow the deck),
// and how often that is looked at.
const DECK_DRIFT_MS = 1000;
const CHECK_MS = 3000;
// A volume dragged on is sent to the device once it rests this long.
const VOLUME_WAIT_MS = 400;
// After a command, the device's state is not read as its own doing for this long.
const SETTLE_MS = 4000;
// Spotify ends a track up to 12 seconds early where it fades into the next (Crossfade, Automix): with
// a next it plays that one, and without one it stops, paused there and then playing nothing (seen on
// an iPhone, 11 seconds before the end). In this last stretch of the deck a stop is not taken for a
// pause until Spotify says paused twice.
const END_STRETCH_S = 15;
// A device that is not the account's active one is first handed the playback, and given this long
// to take it, before a track is started on it.
const TRANSFER_WAIT_MS = 700;
// A track started on the device is looked for this many times, this far apart; not there, it is
// handed over and started once more. How many of the songs next there are told with a track the app
// follows (the app's queue becomes that one and those).
const CONFIRM_TRIES = 3;
const CONFIRM_MS = 800;
const ELSEWHERE_UPCOMING = 20;
// While the deck does not play, Spotify is asked this often what it plays.
const ELSEWHERE_CHECK_MS = 4000;
// A track told is not told again for this long (the app is loading it).
const ELSEWHERE_AGAIN_MS = 10_000;

let tell: ((notice: ProviderNotice) => void) | null = null;
let installed = false;
// The deck the device follows, and the track the device was last told to play.
let deck: HTMLMediaElement | null = null;
let playingTrack: string | null = null;
let lastCommandAt = 0;
let driftTimer: ReturnType<typeof setInterval> | null = null;
let volumeTimer: ReturnType<typeof setTimeout> | null = null;
// Where the deck was moved to follow the device: its seek is not handed back to the device.
let deckMovedTo: number | null = null;
// Spotify said paused once in the last stretch of the deck.
let pausedNearEnd = false;
// The deck's events are answered one after another.
let turn: Promise<void> = Promise.resolve();
// Those told what Spotify plays that the deck does not, and the last track told.
const elsewhereListeners = new Set<(play: ProviderElsewherePlay) => void>();
let elsewhereTold: { trackId: string; at: number } | null = null;
let elsewhereTimer: ReturnType<typeof setInterval> | null = null;
// The list the device played from when the app last followed it, and the tracks told with it (the
// app's queue): one of them the app plays is started in that list, so that the device's queue stays
// the app's.
let followed: { context: string; tracks: Set<string> } | null = null;
// Stand-in URL → Spotify track id, oldest first.
const standIns = new Map<string, string>();

const volumeNow = (): number => {
    const { volume, isMuted } = useAudioSettingsStore.getState();
    return isMuted ? 0 : Math.min(1, Math.max(0, Number(volume) || 0));
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

// GET /me/player: what plays on the account now, and where.
interface WirePlayer {
    is_playing?: boolean;
    progress_ms?: number | null;
    device?: WireDevice;
    item?: { id?: string | null; linked_from?: { id?: string | null } } | null;
    context?: { uri?: string | null } | null;
}

// What Spotify answers it is playing, on whichever device.
// `context`: the list or album it plays from, where Spotify says.
interface PlayState { paused: boolean; position: number; trackIds: (string | null | undefined)[]; context?: string | null }

const readPlayer = async (): Promise<WirePlayer | undefined> => {
    const answer = await callSpotifyWeb<WirePlayer | undefined>('/me/player', { query: { additional_types: 'track' } });
    noteSpotifyWebDevice(answer?.device);
    return answer;
};

const playerState = async (): Promise<PlayState | null> => {
    const answer = await readPlayer();
    if (!answer?.item) return null;
    return { paused: !answer.is_playing, position: answer.progress_ms ?? 0, trackIds: [answer.item.id, answer.item.linked_from?.id], context: answer.context?.uri };
};

// A command a device does not take in the state it is in (pausing one that is paused) is answered
// 403 without a reason of Premium; it changes nothing, so it is let go.
const unlessRestricted = (error: unknown): void => {
    if (error instanceof OnlineProviderError && error.httpStatus === 403 && error.cause !== 'PREMIUM_REQUIRED') return;
    throw error;
};

const pauseOn = (id: string) => callSpotifyWeb('/me/player/pause', { method: 'PUT', query: { device_id: id } }).catch(unlessRestricted);
const resumeOn = (id: string) => callSpotifyWeb('/me/player/play', { method: 'PUT', query: { device_id: id } }).catch(unlessRestricted);
const seekOn = (id: string, positionMs: number) => callSpotifyWeb('/me/player/seek', { method: 'PUT', query: { position_ms: positionMs, device_id: id } }).catch(unlessRestricted);

// A command to the device the songs sound on; before one is known there is nothing to tell.
const command = async (run: (id: string) => Promise<unknown>): Promise<void> => {
    const id = currentSpotifyWebDevice()?.id;
    if (!id) return;
    lastCommandAt = Date.now();
    await run(id);
};

const isSameTrack = (state: PlayState | null, trackId: string): state is PlayState => Boolean(state?.trackIds.includes(trackId));

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The account's playback moves to the device (it is not started there yet).
const handOver = async (deviceId: string): Promise<void> => {
    lastCommandAt = Date.now();
    await callSpotifyWeb('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: false } });
    console.log('[Spotify] Playback handed over to the device');
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
// queue), or in the list the app followed it from, or else in its album, at it (`offset`); only a
// track without an album is started alone.
const startTrackThere = async (deviceId: string, trackId: string, positionMs: number): Promise<void> => {
    lastCommandAt = Date.now();
    const [next] = await upcomingTracks();
    if (next === trackId) {
        await callSpotifyWeb('/me/player/next', { method: 'POST', query: { device_id: deviceId } });
        if (positionMs > DRIFT_MS) await callSpotifyWeb('/me/player/seek', { method: 'PUT', query: { position_ms: positionMs, device_id: deviceId } });
        console.log(`[Spotify] The device skips to ${trackId}, the next of its own`);
        return;
    }
    const list = followed?.tracks.has(trackId) ? followed.context : null;
    const album = list ? null : (await callSpotifyWeb<{ album?: { uri?: string | null } } | undefined>(`/tracks/${trackId}`))?.album?.uri;
    const context = list ?? album;
    const uri = `spotify:track:${trackId}`;
    lastCommandAt = Date.now();
    await callSpotifyWeb('/me/player/play', {
        method: 'PUT', query: { device_id: deviceId },
        body: context ? { context_uri: context, offset: { uri }, position_ms: positionMs } : { uris: [uri], position_ms: positionMs },
    });
    console.log(`[Spotify] The device starts ${trackId} at ${Math.round(positionMs / 1000)}s${list ? ' in the list followed' : album ? ' in its album' : ''}`);
};

// A Spotify app that is open but is not the account's active device may take a start and play
// nothing. So the playback is handed to it first, and after the start the track is looked for there:
// loaded but paused, it is resumed; not there, it is handed over and started again. A device that
// plays the track already (it went on to it by itself) is left playing it.
const startOnDevice = async (element: HTMLMediaElement, deviceId: string, trackId: string, positionMs: number): Promise<void> => {
    const now = await readPlayer();
    if (now?.device?.id !== deviceId) {
        await handOver(deviceId);
    } else if (now.item?.id === trackId || now.item?.linked_from?.id === trackId) {
        lastCommandAt = Date.now();
        if (!now.is_playing) await resumeOn(deviceId);
        console.log('[Spotify] The device plays the track already');
        return;
    }
    for (let round = 1; ; round += 1) {
        await startTrackThere(deviceId, trackId, positionMs);
        for (let check = 1; check <= CONFIRM_TRIES; check += 1) {
            await wait(CONFIRM_MS);
            if (element !== deck || element.paused) return;
            const state = await playerState();
            if (!isSameTrack(state, trackId)) continue;
            if (state.paused) {
                console.log('[Spotify] The device loaded the track paused: resumed');
                lastCommandAt = Date.now();
                await resumeOn(deviceId);
            }
            return;
        }
        if (round >= 2) {
            console.warn('[Spotify] The device did not start the track');
            throw new OnlineProviderError('unavailable', 'The Spotify device did not start the track', 'spotify');
        }
        console.warn('[Spotify] The device did not start the track: handed over and started again');
        await handOver(deviceId);
        positionMs = Math.round(element.currentTime * 1000);
    }
};

// The deck `element` plays the stand-in of `trackId`: the device plays that track where the deck is.
const follow = async (element: HTMLMediaElement, trackId: string): Promise<void> => {
    const device = await findSpotifyWebDevice();
    if (element !== deck || element.paused) return;
    const atMs = Math.round(element.currentTime * 1000);
    const state = await playerState();
    if (playingTrack === trackId && isSameTrack(state, trackId)) {
        // A device still playing is left alone (the drift check moves the deck); a paused one is
        // resumed where the deck is, which may have been sought meanwhile.
        if (!state.paused) {
            startDriftCheck();
            await topUpFollowed(trackId);
            return;
        }
        const id = currentSpotifyWebDevice()?.id ?? device.id;
        lastCommandAt = Date.now();
        if (Math.abs(state.position - atMs) > DRIFT_MS) await seekOn(id, atMs);
        await resumeOn(id);
    } else {
        playingTrack = trackId;
        await startOnDevice(element, device.id, trackId, atMs);
    }
    startDriftCheck();
    await topUpFollowed(trackId);
};

// The app plays on through the list it followed (on the device, which plays it too): the songs next
// there are told again, as Spotify tells no more than 20 at a time, so that the app's queue keeps
// being the device's instead of running out.
const topUpFollowed = async (trackId: string): Promise<void> => {
    if (!followed?.tracks.has(trackId) || elsewhereListeners.size === 0) return;
    if (elsewhereTold?.trackId === trackId && Date.now() - elsewhereTold.at < ELSEWHERE_AGAIN_MS) return;
    const upcoming = await upcomingTracks().catch(() => []);
    if (upcoming.length === 0) return;
    upcoming.forEach(id => followed?.tracks.add(id));
    elsewhereListeners.forEach(listener => listener({ mediaId: trackId, positionMs: 0, upcoming, queueOnly: true }));
};

// The device could not follow the deck: the deck stops too, so that silence does not play on.
const stopDeck = (error: unknown): void => {
    const element = deck;
    deck = null;
    playingTrack = null;
    stopDriftCheck();
    element?.pause();
    const failure = error instanceof OnlineProviderError ? error : null;
    const premium = failure?.code === 'subscription-required' || (failure?.httpStatus === 403 && failure.cause === 'PREMIUM_REQUIRED');
    // No Spotify app is open, or the device went offline.
    const gone = failure?.cause === 'no-device' || failure?.httpStatus === 404;
    tell?.({ type: 'error', textKey: premium ? 'status.spotifyWebPremiumOnly' : gone ? 'status.spotifyWebDeviceGone' : 'status.spotifyWebPlaybackFailed' });
};

const enqueue = (work: () => Promise<void>): void => {
    turn = turn.then(work).catch((error: unknown) => {
        console.warn('[Spotify] The device could not follow the song', error);
        stopDeck(error);
    });
};

// Spotify plays `trackId` (started or resumed in one of its apps): the deck lets go of the song it
// holds, so that its pause or its next song is not sent there, and the track is taken as the one
// played, so that the deck playing it follows the device.
// The songs next there are told too, for the app's queue.
const tellElsewhere = async (trackId: string, positionMs: number, context?: string | null): Promise<void> => {
    if (elsewhereListeners.size === 0) return;
    if (elsewhereTold?.trackId === trackId && Date.now() - elsewhereTold.at < ELSEWHERE_AGAIN_MS) return;
    elsewhereTold = { trackId, at: Date.now() };
    deck = null;
    playingTrack = trackId;
    stopDriftCheck();
    const upcoming = await upcomingTracks().catch(() => []);
    followed = context ? { context, tracks: new Set([trackId, ...upcoming]) } : null;
    console.log(`[Spotify] Spotify plays a track of its own: the app follows it, and the ${upcoming.length} next there`);
    elsewhereListeners.forEach(listener => listener({ mediaId: trackId, positionMs, upcoming }));
};

// While the deck does not play: what Spotify plays, if anything.
const checkElsewhere = async (): Promise<void> => {
    if (!hasSpotifyWebSession() || (deck && !deck.paused)) return;
    if (Date.now() - lastCommandAt < SETTLE_MS) return;
    const state = await playerState();
    const trackId = state?.trackIds[0];
    if (!state || state.paused || !trackId || (deck && !deck.paused)) return;
    await tellElsewhere(trackId, state.position, state.context);
};

const checkDrift = async (): Promise<void> => {
    if (!deck || deck.paused || !playingTrack) return;
    const element = deck;
    const state = await playerState();
    // (Read again below, where the checks have narrowed `state`.)
    const answered = state;
    if (element !== deck || element.paused) return;
    // Spotify plays the track (on whichever device it was moved to): the deck is put where it is.
    if (isSameTrack(state, playingTrack) && !state.paused) {
        pausedNearEnd = false;
        const atMs = element.currentTime * 1000;
        if (Math.abs(state.position - atMs) > DECK_DRIFT_MS) {
            deckMovedTo = state.position / 1000;
            element.currentTime = deckMovedTo;
        }
        return;
    }
    // Shortly after a command, the device may not show it yet.
    if (Date.now() - lastCommandAt < SETTLE_MS) return;
    // Near the end, Spotify that plays nothing ended the track early: the deck plays on to its end, and the
    // app goes on to its next. Paused there, it is a pause only when Spotify says so again.
    if (element.duration - element.currentTime < END_STRETCH_S) {
        if (!state) {
            console.log('[Spotify] Spotify ended the track early: the deck plays on to its end');
            return;
        }
        if (isSameTrack(state, playingTrack) && state.paused && !pausedNearEnd) {
            pausedNearEnd = true;
            return;
        }
    }
    // Spotify plays another track, started in one of its apps: that one is followed.
    if (!isSameTrack(state, playingTrack)) {
        console.log('[Spotify] Spotify no longer plays the song: the deck pauses');
        deck = null;
        playingTrack = null;
        stopDriftCheck();
        element.pause();
        const other = answered?.trackIds[0];
        if (answered && !answered.paused && other) await tellElsewhere(other, answered.position, answered.context);
        return;
    }
    // Paused in a Spotify app: the deck pauses with it.
    element.pause();
};

function startDriftCheck(): void {
    if (driftTimer) return;
    driftTimer = setInterval(() => { enqueue(checkDrift); }, CHECK_MS);
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
    pausedNearEnd = false;
    const trackId = trackOnDeck(element);
    if (!trackId) {
        // Another song plays: the device stops.
        if (deck) {
            deck = null;
            playingTrack = null;
            stopDriftCheck();
            enqueue(() => command(pauseOn));
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
    // A device that comes to the end of the track goes on by itself, to the next of its own, which
    // is often the app's next too: it is not paused there, and what it plays is not taken for a song
    // of its own while the app starts its next.
    if (event.type === 'ended') {
        lastCommandAt = Date.now();
        return;
    }
    enqueue(() => command(pauseOn));
};

const onSeeked = (event: Event): void => {
    const element = deckOf(event);
    if (!element || element !== deck) return;
    const moved = deckMovedTo;
    deckMovedTo = null;
    if (moved !== null && Math.abs(element.currentTime - moved) < 0.1) return;
    if (element.paused) return;
    enqueue(() => command(id => seekOn(id, Math.round(element.currentTime * 1000))));
};

// The deck took up another source.
const onEmptied = (event: Event): void => {
    const element = deckOf(event);
    if (!element || element !== deck || trackOnDeck(element) === playingTrack) return;
    deck = null;
    playingTrack = null;
    stopDriftCheck();
    enqueue(() => command(pauseOn));
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
    useAudioSettingsStore.subscribe((state, previous) => {
        if (state.volume === previous.volume && state.isMuted === previous.isMuted) return;
        // Sent once the volume rests; a device that keeps its own volume answers 403.
        if (volumeTimer) clearTimeout(volumeTimer);
        volumeTimer = setTimeout(() => {
            volumeTimer = null;
            const id = currentSpotifyWebDevice()?.id;
            if (!id) return;
            void callSpotifyWeb('/me/player/volume', {
                method: 'PUT', query: { volume_percent: Math.round(volumeNow() * 100), device_id: id },
            }).catch(() => undefined);
        }, VOLUME_WAIT_MS);
    });
}

/**
 * Calls `listener` when Spotify plays a track the deck does not: one started or resumed in one of
 * its apps. Answers with the way to stop.
 */
export const watchSpotifyElsewhere = (listener: (play: ProviderElsewherePlay) => void): (() => void) => {
    install();
    elsewhereListeners.add(listener);
    elsewhereTimer ??= setInterval(() => {
        turn = turn.then(checkElsewhere).catch((error: unknown) => console.warn('[Spotify] Could not read what Spotify plays', error));
    }, ELSEWHERE_CHECK_MS);
    return () => {
        elsewhereListeners.delete(listener);
        if (elsewhereListeners.size > 0 || !elsewhereTimer) return;
        clearInterval(elsewhereTimer);
        elsewhereTimer = null;
    };
};

/** What playing on the device has to tell the listener goes through `notify` while the app is open. */
export const watchSpotifyWebPlayback = (notify: (notice: ProviderNotice) => void): (() => void) => {
    tell = notify;
    install();
    return () => {
        if (tell === notify) tell = null;
    };
};

/** Signing out: the deck lets go of the device, and the song playing stops. */
export const stopSpotifyWebPlayback = (): void => {
    const element = deck;
    deck = null;
    playingTrack = null;
    stopDriftCheck();
    element?.pause();
};
