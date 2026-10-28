import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetButton } from '../shared/Sheet';
import { Segmented } from './settings/kit';
import { NewFeaturesIntro } from './NewFeaturesIntro';
import { ForkChangesList } from './ForkChangesList';
import { SignInGuide } from './SignInGuide';
import { USER_GUIDE_AUTO_OPEN_VERSION } from './userGuideContent';

// src/components/modal/ReleaseNotesDialog.tsx
// The 版本更新 dialog, in three pages: what each version of this fork changed, how to sign in to
// the platforms that need some setting up first, and the features of the original Folia's release. Opened from the
// Help page, and by the app shell on the first start of a new release, on the changes.

type ReleaseNotesDialogProps = {
    isOpen: boolean;
    isDaylight: boolean;
    onClose: () => void;
};

type ReleaseNotesPage = 'changes' | 'signIn' | 'original';

const APP_VERSION = typeof __APP_VERSION__ === 'undefined' ? null : `v${__APP_VERSION__}`;

const ReleaseNotesDialog: React.FC<ReleaseNotesDialogProps> = ({ isOpen, isDaylight, onClose }) => {
    const { t } = useTranslation();
    const [page, setPage] = useState<ReleaseNotesPage>('changes');

    return (
        <Sheet
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            size="m"
            title={t('help.releaseNotes')}
            // This build's own version (the fork's numbering), else the release the notes were written for.
            subtitle={APP_VERSION ?? (USER_GUIDE_AUTO_OPEN_VERSION ? `v${USER_GUIDE_AUTO_OPEN_VERSION}` : undefined)}
            footer={<SheetButton data-testid="release-notes-close" onClick={onClose}>{t('ui.close')}</SheetButton>}
        >
            <div data-testid="release-notes-dialog">
                <div className="mb-3.5">
                    <Segmented<ReleaseNotesPage>
                        fill
                        value={page}
                        onChange={setPage}
                        options={[
                            { value: 'changes', label: t('forkReleaseNotes.tabChanges') },
                            { value: 'signIn', label: t('forkReleaseNotes.tabSignIn') },
                            { value: 'original', label: t('forkReleaseNotes.tabOriginal') },
                        ]}
                    />
                </div>
                {page === 'changes' && <ForkChangesList />}
                {page === 'signIn' && <SignInGuide />}
                {page === 'original' && <NewFeaturesIntro />}
            </div>
        </Sheet>
    );
};

export default ReleaseNotesDialog;
