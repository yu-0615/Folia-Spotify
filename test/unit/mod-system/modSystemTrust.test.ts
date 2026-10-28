import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modSystemTrust.test.ts
// The enable approval is bound to a mod's content digest: changed files revoke
// it. The one exemption is a development build (unpackaged) editing a mod in
// the repository's own mods/ directory, where the approval follows the edit.
// These pin both sides, so the exemption can never reach user-installed mods,
// but for the user's own choice for one mod (setModKeepTrust): its approval
// follows its edits while it asks the app for what it did when the choice was made.

const require = createRequire(import.meta.url);

const persisted = new Map<string, unknown>();
class FakeStore {
    get(key: string) { return persisted.get(key); }
    set(key: string, value: unknown) { persisted.set(key, JSON.parse(JSON.stringify(value))); }
}
const stubModule = (name: string, exports: unknown) => {
    const resolved = require.resolve(name);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module;
};
// What the native dialog answers: 0 is Cancel, 1 the button that agrees.
let dialogAnswer = 0;
const dialogsShown: Array<{ title: string }> = [];
stubModule('electron', {
    dialog: { showMessageBox: async (options: { title: string }) => { dialogsShown.push(options); return { response: dialogAnswer }; } },
    ipcMain: { handle: () => {}, removeHandler: () => {} },
    protocol: { handle: () => {} },
    shell: { openPath: async () => '' },
});
stubModule('electron-store', FakeStore);

const { createModSystem } = require('../../../electron/modSystem/modSystem.cjs');
const { computeModDigest } = require('../../../electron/modSystem/modDigest.cjs');
const { TRUST_DIALOG_LOCALE } = require('../../../electron/modSystem/approval.cjs');

let root = '';

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-trust-'));
    persisted.clear();
    dialogAnswer = 0;
    dialogsShown.length = 0;
});

/* A confirmed (enabled, digest-bound) mod under `base` ('app/mods' is the repository directory). */
const manifestOf = (modId: string, extra: Record<string, unknown> = {}) => JSON.stringify({ folium: 1, id: modId, name: modId, version: '1.0.0', client: 'client.mjs', ...extra });
const writeConfirmedMod = (base: string, modId: string) => {
    const directory = path.join(root, base, modId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'mod.json'), manifestOf(modId));
    fs.writeFileSync(path.join(directory, 'client.mjs'), 'export default function activate(folium) {}\n');
    persisted.set(`mods.enabled.${modId}`, { enabled: true, digest: computeModDigest(directory) });
    return directory;
};

const launch = ({ isPackaged = false } = {}) => {
    const system = createModSystem({
        app: {
            getPath: () => path.join(root, 'userData'),
            getAppPath: () => path.join(root, 'app'),
            getVersion: () => '0.8.0',
            isPackaged,
        },
        BrowserWindow: { getAllWindows: () => [] },
        getMainWindow: () => null,
        getLocaleKey: () => 'en',
        isFeatureEnabled: () => true,
    });
    system.loadAll();
    return system;
};

interface ListedMod { id: string; enabled: boolean; trustStale: boolean; devSource: boolean; keepTrust: boolean }
const stateOf = (system: { listMods: () => ListedMod[] }, modId: string) => system.listMods().find((mod) => mod.id === modId);

describe('enable approval and content changes', () => {
    it('keeps the approval of an edited mod in the development source tree', () => {
        const directory = writeConfirmedMod('app/mods', 'dev-mod');
        fs.appendFileSync(path.join(directory, 'client.mjs'), '// edited\n');
        const state = stateOf(launch(), 'dev-mod');
        expect(state).toMatchObject({ enabled: true, trustStale: false, devSource: true });
        // The approval now follows the edited bytes.
        expect(persisted.get('mods.enabled.dev-mod')).toMatchObject({ enabled: true, digest: computeModDigest(directory) });
    });

    it('revokes the approval of an edited mod in the user mods directory', () => {
        const directory = writeConfirmedMod('userData/mods', 'user-mod');
        fs.appendFileSync(path.join(directory, 'client.mjs'), '// edited\n');
        const state = stateOf(launch(), 'user-mod');
        expect(state).toMatchObject({ enabled: false, trustStale: true, devSource: false });
        expect(persisted.get('mods.enabled.user-mod')).toMatchObject({ enabled: false, digest: null });
    });

    it('never exempts a packaged app', () => {
        const directory = writeConfirmedMod('userData/mods', 'packaged-mod');
        fs.appendFileSync(path.join(directory, 'client.mjs'), '// edited\n');
        expect(stateOf(launch({ isPackaged: true }), 'packaged-mod')).toMatchObject({ enabled: false, trustStale: true, devSource: false });
    });

    // A build from before approvals were bound to files stored a bare `true`.
    it('reads a stored approval that is not an object as none: the mod stays off, with no files-changed note', () => {
        for (const [index, stored] of [true, 1, 'yes'].entries()) {
            const modId = `old-record-${index}`;
            writeConfirmedMod('userData/mods', modId);
            persisted.set(`mods.enabled.${modId}`, stored);
        }
        const system = launch();
        for (const index of [0, 1, 2]) {
            expect(stateOf(system, `old-record-${index}`)).toMatchObject({ enabled: false, trustStale: false });
        }
    });

    it('still needs the first confirmation in the development source tree', () => {
        writeConfirmedMod('app/mods', 'never-enabled');
        persisted.delete('mods.enabled.never-enabled');
        expect(stateOf(launch(), 'never-enabled')).toMatchObject({ enabled: false, trustStale: false, devSource: true });
    });
});

describe('keeping a mod\'s approval through its file changes, the user\'s choice for one mod', () => {
    type System = ReturnType<typeof launch> & { setModKeepTrust: (modId: string, keep: boolean) => Promise<{ ok: boolean; error?: string }> };

    it('is turned on through the native dialog only, and off without it', async () => {
        writeConfirmedMod('userData/mods', 'own-mod');
        const system = launch({ isPackaged: true }) as System;
        expect(await system.setModKeepTrust('own-mod', true)).toMatchObject({ ok: false, error: 'keep-declined' });
        expect(stateOf(system, 'own-mod')).toMatchObject({ enabled: true, keepTrust: false });
        dialogAnswer = 1;
        expect(await system.setModKeepTrust('own-mod', true)).toMatchObject({ ok: true });
        expect(dialogsShown.map((shown) => shown.title)).toEqual([TRUST_DIALOG_LOCALE.en.keepTitle, TRUST_DIALOG_LOCALE.en.keepTitle]);
        expect(stateOf(system, 'own-mod')).toMatchObject({ enabled: true, keepTrust: true });
        expect(await system.setModKeepTrust('own-mod', false)).toMatchObject({ ok: true });
        expect(dialogsShown).toHaveLength(2);
        expect(stateOf(system, 'own-mod')).toMatchObject({ enabled: true, keepTrust: false });
    });

    it('keeps the approval of an edited mod in the user mods directory, also in a packaged app', async () => {
        const directory = writeConfirmedMod('userData/mods', 'own-mod');
        dialogAnswer = 1;
        await (launch({ isPackaged: true }) as System).setModKeepTrust('own-mod', true);
        fs.appendFileSync(path.join(directory, 'client.mjs'), '// edited\n');
        expect(stateOf(launch({ isPackaged: true }), 'own-mod')).toMatchObject({ enabled: true, trustStale: false, keepTrust: true });
        // The approval follows the edited bytes, and the choice stays.
        expect(persisted.get('mods.enabled.own-mod')).toMatchObject({ enabled: true, digest: computeModDigest(directory), keep: true });
    });

    it('revokes it, and the choice with it, where the edited mod asks the app for more', async () => {
        const directory = writeConfirmedMod('userData/mods', 'own-mod');
        dialogAnswer = 1;
        await (launch({ isPackaged: true }) as System).setModKeepTrust('own-mod', true);
        fs.writeFileSync(path.join(directory, 'mod.json'), manifestOf('own-mod', { permissions: ['net.fetch'] }));
        expect(stateOf(launch({ isPackaged: true }), 'own-mod')).toMatchObject({ enabled: false, trustStale: true, keepTrust: false });
        expect(persisted.get('mods.enabled.own-mod')).toEqual(expect.not.objectContaining({ keep: true }));
    });

    it('is refused for a mod that is not enabled', async () => {
        writeConfirmedMod('userData/mods', 'off-mod');
        persisted.set('mods.enabled.off-mod', { enabled: false, digest: null });
        dialogAnswer = 1;
        expect(await (launch({ isPackaged: true }) as System).setModKeepTrust('off-mod', true)).toMatchObject({ ok: false, error: 'mod-not-enabled' });
        expect(dialogsShown).toHaveLength(0);
    });
});

describe('the enable dialog text', () => {
    // A line one language lacks would read "undefined" in the dialog there.
    it('has the same lines in the five languages', () => {
        const english = Object.keys(TRUST_DIALOG_LOCALE.en).sort();
        for (const language of ['zh-CN', 'zh-TW', 'in', 'vi']) {
            expect(Object.keys(TRUST_DIALOG_LOCALE[language]).sort(), language).toEqual(english);
        }
    });
});
