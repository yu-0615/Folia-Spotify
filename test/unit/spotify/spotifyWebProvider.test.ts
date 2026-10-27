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

    it('is the desktop one without a Client ID, which says it needs the desktop app', () => {
        vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', '');
        expect(spotify().capabilities.explore).toBe(true);
        expect(spotify().getAvailability?.()).toEqual({ configured: false, reason: 'runtime-unavailable' });
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
            vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', '');
            expect(isLyricMatchSourceOffered('spotify')).toBe(true);
        } finally {
            useOnlineProviderAccountStore.setState({ accounts });
        }
    });
});
