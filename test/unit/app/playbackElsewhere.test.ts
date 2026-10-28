import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/app/playbackElsewhere.test.ts
// Following what the platform's own app plays (src/components/app/usePlaybackElsewhere.ts): the song
// plays at once, from the queue where it is there (the app moved on by itself, a few seconds before
// the end here), and only then is the queue made the app's next songs, which take a while to read.

const omni = vi.hoisted(() => ({ getSongDetail: vi.fn(), getSongDetails: vi.fn(), watchPlaybackElsewhere: vi.fn() }));
const store = vi.hoisted(() => ({ state: { currentSong: null as unknown, playQueue: [] as unknown[] }, replacePlayQueue: vi.fn() }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni }));
vi.mock('@/services/wholeQueueWrites', () => ({ noteWholeQueueWrite: vi.fn() }));
vi.mock('@/stores/usePlaybackStore', () => ({ usePlaybackStore: { getState: () => store.state }, replacePlayQueue: store.replacePlayQueue }));

import { followElsewherePlay } from '@/components/app/usePlaybackElsewhere';

const song = (mediaId: string) => ({
    id: mediaId, name: `Song ${mediaId}`, artists: [], album: { id: 'm', name: 'Album' }, durationMs: 1000,
    sourceRef: { kind: 'online' as const, providerId: 'spotify', mediaId },
});

describe('following the platform\'s own app', () => {
    const playSong = vi.fn(async (played: unknown, _queue?: unknown[], _isFm?: boolean, _options?: unknown) => { store.state.currentSong = played; });
    const seek = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        store.state = { currentSong: song('a'), playQueue: [song('a'), song('b'), song('c')] };
    });

    it('plays a song of the queue at once, without asking the platform, then makes the queue the app\'s next', async () => {
        let readNext: (details: unknown[]) => void = () => undefined;
        omni.getSongDetails.mockReturnValue(new Promise(resolve => { readNext = resolve; }));
        const following = followElsewherePlay({ providerId: 'spotify', mediaId: 'b', positionMs: 1500, upcoming: ['x', 'y'] }, playSong, seek);
        await vi.waitFor(() => expect(playSong).toHaveBeenCalled());
        expect(playSong).toHaveBeenCalledWith(store.state.playQueue[1], store.state.playQueue, false, { shouldNavigateToPlayer: false, startAtSec: 1.5 });
        expect(omni.getSongDetail).not.toHaveBeenCalled();
        expect(store.replacePlayQueue).not.toHaveBeenCalled();
        readNext([{ status: 'found', song: song('x') }, { status: 'missing' }]);
        await following;
        expect(store.replacePlayQueue).toHaveBeenCalledWith([store.state.currentSong, song('x')], false);
    });

    it('looks up a song that is not in the queue and plays it after the one playing', async () => {
        omni.getSongDetail.mockResolvedValue(song('z'));
        await followElsewherePlay({ providerId: 'spotify', mediaId: 'z', positionMs: 0 }, playSong, seek);
        expect(playSong.mock.calls[0][1]).toEqual([song('a'), song('z'), song('b'), song('c')]);
        expect(omni.getSongDetails).not.toHaveBeenCalled();
    });

    it('keeps the queue where another song plays by the time the next ones are read', async () => {
        omni.getSongDetails.mockImplementation(async () => {
            store.state.currentSong = song('c');
            return [{ status: 'found', song: song('x') }];
        });
        await followElsewherePlay({ providerId: 'spotify', mediaId: 'b', positionMs: 0, upcoming: ['x'] }, playSong, seek);
        expect(store.replacePlayQueue).not.toHaveBeenCalled();
    });

    it('seeks the song playing here, and only fills the queue for the songs next', async () => {
        omni.getSongDetails.mockResolvedValue([{ status: 'found', song: song('x') }]);
        await followElsewherePlay({ providerId: 'spotify', mediaId: 'a', positionMs: 42_000, upcoming: ['x'] }, playSong, seek);
        expect(seek).toHaveBeenCalledWith(42);
        expect(playSong).not.toHaveBeenCalled();
        expect(store.replacePlayQueue).toHaveBeenCalledWith([song('a'), song('x')], false);
        seek.mockClear();
        await followElsewherePlay({ providerId: 'spotify', mediaId: 'a', positionMs: 0, upcoming: ['x'], queueOnly: true }, playSong, seek);
        expect(seek).not.toHaveBeenCalled();
    });
});
