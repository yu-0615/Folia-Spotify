import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';

// src/stores/useOnlinePlatformListStore.ts
// Whether the platform list shows every platform, those a provider leaves out by default
// (`OnlineMusicProvider.offByDefault`) too. Off, those are lyric sources only (连接与集成 settings page).

const SHOW_ALL_PLATFORMS_KEY = 'folia_show_all_online_platforms';

type OnlinePlatformListStore = {
    showAllPlatforms: boolean;
    setShowAllPlatforms: (show: boolean) => void;
};

export const useOnlinePlatformListStore = create<OnlinePlatformListStore>(set => ({
    showAllPlatforms: getStoredBoolean(SHOW_ALL_PLATFORMS_KEY, false),
    setShowAllPlatforms: show => {
        setStoredBoolean(SHOW_ALL_PLATFORMS_KEY, show);
        set({ showAllPlatforms: show });
    },
}));
