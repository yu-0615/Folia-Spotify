// dev/folium/zh-hant-lyrics/client.mjs
// 简转繁：歌词进播放页之前（lyrics.transform），把简体的原文与翻译换成繁体（OpenCC，台湾字形、台湾用语或香港字形）。
//
//   - 一行的逐字、音节、用户分词和整行一起转：先拼成一串转，换完长度不变就按原来的长度切回去，
//     这样跨词的词组（「头发」→「頭髮」）照词组转，逐字时间也对得上；长度变了（台湾用语会把「鼠标」换成「滑鼠」）
//     就各段分开转，分词对不上整行时交给宿主丢掉。
//   - 日文歌不转原文：歌词里出现假名，原文里的汉字是日文写法，转了会把「国」写成「國」。翻译照样看自己有没有假名。
//   - 罗马音不碰。设置改了用 folium.lyrics.refresh() 重转正在显示的歌词。

import { Converter } from './vendor/opencc-cn2t.mjs';

const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const HAN = /\p{Script=Han}/u;

const VARIANTS = ['tw', 'twp', 'hk'];

/** `converted` cut into pieces as long as `originals`, or null when the conversion changed its length. */
const sliceLike = (converted, originals) => {
  if (converted.length !== originals.reduce((total, text) => total + text.length, 0)) return null;
  let at = 0;
  return originals.map(text => converted.slice(at, (at += text.length)));
};

/** Pieces of one text converted together, so phrases across piece edges convert as phrases. */
const convertPieces = (convert, pieces) => {
  const joined = pieces.join('');
  if (!HAN.test(joined)) return pieces;
  return sliceLike(convert(joined), pieces) ?? pieces.map(piece => convert(piece));
};

const convertSyllables = (convert, syllables, before, after) => {
  const texts = syllables.map(syllable => syllable.text);
  const parts = (texts.join('') === before && sliceLike(after, texts)) || convertPieces(convert, texts);
  return syllables.map((syllable, index) => ({ ...syllable, text: parts[index] }));
};

/** Words, and the whole text they make up, converted as one. */
const convertWords = (convert, words, fullText) => {
  const texts = convertPieces(convert, words.map(word => word.text));
  const nextWords = words.map((word, index) => (word.syllables
    ? { ...word, text: texts[index], syllables: convertSyllables(convert, word.syllables, word.text, texts[index]) }
    : { ...word, text: texts[index] }));
  const nextFull = words.map(word => word.text).join('') === fullText ? texts.join('') : convertPieces(convert, [fullText])[0];
  return { words: nextWords, fullText: nextFull };
};

const isChineseAlternate = alternate => alternate.role === 'translation'
  && (!alternate.language || /^zh/i.test(alternate.language))
  && !KANA.test(alternate.text);

const convertAlternates = (convert, alternates) => alternates.map(alternate => {
  if (!isChineseAlternate(alternate)) return alternate;
  const text = convertPieces(convert, [alternate.text])[0];
  return alternate.syllables
    ? { ...alternate, text, syllables: convertSyllables(convert, alternate.syllables, alternate.text, text) }
    : { ...alternate, text };
});

const convertTranslation = (convert, translation) => (
  translation && !KANA.test(translation) ? convertPieces(convert, [translation])[0] : translation
);

/** A line or background vocal (`text` or `fullText`) with the parts the settings ask for converted. */
const convertLine = (convert, line, { main, translation }) => {
  const next = { ...line };
  const textKey = 'fullText' in line ? 'fullText' : 'text';
  if (main) {
    const { words, fullText } = convertWords(convert, line.words ?? [], line[textKey]);
    next.words = words;
    next[textKey] = fullText;
    if (line.wordSegments) {
      const segments = sliceLike(fullText, line.wordSegments);
      if (segments) next.wordSegments = segments;
      else delete next.wordSegments;
    }
  }
  if (translation) {
    if (line.translation) next.translation = convertTranslation(convert, line.translation);
    if (line.alternateTexts) next.alternateTexts = convertAlternates(convert, line.alternateTexts);
  }
  if (line.backgroundVocals) {
    next.backgroundVocals = line.backgroundVocals.map(vocal => convertLine(convert, vocal, { main, translation }));
  }
  return next;
};

export default function activate(folium) {
  const section = folium.registries.settingsSections.register({
    id: 'convert',
    label: { 'zh-CN': '简转繁', 'zh-TW': '簡轉繁', en: 'Simplified to Traditional' },
    description: {
      'zh-CN': '把简体歌词与翻译换成繁体。日文歌的原文不转，罗马音不碰。',
      'zh-TW': '把簡體歌詞與翻譯換成繁體。日文歌的原文不轉，羅馬音不碰。',
      en: 'Shows Simplified Chinese lyrics and translations in Traditional characters. Japanese lyrics and romanization stay as they are.',
    },
    settings: [
      {
        key: 'variant',
        type: 'select',
        label: { 'zh-CN': '转成', 'zh-TW': '轉成', en: 'Convert to' },
        options: [
          { value: 'tw', label: { 'zh-CN': '台湾字形', 'zh-TW': '台灣字形', en: 'Taiwan characters' } },
          { value: 'twp', label: { 'zh-CN': '台湾字形与用语', 'zh-TW': '台灣字形與用語', en: 'Taiwan characters and wording' } },
          { value: 'hk', label: { 'zh-CN': '香港字形', 'zh-TW': '香港字形', en: 'Hong Kong characters' } },
        ],
        defaultValue: 'tw',
      },
      { key: 'main', type: 'boolean', label: { 'zh-CN': '转换歌词原文', 'zh-TW': '轉換歌詞原文', en: 'Convert the lyrics' }, defaultValue: true },
      { key: 'translation', type: 'boolean', label: { 'zh-CN': '转换翻译', 'zh-TW': '轉換翻譯', en: 'Convert translations' }, defaultValue: true },
    ],
  });

  // Building a dictionary takes about a second, so each variant is built once, when first used.
  const converters = new Map();
  const converterFor = variant => {
    const to = VARIANTS.includes(variant) ? variant : 'tw';
    if (!converters.has(to)) {
      const startedAt = performance.now();
      converters.set(to, Converter({ from: 'cn', to }));
      folium.log.info(`[zh-hant-lyrics] built the ${to} dictionary in ${Math.round(performance.now() - startedAt)} ms`);
    }
    return converters.get(to);
  };
  converterFor(section.settings.get().variant);

  folium.events.on('lyrics.transform', event => {
    const { variant, main, translation } = section.settings.get();
    if (!event.lines.length || (!main && !translation)) return;
    const convert = converterFor(variant);
    // Kana anywhere in the lyrics means Japanese: its kanji are not Simplified Chinese.
    const japanese = event.lines.some(line => KANA.test(line.fullText));
    event.lines = event.lines.map(line => convertLine(convert, line, { main: main && !japanese, translation }));
  });

  section.settings.onChange(() => folium.lyrics.refresh());
}
