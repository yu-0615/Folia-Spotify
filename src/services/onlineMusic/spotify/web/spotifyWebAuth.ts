import { OnlineProviderError } from '../../../../types/onlineMusic';
import type { LoginState, ProviderAvailability } from '../../../../types/onlineMusic';
import { getStoredString, removeStoredKey, setStoredString } from '../../../../stores/storagePrimitives';

// src/services/onlineMusic/spotify/web/spotifyWebAuth.ts
// The web version's sign-in to Spotify: the authorization code flow with PKCE against the app the
// person registered on developer.spotify.com (its Client ID is VITE_SPOTIFY_CLIENT_ID). Spotify's
// page opens in a window of its own; it comes back to public/spotify-callback.html, which hands the
// code to this page over a BroadcastChannel. The tokens are kept in this browser's storage.

const ACCOUNTS = 'https://accounts.spotify.com';
const SESSION_KEY = 'folia_spotify_web_session';
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

export const spotifyWebClientId = (): string => String(import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '').trim();

// The address registered with the app on developer.spotify.com. Spotify accepts http only for a
// loopback address (127.0.0.1, not localhost); any other must be https.
export const spotifyWebRedirectUri = (): string => {
    const configured = String(import.meta.env.VITE_SPOTIFY_REDIRECT_URI ?? '').trim();
    if (configured) return configured;
    return new URL(`${import.meta.env.BASE_URL ?? '/'}spotify-callback.html`, window.location.origin).href;
};

export const getSpotifyWebAvailability = (): ProviderAvailability => (
    spotifyWebClientId() ? { configured: true } : { configured: false, reason: 'not-configured' }
);

const attempts = new Map<string, LoginAttempt>();
let channel: BroadcastChannel | null = null;

const listen = (): void => {
    if (channel || typeof BroadcastChannel === 'undefined') return;
    channel = new BroadcastChannel(CHANNEL);
    // Node's channel (the tests) would otherwise keep the process open; a browser has no `unref`.
    (channel as BroadcastChannel & { unref?: () => void }).unref?.();
    channel.onmessage = (event: MessageEvent<CallbackAnswer>) => {
        const attempt = event.data?.state ? attempts.get(event.data.state) : undefined;
        if (attempt && !attempt.answer) attempt.answer = event.data;
    };
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
};

export const hasSpotifyWebSession = (): boolean => readSession() !== null;

export const clearSpotifyWebSession = (): void => {
    removeStoredKey(SESSION_KEY);
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
export const startSpotifyWebLogin = (): string => {
    if (!spotifyWebClientId()) throw new OnlineProviderError('unavailable', 'VITE_SPOTIFY_CLIENT_ID is not set', 'spotify');
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

/** Opens Spotify's consent page in a window of its own. */
export const openSpotifyWebLogin = async (key: string): Promise<void> => {
    const attempt = attempts.get(key);
    if (!attempt) throw new OnlineProviderError('unavailable', 'This Spotify sign-in has ended', 'spotify');
    const url = await authorizeUrl(key, attempt.verifier);
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
