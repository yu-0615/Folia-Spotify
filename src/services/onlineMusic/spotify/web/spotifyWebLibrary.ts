import i18n from '../../../../i18n/config';
import { OnlineProviderError } from '../../../../types/onlineMusic';
import type { OnlineLibraryProvider, ProviderCollection, ProviderUser } from '../../../../types/onlineMusic';
import { SPOTIFY_LIKED_ID } from '../spotifyNormalize';
import { callSpotifyWeb } from './spotifyWebApi';
import {
    present, spotifyWebAlbumOf, spotifyWebPage, spotifyWebPlaylistOf, spotifyWebSongOf, spotifyWebUserOf,
} from './spotifyWebNormalize';
import type { SpotifyWebAlbum, SpotifyWebPage, SpotifyWebPlaylist, SpotifyWebTrack, SpotifyWebUser } from './spotifyWebNormalize';

// src/services/onlineMusic/spotify/web/spotifyWebLibrary.ts
// What the account keeps, read through the Web API: its playlists, its albums, and the songs it
// liked, which the app shows as one more playlist (the same card as the desktop version's).

// Spotify gives at most 50 rows of a library list a request.
const LIBRARY_ROWS = 50;
// The liked songs are read to this many rows at most: 40 requests. Past it, `areSongsLiked` asks
// for the songs that are played.
const LIKED_MAX_ROWS = 2000;
// How many uris one /me/library/contains request carries.
const CONTAINS_PER_REQUEST = 40;

export type SpotifyWebSavedTrack = { track?: SpotifyWebTrack | null };

let me: ProviderUser | null = null;

/** The signed-in account, read again from Spotify. */
export const readSpotifyWebMe = async (): Promise<ProviderUser> => {
    me = spotifyWebUserOf(await callSpotifyWeb<SpotifyWebUser>('/me'));
    return me;
};

/** The id of the signed-in account as last read, '' before it is read. */
export const spotifyWebMeId = (): string => String(me?.id ?? '');

export const forgetSpotifyWebMe = (): void => {
    me = null;
};

/** Whether the account keeps each of these uris (songs, albums, playlists), in the order asked. */
export const spotifyWebLibraryContains = async (uris: string[]): Promise<boolean[]> => {
    const kept: boolean[] = [];
    for (let start = 0; start < uris.length; start += CONTAINS_PER_REQUEST) {
        const slice = uris.slice(start, start + CONTAINS_PER_REQUEST);
        const answer = await callSpotifyWeb<unknown>('/me/library/contains', { query: { uris: slice.join(',') } });
        if (!Array.isArray(answer) || answer.length !== slice.length) {
            throw new OnlineProviderError('invalid-response', 'Spotify did not answer for every uri', 'spotify');
        }
        kept.push(...answer.map(Boolean));
    }
    return kept;
};

const likedHead = () => callSpotifyWeb<SpotifyWebPage<SpotifyWebSavedTrack>>('/me/tracks', { query: { limit: 1 } });

/** The liked songs as a playlist card: how many there are, under the cover of the latest one. */
export const spotifyWebLikedCollection = async (): Promise<ProviderCollection> => {
    const head = await likedHead();
    return {
        providerId: 'spotify', id: SPOTIFY_LIKED_ID, type: 'playlist', name: i18n.t('home.spotifyLikedSongs'),
        coverUrl: spotifyWebSongOf(head.items?.[0]?.track)?.album.coverUrl ?? '', description: '',
        trackCount: head.total ?? 0, isLiked: true, isOwned: true,
    };
};

export const spotifyWebLibrary: OnlineLibraryProvider = {
    // The liked songs come first, on the first page only; `total` counts them in.
    async getUserPlaylists(_userId, limit, offset) {
        if (!spotifyWebMeId()) await readSpotifyWebMe();
        const [page, liked] = await Promise.all([
            callSpotifyWeb<SpotifyWebPage<SpotifyWebPlaylist>>('/me/playlists', { query: { limit: Math.min(limit, LIBRARY_ROWS), offset } }),
            offset === 0 ? spotifyWebLikedCollection() : null,
        ]);
        const rows = page.items ?? [];
        const playlists = rows.map(row => spotifyWebPlaylistOf(row, spotifyWebMeId())).filter(present);
        const listed = spotifyWebPage(liked ? [liked, ...playlists] : playlists, offset, rows.length, page);
        return { ...listed, ...(listed.total === undefined ? {} : { total: listed.total + 1 }) };
    },
    async getLikedSongIds() {
        const ids: string[] = [];
        let offset = 0;
        let whole = false;
        while (offset < LIKED_MAX_ROWS) {
            const page = await callSpotifyWeb<SpotifyWebPage<SpotifyWebSavedTrack>>('/me/tracks', { query: { limit: LIBRARY_ROWS, offset } });
            // An answer without the list is no empty list: the read fails.
            if (!Array.isArray(page.items)) throw new OnlineProviderError('invalid-response', 'Spotify liked songs are missing', 'spotify');
            ids.push(...page.items.map(row => row?.track?.id).filter((id): id is string => Boolean(id)));
            offset += page.items.length;
            whole = !page.next;
            if (whole || page.items.length === 0) break;
        }
        if (!whole) console.warn(`[Spotify] Web: the liked songs were read to ${offset} rows, not to their end; the hearts of the others are asked song by song`);
        return { ids, whole };
    },
    async areSongsLiked(ids) {
        const kept = await spotifyWebLibraryContains(ids.map(id => `spotify:track:${id}`));
        return Object.fromEntries(ids.map((id, at) => [String(id), kept[at]]));
    },
    async getLikedSongCount() {
        return (await likedHead()).total ?? null;
    },
    async getUserAlbums(_userId, limit, offset) {
        const page = await callSpotifyWeb<SpotifyWebPage<{ album?: SpotifyWebAlbum }>>('/me/albums', { query: { limit: Math.min(limit, LIBRARY_ROWS), offset } });
        const rows = page.items ?? [];
        return spotifyWebPage(rows.map(row => spotifyWebAlbumOf(row?.album)).filter(present), offset, rows.length, page);
    },
};
