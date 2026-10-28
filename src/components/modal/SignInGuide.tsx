import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { Button, CopyValue } from './settings/kit';
import { openOutsideLink } from '../../utils/system/outsideLink';
import { omni } from '../../services/onlineMusic/omni';
import type { LoginGuide } from '../../types/onlineMusic';

// src/components/modal/SignInGuide.tsx
// The 授权登录 page of the 版本更新 dialog: the first sign-in of every platform that gives its steps
// (`auth.getLoginGuide`), one numbered card each. A step may carry a page to open and a value to copy.

const GuideSection: React.FC<{ providerId: string; guide: LoginGuide }> = ({ providerId, guide }) => {
    const { t } = useTranslation();

    return (
        <section data-testid={`sign-in-guide-${providerId}`} className="mt-3.5">
            <h3 className="px-1 text-sm font-semibold leading-5">{t(guide.title)}</h3>
            <p className="mb-2 mt-0.5 px-1 text-xs leading-[19px] text-[color:var(--st-t2)]">{t(guide.note)}</p>
            <ol className="st-card overflow-hidden rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]">
                {guide.steps.map((step, index) => (
                    <li key={step.text} className="st-row relative flex gap-3 px-4 py-2.5 text-[13px] leading-[20px]">
                        <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--st-fill)] text-[11px] font-semibold text-[color:var(--st-t2)]">
                            {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                            {t(step.text)}
                            {step.link && (
                                <div className="mt-2">
                                    <Button icon={ExternalLink} onClick={() => void openOutsideLink(step.link!.url)}>
                                        {t(step.link.label)}
                                    </Button>
                                </div>
                            )}
                            {step.copy && (
                                <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                                    <CopyValue value={step.copy} />
                                </div>
                            )}
                        </div>
                    </li>
                ))}
            </ol>
        </section>
    );
};

export const SignInGuide: React.FC = () => {
    const { t } = useTranslation();
    const guides = useMemo(() => omni.getLoginGuides(), []);

    return (
        <>
            <p className="text-[13px] leading-[21px] text-[color:var(--st-t1)]">{t('signInGuide.intro')}</p>
            {guides.map(({ providerId, guide }) => <GuideSection key={providerId} providerId={providerId} guide={guide} />)}
        </>
    );
};
