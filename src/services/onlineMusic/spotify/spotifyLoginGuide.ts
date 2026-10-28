import type { LoginGuide } from '../../../types/onlineMusic';
import { spotifyWebRedirectUri } from './web/spotifyWebAuth';

// src/services/onlineMusic/spotify/spotifyLoginGuide.ts
// The first sign-in to Spotify, step by step (`auth.getLoginGuide`): Spotify lets only an app the
// listener made on developer.spotify.com sign in, whose Redirect URI is the one this build signs in
// through. The desktop app signs in twice (its own client's sign-in, then the listener's app for the
// device the songs sound on); the web build once, with the Client ID in the sign-in window.

const SPOTIFY_DASHBOARD_URL = 'https://developer.spotify.com/dashboard';

export const spotifyLoginGuide = (build: 'desktop' | 'web'): LoginGuide => ({
    title: 'signInGuide.spotifyTitle',
    note: 'signInGuide.spotifyNote',
    steps: [
        { text: 'signInGuide.spotifyStep1', link: { label: 'signInGuide.openDashboard', url: SPOTIFY_DASHBOARD_URL } },
        { text: 'signInGuide.spotifyStep2', copy: spotifyWebRedirectUri() },
        { text: 'signInGuide.spotifyStep3' },
        { text: 'signInGuide.spotifyStep4' },
        { text: build === 'desktop' ? 'signInGuide.spotifyStep5Desktop' : 'signInGuide.spotifyStep5Web' },
        { text: 'signInGuide.spotifyStep6' },
    ],
});
