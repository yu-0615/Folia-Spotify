import { OnlineProviderError } from '../../../../types/onlineMusic';
import { spotifyWebAccessToken } from './spotifyWebAuth';

// src/services/onlineMusic/spotify/web/spotifyWebApi.ts
// Requests to Spotify's public Web API as the signed-in account. Every Web API request of the web
// version goes through `callSpotifyWeb`. The rules of an app in Development Mode (February 2026)
// apply: a search gives at most 10 rows a request, items are read one by one (no batch reads), a
// playlist's songs are read only for the account's own and collaborative playlists, and the
// library is changed through /me/library with uris.

const API = 'https://api.spotify.com/v1';

export type SpotifyWebQuery = Record<string, string | number | boolean | undefined>;
export interface SpotifyWebRequest { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; query?: SpotifyWebQuery; body?: unknown }

// Spotify's error answer: `{ error: { status, message } }`.
interface ErrorAnswer { error?: { status?: number; message?: string; reason?: string } }

const urlOf = (path: string, query: SpotifyWebQuery = {}): string => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([name, value]) => { if (value !== undefined) params.set(name, String(value)); });
    const text = params.toString();
    return `${API}${path}${text ? `?${text}` : ''}`;
};

const send = async (path: string, request: SpotifyWebRequest, token: string): Promise<Response> => {
    try {
        return await fetch(urlOf(path, request.query), {
            method: request.method ?? 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        });
    } catch (error) {
        throw new OnlineProviderError('network', 'Spotify Web API request failed', 'spotify', error);
    }
};

/**
 * One request; the answer's JSON, or undefined for an answer without a body. A token Spotify
 * refuses is renewed once. Errors: 429 is the sentence spotifyFailure.ts names as `retry-later`;
 * 403 and 404 come as `unavailable` with their status (a 404 is no such item, for the caller to
 * read as null); 5xx as `network`.
 */
export async function callSpotifyWeb<T = unknown>(path: string, request: SpotifyWebRequest = {}): Promise<T> {
    const method = request.method ?? 'GET';
    const startedAt = Date.now();
    let response = await send(path, request, await spotifyWebAccessToken());
    if (response.status === 401) response = await send(path, request, await spotifyWebAccessToken(true));
    if (response.ok) {
        const text = await response.text();
        if (!text) return undefined as T;
        try {
            return JSON.parse(text) as T;
        } catch (error) {
            throw new OnlineProviderError('invalid-response', 'Spotify Web API answered something that is not JSON', 'spotify', error);
        }
    }
    const answer = await response.json().catch(() => ({})) as ErrorAnswer;
    const message = answer.error?.message || `Spotify Web API answered ${response.status}`;
    console.warn(`[Spotify] Web ${method} ${path} failed after ${Date.now() - startedAt}ms: ${response.status} (${message})`);
    if (response.status === 401) throw new OnlineProviderError('auth-required', message, 'spotify', undefined, 401);
    if (response.status === 429) {
        const retryAfterMs = (Number(response.headers.get('Retry-After')) || 0) * 1000 || undefined;
        throw new OnlineProviderError('unavailable', 'Spotify asked to wait before trying again', 'spotify', answer.error?.reason, 429, retryAfterMs);
    }
    if (response.status >= 500) throw new OnlineProviderError('network', message, 'spotify', undefined, response.status);
    throw new OnlineProviderError('unavailable', message, 'spotify', answer.error?.reason, response.status);
}

/** Whether `error` is Spotify answering that it has no such item. */
export const isSpotifyWebNotFound = (error: unknown): boolean => (
    error instanceof OnlineProviderError && error.providerId === 'spotify' && error.httpStatus === 404
);
