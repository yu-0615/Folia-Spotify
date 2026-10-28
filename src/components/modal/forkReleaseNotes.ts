// src/components/modal/forkReleaseNotes.ts
// What each version of this fork changed, newest first, for the 更新记录 page of the 版本更新
// dialog. Each change is one line of text under `forkReleaseNotes.v<version, dots as _>.<id>` in
// every locale. A release adds its version at the top, and USER_GUIDE_AUTO_OPEN_VERSION
// (userGuideContent.ts) follows it, so the dialog opens on that release's first start.

export type ForkRelease = {
    version: string;
    changes: string[];
};

export const FORK_RELEASES: ForkRelease[] = [
    { version: '0.1.1', changes: ['releaseNotes', 'signInGuide'] },
    { version: '0.1.0', changes: ['renumber', 'playsInApp', 'follow', 'dailyMix', 'lyrics', 'videoPlatform', 'mods'] },
];

export const forkReleaseKey = (version: string): string => `forkReleaseNotes.v${version.replace(/\./g, '_')}`;
