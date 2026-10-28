// src/services/onlineMusic/spotify/spotifyLyricOffset.ts
// How much earlier the lyrics of a Spotify song come than the deck says (`OnlineMusicProvider.lyricOffsetMs`),
// in both adapters: Spotify's sound reaches the listener late, whether its own player sounds it or
// another device of the account does. Measured by ear (2026-10-28), not shown among the settings.
export const SPOTIFY_LYRIC_OFFSET_MS = -750;
