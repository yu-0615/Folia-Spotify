import { describe, expect, it, vi } from 'vitest';
import en from '../../src/i18n/locales/en';
import inLocale from '../../src/i18n/locales/in';
import viLocale from '../../src/i18n/locales/vi';
import zhCN from '../../src/i18n/locales/zh-CN';
import { FORK_RELEASES, forkReleaseKey } from '../../src/components/modal/forkReleaseNotes';
import { NEW_FEATURES_RELEASE } from '../../src/components/modal/newFeaturesRelease';
import { spotifyLoginGuide } from '../../src/services/onlineMusic/spotify/spotifyLoginGuide';
import { ytmLoginGuide } from '../../src/services/onlineMusic/ytm/ytmLoginGuide';
import { USER_GUIDE_AUTO_OPEN_VERSION } from '../../src/components/modal/userGuideContent';

// test/unit/newFeaturesRelease.test.ts
// The release intro reads every card's text by key at render time; a key missing in one locale shows the raw key there.

// The address the guide asks to register is read from the page, which a unit test has none of.
vi.mock('../../src/services/onlineMusic/spotify/web/spotifyWebAuth', () => ({
    spotifyWebRedirectUri: () => 'http://127.0.0.1:5590/spotify-callback.html',
}));

const LOCALES = { en, in: inLocale, vi: viLocale, 'zh-CN': zhCN } as Record<string, unknown>;

const lookup = (tree: unknown, path: string): unknown => path.split('.').reduce<unknown>(
    (node, segment) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined),
    tree,
);

describe('new features release', () => {
    it.each(Object.keys(LOCALES))('has the intro and every card title / description in %s', (locale) => {
        const tree = LOCALES[locale];
        const texts = [
            `${NEW_FEATURES_RELEASE.i18nKey}.intro`,
            ...NEW_FEATURES_RELEASE.features.flatMap(feature => [
                `${NEW_FEATURES_RELEASE.i18nKey}.${feature.id}.title`,
                `${NEW_FEATURES_RELEASE.i18nKey}.${feature.id}.description`,
            ]),
        ];
        for (const key of texts) {
            expect(lookup(tree, key), key).toEqual(expect.any(String));
        }
    });

    it.each(Object.keys(LOCALES))('has the major update label in %s whenever the release names one', (locale) => {
        if (!NEW_FEATURES_RELEASE.majorUpdate) return;
        const label = lookup(LOCALES[locale], 'help.majorUpdateLabel');
        expect(label).toEqual(expect.stringContaining('{{codename}}'));
    });

    it('uses card ids once each', () => {
        const ids = NEW_FEATURES_RELEASE.features.map(feature => feature.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it.each(Object.keys(LOCALES))('has every change of the fork and every sign-in guide in %s', (locale) => {
        const tree = LOCALES[locale];
        const texts = [
            'forkReleaseNotes.tabChanges', 'forkReleaseNotes.tabSignIn', 'forkReleaseNotes.tabOriginal', 'forkReleaseNotes.originalLabel', 'forkReleaseNotes.changesIntro',
            ...FORK_RELEASES.flatMap(release => release.changes.map(id => `${forkReleaseKey(release.version)}.${id}`)),
            'signInGuide.intro',
            ...[spotifyLoginGuide('desktop'), spotifyLoginGuide('web'), ytmLoginGuide()].flatMap(guide => [
                guide.title, guide.note,
                ...guide.steps.flatMap(step => [step.text, ...(step.link ? [step.link.label] : [])]),
            ]),
        ];
        for (const key of texts) {
            expect(lookup(tree, key), key).toEqual(expect.any(String));
        }
    });

    it('lists each version of the fork once, newest first, and opens on the newest', () => {
        const versions = FORK_RELEASES.map(release => release.version);
        expect(new Set(versions).size).toBe(versions.length);
        const parts = (version: string) => version.split('.').map(Number);
        for (let index = 1; index < versions.length; index += 1) {
            const [a, b] = [parts(versions[index - 1]), parts(versions[index])];
            const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
            expect(newer, `${versions[index - 1]} before ${versions[index]}`).toBeGreaterThan(0);
        }
        expect(USER_GUIDE_AUTO_OPEN_VERSION).toBe(versions[0]);
    });
});
