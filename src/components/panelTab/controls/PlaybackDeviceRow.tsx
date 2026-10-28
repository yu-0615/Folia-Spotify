import React, { useCallback, useState, useSyncExternalStore } from 'react';
import { Laptop, Loader2, LogIn, MonitorSpeaker, Smartphone, Speaker, Tv } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { omni } from '../../../services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import type { OmniPlaybackDevice } from '../../../types/onlineMusic';
import { getOnlineProviderIdForSong } from '../../../utils/appPlaybackGuards';
import { FIELD_SURFACE_CLASS } from '../../modal/settings/kit/TextField';
import { PanelIconButton } from '../shell/PanelIconButton';

// src/components/panelTab/controls/PlaybackDeviceRow.tsx
// 正在放的歌所属的平台在它自己的 App 里出声时（provider 的 `devices`），音量下面多一行「播放设备」：写着现在在哪台设备上放
// （iPhone、Mac……，跟着平台自己的 App 换），不在这里选。正在放的歌的平台没有设备时（没在放歌、放的是本地歌），看书库现在的平台。
// 控制设备要单独登录一次时（桌面版要用的人自己注册的应用），点开是它要的值和登录按钮。

const KIND_ICONS: Record<OmniPlaybackDevice['kind'], React.FC<{ size?: number }>> = {
    computer: Laptop,
    phone: Smartphone,
    speaker: Speaker,
    tv: Tv,
    other: Speaker,
};

const NO_DEVICE = (): (() => void) => () => undefined;

const PlaybackDeviceRow: React.FC = () => {
    const { t } = useTranslation();
    const songProviderId = usePlaybackStore(state => getOnlineProviderIdForSong(state.currentSong));
    const libraryProviderId = useOnlineProviderAccountStore(state => state.activeProviderId);
    const providerId = songProviderId !== null && omni.hasPlaybackDevices(songProviderId) ? songProviderId : libraryProviderId;
    const hasDevices = providerId !== null && omni.hasPlaybackDevices(providerId);
    // (Changes with the device the platform plays on and with the devices' own sign-in, both read below.)
    useSyncExternalStore(
        useCallback(listener => (hasDevices && providerId ? omni.subscribePlaybackDevice(providerId, listener) : NO_DEVICE()), [hasDevices, providerId]),
        () => (hasDevices && providerId ? `${omni.getPlaybackDevice(providerId)?.id ?? ''}|${omni.playbackDevicesNeedSignIn(providerId)}` : ''),
    );
    const device = hasDevices && providerId ? omni.getPlaybackDevice(providerId) : null;
    const needsSignIn = hasDevices && providerId ? omni.playbackDevicesNeedSignIn(providerId) : false;
    const setting = hasDevices && providerId ? omni.getPlaybackDevicesSetting(providerId) : null;
    const [open, setOpen] = useState(false);
    const [typed, setTyped] = useState<string | null>(null);
    const [signingIn, setSigningIn] = useState(false);
    const [signInFailed, setSignInFailed] = useState<string | null>(null);

    if (!hasDevices || !providerId) return null;

    const settingValue = typed ?? setting?.get() ?? '';
    const DeviceIcon = device ? KIND_ICONS[device.kind] : MonitorSpeaker;
    const deviceName = needsSignIn ? t('ui.playbackDeviceNotSignedIn') : device?.name ?? t('ui.playbackDeviceNone');

    // The page opens in the browser; this waits until the sign-in is confirmed, then lists the devices.
    const signIn = async () => {
        setSigningIn(true);
        setSignInFailed(null);
        try {
            await omni.signInForPlaybackDevices(providerId);
            setOpen(false);
        } catch (error) {
            console.warn('[PlaybackDevice] The sign-in for the devices did not complete', error);
            setSignInFailed(error instanceof Error ? error.message : String(error));
        } finally {
            setSigningIn(false);
        }
    };

    return (
        <>
            <div className="flex h-10 items-center gap-2">
                <PanelIconButton label={t('ui.playbackDevice')} onClick={(event) => { event.stopPropagation(); if (needsSignIn) setOpen(!open); }}>
                    <DeviceIcon size={17} />
                </PanelIconButton>
                <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); if (needsSignIn) setOpen(!open); }}
                    aria-expanded={needsSignIn ? open : undefined}
                    className="min-w-0 flex-1 truncate text-left text-sm text-[color:var(--st-t1)]"
                >
                    <span className="text-xs text-[color:var(--st-t3)]">{t('ui.playbackDevice')} · </span>
                    {deviceName}
                </button>
            </div>
            {open && needsSignIn && (
                <div className="pb-2 pl-10">
                    <div className="mt-1 rounded-lg bg-[var(--st-fill)] p-2.5">
                        <p className="text-xs leading-[18px] text-[color:var(--st-t2)]">{t('ui.playbackDeviceSignInNote')}</p>
                        {setting && (
                            <label className="mt-2 block" onClick={event => event.stopPropagation()}>
                                <span className="text-xs font-medium text-[color:var(--st-t1)]">{t(setting.labelKey)}</span>
                                <input
                                    type="text"
                                    value={settingValue}
                                    placeholder={t(setting.placeholderKey)}
                                    spellCheck={false}
                                    autoComplete="off"
                                    onChange={(event) => {
                                        setTyped(event.target.value);
                                        setting.set(event.target.value);
                                    }}
                                    className={`${FIELD_SURFACE_CLASS} mt-1 h-8 w-full px-2.5 font-mono text-[12px]`}
                                />
                                <span className="mt-1 block select-text whitespace-pre-line text-[11px] leading-4 text-[color:var(--st-t3)] [overflow-wrap:anywhere]">
                                    {t(setting.hintKey, setting.hintValues?.() ?? {})}
                                </span>
                            </label>
                        )}
                        <button
                            type="button"
                            disabled={signingIn || (Boolean(setting) && !settingValue.trim())}
                            onClick={(event) => { event.stopPropagation(); void signIn(); }}
                            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--st-accent)] px-3 text-xs font-medium text-white transition-opacity disabled:opacity-40"
                        >
                            {signingIn ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
                            {t(signingIn ? 'ui.playbackDeviceSigningIn' : 'ui.playbackDeviceSignIn')}
                        </button>
                        {signInFailed && <p className="mt-1.5 text-[11px] leading-4 text-[color:var(--st-t3)] [overflow-wrap:anywhere]">{t('ui.playbackDeviceSignInFailed', { reason: signInFailed })}</p>}
                    </div>
                </div>
            )}
        </>
    );
};

export default PlaybackDeviceRow;
