import type { UnifiedSong } from '../../../../types';
import { OnlineProviderError } from '../../../../types/onlineMusic';
import type { OnlineFailureDetail, OnlineFailureOperation, OnlineMusicProvider } from '../../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../../utils/songMetadata';
import { normalizeSpotifyUser, requireSpotifySong } from '../spotifyNormalize';
import { describeSpotifyFailure } from '../spotifyFailure';
import {
    SPOTIFY_WEB_LOGIN_TTL_MS, SPOTIFY_WEB_POPUP_BLOCKED, cancelSpotifyWebLogin, checkSpotifyWebLogin, clearSpotifyWebSession,
    getSpotifyWebAvailability, hasSpotifyWebSession, openSpotifyWebLogin, spotifyClientIdSetting, startSpotifyWebLogin,
} from './spotifyWebAuth';
import { callSpotifyWeb, isSpotifyWebNotFound } from './spotifyWebApi';
import { isSpotifyWebPlaylistClosed, spotifyWebCatalog } from './spotifyWebCatalog';
import { forgetSpotifyWebMe, readSpotifyWebMe, spotifyWebLibrary } from './spotifyWebLibrary';
import { spotifyWebMutations } from './spotifyWebMutations';
import { normalizeSpotifyWebCollection, normalizeSpotifyWebSong, present, spotifyWebSongOf } from './spotifyWebNormalize';
import type { SpotifyWebPage, SpotifyWebTrack } from './spotifyWebNormalize';
import { chosenSpotifyWebDevice, subscribeSpotifyWebDevice } from './spotifyWebDevices';
import {
    chooseSpotifyWebDevice, disconnectSpotifyWebPlayer, ensureSpotifyWebPlayer, listSpotifyWebPlaybackDevices, spotifyWebStandIn,
    watchSpotifyElsewhere, watchSpotifyWebPlayback,
} from './spotifyWebPlayback';

// src/services/onlineMusic/spotify/web/spotifyWebProvider.ts
// Spotify in the web version (the desktop version is spotify/spotifyProvider.ts; which of the two is
// registered is decided in spotifyRuntimeProvider.ts). It reads through Spotify's public Web API
// as an app the person registered (VITE_SPOTIFY_CLIENT_ID), and plays through the Web Playback SDK,
// which needs Premium, or on another Spotify Connect device of the account that Folia controls
// (`devices`, spotifyWebDevices.ts). Its songs and collections are the desktop version's, so a song kept by one
// plays in the other. Spotify's own lyrics, the radio tab and the explore page are not in the
// public API: lyrics come from the other sources, and the two tabs are left out.

// Spotify gives at most 10 rows of a search a request (February 2026), up to offset 1000.
const SEARCH_ROWS = 10;
const SEARCH_MAX_OFFSET = 1000;

const describeFailure = (operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null => (
    isSpotifyWebPlaylistClosed(error)
        ? { case: 'refused', httpStatus: 403, message: (error as Error).message }
        : describeSpotifyFailure(operation, error)
);

const getSongDetail = async (id: string | number): Promise<UnifiedSong | null> => {
    try {
        return spotifyWebSongOf(await callSpotifyWeb<SpotifyWebTrack>(`/tracks/${encodeURIComponent(String(id))}`));
    } catch (error) {
        if (isSpotifyWebNotFound(error)) return null;
        throw error;
    }
};

export const spotifyWebProvider: OnlineMusicProvider = {
    id: 'spotify', displayName: 'Spotify', shortName: 'Spotify',
    mark: { letter: 'S', color: '#22c55e' },
    getAvailability: getSpotifyWebAvailability,
    // Where a listener who has not chosen a platform starts.
    startsHere: true,
    describeFailure,
    watch: watchSpotifyWebPlayback,
    capabilities: {
        search: true, playback: true, lyrics: false, wordByWordLyrics: false, auth: true,
        userLibrary: true, playlists: true, albums: true, artists: true, userAlbums: true,
        recommendations: false, explore: false, mutations: true, likes: true, playlistTrackMutations: true,
        playlistSubscription: true,
    },
    normalizeSong: normalizeSpotifyWebSong, normalizeUser: normalizeSpotifyUser, normalizeCollection: normalizeSpotifyWebCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    search: {
        // Requests of 10 rows are made until the page asked for is full or the search ends.
        async searchSongs(query, limit, offset) {
            const text = query.trim();
            if (!text) return { items: [], total: 0, nextOffset: offset, hasMore: false };
            const items: UnifiedSong[] = [];
            let at = offset;
            let more = true;
            let total: number | undefined;
            while (more && items.length < limit && at < SEARCH_MAX_OFFSET) {
                const answer = await callSpotifyWeb<{ tracks?: SpotifyWebPage<SpotifyWebTrack> }>('/search', {
                    query: { q: text, type: 'track', limit: Math.max(1, Math.min(SEARCH_ROWS, limit - items.length)), offset: at },
                });
                const rows = answer.tracks?.items ?? [];
                items.push(...rows.map(row => spotifyWebSongOf(row)).filter(present));
                at += rows.length;
                total = answer.tracks?.total;
                more = rows.length > 0 && Boolean(answer.tracks?.next);
            }
            return { items, ...(total === undefined ? {} : { total }), nextOffset: at, hasMore: more && at < SEARCH_MAX_OFFSET };
        },
    },
    playback: {
        getSongDetail,
        // The SDK chooses the file itself (256 kbit/s AAC on the web for Premium): one level.
        audioQualityLevels: ['high'],
        // A stand-in for the deck; the song itself is sounded by the Web Playback SDK, which is
        // connected first, so that a browser without it or an account without Premium fails here,
        // or by the other device chosen, which is asked once the deck plays.
        async getAudioSource(song, quality) {
            const id = requireSpotifySong(song);
            if (!hasSpotifyWebSession()) throw new OnlineProviderError('auth-required', 'Not signed in to Spotify', 'spotify');
            if (chosenSpotifyWebDevice().id === null) await ensureSpotifyWebPlayer();
            const durationMs = song.durationMs || (await getSongDetail(id))?.durationMs || 0;
            if (!durationMs) throw new OnlineProviderError('not-playable', 'Spotify did not say how long the song is', 'spotify');
            return { url: spotifyWebStandIn(id, durationMs), fetchedAt: Date.now(), quality, standIn: true };
        },
    },
    auth: {
        // The listener's own app on developer.spotify.com, asked for before the browser opens.
        setting: spotifyClientIdSetting,
        getLoginTexts: () => ({
            title: 'home.loginTitleSpotify',
            note: 'home.loginNoteSpotifyWeb',
            caseNotes: {
                'browser-unfinished': 'home.loginCaseSpotifyUnfinished',
                'not-authorized': 'home.loginCaseSpotifyDenied',
                'refused': 'home.loginCaseSpotifyWebNotListed',
                'browser-not-opened': 'home.loginCaseSpotifyWebPopup',
            },
        }),
        // A sign-in Spotify no longer accepts is forgotten (spotifyWebAuth.ts) and reads as none.
        async getLoginStatus() {
            if (!hasSpotifyWebSession()) return null;
            try {
                return await readSpotifyWebMe();
            } catch (error) {
                if (error instanceof OnlineProviderError && error.code === 'auth-required') {
                    forgetSpotifyWebMe();
                    return null;
                }
                throw error;
            }
        },
        async logout() {
            forgetSpotifyWebMe();
            clearSpotifyWebSession();
            disconnectSpotifyWebPlayer();
        },
        async startLogin() { return startSpotifyWebLogin(); },
        openLoginPage: openSpotifyWebLogin,
        checkLogin: key => checkSpotifyWebLogin(key, readSpotifyWebMe),
        describeLoginFailure: (_step, error) => (
            error instanceof OnlineProviderError && error.message === SPOTIFY_WEB_POPUP_BLOCKED ? { case: 'browser-not-opened' } : null
        ),
        async cancelLogin(key) { cancelSpotifyWebLogin(key); },
        getLoginTtlMs: () => SPOTIFY_WEB_LOGIN_TTL_MS,
    },
    devices: {
        list: listSpotifyWebPlaybackDevices,
        chosen: chosenSpotifyWebDevice,
        choose: chooseSpotifyWebDevice,
        subscribe: subscribeSpotifyWebDevice,
        watchElsewhere: watchSpotifyElsewhere,
    },
    catalog: spotifyWebCatalog,
    library: spotifyWebLibrary,
    mutations: spotifyWebMutations,
};
