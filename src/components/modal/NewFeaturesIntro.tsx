import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { NEW_FEATURES_RELEASE } from './newFeaturesRelease';

// 在这里编辑当前版本的新功能介绍
// 这里是原版 Folia 那一版的新功能（版本更新的「原版新功能」页）；这个 fork 每一版的更动写在 forkReleaseNotes.ts
// The intro, then the features as the rows of one card. A major update carries a tag above the
// intro with its codename. It is drawn with the settings kit's variables, so it goes inside a
// sheet (ReleaseNotesDialog) or the settings window.
export const NewFeaturesIntro: React.FC = () => {
    const { t } = useTranslation();
    const { i18nKey, features, majorUpdate } = NEW_FEATURES_RELEASE;

    return (
        <>
            {majorUpdate && (
                <span
                    data-testid="release-major-update"
                    className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-[var(--st-fill)] px-2.5 py-0.5 text-xs font-semibold leading-5 text-[color:var(--st-accent)]"
                >
                    <Sparkles size={13} aria-hidden="true" />
                    {t('help.majorUpdateLabel', { codename: majorUpdate.codename })}
                </span>
            )}
            <h3 className="mb-1 text-xs font-semibold leading-5 text-[color:var(--st-t2)]">
                {t('forkReleaseNotes.originalLabel', { version: i18nKey.replace(/^releaseNotes\.v/, '').replace(/_/g, '.') })}
            </h3>
            <p className="text-[13px] leading-[21px] text-[color:var(--st-t1)]">{t(`${i18nKey}.intro`)}</p>
            <div className="st-card mt-3.5 overflow-hidden rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]">
                {features.map(({ id, icon: Icon }) => (
                    <div key={id} className="st-row relative flex gap-3.5 px-4 py-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--st-fill)]">
                            <Icon size={16} />
                        </span>
                        <div className="min-w-0">
                            <div className="text-sm font-semibold leading-5">{t(`${i18nKey}.${id}.title`)}</div>
                            <div className="mt-0.5 text-xs leading-[19px] text-[color:var(--st-t2)]">{t(`${i18nKey}.${id}.description`)}</div>
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
};
