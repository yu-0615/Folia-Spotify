import type { SongResult } from '../../../../types';
import { OnlineProviderError } from '../../../../types/onlineMusic';
import type { MediaId, OnlineMutationProvider } from '../../../../types/onlineMusic';
import { requireSpotifySong } from '../spotifyNormalize';
import { spotifyMutations } from '../spotifyMutations';
import { callSpotifyWeb } from './spotifyWebApi';
import { spotifyWebPlaylistOf } from './spotifyWebNormalize';
import type { SpotifyWebPlaylist } from './spotifyWebNormalize';
import { spotifyWebMeId } from './spotifyWebLibrary';

// src/services/onlineMusic/spotify/web/spotifyWebMutations.ts
// Changes to the signed-in account through the Web API: liked songs, kept albums and followed
// playlists go through /me/library by uri (February 2026); the songs of its own playlists through
// /playlists/{id}/items. Which collections can be changed is the desktop version's rule.

// Spotify takes this many songs in one playlist request.
const SONGS_PER_REQUEST = 100;

const songId = (song: MediaId | SongResult): string => (typeof song === 'object' ? requireSpotifySong(song) : String(song));

const keep = (uri: string, saved: boolean) => callSpotifyWeb('/me/library', { method: saved ? 'PUT' : 'DELETE', body: { uris: [uri] } });

export const spotifyWebMutations: OnlineMutationProvider = {
    canAddToPlaylist: spotifyMutations.canAddToPlaylist,
    canSubscribe: spotifyMutations.canSubscribe,
    async likeSong(song, liked) {
        await keep(`spotify:track:${songId(song)}`, liked);
    },
    async subscribeAlbum(id, subscribed) {
        await keep(`spotify:album:${id}`, subscribed);
    },
    async subscribePlaylist(playlist, subscribed) {
        await keep(`spotify:playlist:${typeof playlist === 'object' ? playlist.id : playlist}`, subscribed);
    },
    // Unlike the desktop version, a song already in the playlist is added again: the Web API does
    // not leave it out. Removing a song takes every copy of it.
    async updatePlaylistTracks(operation, playlist, tracks) {
        if (typeof playlist === 'object' && spotifyMutations.canAddToPlaylist && !spotifyMutations.canAddToPlaylist(playlist)) {
            throw new OnlineProviderError('unsupported', 'Playlist is not one the account may change the songs of', 'spotify');
        }
        const id = encodeURIComponent(String(typeof playlist === 'object' ? playlist.id : playlist));
        const uris = tracks.map(track => `spotify:track:${songId(track)}`);
        for (let start = 0; start < uris.length; start += SONGS_PER_REQUEST) {
            const slice = uris.slice(start, start + SONGS_PER_REQUEST);
            await callSpotifyWeb(`/playlists/${id}/items`, operation === 'add'
                ? { method: 'POST', body: { uris: slice } }
                : { method: 'DELETE', body: { items: slice.map(uri => ({ uri })) } });
        }
    },
    async createPlaylist(name) {
        const made = await callSpotifyWeb<SpotifyWebPlaylist>('/me/playlists', { method: 'POST', body: { name: name.trim(), public: false } });
        const playlist = spotifyWebPlaylistOf(made, spotifyWebMeId());
        if (!playlist) throw new OnlineProviderError('invalid-response', 'Spotify did not name the new playlist', 'spotify');
        return { ...playlist, trackCount: 0, isOwned: true };
    },
};
