import { OnlineProviderError } from '../../../../types/onlineMusic';
import type { LoginState, ProviderAvailability, ProviderSetting } from '../../../../types/onlineMusic';
import { getStoredString, removeStoredKey, setStoredString } from '../../../../stores/storagePrimitives';

// src/services/onlineMusic/spotify/web/spotifyWebAuth.ts
// The sign-in to Spotify through the app the listener registered on developer.spotify.com: the
// authorization code flow with PKCE. Its Client ID is the one the listener gives at sign-in, kept
// on this device (a build's VITE_SPOTIFY_CLIENT_ID is the one used until then). In a browser,
// Spotify's page opens in a window of its own and comes back to public/spotify-callback.html, which
// hands the code to this page over a BroadcastChannel. In the desktop app (whose own sign-in reads
// Spotify; this one controls its devices), the page opens in the listener's browser and comes back
// to a loopback address the desktop side answers (electron/loopbackSignIn.cjs). The tokens are kept
// in this page's storage.

const ACCOUNTS = 'https://accounts.spotify.com';
const SESSION_KEY = 'folia_spotify_web_session';
const CLIENT_ID_KEY = 'folia_spotify_client_id';
// Where the desktop app's sign-in comes back to (to be registered with the app on developer.spotify.com).
const DESKTOP_REDIRECT = { port: 5590, path: '/spotify-callback.html' };
const CHANNEL = 'folia-spotify-login';
// How long a sign-in attempt waits for Spotify's answer.
export const SPOTIFY_WEB_LOGIN_TTL_MS = 10 * 60 * 1000;
// A token is renewed this long before Spotify says it ends.
const RENEW_BEFORE_MS = 60 * 1000;

// `streaming`, `user-read-email` and `user-read-private` are what the Web Playback SDK asks for; the
// others are the library, the playlists and the player.
const SCOPES = [
    'streaming', 'user-read-email', 'user-read-private',
    'user-library-read', 'user-library-modify', 'user-follow-read', 'user-follow-modify',
    'playlist-read-private', 'playlist-read-collaborative', 'playlist-modify-private', 'playlist-modify-public',
    'user-read-playback-state', 'user-modify-playback-state',
].join(' ');

interface SpotifyWebSession { accessToken: string; refreshToken: string; expiresAt: number }
interface TokenAnswer { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
// What spotify-callback.html hands over: Spotify's `code`, or its `error`, for the attempt `state`.
interface CallbackAnswer { state?: string; code?: string; error?: string }
interface LoginAttempt { verifier: string; answer: CallbackAnswer | null; exchange: Promise<void> | null }

const desktopBridge = () => (typeof window === 'undefined' ? undefined : window.electron);
const signsInThroughDesktop = () => typeof desktopBridge()?.openLoopbackSignIn === 'function';

// In an app added to the home screen (the iPhone's Safari), a window of its own opens in another
// browser with storage of its own, so the answer never comes back to the app. There Spotify's page
// opens in place of the app instead: the attempt waits in storage under this key,
// public/spotify-callback.html adds Spotify's answer to it and goes back to the app, and the app's
// next start exchanges the code (resumeSpotifyWebRedirectLogin).
const REDIRECT_KEY = 'folia_spotify_web_redirect';
interface RedirectAttempt extends CallbackAnswer { verifier: string; returnTo: string; startedAt: number }

const runsFromHomeScreen = (): boolean => {
    if (typeof window === 'undefined') return false;
    const browser = window.navigator as (Navigator & { standalone?: boolean }) | undefined;
    if (browser?.standalone === true) return true;
    return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
};

// The listener's own, else the build's.
export const spotifyWebClientId = (): string => (
    getStoredString(CLIENT_ID_KEY, '').trim() || String(import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '').trim()
);

// The address registered with the app on developer.spotify.com. Spotify accepts http only for a
// loopback address (127.0.0.1, not localhost); any other must be https.
export const spotifyWebRedirectUri = (): string => {
    if (signsInThroughDesktop()) return `http://127.0.0.1:${DESKTOP_REDIRECT.port}${DESKTOP_REDIRECT.path}`;
    const configured = String(import.meta.env.VITE_SPOTIFY_REDIRECT_URI ?? '').trim();
    if (configured) return configured;
    return new URL(`${import.meta.env.BASE_URL ?? '/'}spotify-callback.html`, window.location.origin).href;
};

// The Client ID is asked for at sign-in, so the sign-in is always on offer.
export const getSpotifyWebAvailability = (): ProviderAvailability => ({ configured: true });

const sessionListeners = new Set<() => void>();
const sessionChanged = () => sessionListeners.forEach(listener => listener());

/** Calls `listener` when the sign-in is kept or dropped; answers with the way to stop. */
export const subscribeSpotifyWebSession = (listener: () => void): (() => void) => {
    sessionListeners.add(listener);
    return () => {
        sessionListeners.delete(listener);
    };
};

const attempts = new Map<string, LoginAttempt>();
let channel: BroadcastChannel | null = null;
let stopDesktop: (() => void) | null = null;

const take = (answer: CallbackAnswer | undefined) => {
    const attempt = answer?.state ? attempts.get(answer.state) : undefined;
    if (attempt && !attempt.answer) attempt.answer = answer!;
};

const listen = (): void => {
    if (!stopDesktop && desktopBridge()?.onLoopbackSignIn) stopDesktop = desktopBridge()!.onLoopbackSignIn!(take);
    if (channel || typeof BroadcastChannel === 'undefined') return;
    channel = new BroadcastChannel(CHANNEL);
    // Node's channel (the tests) would otherwise keep the process open; a browser has no `unref`.
    (channel as BroadcastChannel & { unref?: () => void }).unref?.();
    channel.onmessage = (event: MessageEvent<CallbackAnswer>) => take(event.data);
};

const readSession = (): SpotifyWebSession | null => {
    try {
        const session = JSON.parse(getStoredString(SESSION_KEY, 'null')) as SpotifyWebSession | null;
        return session?.accessToken && session.refreshToken ? session : null;
    } catch {
        return null;
    }
};

const writeSession = (answer: TokenAnswer, previous: SpotifyWebSession | null): void => {
    if (!answer.access_token) throw new OnlineProviderError('invalid-response', 'Spotify gave no access token', 'spotify');
    const refreshToken = answer.refresh_token || previous?.refreshToken;
    if (!refreshToken) throw new OnlineProviderError('invalid-response', 'Spotify gave no refresh token', 'spotify');
    const session: SpotifyWebSession = {
        accessToken: answer.access_token, refreshToken, expiresAt: Date.now() + (Number(answer.expires_in) || 3600) * 1000,
    };
    setStoredString(SESSION_KEY, JSON.stringify(session));
    sessionChanged();
};

export const hasSpotifyWebSession = (): boolean => readSession() !== null;

export const clearSpotifyWebSession = (): void => {
    removeStoredKey(SESSION_KEY);
    sessionChanged();
};

/** Keeps the listener's Client ID on this device. A sign-in made through another app is dropped. */
export const setSpotifyWebClientId = (value: string): void => {
    const next = value.trim();
    if (next === spotifyWebClientId()) return;
    if (next) setStoredString(CLIENT_ID_KEY, next);
    else removeStoredKey(CLIENT_ID_KEY);
    if (readSession()) clearSpotifyWebSession();
};

// Asks Spotify's token endpoint. A refused grant (a code used twice, a refresh token Spotify no
// longer honours) is `auth-required`.
const askToken = async (fields: Record<string, string>): Promise<TokenAnswer> => {
    let response: Response;
    try {
        response = await fetch(`${ACCOUNTS}/api/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: spotifyWebClientId(), ...fields }).toString(),
        });
    } catch (error) {
        throw new OnlineProviderError('network', 'Spotify token request failed', 'spotify', error);
    }
    const answer = await response.json().catch(() => ({})) as TokenAnswer;
    if (response.ok) return answer;
    console.warn(`[Spotify] Web token request answered ${response.status}: ${answer.error ?? ''}`);
    if (response.status === 400 && answer.error === 'invalid_grant') {
        throw new OnlineProviderError('auth-required', 'Spotify no longer accepts this sign-in', 'spotify', undefined, 400);
    }
    if (response.status === 429) {
        const retryAfterMs = (Number(response.headers.get('Retry-After')) || 0) * 1000 || undefined;
        throw new OnlineProviderError('unavailable', 'Spotify asked to wait before trying again', 'spotify', undefined, 429, retryAfterMs);
    }
    throw new OnlineProviderError(response.status >= 500 ? 'network' : 'unavailable', answer.error_description || answer.error || 'Spotify refused the token request', 'spotify', undefined, response.status);
};

let renewing: Promise<string> | null = null;

/**
 * A token for a request: the kept one, or a renewed one where it ends within a minute (or `force`,
 * after Spotify refused the kept one). Without a sign-in, or where Spotify no longer accepts it,
 * `auth-required`, and a sign-in Spotify no longer accepts is forgotten.
 */
export const spotifyWebAccessToken = async (force = false): Promise<string> => {
    const session = readSession();
    if (!session) throw new OnlineProviderError('auth-required', 'Not signed in to Spotify', 'spotify');
    if (!force && session.expiresAt - RENEW_BEFORE_MS > Date.now()) return session.accessToken;
    if (!renewing) {
        renewing = askToken({ grant_type: 'refresh_token', refresh_token: session.refreshToken })
            .then((answer) => {
                writeSession(answer, session);
                console.log('[Spotify] Web access token renewed');
                return readSession()!.accessToken;
            })
            .catch((error: unknown) => {
                if (error instanceof OnlineProviderError && error.code === 'auth-required') clearSpotifyWebSession();
                throw error;
            })
            .finally(() => { renewing = null; });
    }
    return renewing;
};

const randomText = (bytes: number): string => base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
const base64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Starts an attempt; its key is the `state` Spotify hands back with its answer. */
export const SPOTIFY_WEB_NO_CLIENT_ID = 'No Spotify Client ID was given';

export const startSpotifyWebLogin = (): string => {
    if (!spotifyWebClientId()) throw new OnlineProviderError('unavailable', SPOTIFY_WEB_NO_CLIENT_ID, 'spotify');
    listen();
    const key = randomText(16);
    attempts.set(key, { verifier: randomText(48), answer: null, exchange: null });
    return key;
};

// Spotify's consent page for the attempt `key`.
const authorizeUrl = async (key: string, verifier: string): Promise<string> => {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    return `${ACCOUNTS}/authorize?${new URLSearchParams({
        response_type: 'code', client_id: spotifyWebClientId(), redirect_uri: spotifyWebRedirectUri(), scope: SCOPES,
        state: key, code_challenge_method: 'S256', code_challenge: base64Url(digest),
    })}`;
};

// What a browser that blocked the window is told; the sign-in dialog names it (spotifyWebProvider.ts).
export const SPOTIFY_WEB_POPUP_BLOCKED = 'The browser did not open the Spotify window';

/** Opens Spotify's consent page in a window of its own (in the desktop app, in the listener's browser). */
export const openSpotifyWebLogin = async (key: string): Promise<void> => {
    const attempt = attempts.get(key);
    if (!attempt) throw new OnlineProviderError('unavailable', 'This Spotify sign-in has ended', 'spotify');
    const url = await authorizeUrl(key, attempt.verifier);
    if (signsInThroughDesktop()) {
        try {
            await desktopBridge()!.openLoopbackSignIn!({ url, ...DESKTOP_REDIRECT });
        } catch (error) {
            throw new OnlineProviderError('unavailable', SPOTIFY_WEB_POPUP_BLOCKED, 'spotify', error);
        }
        return;
    }
    if (runsFromHomeScreen()) {
        const pending: RedirectAttempt = { state: key, verifier: attempt.verifier, returnTo: window.location.href, startedAt: Date.now() };
        setStoredString(REDIRECT_KEY, JSON.stringify(pending));
        console.log('[Spotify] Web sign-in opens in place of the home-screen app');
        window.location.assign(url);
        return;
    }
    const opened = window.open(url, 'folia-spotify-login', 'popup,width=520,height=760');
    if (!opened) throw new OnlineProviderError('unavailable', SPOTIFY_WEB_POPUP_BLOCKED, 'spotify');
};

/**
 * Where the attempt `key` stands. An approval is exchanged for tokens once; `readAccount` then
 * reads the account, which a Development Mode app answers 403 for an account not on its list.
 */
export const checkSpotifyWebLogin = async (key: string, readAccount: () => Promise<unknown>): Promise<LoginState> => {
    const attempt = attempts.get(key);
    if (!attempt) return { state: 'expired' };
    const answer = attempt.answer;
    if (!answer) return { state: 'waiting' };
    if (answer.error) {
        console.warn(`[Spotify] Web sign-in answered ${answer.error}`);
        attempts.delete(key);
        return answer.error === 'access_denied'
            ? { state: 'error', message: answer.error, failure: { case: 'not-authorized', code: answer.error } }
            : { state: 'error', message: answer.error, failure: { code: answer.error } };
    }
    if (!attempt.exchange) {
        attempt.exchange = askToken({
            grant_type: 'authorization_code', code: answer.code ?? '', redirect_uri: spotifyWebRedirectUri(), code_verifier: attempt.verifier,
        }).then(token => writeSession(token, null));
    }
    try {
        await attempt.exchange;
    } catch (error) {
        // Spotify was not reached: the code is still good, and the next check exchanges it again.
        if (error instanceof OnlineProviderError && error.code === 'network') {
            attempt.exchange = null;
            return { state: 'error', message: error.message, transient: true };
        }
        attempts.delete(key);
        throw error;
    }
    try {
        await readAccount();
    } catch (error) {
        attempts.delete(key);
        clearSpotifyWebSession();
        if (error instanceof OnlineProviderError && error.httpStatus === 403) {
            return { state: 'error', message: error.message, failure: { case: 'refused', httpStatus: 403, message: error.message } };
        }
        throw error;
    }
    attempts.delete(key);
    console.log('[Spotify] Web sign-in confirmed');
    return { state: 'confirmed' };
};

export const cancelSpotifyWebLogin = (key: string): void => {
    attempts.delete(key);
};

/** The Client ID as the sign-in window and the devices row ask for it, with the address to register. */
export const spotifyClientIdSetting: ProviderSetting = {
    labelKey: 'home.spotifyClientIdLabel',
    placeholderKey: 'home.spotifyClientIdPlaceholder',
    hintKey: 'home.spotifyClientIdHint',
    hintValues: () => ({ redirect: spotifyWebRedirectUri() }),
    get: spotifyWebClientId,
    set: setSpotifyWebClientId,
};

/**
 * A sign-in from start to end without the sign-in window (the desktop app's sign-in for the devices):
 * the page opens, and the answer is checked until it is confirmed. Throws where it fails or runs out.
 */
export const signInSpotifyWebUntilDone = async (readAccount: () => Promise<unknown>): Promise<void> => {
    const key = startSpotifyWebLogin();
    try {
        await openSpotifyWebLogin(key);
        const until = Date.now() + SPOTIFY_WEB_LOGIN_TTL_MS;
        while (Date.now() < until) {
            const answer = await checkSpotifyWebLogin(key, readAccount);
            if (answer.state === 'confirmed') return;
            if (answer.state === 'expired') break;
            if (answer.state === 'error' && !answer.transient) {
                throw new OnlineProviderError(answer.failure?.case === 'refused' ? 'unavailable' : 'auth-required', answer.message || 'The Spotify sign-in did not complete', 'spotify', undefined, answer.failure?.httpStatus);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new OnlineProviderError('auth-required', 'The Spotify sign-in ran out', 'spotify');
    } finally {
        cancelSpotifyWebLogin(key);
    }
};

/**
 * Finishes a sign-in that opened Spotify's page in place of the home-screen app (REDIRECT_KEY):
 * exchanges the code it came back with and keeps the tokens. Answers whether a sign-in was kept.
 * An attempt that never came back is dropped once it runs out.
 */
export const resumeSpotifyWebRedirectLogin = async (): Promise<boolean> => {
    let pending: RedirectAttempt | null;
    try {
        pending = JSON.parse(getStoredString(REDIRECT_KEY, 'null')) as RedirectAttempt | null;
    } catch {
        pending = null;
    }
    if (!pending?.verifier) return false;
    if (!pending.code && !pending.error) {
        if (Date.now() - (Number(pending.startedAt) || 0) > SPOTIFY_WEB_LOGIN_TTL_MS) removeStoredKey(REDIRECT_KEY);
        return false;
    }
    removeStoredKey(REDIRECT_KEY);
    if (!pending.code) {
        console.warn(`[Spotify] Web sign-in from the home-screen app answered ${pending.error}`);
        return false;
    }
    try {
        const token = await askToken({
            grant_type: 'authorization_code', code: pending.code, redirect_uri: spotifyWebRedirectUri(), code_verifier: pending.verifier,
        });
        writeSession(token, null);
        console.log('[Spotify] Web sign-in from the home-screen app confirmed');
        return true;
    } catch (error) {
        console.warn('[Spotify] Web sign-in from the home-screen app could not be finished', error);
        return false;
    }
};

// A page loaded fresh may be the app coming back from Spotify's page.
if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && !signsInThroughDesktop()) {
    void resumeSpotifyWebRedirectLogin();
}
