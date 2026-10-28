import React, { useCallback, useState, useSyncExternalStore } from 'react';
import { Check, Laptop, MonitorSpeaker, RefreshCw, Smartphone, Speaker, Tv } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { omni } from '../../../services/onlineMusic/omni';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import type { OmniPlaybackDevice } from '../../../types/onlineMusic';
import { getOnlineProviderIdForSong } from '../../../utils/appPlaybackGuards';
import { PanelIconButton } from '../shell/PanelIconButton';

// src/components/panelTab/controls/PlaybackDeviceRow.tsx
// 正在放的歌所属的平台能在别的设备上放时（provider 的 `devices`），音量下面多一行「播放设备」：现在在哪台设备上放；
// 点开列出账号现在开着的设备（打开时才问平台），选一台，正在放的歌就移过去，之后的歌也在那里放。

const KIND_ICONS: Record<OmniPlaybackDevice['kind'], React.FC<{ size?: number }>> = {
    this: MonitorSpeaker,
    computer: Laptop,
    phone: Smartphone,
    speaker: Speaker,
    tv: Tv,
    other: Speaker,
};

const NO_DEVICE = (): (() => void) => () => undefined;

const PlaybackDeviceRow: React.FC = () => {
    const { t } = useTranslation();
    const providerId = usePlaybackStore(state => getOnlineProviderIdForSong(state.currentSong));
    const hasDevices = providerId !== null && omni.hasPlaybackDevices(providerId);
    const chosen = useSyncExternalStore(
        useCallback(listener => (hasDevices && providerId ? omni.subscribePlaybackDevice(providerId, listener) : NO_DEVICE()), [hasDevices, providerId]),
        () => (hasDevices && providerId ? omni.getChosenPlaybackDevice(providerId) : null),
    );
    const [open, setOpen] = useState(false);
    const [devices, setDevices] = useState<OmniPlaybackDevice[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    if (!hasDevices || !providerId || !chosen) return null;

    const nameOf = (device: OmniPlaybackDevice) => (device.kind === 'this' ? t('ui.playbackDeviceThisWindow') : device.name);
    const ChosenIcon = KIND_ICONS[chosen.kind];

    const load = async () => {
        setLoading(true);
        setFailed(false);
        try {
            setDevices(await omni.listPlaybackDevices(providerId));
        } catch (error) {
            console.warn('[PlaybackDevice] Devices could not be read', error);
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next) void load();
    };

    const choose = async (device: OmniPlaybackDevice) => {
        setOpen(false);
        try {
            await omni.choosePlaybackDevice(providerId, device);
        } catch (error) {
            console.warn('[PlaybackDevice] The device could not be chosen', error);
        }
    };

    return (
        <>
            <div className="flex h-10 items-center gap-2">
                <PanelIconButton label={t('ui.playbackDevice')} onClick={(event) => { event.stopPropagation(); toggle(); }}>
                    <ChosenIcon size={17} />
                </PanelIconButton>
                <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); toggle(); }}
                    aria-expanded={open}
                    className="min-w-0 flex-1 truncate text-left text-sm text-[color:var(--st-t1)]"
                >
                    <span className="text-xs text-[color:var(--st-t3)]">{t('ui.playbackDevice')} · </span>
                    {nameOf(chosen)}
                </button>
                {open && (
                    <PanelIconButton label={t('ui.playbackDeviceRefresh')} size="s" disabled={loading} onClick={(event) => { event.stopPropagation(); void load(); }}>
                        <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
                    </PanelIconButton>
                )}
            </div>
            {open && (
                <div className="pb-2 pl-10">
                    {loading && !devices && <p className="px-1 py-1 text-xs text-[color:var(--st-t3)]">{t('ui.playbackDeviceLoading')}</p>}
                    {failed && <p className="px-1 py-1 text-xs text-[color:var(--st-t3)]">{t('ui.playbackDeviceFailed')}</p>}
                    {devices?.map((device) => {
                        const Icon = KIND_ICONS[device.kind];
                        const isChosen = device.id === chosen.id;
                        return (
                            <button
                                key={device.id ?? 'this'}
                                type="button"
                                onClick={(event) => { event.stopPropagation(); void choose(device); }}
                                className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors hover:bg-[var(--st-raise)] ${isChosen ? 'text-[color:var(--st-accent)]' : 'text-[color:var(--st-t2)]'}`}
                            >
                                <Icon size={15} />
                                <span className="min-w-0 flex-1 truncate">{nameOf(device)}</span>
                                {isChosen && <Check size={14} />}
                            </button>
                        );
                    })}
                    {devices && devices.length <= 1 && (
                        <p className="px-1 pt-1 text-xs leading-4 text-[color:var(--st-t3)]">{t('ui.playbackDeviceEmpty')}</p>
                    )}
                </div>
            )}
        </>
    );
};

export default PlaybackDeviceRow;
