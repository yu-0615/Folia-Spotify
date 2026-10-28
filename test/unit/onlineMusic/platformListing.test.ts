import { afterEach, describe, expect, it } from 'vitest';
import { accountStorePort } from '@/library/core/account/providerAccountDeps.service';
import { omni } from '@/services/onlineMusic/omni';
import { useOnlinePlatformListStore } from '@/stores/useOnlinePlatformListStore';

// test/unit/onlineMusic/platformListing.test.ts
// Which platforms the platform list offers (`OnlineMusicProvider.offByDefault`, the 连接与集成
// setting that shows them all) and which one a listener without a choice starts on (`startsHere`).

const CHINESE = ['netease', 'kugou', 'qq', 'bodian', 'qishui'];
const listedIds = () => accountStorePort.listProviders().map(provider => provider.providerId);

afterEach(() => {
    useOnlinePlatformListStore.setState({ showAllPlatforms: false });
});

describe('the platform list', () => {
    it('leaves the platforms in mainland China out by default, as lyric sources only', () => {
        const listed = listedIds();
        expect(listed).toContain('spotify');
        for (const id of CHINESE) expect(listed).not.toContain(id);
        // They are still registered: lyrics and songs already kept still reach them through omni.
        const summaries = omni.getProviderSummaries();
        for (const id of CHINESE) expect(summaries.find(provider => provider.providerId === id)).toMatchObject({ listed: false });
    });

    it('lists every platform once the settings show them all, and tells the list as it changes', () => {
        const told: number[] = [];
        const stop = accountStorePort.subscribe(() => told.push(1));
        useOnlinePlatformListStore.getState().setShowAllPlatforms(true);
        stop();
        expect(told.length).toBeGreaterThan(0);
        expect(listedIds()).toEqual(expect.arrayContaining(['spotify', ...CHINESE]));
    });

    it('starts on Spotify', () => {
        expect(omni.getProviderSummaries().filter(provider => provider.startsHere).map(provider => provider.providerId)).toEqual(['spotify']);
    });
});
