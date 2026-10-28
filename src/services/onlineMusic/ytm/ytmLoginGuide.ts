import type { LoginGuide } from '../../../types/onlineMusic';

// src/services/onlineMusic/ytm/ytmLoginGuide.ts
// The first sign-in to YouTube Music, step by step (`auth.getLoginGuide`): a browser window of its
// own (electron/ytm/browserSignIn.cjs), closed once the account shows, and opened again from the
// sign-in window when it went away.

export const ytmLoginGuide = (): LoginGuide => ({
    title: 'signInGuide.ytmTitle',
    note: 'signInGuide.ytmNote',
    steps: [
        { text: 'signInGuide.ytmStep1' },
        { text: 'signInGuide.ytmStep2' },
        { text: 'signInGuide.ytmStep3' },
    ],
});
