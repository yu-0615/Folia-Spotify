import React from 'react';
import { useTranslation } from 'react-i18next';
import { FORK_RELEASES, forkReleaseKey } from './forkReleaseNotes';

// src/components/modal/ForkChangesList.tsx
// The 更新记录 page: one card for each version of this fork, newest first, a line for each
// change. Drawn with the settings kit's variables, inside the 版本更新 sheet.
export const ForkChangesList: React.FC = () => {
    const { t } = useTranslation();

    return (
        <>
            <p className="text-[13px] leading-[21px] text-[color:var(--st-t1)]">{t('forkReleaseNotes.changesIntro')}</p>
            {FORK_RELEASES.map(({ version, changes }) => (
                <section key={version} data-testid={`fork-release-${version}`} className="mt-3.5">
                    <h3 className="mb-1.5 px-1 text-xs font-semibold leading-5 text-[color:var(--st-t2)]">v{version}</h3>
                    <ul className="st-card overflow-hidden rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]">
                        {changes.map(id => (
                            <li key={id} className="st-row relative flex gap-2.5 px-4 py-2.5 text-[13px] leading-[20px]">
                                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--st-accent)]" />
                                <span className="min-w-0">{t(`${forkReleaseKey(version)}.${id}`)}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </>
    );
};
