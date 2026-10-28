import { beforeAll, describe, expect, it } from 'vitest';
import activate from '../../../dev/folium/zh-hant-lyrics/client.mjs';

// test/unit/mod-system/zhHantLyricsMod.test.ts
// The 簡轉繁 mod (dev/folium/zh-hant-lyrics): lyrics.transform turns Simplified lyrics and translations
// into Traditional, keeps word, syllable and segment pieces lined up, and leaves Japanese lyrics alone.

type Transform = (event: { song: null; lines: any[] }) => void;

const settings = { variant: 'tw', main: true, translation: true };
let transform: Transform;
let refreshes = 0;
let onSettingsChange: () => void;

const run = (lines: any[]) => {
    const event = { song: null, lines };
    transform(event);
    return event.lines;
};

const line = (words: string[], extra: Record<string, unknown> = {}) => ({
    words: words.map((text, index) => ({ text, startTime: index, endTime: index + 1 })),
    startTime: 0,
    endTime: words.length,
    fullText: words.join(''),
    renderHints: { rawDuration: words.length, timingClass: 'normal', renderEndTime: words.length, lineTransitionMode: 'normal', wordRevealMode: 'normal' },
    ...extra,
});

beforeAll(() => {
    activate({
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
        registries: {
            settingsSections: {
                register: () => ({ settings: { get: () => ({ ...settings }), onChange: (listener: () => void) => { onSettingsChange = listener; } } }),
            },
        },
        events: { on: (type: string, handler: Transform) => { if (type === 'lyrics.transform') transform = handler; } },
        lyrics: { refresh: () => { refreshes += 1; } },
    });
}, 30_000);

describe('zh-hant-lyrics mod', () => {
    it('converts a phrase split across words as a phrase, word timing kept', () => {
        const [converted] = run([line(['我的头', '发里', '有台风'], { translation: '后来' })]);
        expect(converted.fullText).toBe('我的頭髮裡有颱風');
        expect(converted.words.map((word: any) => word.text)).toEqual(['我的頭', '髮裡', '有颱風']);
        expect(converted.words[1]).toMatchObject({ startTime: 1, endTime: 2 });
        expect(converted.translation).toBe('後來');
    });

    it('cuts syllables and saved segments to the converted text', () => {
        const source = line(['头发'], { wordSegments: ['头', '发'] });
        source.words[0] = { ...source.words[0], syllables: [{ text: '头', startTime: 0, endTime: 0.5 }, { text: '发', startTime: 0.5, endTime: 1 }] } as any;
        const [converted] = run([source]);
        expect(converted.words[0].syllables.map((syllable: any) => syllable.text)).toEqual(['頭', '髮']);
        expect(converted.wordSegments).toEqual(['頭', '髮']);
    });

    it('leaves Japanese lyrics alone but converts their Chinese translation', () => {
        const lines = run([line(['国の', '歌']), line(['会いたい'], { translation: '想见你' })]);
        expect(lines.map((converted: any) => converted.fullText)).toEqual(['国の歌', '会いたい']);
        expect(lines[1].translation).toBe('想見你');
    });

    it('converts background vocals and Chinese translation alternates, not romanization', () => {
        const [converted] = run([line(['爱'], {
            romanization: 'ai',
            alternateTexts: [{ role: 'translation', language: 'zh-Hans', text: '爱情' }, { role: 'romanization', text: 'ai' }],
            backgroundVocals: [{ text: '温柔', startTime: 0, endTime: 1, words: [{ text: '温柔', startTime: 0, endTime: 1 }], translation: '温柔' }],
        })]);
        expect(converted.fullText).toBe('愛');
        expect(converted.romanization).toBe('ai');
        expect(converted.alternateTexts).toEqual([{ role: 'translation', language: 'zh-Hans', text: '愛情' }, { role: 'romanization', text: 'ai' }]);
        expect(converted.backgroundVocals[0]).toMatchObject({ text: '溫柔', translation: '溫柔' });
        expect(converted.backgroundVocals[0].words[0].text).toBe('溫柔');
    });

    it('converts piece by piece when Taiwan wording changes the length, and drops segments that no longer fit', () => {
        settings.variant = 'twp';
        const [converted, longer] = run([line(['鼠标', '软件'], { wordSegments: ['鼠标', '软件'] }), line(['内存'], { wordSegments: ['内', '存'] })]);
        settings.variant = 'tw';
        expect(converted.words.map((word: any) => word.text)).toEqual(['滑鼠', '軟體']);
        expect(converted.fullText).toBe('滑鼠軟體');
        expect(converted.wordSegments).toEqual(['滑鼠', '軟體']);
        expect(longer.fullText).toBe('記憶體');
        expect(longer.wordSegments).toBeUndefined();
    }, 30_000);

    it('follows the switches and re-runs on a settings change', () => {
        settings.main = false;
        const [converted] = run([line(['头发'], { translation: '头发' })]);
        settings.main = true;
        expect(converted.fullText).toBe('头发');
        expect(converted.translation).toBe('頭髮');
        onSettingsChange();
        expect(refreshes).toBe(1);
    });
});
