import type { UnifiedSong } from '../../../../types';
import { OnlineProviderError } from '../../../../types/onlineMusic';
import type { OnlineCatalogProvider, ProviderCollection, ProviderPage } from '../../../../types/onlineMusic';
import { SPOTIFY_LIKED_ID } from '../spotifyNormalize';
import { callSpotifyWeb, isSpotifyWebNotFound } from './spotifyWebApi';
import { spotifyWebLibraryContains, spotifyWebLikedCollection, spotifyWebMeId } from './spotifyWebLibrary';
import type { SpotifyWebSavedTrack } from './spotifyWebLibrary';
import {
    present, spotifyWebAlbumOf, spotifyWebArtistOf, spotifyWebPage, spotifyWebPlaylistOf, spotifyWebSongOf,
} from './spotifyWebNormalize';
import type { SpotifyWebAlbum, SpotifyWebArtist, SpotifyWebPage, SpotifyWebPlaylist, SpotifyWebTrack } from './spotifyWebNormalize';

// src/services/onlineMusic/spotify/web/spotifyWebCatalog.ts
// Playlists, albums and artists, read through the Web API. What an app in Development Mode cannot
// read: the songs of a playlist the account neither owns nor collaborates on, and an artist's top
// songs (the songs of an artist are a search for the artist's name here).

const PAGE_ROWS = 50;
const SEARCH_ROWS = 10;
// An artist's songs are looked for this many search requests at most for one page.
const ARTIST_SEARCH_REQUESTS = 5;
// Albums and artists read lately, by id: an album's page and its songs are read together. They are
// the public catalogue, the same for every account.
const KEPT_ITEMS = 24;

// What a playlist the account does not own answers: the sentence spotifyWebProvider.ts names.
export const SPOTIFY_WEB_PLAYLIST_CLOSED = 'Spotify lets this app read the songs of its own playlists only';

type PlaylistRow = { item?: SpotifyWebTrack | null; track?: SpotifyWebTrack | null };

const kept = <T>() => {
    const items = new Map<string, Promise<T>>();
    return (id: string, read: () => Promise<T>): Promise<T> => {
        const known = items.get(id);
        if (known) return known;
        const reading = read();
        items.set(id, reading);
        reading.catch(() => items.delete(id));
        while (items.size > KEPT_ITEMS) items.delete(items.keys().next().value!);
        return reading;
    };
};
const albumKept = kept<SpotifyWebAlbum>();
const artistKept = kept<SpotifyWebArtist>();

const readAlbum = (id: string) => albumKept(id, () => callSpotifyWeb<SpotifyWebAlbum>(`/albums/${encodeURIComponent(id)}`));
const readArtist = (id: string) => artistKept(id, () => callSpotifyWeb<SpotifyWebArtist>(`/artists/${encodeURIComponent(id)}`));

// No such item reads as null.
const orNull = async <T>(read: Promise<T>): Promise<T | null> => {
    try {
        return await read;
    } catch (error) {
        if (isSpotifyWebNotFound(error)) return null;
        throw error;
    }
};

const likedTracks = async (limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> => {
    const page = await callSpotifyWeb<SpotifyWebPage<SpotifyWebSavedTrack>>('/me/tracks', { query: { limit: Math.min(limit, PAGE_ROWS), offset } });
    const rows = page.items ?? [];
    return spotifyWebPage(rows.map(row => spotifyWebSongOf(row?.track)).filter(present), offset, rows.length, page);
};

export const spotifyWebCatalog: OnlineCatalogProvider = {
    async getPlaylistTracks(id, limit, offset) {
        if (String(id) === SPOTIFY_LIKED_ID) return likedTracks(limit, offset);
        let page: SpotifyWebPage<PlaylistRow>;
        try {
            page = await callSpotifyWeb<SpotifyWebPage<PlaylistRow>>(`/playlists/${encodeURIComponent(String(id))}/items`, {
                query: { limit: Math.min(limit, PAGE_ROWS), offset, additional_types: 'track' },
            });
        } catch (error) {
            if (error instanceof OnlineProviderError && error.httpStatus === 403) {
                throw new OnlineProviderError('unavailable', SPOTIFY_WEB_PLAYLIST_CLOSED, 'spotify', error, 403);
            }
            throw error;
        }
        const rows = page.items ?? [];
        return spotifyWebPage(rows.map(row => spotifyWebSongOf(row?.item ?? row?.track)).filter(present), offset, rows.length, page);
    },
    async getPlaylistDetail(id) {
        if (String(id) === SPOTIFY_LIKED_ID) return spotifyWebLikedCollection();
        const playlist = await orNull(callSpotifyWeb<SpotifyWebPlaylist>(`/playlists/${encodeURIComponent(String(id))}`));
        return spotifyWebPlaylistOf(playlist, spotifyWebMeId());
    },
    async getAlbumDetail(id) {
        return spotifyWebAlbumOf(await orNull(readAlbum(String(id))));
    },
    // The album's page holds its first 50 songs; the rest are read from its list of songs.
    async getAlbumTracks(id, limit = PAGE_ROWS, offset = 0) {
        const album = await readAlbum(String(id));
        const first = album.tracks?.items ?? [];
        if (offset + limit <= first.length || (offset === 0 && !album.tracks?.next)) {
            const rows = first.slice(offset, offset + limit);
            const items = rows.map(row => spotifyWebSongOf(row, album)).filter(present);
            const total = album.tracks?.total ?? first.length;
            return { items, total, nextOffset: offset + rows.length, hasMore: offset + rows.length < total };
        }
        const page = await callSpotifyWeb<SpotifyWebPage<SpotifyWebTrack>>(`/albums/${encodeURIComponent(String(id))}/tracks`, {
            query: { limit: Math.min(limit, PAGE_ROWS), offset },
        });
        const rows = page.items ?? [];
        return spotifyWebPage(rows.map(row => spotifyWebSongOf(row, album)).filter(present), offset, rows.length, page);
    },
    async getArtistDetail(id) {
        return spotifyWebArtistOf(await orNull(readArtist(String(id))));
    },
    async getArtistAlbums(id, limit, offset) {
        const page = await callSpotifyWeb<SpotifyWebPage<SpotifyWebAlbum>>(`/artists/${encodeURIComponent(String(id))}/albums`, {
            query: { include_groups: 'album,single,compilation', limit: Math.min(limit, PAGE_ROWS), offset },
        });
        const rows = page.items ?? [];
        return spotifyWebPage(rows.map(spotifyWebAlbumOf).filter(present), offset, rows.length, page);
    },
    // The Web API no longer gives an artist's top songs to an app in Development Mode: the songs are
    // a search for the artist's name, keeping those the artist is credited on. `offset` counts the
    // search's rows, so a page may hold fewer songs than asked for.
    async getArtistSongs(id, limit, offset) {
        const artist = await readArtist(String(id));
        if (!artist.name) return { items: [], nextOffset: offset, hasMore: false };
        const songs: UnifiedSong[] = [];
        let at = offset;
        let more = true;
        for (let request = 0; request < ARTIST_SEARCH_REQUESTS && more && songs.length < limit; request += 1) {
            const answer = await callSpotifyWeb<{ tracks?: SpotifyWebPage<SpotifyWebTrack> }>('/search', {
                query: { q: `artist:"${artist.name.replace(/"/g, '')}"`, type: 'track', limit: SEARCH_ROWS, offset: at },
            });
            const rows = answer.tracks?.items ?? [];
            songs.push(...rows.filter(row => row?.artists?.some(credited => credited.id === String(id))).map(row => spotifyWebSongOf(row)).filter(present));
            at += rows.length;
            more = rows.length > 0 && Boolean(answer.tracks?.next);
        }
        return { items: songs, nextOffset: at, hasMore: more };
    },
    async getSubscriptionStatus(type, id, collection?: ProviderCollection) {
        if (type === 'playlist' && (String(id) === SPOTIFY_LIKED_ID || collection?.isOwned)) return true;
        const [keptNow] = await spotifyWebLibraryContains([`spotify:${type}:${id}`]);
        return keptNow;
    },
};
