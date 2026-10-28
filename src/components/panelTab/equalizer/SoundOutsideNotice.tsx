import React from 'react';
import { AudioWaveform } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSoundOutsideFolia } from './useSoundOutsideFolia';

// src/components/panelTab/equalizer/SoundOutsideNotice.tsx
// 音频效果器窗口顶上的说明：这首歌的声音不经过 Folia（平台自己的播放器或别的设备在放，播放器里只是一段静音），
// 均衡器和音效碰不到它，设置留着给别的歌用。样子照 hifi/HifiBypassNotice.tsx；不是这样的歌时什么都不画。

const SoundOutsideNotice: React.FC = () => {
    const { t } = useTranslation();
    const soundOutside = useSoundOutsideFolia();

    if (!soundOutside) {
        return null;
    }

    return (
        <div role="note" className="mb-4 flex items-start gap-3 rounded-xl bg-[var(--st-card)] px-4 py-3 shadow-[0_0_0_1px_var(--st-line)]">
            <AudioWaveform size={16} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--st-t2)]" />
            <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5">{t('ui.equalizerSoundOutsideTitle')}</p>
                <p className="mt-0.5 text-xs leading-[18px] text-[color:var(--st-t2)]">{t('ui.equalizerSoundOutsideBody')}</p>
            </div>
        </div>
    );
};

export default SoundOutsideNotice;
