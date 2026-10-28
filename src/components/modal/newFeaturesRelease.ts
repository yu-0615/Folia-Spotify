import { AudioLines, Droplets, Languages, ListFilter, Sparkles, Volume2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// src/components/modal/newFeaturesRelease.ts

type NewFeatureCard = {
    id: string;
    icon: LucideIcon;
};

type NewFeaturesRelease = {
    i18nKey: string;
    /** 重大更新：介绍上方显示「<代号> Update · 重大更新」标签；代号不翻译，文案在 help.majorUpdateLabel。 */
    majorUpdate?: { codename: string };
    features: NewFeatureCard[];
};

// Defines the current release's cards; their localized text lives under i18nKey in every locale.
export const NEW_FEATURES_RELEASE: NewFeaturesRelease = {
    i18nKey: 'releaseNotes.v0_7_23',
    features: [
        { id: 'hifi', icon: AudioLines },
        { id: 'smartBalance', icon: Volume2 },
        { id: 'lyricFilter', icon: ListFilter },
        { id: 'temperaInk', icon: Droplets },
        { id: 'vietnamese', icon: Languages },
        { id: 'moreDetails', icon: Sparkles },
    ],
};
