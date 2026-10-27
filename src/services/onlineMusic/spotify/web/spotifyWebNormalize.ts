import type { Artist, UnifiedSong } from '../../../../types';
import type { ProviderCatalogRef, ProviderCollection, ProviderPage, ProviderUser } from '../../../../types/onlineMusic';
import { OnlineProviderError } from '../../../../types/onlineMusic';

// src/services/onlineMusic/spotify/web/spotifyWebNormalize.ts
// The Web API's objects, as far as the web version reads them, and what they become in the app:
// the same songs and collections the desktop version makes (spotifyNormalize.ts), so a song kept
// by one plays in the other. Fields Spotify took out in February 2026 (popularity, markets,
// followers, a user's country and product) are not read.

export interface SpotifyWebImage { url?: string; width?: number | null }
export interface SpotifyWebArtist { id?: string; name?: string; images?: SpotifyWebImage[] }
export interface SpotifyWebAlbum {
    id?: string;
    name?: string;
    images?: SpotifyWebImage[];
    artists?: SpotifyWebArtist[];
    release_date?: string;
    total_tracks?: number;
    tracks?: SpotifyWebPage<SpotifyWebTrack>;
}
export interface SpotifyWebTrack {
    id?: string | null;
    type?: string;
    name?: string;
    is_local?: boolean;
    duration_ms?: number;
    artists?: SpotifyWebArtist[];
    album?: SpotifyWebAlbum;
}
export interface SpotifyWebPlaylist {
    id?: string;
    name?: string;
    description?: string | null;
    images?: SpotifyWebImage[] | null;
    collaborative?: boolean;
    owner?: { id?: string; display_name?: string | null };
    // `items` since February 2026; `tracks` before it.
    items?: { total?: number };
    tracks?: { total?: number };
}
export interface SpotifyWebUser { id?: string; display_name?: string | null; images?: SpotifyWebImage[] }
export interface SpotifyWebPage<T> { items?: Array<T | null>; total?: number; next?: string | null }

const ref = (kind: 'album' | 'artist', id: string): ProviderCatalogRef | undefined => (
    id ? { providerId: 'spotify', kind, id } : undefined
);

// Spotify lists a picture in several sizes, largest first; the width is not always there.
const pictureOf = (images: SpotifyWebImage[] | null | undefined): string => (
    (images ?? []).reduce<SpotifyWebImage | null>((best, image) => (
        image?.url && (!best || (image.width ?? 0) > (best.width ?? 0)) ? image : best
    ), null)?.url ?? ''
);

const artistsOf = (artists: SpotifyWebArtist[] | undefined): Artist[] => (artists ?? [])
    .filter(artist => artist?.name)
    .map(artist => ({ id: artist.id ?? '', name: artist.name!, catalogRef: ref('artist', artist.id ?? '') }));

/** The album a song read from that album's page belongs to. */
export const spotifyWebSongAlbum = (album: SpotifyWebAlbum): UnifiedSong['album'] => ({
    id: album.id ?? '', name: album.name ?? '', coverUrl: pictureOf(album.images), catalogRef: ref('album', album.id ?? ''),
});

// Null for a row that is not a song: a podcast episode, a file of the owner's own computer, a
// track Spotify has withdrawn (a row without an id).
export const spotifyWebSongOf = (track: SpotifyWebTrack | null | undefined, album?: SpotifyWebAlbum): UnifiedSong | null => {
    if (!track?.id || !track.name || track.is_local || (track.type && track.type !== 'track')) return null;
    return {
        id: track.id,
        name: track.name,
        artists: artistsOf(track.artists),
        album: spotifyWebSongAlbum(album ?? track.album ?? {}),
        durationMs: Math.max(0, Number(track.duration_ms) || 0),
        sourceRef: { kind: 'online', providerId: 'spotify', mediaId: track.id },
    };
};

// Cached canonical songs pass through unchanged.
export const normalizeSpotifyWebSong = (raw: unknown): UnifiedSong => {
    const item = (raw ?? {}) as SpotifyWebTrack & { sourceRef?: UnifiedSong['sourceRef'] };
    if (item.sourceRef?.kind === 'online' && item.sourceRef.providerId === 'spotify') return item as unknown as UnifiedSong;
    const song = spotifyWebSongOf(item);
    if (!song) throw new OnlineProviderError('invalid-response', 'Spotify song has no id', 'spotify');
    return song;
};

export const spotifyWebUserOf = (user: SpotifyWebUser): ProviderUser => ({
    id: user.id ?? '', nickname: user.display_name || user.id || '', avatarUrl: pictureOf(user.images),
});

// A playlist's description is a line of HTML: links to other playlists, and escaped characters.
const plainText = (html: string | null | undefined): string => (html ?? '').replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_all, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#x27': '\'', '#39': '\'' })[name] ?? '');

/** `meId`: the signed-in account, whose own playlists (and collaborative ones) it may change. */
export const spotifyWebPlaylistOf = (playlist: SpotifyWebPlaylist | null | undefined, meId: string): ProviderCollection | null => {
    if (!playlist?.id) return null;
    const owner = playlist.owner;
    const trackCount = playlist.items?.total ?? playlist.tracks?.total;
    return {
        providerId: 'spotify', id: playlist.id, type: 'playlist', name: playlist.name || '',
        coverUrl: pictureOf(playlist.images), description: plainText(playlist.description),
        ...(owner?.display_name || owner?.id ? { creator: { id: owner.id ?? '', nickname: owner.display_name || owner.id || '' } } : {}),
        ...(trackCount === undefined ? {} : { trackCount }),
        ...((meId && owner?.id === meId) || playlist.collaborative ? { isOwned: true } : {}),
    };
};

export const spotifyWebAlbumOf = (album: SpotifyWebAlbum | null | undefined): ProviderCollection | null => {
    if (!album?.id) return null;
    // A date is a year, a month or a day.
    const publishedAt = album.release_date ? Date.parse(album.release_date.length === 4 ? `${album.release_date}-01-01` : album.release_date) : NaN;
    const trackCount = album.total_tracks ?? album.tracks?.total;
    return {
        providerId: 'spotify', id: album.id, type: 'album', name: album.name || '',
        coverUrl: pictureOf(album.images), description: '', artists: artistsOf(album.artists),
        ...(trackCount === undefined ? {} : { trackCount }),
        ...(Number.isFinite(publishedAt) ? { publishedAt } : {}),
    };
};

export const spotifyWebArtistOf = (artist: SpotifyWebArtist | null | undefined): ProviderCollection | null => (
    artist?.id && artist.name
        ? { providerId: 'spotify', id: artist.id, type: 'artist', name: artist.name, coverUrl: pictureOf(artist.images), description: '' }
        : null
);

// Cached canonical collections pass through unchanged; anything else is one of the Web API's objects.
export const normalizeSpotifyWebCollection = (raw: unknown, type = 'playlist'): ProviderCollection => {
    const item = (raw ?? {}) as { providerId?: string };
    if (item.providerId === 'spotify') return item as unknown as ProviderCollection;
    const collection = type === 'album' ? spotifyWebAlbumOf(raw as SpotifyWebAlbum)
        : type === 'artist' ? spotifyWebArtistOf(raw as SpotifyWebArtist) : spotifyWebPlaylistOf(raw as SpotifyWebPlaylist, '');
    if (!collection) throw new OnlineProviderError('invalid-response', 'Spotify collection has no id', 'spotify');
    return collection;
};

/**
 * A page of the app's, from a page of Spotify's that began at `offset` and held `read` rows (rows
 * that are no song or collection are left out of `items`, and the next page begins after them).
 */
export const spotifyWebPage = <T>(items: T[], offset: number, read: number, page: SpotifyWebPage<unknown>): ProviderPage<T> => {
    const nextOffset = offset + read;
    return {
        items, ...(page.total === undefined ? {} : { total: page.total }), nextOffset,
        hasMore: read > 0 && (page.next ? true : page.total !== undefined && nextOffset < page.total),
    };
};

export const present = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined;
