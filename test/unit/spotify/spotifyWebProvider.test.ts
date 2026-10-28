import { resolveObjectURL } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyWebProvider.test.ts — the web version's Spotify adapter
// (src/services/onlineMusic/spotify/web/) against stand-ins for the Web API, the token endpoint and
// the browser: which adapter is registered, the sign-in with PKCE, token renewal, paging under the
// Development Mode limits, and the silent stand-in a song plays from. Nothing here asks Spotify, and
// the Web Playback SDK is not loaded (`ensureSpotifyWebPlayer` is replaced).

vi.mock('@/services/onlineMusic/providerAccountCache', () => ({ saveProviderAccountSnapshot: vi.fn() }));
const ensurePlayer = vi.hoisted(() => vi.fn(async () => ({ deviceId: 'device' })));
vi.mock('@/services/onlineMusic/spotify/web/spotifyWebPlayback', async importOriginal => ({
    ...(await importOriginal<object>()),
    ensureSpotifyWebPlayer: ensurePlayer,
}));

import { omni } from '@/services/onlineMusic/omni';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { whyPreviewClip } from '@/services/wholeSongCheck';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { isLyricMatchSourceOffered } from '@/utils/lyrics/lyricMatchSources';
import { OnlineProviderError } from '@/types/onlineMusic';
import type { OnlineMusicProvider } from '@/types/onlineMusic';

const SESSION_KEY = 'folia_spotify_web_session';
const memory = new Map<string, string>();
const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, String(value)); },
    removeItem: (key: string) => { memory.delete(key); },
};
const fetchMock = vi.fn();
const openMock = vi.fn((_url: string, _name?: string, _features?: string): unknown => ({}));

const id = (letter: string) => letter.repeat(22);
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => (
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers })
);
const track = (letter: string, extra: Record<string, unknown> = {}) => ({
    id: id(letter), type: 'track', name: `Song ${letter}`, duration_ms: 2000,
    artists: [{ id: id('r'), name: 'Artist' }],
    album: { id: id('m'), name: 'Album', images: [{ url: 'https://i.scdn.co/image/small', width: 64 }, { url: 'https://i.scdn.co/image/large', width: 640 }] },
    ...extra,
});
// Answers each request by the first route its address starts with: `${method} ${path}`.
type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;
const answer = (routes: Record<string, Route>) => fetchMock.mockImplementation(async (address: string, init: RequestInit = {}) => {
    const url = new URL(address);
    const name = `${init.method ?? 'GET'} ${url.origin === 'https://accounts.spotify.com' ? url.pathname : url.pathname.replace(/^\/v1/, '')}`;
    const route = Object.entries(routes).find(([prefix]) => name.startsWith(prefix));
    if (!route) throw new Error(`unexpected request ${name}`);
    return route[1](url, init);
});
const signedIn = (expiresAt = Date.now() + 3_600_000) => {
    memory.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-a', refreshToken: 'refresh-a', expiresAt }));
};
const spotify = (): OnlineMusicProvider => getOnlineMusicProvider('spotify')!;
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

beforeEach(() => {
    memory.clear();
    fetchMock.mockReset();
    openMock.mockClear();
    ensurePlayer.mockClear();
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'client-test');
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { location: { origin: 'https://folia.test' }, open: openMock, localStorage: storage });
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('which Spotify adapter is registered', () => {
    it('is the web one where the build names a Spotify app and there is no desktop bridge', () => {
        expect(spotify().capabilities.explore).toBe(false);
        expect(spotify().getAvailability?.()).toEqual({ configured: true });
    });

    it('is the web one in a browser without a Client ID too, which asks for one at sign-in and keeps it here', async () => {
        vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', '');
        expect(spotify().capabilities.explore).toBe(false);
        expect(spotify().getAvailability?.()).toEqual({ configured: true });
        const setting = spotify().auth!.setting!;
        expect(setting.get()).toBe('');
        expect(setting.hintValues?.()).toEqual({ redirect: 'https://folia.test/spotify-callback.html' });
        await expect(spotify().auth!.startLogin!()).rejects.toMatchObject({ code: 'unavailable' });
        setting.set('  client-mine ');
        expect(setting.get()).toBe('client-mine');
        expect(memory.get('folia_spotify_client_id')).toBe('client-mine');
        // A sign-in made through another app is dropped when the Client ID changes.
        signedIn();
        setting.set('client-other');
        expect(memory.has(SESSION_KEY)).toBe(false);
    });

    it('signs the desktop app in through the listener\'s browser, coming back to a loopback address', async () => {
        const openLoopbackSignIn = vi.fn(async () => true);
        let callback: ((query: { code?: string; state?: string }) => void) | null = null;
        vi.stubGlobal('window', {
            location: { origin: 'file://' }, open: openMock,
            electron: { spotifyRequest: vi.fn(), openLoopbackSignIn, onLoopbackSignIn: (listener: never) => { callback = listener; return () => undefined; } },
        });
        // (The desktop adapter is registered; its devices sign in this way.)
        expect(spotify().capabilities.explore).toBe(true);
        expect(spotify().devices?.signIn?.needed()).toBe(true);
        answer({
            'POST /api/token': () => reply({ access_token: 'access-d', refresh_token: 'refresh-d', expires_in: 3600 }),
            'GET /me': () => reply({ id: 'me', display_name: 'Me' }),
        });
        const done = spotify().devices!.signIn!.start();
        await vi.waitFor(() => expect(openLoopbackSignIn).toHaveBeenCalled());
        const request = (openLoopbackSignIn.mock.calls[0] as unknown as [{ url: string; port: number; path: string }])[0];
        expect(request).toMatchObject({ port: 5590, path: '/spotify-callback.html' });
        const page = new URL(request.url);
        expect(page.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5590/spotify-callback.html');
        expect(openMock).not.toHaveBeenCalled();
        callback!({ state: page.searchParams.get('state')!, code: 'code-d' });
        await done;
        expect(spotify().devices?.signIn?.needed()).toBe(false);
    });

    it('is the desktop one where the desktop bridge is there', () => {
        vi.stubGlobal('window', { location: { origin: 'https://folia.test' }, electron: { spotifyRequest: vi.fn() } });
        expect(spotify().capabilities.explore).toBe(true);
    });
});

describe('signing in', () => {
    it('opens the consent page with PKCE, waits for the answer and exchanges the code', async () => {
        const key = await omni.startLogin('spotify');
        const started = typeof key === 'string' ? key : (key as { key: string }).key;
        await spotify().auth!.openLoginPage!(started);
        const page = new URL(openMock.mock.calls[0][0]);
        expect(page.origin + page.pathname).toBe('https://accounts.spotify.com/authorize');
        expect(Object.fromEntries(page.searchParams)).toMatchObject({
            client_id: 'client-test', response_type: 'code', state: started, code_challenge_method: 'S256',
            redirect_uri: 'https://folia.test/spotify-callback.html',
        });
        expect(page.searchParams.get('scope')).toContain('streaming');
        expect(await spotify().auth!.checkLogin!(started)).toEqual({ state: 'waiting' });

        answer({
            'POST /api/token': (_url, init) => {
                const form = new URLSearchParams(String(init.body));
                expect(form.get('code')).toBe('code-1');
                expect(form.get('code_verifier')).toMatch(/^[\w-]{43,128}$/);
                return reply({ access_token: 'access-b', refresh_token: 'refresh-b', expires_in: 3600 });
            },
            'GET /me': () => reply({ id: 'me', display_name: 'Listener' }),
        });
        const channel = new BroadcastChannel('folia-spotify-login');
        channel.postMessage({ state: started, code: 'code-1', error: '' });
        channel.close();
        await settle();
        expect(await spotify().auth!.checkLogin!(started)).toEqual({ state: 'confirmed' });
        expect(JSON.parse(memory.get(SESSION_KEY)!)).toMatchObject({ accessToken: 'access-b', refreshToken: 'refresh-b' });
        expect(await spotify().auth!.getLoginStatus()).toMatchObject({ id: 'me', nickname: 'Listener' });
    });

    it('names the cancel on Spotify\'s page not-authorized', async () => {
        const key = await spotify().auth!.startLogin!();
        const channel = new BroadcastChannel('folia-spotify-login');
        channel.postMessage({ state: key, code: '', error: 'access_denied' });
        channel.close();
        await settle();
        expect(await spotify().auth!.checkLogin!(key)).toMatchObject({ state: 'error', failure: { case: 'not-authorized' } });
    });

    it('names an account the Development Mode app does not list refused, and keeps no session', async () => {
        const key = await spotify().auth!.startLogin!();
        answer({
            'POST /api/token': () => reply({ access_token: 'access-b', refresh_token: 'refresh-b', expires_in: 3600 }),
            'GET /me': () => reply({ error: { status: 403, message: 'User not registered in the Developer Dashboard' } }, 403),
        });
        const channel = new BroadcastChannel('folia-spotify-login');
        channel.postMessage({ state: key, code: 'code-2', error: '' });
        channel.close();
        await settle();
        expect(await spotify().auth!.checkLogin!(key)).toMatchObject({ state: 'error', failure: { case: 'refused', httpStatus: 403 } });
        expect(memory.has(SESSION_KEY)).toBe(false);
    });

    it('names a blocked window browser-not-opened', async () => {
        openMock.mockReturnValueOnce(null);
        const key = await spotify().auth!.startLogin!();
        const opened = spotify().auth!.openLoginPage!(key);
        await expect(opened).rejects.toBeInstanceOf(OnlineProviderError);
        const error = await opened.catch(caught => caught);
        expect(spotify().auth!.describeLoginFailure!('open', error)).toEqual({ case: 'browser-not-opened' });
    });
});

describe('tokens', () => {
    it('renews a token Spotify refuses once and keeps the refresh token it gave no new one for', async () => {
        signedIn();
        let reads = 0;
        answer({
            'GET /me': (_url, init) => {
                reads += 1;
                const bearer = (init.headers as Record<string, string>).Authorization;
                return bearer === 'Bearer access-a' ? reply({ error: { status: 401, message: 'expired' } }, 401) : reply({ id: 'me', display_name: 'Listener' });
            },
            'POST /api/token': (_url, init) => {
                expect(new URLSearchParams(String(init.body)).get('grant_type')).toBe('refresh_token');
                return reply({ access_token: 'access-c', expires_in: 3600 });
            },
        });
        expect(await spotify().auth!.getLoginStatus()).toMatchObject({ id: 'me' });
        expect(reads).toBe(2);
        expect(JSON.parse(memory.get(SESSION_KEY)!)).toMatchObject({ accessToken: 'access-c', refreshToken: 'refresh-a' });
    });

    it('forgets a sign-in whose refresh Spotify refuses: nobody is signed in', async () => {
        signedIn(Date.now() - 1000);
        answer({ 'POST /api/token': () => reply({ error: 'invalid_grant' }, 400) });
        expect(await spotify().auth!.getLoginStatus()).toBeNull();
        expect(memory.has(SESSION_KEY)).toBe(false);
    });
});

describe('reading', () => {
    it('reads a search 10 rows a request until the page is full', async () => {
        signedIn();
        answer({
            'GET /search': (url) => {
                const offset = Number(url.searchParams.get('offset'));
                const limit = Number(url.searchParams.get('limit'));
                expect(limit).toBeLessThanOrEqual(10);
                const items = Array.from({ length: limit }, (_, at) => track(String.fromCharCode(97 + ((offset + at) % 26)), { id: `${offset + at}`.padStart(22, '0') }));
                return reply({ tracks: { items, total: 100, next: 'more' } });
            },
        });
        const page = await spotify().search!.searchSongs('song', 25, 0);
        const asked = fetchMock.mock.calls.map(([address]) => new URL(address).searchParams);
        expect(asked.map(params => [params.get('offset'), params.get('limit')])).toEqual([['0', '10'], ['10', '10'], ['20', '5']]);
        expect(page).toMatchObject({ nextOffset: 25, hasMore: true, total: 100 });
        expect(page.items).toHaveLength(25);
        expect(page.items[0]).toMatchObject({ sourceRef: { kind: 'online', providerId: 'spotify' }, album: { coverUrl: 'https://i.scdn.co/image/large' } });
    });

    it('puts the liked songs first among the playlists and marks the account\'s own', async () => {
        signedIn();
        answer({
            'GET /me/playlists': () => reply({
                items: [
                    { id: 'own', name: 'Mine', owner: { id: 'me', display_name: 'Listener' }, items: { total: 3 } },
                    { id: 'theirs', name: 'Theirs', owner: { id: 'other', display_name: 'Other' }, items: { total: 9 } },
                ],
                total: 2, next: null,
            }),
            'GET /me/tracks': () => reply({ items: [{ track: track('a') }], total: 42, next: null }),
            'GET /me': () => reply({ id: 'me', display_name: 'Listener' }),
        });
        const page = await spotify().library!.getUserPlaylists('me', 50, 0);
        expect(page.items.map(item => [item.id, item.isOwned ?? false, item.trackCount])).toEqual([['liked', true, 42], ['own', true, 3], ['theirs', false, 9]]);
        expect(page).toMatchObject({ total: 3, hasMore: false });
    });

    it('says a playlist of someone else cannot be read by this app, as refused', async () => {
        signedIn();
        answer({ 'GET /playlists/theirs/items': () => reply({ error: { status: 403, message: 'Forbidden' } }, 403) });
        const read = spotify().catalog!.getPlaylistTracks!('theirs', 50, 0);
        const error = await read.catch(caught => caught);
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(spotify().describeFailure!('collection', error)).toMatchObject({ case: 'refused', httpStatus: 403 });
    });

    it('likes a song through /me/library by its uri', async () => {
        signedIn();
        answer({ 'PUT /me/library': (_url, init) => { expect(JSON.parse(String(init.body))).toEqual({ uris: [`spotify:track:${id('a')}`] }); return reply(undefined, 200); } });
        await spotify().mutations!.likeSong!(id('a'), true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('playing', () => {
    const song = {
        id: id('a'), name: 'Song a', artists: [], album: { id: id('m'), name: 'Album' }, durationMs: 2000,
        sourceRef: { kind: 'online' as const, providerId: 'spotify', mediaId: id('a') },
    };

    it('hands the deck silence as long as the song, which is never taken for the song', async () => {
        signedIn();
        const source = await omni.getAudioSource(song as never, 'high');
        expect(ensurePlayer).toHaveBeenCalled();
        expect(source).toMatchObject({ standIn: true });
        expect(source!.url.startsWith('blob:')).toBe(true);
        expect(omni.isStandInAudioSource(source!.url)).toBe(true);
        expect(omni.isPreviewAudioSource(source!.url)).toBe(false);
        expect(whyPreviewClip(source!.url)).toContain('silence');

        const wav = resolveObjectURL(source!.url)!;
        expect(wav.size).toBe(44 + 2 * 8000);
        const head = new TextDecoder().decode(new Uint8Array(await wav.arrayBuffer()).slice(0, 12));
        expect(head.startsWith('RIFF') && head.endsWith('WAVE')).toBe(true);

        // The same song is handed the same stand-in.
        expect((await omni.getAudioSource(song as never, 'high'))!.url).toBe(source!.url);
    });

    it('asks for a sign-in before connecting the player', async () => {
        await expect(spotify().playback!.getAudioSource(song as never, 'high')).rejects.toMatchObject({ code: 'auth-required' });
        expect(ensurePlayer).not.toHaveBeenCalled();
    });
});

describe('lyrics', () => {
    const song = {
        id: id('a'), name: 'Song a', artists: [], album: { id: id('m'), name: 'Album' }, durationMs: 2000,
        sourceRef: { kind: 'online' as const, providerId: 'spotify', mediaId: id('a') },
    };

    it('reads none of its own: a song has none from it, and is looked up in the other sources', async () => {
        expect(omni.hasOwnLyrics(song as never)).toBe(false);
        expect(await omni.getLyrics(song as never)).toEqual({ lyrics: null, isPureMusic: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is no lyric source for other songs, also while signed in', () => {
        const accounts = useOnlineProviderAccountStore.getState().accounts;
        useOnlineProviderAccountStore.setState({ accounts: { ...accounts, spotify: { ...accounts.spotify, user: { id: 'me', nickname: 'Me', avatarUrl: '' } } as never } });
        try {
            expect(isLyricMatchSourceOffered('spotify')).toBe(false);
            // The desktop app reads Spotify's own lyrics.
            vi.stubGlobal('window', { location: { origin: 'file://' }, electron: { spotifyRequest: vi.fn() } });
            expect(isLyricMatchSourceOffered('spotify')).toBe(true);
        } finally {
            useOnlineProviderAccountStore.setState({ accounts });
        }
    });
});

describe('the device it plays on', () => {
    const song = {
        id: id('a'), name: 'Song a', artists: [], album: { id: id('m'), name: 'Album' }, durationMs: 2000,
        sourceRef: { kind: 'online' as const, providerId: 'spotify', mediaId: id('a') },
    };
    const phone = { id: 'phone-1', name: 'Pixel', kind: 'phone' as const };
    // The deck's media events, caught on the document. The player listens once per run, so the
    // tests that play a deck share where it listens.
    const handlers: Record<string, (event: Event) => void> = {};
    class FakeMedia {}

    afterEach(async () => {
        await omni.choosePlaybackDevice('spotify', { id: null, name: 'Folia', kind: 'this' });
    });

    it('lists this window first, then the devices on now that take commands', async () => {
        signedIn();
        answer({
            'GET /me/player/devices': () => reply({
                devices: [
                    { id: 'phone-1', name: 'Pixel', type: 'Smartphone', is_restricted: false },
                    { id: 'tv-1', name: 'Living room', type: 'TV', is_restricted: false },
                    { id: 'locked', name: 'Car', type: 'Automobile', is_restricted: true },
                ],
            }),
        });
        expect(omni.hasPlaybackDevices('spotify')).toBe(true);
        expect(await omni.listPlaybackDevices('spotify')).toEqual([
            { id: null, name: 'Folia', kind: 'this' },
            { id: 'phone-1', name: 'Pixel', kind: 'phone' },
            { id: 'tv-1', name: 'Living room', kind: 'tv' },
        ]);
    });

    it('plays a song of the desktop app on the device chosen as silence for the deck, without the desktop side\'s audio', async () => {
        const spotifyRequest = vi.fn();
        vi.stubGlobal('window', { location: { origin: 'file://' }, localStorage: storage, electron: { spotifyRequest } });
        signedIn();
        await omni.choosePlaybackDevice('spotify', phone);
        expect(spotify().capabilities.explore).toBe(true);
        expect(await spotify().playback!.getAudioSource(song as never, 'high')).toMatchObject({ standIn: true });
        expect(spotifyRequest).not.toHaveBeenCalled();
        // Without the sign-in that controls the device, the app's own player plays it.
        memory.delete(SESSION_KEY);
        spotifyRequest.mockResolvedValue({ ok: true, data: { url: 'folia-spotify://audio/x', format: 'OGG_VORBIS_320' } });
        expect((await spotify().playback!.getAudioSource(song as never, 'high'))?.standIn).toBeUndefined();
        expect(spotifyRequest).toHaveBeenCalledWith('audio', expect.objectContaining({ id: id('a') }));
    });

    it('keeps the device chosen, tells it, and plays a song there without this window\'s player', async () => {
        signedIn();
        const told = vi.fn();
        const stop = omni.subscribePlaybackDevice('spotify', told);
        await omni.choosePlaybackDevice('spotify', phone);
        stop();
        expect(told).toHaveBeenCalledTimes(1);
        expect(omni.getChosenPlaybackDevice('spotify')).toEqual(phone);
        expect(JSON.parse(memory.get('folia_spotify_web_device')!)).toEqual(phone);

        const source = await omni.getAudioSource(song as never, 'high');
        expect(source).toMatchObject({ standIn: true });
        expect(ensurePlayer).not.toHaveBeenCalled();
    });
    it('hands the playback to a device that is not the active one, starts the track there and resumes it loaded paused', async () => {
        vi.useFakeTimers();
        // A deck in a document whose media events are caught on the way down.
        vi.stubGlobal('HTMLMediaElement', FakeMedia);
        vi.stubGlobal('document', {
            addEventListener: (type: string, handler: (event: Event) => void) => { handlers[type] = handler; },
            querySelectorAll: () => [],
        });
        try {
            signedIn();
            await omni.choosePlaybackDevice('spotify', phone);
            const url = (await omni.getAudioSource(song as never, 'high'))!.url;
            const deck = Object.assign(new FakeMedia(), {
                currentSrc: url, paused: false, currentTime: 0,
                hasAttribute: (name: string) => name === 'data-playback-deck',
                getAttribute: () => url,
                pause() { this.paused = true; },
            });
            const asked: string[] = [];
            let started = false;
            answer({
                'GET /me/player/queue': () => reply({ queue: [{ id: id('z') }] }),
                'GET /me/player': () => reply(started
                    ? { is_playing: false, progress_ms: 0, device: { id: 'phone-1' }, item: { id: id('a') } }
                    : { is_playing: false, device: { id: 'computer-1' }, item: null }),
                'GET /tracks/': () => reply({ album: { uri: `spotify:album:${id('m')}` } }),
                'PUT /me/player/play': (_url, init) => {
                    // A lone track is not started there: the Spotify app plays nothing for it.
                    const body = init.body ? JSON.parse(String(init.body)) : null;
                    asked.push(body ? `start ${body.offset.uri} in ${body.context_uri}` : 'resume');
                    started = true;
                    return reply(undefined, 204);
                },
                'PUT /me/player/pause': () => { asked.push('pause'); return reply(undefined, 204); },
                'PUT /me/player': (_url, init) => { asked.push(`hand over ${JSON.parse(String(init.body)).device_ids[0]}`); return reply(undefined, 204); },
            });
            handlers.playing({ target: deck } as unknown as Event);
            await vi.advanceTimersByTimeAsync(3000);
            expect(asked).toEqual(['hand over phone-1', `start spotify:track:${id('a')} in spotify:album:${id('m')}`, 'resume']);
            deck.pause();
            handlers.pause({ target: deck } as unknown as Event);
            await vi.advanceTimersByTimeAsync(100);
            expect(asked.at(-1)).toBe('pause');
        } finally {
            vi.useRealTimers();
        }
    });
    it('skips to the track where it is the next on the chosen device, keeping the list it plays from', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('HTMLMediaElement', FakeMedia);
        vi.stubGlobal('document', {
            addEventListener: (type: string, handler: (event: Event) => void) => { handlers[type] = handler; },
            querySelectorAll: () => [],
        });
        try {
            signedIn();
            await omni.choosePlaybackDevice('spotify', phone);
            const url = (await omni.getAudioSource({ ...song, id: id('e'), sourceRef: { ...song.sourceRef, mediaId: id('e') } } as never, 'high'))!.url;
            const deck = Object.assign(new FakeMedia(), {
                currentSrc: url, paused: false, currentTime: 0,
                hasAttribute: (name: string) => name === 'data-playback-deck',
                getAttribute: () => url,
                pause() { this.paused = true; },
            });
            const asked: string[] = [];
            let skipped = false;
            answer({
                'GET /me/player/queue': () => reply({ queue: [{ id: id('e') }, { id: id('f') }] }),
                'GET /me/player': () => reply({ is_playing: true, progress_ms: 0, device: { id: 'phone-1' }, item: { id: skipped ? id('e') : id('d') } }),
                'POST /me/player/next': () => { asked.push('next'); skipped = true; return reply(undefined, 204); },
                'PUT /me/player/play': () => { asked.push('start'); return reply(undefined, 204); },
                'PUT /me/player/pause': () => { asked.push('pause'); return reply(undefined, 204); },
            });
            handlers.playing({ target: deck } as unknown as Event);
            await vi.advanceTimersByTimeAsync(3000);
            expect(asked).toEqual(['next']);
            // The track's end leaves the device going on by itself.
            deck.paused = true;
            handlers.ended({ type: 'ended', target: deck } as unknown as Event);
            await vi.advanceTimersByTimeAsync(100);
            expect(asked).toEqual(['next']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('tells what the chosen device plays that the app does not, once, and starts one of its next in the same list', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('HTMLMediaElement', FakeMedia);
        vi.stubGlobal('document', {
            addEventListener: (type: string, handler: (event: Event) => void) => { handlers[type] = handler; },
            querySelectorAll: () => [],
        });
        try {
            signedIn();
            await omni.choosePlaybackDevice('spotify', phone);
            let where = 'phone-1';
            let playing = id('b');
            const started: string[] = [];
            answer({
                'GET /me/player/queue': () => reply({ queue: [{ id: id('c') }, { id: id('d') }] }),
                'GET /me/player': () => reply({
                    is_playing: true, progress_ms: 42_000, device: { id: where }, item: { id: playing }, context: { uri: 'spotify:playlist:mix' },
                }),
                'PUT /me/player/play': (_url, init) => {
                    const body = JSON.parse(String(init.body));
                    started.push(`${body.offset.uri} in ${body.context_uri}`);
                    playing = id('d');
                    return reply(undefined, 204);
                },
                'PUT /me/player/pause': () => reply(undefined, 204),
            });
            const told = vi.fn();
            const stop = omni.watchPlaybackElsewhere(told);
            await vi.advanceTimersByTimeAsync(12_000);
            expect(told).toHaveBeenCalledTimes(1);
            expect(told).toHaveBeenCalledWith({ providerId: 'spotify', mediaId: id('b'), positionMs: 42_000, upcoming: [id('c'), id('d')] });
            // The app plays one of those next (the second, not the device's next): it starts in that list.
            const url = (await omni.getAudioSource({ ...song, id: id('d'), sourceRef: { ...song.sourceRef, mediaId: id('d') } } as never, 'high'))!.url;
            const deck = Object.assign(new FakeMedia(), {
                currentSrc: url, paused: false, currentTime: 0,
                hasAttribute: (name: string) => name === 'data-playback-deck',
                getAttribute: () => url,
                pause() { this.paused = true; },
            });
            handlers.playing({ target: deck } as unknown as Event);
            await vi.advanceTimersByTimeAsync(2000);
            expect(started).toEqual([`spotify:track:${id('d')} in spotify:playlist:mix`]);
            // Playing on through that list, the songs next there are told again for the queue.
            expect(told).toHaveBeenLastCalledWith({ providerId: 'spotify', mediaId: id('d'), positionMs: 0, upcoming: [id('c'), id('d')], queueOnly: true });
            deck.paused = true;
            handlers.pause({ type: 'pause', target: deck } as unknown as Event);
            // Nothing while another device plays.
            where = 'computer-1';
            await vi.advanceTimersByTimeAsync(12_000);
            expect(told).toHaveBeenCalledTimes(2);
            stop();
        } finally {
            vi.useRealTimers();
        }
    });
});
