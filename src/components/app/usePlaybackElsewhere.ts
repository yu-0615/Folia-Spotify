import { useEffect, useRef } from 'react';
import type { SongResult } from '../../types';
import type { PlaybackNavigationOptions } from '../../types/appPlayback';
import { omni } from '../../services/onlineMusic/omni';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../utils/appPlaybackGuards';

// src/components/app/usePlaybackElsewhere.ts
// 在线平台的「播放设备」选了别的设备时，用的人在那台设备自己的 App 里放的歌，这里也跟着放
// （omni.watchPlaybackElsewhere）：正在放的就是那首（停着），从那台设备放到的地方接着放；别的歌，
// 查到以后从那台设备放到的地方开始放，队列换成那首和那台设备接下来要放的歌（设备没说时插在当前这首后面）。
// 之后播放器跟着那台设备走，不会让它从头再放。

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
        if (playing?.kind === 'online' && playing.providerId === play.providerId && String(playing.mediaId) === play.mediaId) {
            // A seek plays a paused song on.
            latest.current.seek(atSec);
            return;
        }
        const song = await omni.getSongDetail(play.providerId, play.mediaId).catch(() => null);
        if (!song) return;
        if (play.upcoming?.length) {
            const next = await omni.getSongDetails(play.providerId, play.upcoming).catch(() => []);
            const upcoming = next.flatMap(detail => (detail.status === 'found' ? [detail.song] : []));
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
