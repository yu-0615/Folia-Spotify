import { useEffect, useRef } from 'react';
import type { SongResult } from '../../types';
import type { PlaybackNavigationOptions } from '../../types/appPlayback';
import type { OmniElsewherePlay } from '../../types/onlineMusic';
import { omni } from '../../services/onlineMusic/omni';
import { noteWholeQueueWrite } from '../../services/wholeQueueWrites';
import { replacePlayQueue, usePlaybackStore } from '../../stores/usePlaybackStore';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../utils/appPlaybackGuards';

// src/components/app/usePlaybackElsewhere.ts
// 在线平台的歌在它自己的 App 里出声时，用的人在那个 App 里放的歌，这里也跟着放
// （omni.watchPlaybackElsewhere）：正在放的就是那首（停着），从那台设备放到的地方接着放；别的歌马上从那台设备放到的地方开始放：
// 队列里有它（平台自己换到下一首，常比这里早几秒）就直接放队列里的那首，不再问平台；没有才查这一首，插在当前这首后面。
// 放起来以后再把队列换成那首和那台设备接下来要放的歌（查 20 首要几秒，不让歌等它）。
// 之后播放器跟着那台设备走，不会让它从头再放；接着放这份队列里的歌时，队列再换成那台设备接下来的歌
// （平台一次只给 20 首，这样队列不会放完）。

type PlaySong = (song: SongResult, queue?: SongResult[], isFmCall?: boolean, options?: PlaybackNavigationOptions) => Promise<void>;

const isTheSong = (song: SongResult | null | undefined, play: OmniElsewherePlay): song is SongResult => {
    const ref = song ? getPlaybackSourceRef(song) : null;
    return ref?.kind === 'online' && ref.providerId === play.providerId && String(ref.mediaId) === play.mediaId;
};

/** Plays what the platform's own app plays (see the top of the file); `playSong` and `seek` are the app's. */
export const followElsewherePlay = async (play: OmniElsewherePlay, playSong: PlaySong, seek: (timeSec: number) => void): Promise<void> => {
    const { currentSong, playQueue } = usePlaybackStore.getState();
    const atSec = play.positionMs / 1000;
    // Only the songs next: for the song playing here, and not for one that is no longer.
    if (play.queueOnly && !isTheSong(currentSong, play)) return;
    let song: SongResult;
    if (isTheSong(currentSong, play)) {
        // A seek plays a paused song on.
        if (!play.queueOnly) seek(atSec);
        song = currentSong;
    } else {
        const queued = playQueue.find(entry => isTheSong(entry, play));
        if (queued) {
            song = queued;
            await playSong(song, playQueue, false, { shouldNavigateToPlayer: false, startAtSec: atSec });
        } else {
            const found = await omni.getSongDetail(play.providerId, play.mediaId).catch(() => null);
            if (!found) return;
            song = found;
            const at = currentSong ? playQueue.findIndex(entry => getPlaybackSongKey(entry) === getPlaybackSongKey(currentSong)) : -1;
            const queue = at < 0 ? [song] : [...playQueue.slice(0, at + 1), song, ...playQueue.slice(at + 1)];
            await playSong(song, queue, false, { shouldNavigateToPlayer: false, startAtSec: atSec });
        }
    }
    // The queue becomes the device's, the song staying as it plays.
    if (!play.upcoming?.length) return;
    const found = await omni.getSongDetails(play.providerId, play.upcoming).catch(() => []);
    const upcoming = found.flatMap(detail => (detail.status === 'found' ? [detail.song] : []));
    const playing = usePlaybackStore.getState().currentSong;
    if (upcoming.length === 0 || !playing || getPlaybackSongKey(playing) !== getPlaybackSongKey(song)) return;
    noteWholeQueueWrite();
    replacePlayQueue([playing, ...upcoming], false);
};

export function usePlaybackElsewhere(playSong: PlaySong, seek: (timeSec: number) => void) {
    const latest = useRef({ playSong, seek });
    useEffect(() => {
        latest.current = { playSong, seek };
    });

    useEffect(() => omni.watchPlaybackElsewhere((play) => {
        followElsewherePlay(play, latest.current.playSong, latest.current.seek)
            .catch(error => console.warn('[Elsewhere] The song played in the platform\'s app could not be followed', error));
    }), []);
}
