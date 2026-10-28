import { useEffect, useRef } from 'react';
import type { SongResult } from '../../types';
import type { PlaybackNavigationOptions } from '../../types/appPlayback';
import { omni } from '../../services/onlineMusic/omni';
import { noteWholeQueueWrite } from '../../services/wholeQueueWrites';
import { replacePlayQueue, usePlaybackStore } from '../../stores/usePlaybackStore';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../utils/appPlaybackGuards';

// src/components/app/usePlaybackElsewhere.ts
// 在线平台的「播放设备」选了别的设备时，用的人在那台设备自己的 App 里放的歌，这里也跟着放
// （omni.watchPlaybackElsewhere）：正在放的就是那首（停着），从那台设备放到的地方接着放；别的歌，
// 查到以后从那台设备放到的地方开始放。队列都换成那首和那台设备接下来要放的歌（设备没说时插在当前这首后面）。
// 之后播放器跟着那台设备走，不会让它从头再放；接着放这份队列里的歌时，队列再换成那台设备接下来的歌
// （平台一次只给 20 首，这样队列不会放完）。

type PlaySong = (song: SongResult, queue?: SongResult[], isFmCall?: boolean, options?: PlaybackNavigationOptions) => Promise<void>;

export function usePlaybackElsewhere(playSong: PlaySong, seek: (timeSec: number) => void) {
    const latest = useRef({ playSong, seek });
    useEffect(() => {
        latest.current = { playSong, seek };
    });

    useEffect(() => omni.watchPlaybackElsewhere(async play => {
        const { currentSong, playQueue } = usePlaybackStore.getState();
        const atSec = play.positionMs / 1000;
        const playing = currentSong ? getPlaybackSourceRef(currentSong) : null;
        const upcomingOf = async () => {
            if (!play.upcoming?.length) return null;
            const found = await omni.getSongDetails(play.providerId, play.upcoming).catch(() => []);
            return found.flatMap(detail => (detail.status === 'found' ? [detail.song] : []));
        };
        const playsIt = Boolean(currentSong && playing?.kind === 'online' && playing.providerId === play.providerId && String(playing.mediaId) === play.mediaId);
        // Only the songs next: for the song playing here, and not for one that is no longer.
        if (play.queueOnly && !playsIt) return;
        if (currentSong && playsIt) {
            // A seek plays a paused song on; the queue becomes the device's, the song staying as it plays.
            if (!play.queueOnly) latest.current.seek(atSec);
            const upcoming = await upcomingOf();
            if (!upcoming || usePlaybackStore.getState().currentSong !== currentSong) return;
            noteWholeQueueWrite();
            replacePlayQueue([currentSong, ...upcoming], false);
            return;
        }
        const song = await omni.getSongDetail(play.providerId, play.mediaId).catch(() => null);
        if (!song) return;
        const upcoming = await upcomingOf();
        if (upcoming) {
            await latest.current.playSong(song, [song, ...upcoming], false, { shouldNavigateToPlayer: false, startAtSec: atSec });
            return;
        }
        const key = getPlaybackSongKey(song);
        const at = currentSong ? playQueue.findIndex(queued => getPlaybackSongKey(queued) === getPlaybackSongKey(currentSong)) : -1;
        const queue = playQueue.some(queued => getPlaybackSongKey(queued) === key)
            ? playQueue
            : at < 0 ? [song] : [...playQueue.slice(0, at + 1), song, ...playQueue.slice(at + 1)];
        await latest.current.playSong(song, queue, false, { shouldNavigateToPlayer: false, startAtSec: atSec });
    }), []);
}
