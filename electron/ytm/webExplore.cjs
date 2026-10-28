const { VIDEO_ID } = require('./tiles.cjs');
const { thumbnailUrl } = require('./catalog.cjs');
const { describeError, toErrorResult } = require('./errors.cjs');
const { videoFieldsOf } = require('./songVersion.cjs');

// electron/ytm/webExplore.cjs
// The explore page of the account of the web sign-in: YouTube Music's own pages as its web
// client is given them (raw browse JSON), read into the wire shapes of the `explore` operation's
// answer. The home feed comes first, a part a request; after its last part the explore page and
// the charts page, a page each; then the moods and genres, a few of them a page. The layouts read
// here are those of the answers a guest was given on 2026-10-08 (the moods and genres on
// 2026-10-28); of an account's answers only the counts were at hand (the same layouts, and a
// shelf of podcast episodes, which is left out).

const HOME = 'FEmusic_home';
// The pages after the home feed, in this order. A page is asked for by its name here, which the
// page before it hands out as its `continuation`: no token of YouTube's is such a name.
const LATER_PAGES = ['FEmusic_explore', 'FEmusic_charts'];
// After them, the moods and genres. Their page is a list of links, one a category, under two
// headings (to a guest in zh-TW, 2026-10-28: 12 moods and 16 genres), and a category's page is
// shelves: of playlists for a mood (12 shelves of 6 to 47), for a genre of songs, playlists and
// videos (5 shelves of 14 to 80). A category comes here as one shelf, headed with its heading and
// its name, of the playlists of its page taken from its shelves in turn (the first of each shelf,
// then the second...), each once and MOOD_LISTS at most. The list of the categories is read once
// in a read of the page from its start, and MOODS_A_PAGE categories make a page, which is asked
// for as MOODS and the place of its first category ("FEmusic_moods_and_genres 4").
const MOODS = 'FEmusic_moods_and_genres';
const MOOD_CATEGORY = 'FEmusic_moods_and_genres_category';
const MOODS_A_PAGE = 4;
const MOOD_LISTS = 24;

const LIST_ID = /^[\w-]{2,128}$/;
const ARTIST_ID = /^UC[\w-]{10,62}$/;

const textOf = node => (Array.isArray(node?.runs) ? node.runs.map(run => run?.text ?? '').join('') : '').trim();

const pageTypeOf = endpoint => endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;

// The artists a line names with a link. One linked to an artist's page has that page's id; one
// linked to another channel (a video's uploader) is a name alone, with no id. A name the
// line gives without a link cannot be told from the words around it, and is left out.
const artistsOf = line => (Array.isArray(line?.runs) ? line.runs : [])
  .filter(run => ARTIST_ID.test(run?.navigationEndpoint?.browseEndpoint?.browseId ?? '') && run.text?.trim())
  .map(run => ({
    id: pageTypeOf(run.navigationEndpoint) === 'MUSIC_PAGE_TYPE_ARTIST' ? run.navigationEndpoint.browseEndpoint.browseId : '',
    name: run.text.trim(),
  }));

// What an entry stands for, told by where it leads: a video is a song to play; a list that
// plays instead of opening is a mix where its id begins with RD (a mix has no page of its own:
// it is the queue YouTube makes up for its id), else a playlist with a page; a page is an
// album, a playlist or an artist. Null for a page of any other kind (a podcast episode, a
// channel that is no artist's).
function entryLeadingTo(endpoint, { name, coverUrl, artists, albumLine }) {
  const videoId = endpoint.watchEndpoint?.videoId;
  if (videoId !== undefined) {
    if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) return null;
    const album = (Array.isArray(albumLine?.runs) ? albumLine.runs : [])
      .find(run => pageTypeOf(run?.navigationEndpoint) === 'MUSIC_PAGE_TYPE_ALBUM')?.navigationEndpoint.browseEndpoint.browseId;
    // (No entry of these pages says how long its song is.)
    return {
      kind: 'song',
      song: {
        id: videoId, name, artists, album: { id: album ?? '', name: album ? textOf(albumLine) : '', coverUrl }, durationMs: 0,
        ...videoFieldsOf(endpoint.watchEndpoint),
      },
    };
  }
  const played = endpoint.watchPlaylistEndpoint?.playlistId;
  if (played !== undefined) {
    if (typeof played !== 'string' || !LIST_ID.test(played)) return null;
    return { kind: 'collection', collection: { id: played, type: 'playlist', name, coverUrl, ...(played.startsWith('RD') ? { mix: true } : {}) } };
  }
  const id = endpoint.browseEndpoint?.browseId;
  if (typeof id !== 'string') return null;
  switch (pageTypeOf(endpoint)) {
    case 'MUSIC_PAGE_TYPE_ALBUM':
      return id.startsWith('MPRE') && LIST_ID.test(id) ? { kind: 'collection', collection: { id, type: 'album', name, coverUrl, artists } } : null;
    case 'MUSIC_PAGE_TYPE_PLAYLIST': {
      // A playlist's page is named VL and the list's id. (LM is the liked-music list, and is marked as it.)
      const playlistId = id.slice(2);
      if (!id.startsWith('VL') || !LIST_ID.test(playlistId)) return null;
      return { kind: 'collection', collection: { id: playlistId, type: 'playlist', name, coverUrl, ...(playlistId === 'LM' ? { isLiked: true } : {}) } };
    }
    case 'MUSIC_PAGE_TYPE_ARTIST':
      return ARTIST_ID.test(id) ? { kind: 'collection', collection: { id, type: 'artist', name, coverUrl } } : null;
    default:
      return null;
  }
}

// One entry of a shelf as an item of the explore page, or null for what the page does not show
// (a podcast episode, a link to a mood or a genre, anything in a layout not known here). An
// entry comes in one of two layouts, a card of two rows or a row of a list, and a layout does
// not say the kind (the rows of the explore page are songs, those of the charts page artists).
function exploreItemFromEntry(entry) {
  const card = entry?.musicTwoRowItemRenderer;
  const row = entry?.musicResponsiveListItemRenderer;
  const columns = (Array.isArray(row?.flexColumns) ? row.flexColumns : []).map(column => column?.musicResponsiveListItemFlexColumnRenderer?.text);
  const title = card ? card.title : columns[0];
  const name = textOf(title);
  // The row of a song leads nowhere itself: its title does.
  const endpoint = (card ?? row)?.navigationEndpoint ?? title?.runs?.[0]?.navigationEndpoint;
  if (!name || !endpoint) return null;
  const thumbnails = (card?.thumbnailRenderer ?? row?.thumbnail)?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  const coverUrl = thumbnailUrl(thumbnails);
  const item = entryLeadingTo(endpoint, { name, coverUrl, artists: artistsOf(card ? card.subtitle : columns[1]), albumLine: columns[2] });
  // A video shows a still of itself, 16:9 (800 × 450 on a card, 400 × 225 in a row), anything
  // else a square picture. An entry with a wide picture names it, for a layout to keep the
  // picture's proportions.
  const isWide = (Array.isArray(thumbnails) ? thumbnails : []).some(picture => picture?.width > picture?.height);
  return item && isWide ? { ...item, wideCoverUrl: coverUrl } : item;
}

// The shelves of one answer in page order, each with its heading and the entries read from it,
// and the token of the feed's further part where the answer offers one. A first answer keeps its
// shelves under the page's one tab, a further part of the home feed under `continuationContents`.
// A shelf is a carousel; a shelf left with no entry is left out, and so is what else stands
// between the shelves (a grid of links, the invitation to pick artists, an empty list).
function readWebShelves(data) {
  const list = data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
    ?? data?.continuationContents?.sectionListContinuation;
  const sections = (Array.isArray(list?.contents) ? list.contents : []).flatMap(shelf => {
    const carousel = shelf?.musicCarouselShelfRenderer;
    const items = (Array.isArray(carousel?.contents) ? carousel.contents : []).map(exploreItemFromEntry).filter(Boolean);
    return items.length > 0 ? [{ title: textOf(carousel.header?.musicCarouselShelfBasicHeaderRenderer?.title), items }] : [];
  });
  const continuation = list?.continuations?.[0]?.nextContinuationData?.continuation;
  return { sections, ...(typeof continuation === 'string' && continuation ? { continuation } : {}) };
}

// The categories of the moods and genres page, in its order: each with its heading, its name and
// what its page is asked for with. A link that leads anywhere else is left out.
function readMoodLinks(data) {
  const groups = data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
  return (Array.isArray(groups) ? groups : []).flatMap(group => {
    const grid = group?.gridRenderer;
    const heading = textOf(grid?.header?.gridHeaderRenderer?.title);
    return (Array.isArray(grid?.items) ? grid.items : []).flatMap(item => {
      const link = item?.musicNavigationButtonRenderer;
      const endpoint = link?.clickCommand?.browseEndpoint;
      const name = textOf(link?.buttonText);
      return name && endpoint?.browseId === MOOD_CATEGORY && typeof endpoint.params === 'string' && endpoint.params
        ? [{ heading, name, params: endpoint.params }]
        : [];
    });
  });
}

// The playlists of a category's shelves, taken from them in turn, each once and `most` at most.
function playlistsInTurn(sections, most) {
  const seen = new Set();
  const lists = [];
  const longest = Math.max(0, ...sections.map(section => section.items.length));
  for (let place = 0; place < longest && lists.length < most; place += 1) {
    for (const section of sections) {
      const item = section.items[place];
      if (item?.kind !== 'collection' || item.collection.type !== 'playlist' || seen.has(item.collection.id) || lists.length >= most) continue;
      seen.add(item.collection.id);
      lists.push(item);
    }
  }
  return lists;
}

// A shelf by its heading and its entries, in whatever order they come.
const shelfKey = section => JSON.stringify([
  section.title,
  ...section.items.map(item => (item.kind === 'song' ? `song:${item.song.id}` : `${item.collection.type}:${item.collection.id}`)).sort(),
]);

// `browse` makes one signed-in /browse request as the web client and answers YouTube's raw JSON.
function createWebExplore({ browse, log = (...args) => console.log(...args), warn = (...args) => console.warn(...args) }) {
  // The shelves answered since the page was last asked for from its start.
  let answered = new Set();
  // The categories of the moods and genres, as read once since then (the read may be under way).
  let moods = null;

  // A page of the moods and genres: MOODS_A_PAGE categories from the place `continuation` names.
  // A page of theirs that YouTube will not give is passed over as a page after the feed is: the
  // list of them ends the explore page, a category leaves its shelf out.
  async function moodPage(continuation, own) {
    const from = Number(continuation.slice(MOODS.length).trim() || 0);
    const passOver = (what, error) => {
      const { code } = toErrorResult(error).error;
      if (code === 'auth-required' || code === 'network') throw error;
      warn(`[Ytm] Explore page as the web client (${what}) could not be read: ${describeError(error)}; it is passed over`);
      return null;
    };
    if (!moods) {
      const asked = browse({ browseId: MOODS }).then(readMoodLinks);
      moods = asked;
      // (A read that failed is not kept: the next page asks YouTube again.)
      asked.catch(() => { if (moods === asked) moods = null; });
    }
    const links = await moods.catch(error => passOver(MOODS, error));
    if (!links) return { sections: [] };
    const asked = links.slice(from, from + MOODS_A_PAGE);
    const pages = await Promise.all(asked.map(link => browse({ browseId: MOOD_CATEGORY, params: link.params })
      .catch(error => passOver(`${MOOD_CATEGORY} ${link.name}`, error))));
    const sections = asked.flatMap((link, index) => {
      const items = pages[index] ? playlistsInTurn(readWebShelves(pages[index]).sections, MOOD_LISTS) : [];
      const section = { title: link.heading ? `${link.heading} · ${link.name}` : link.name, items };
      const key = shelfKey(section);
      if (items.length === 0 || own.has(key)) return [];
      own.add(key);
      return [section];
    });
    const next = from + MOODS_A_PAGE < links.length ? `${MOODS} ${from + MOODS_A_PAGE}` : undefined;
    log(`[Ytm] Explore page as the web client (${MOODS}, from category ${from}): ${sections.length} shelves of ${asked.length} categories, ${sections.reduce((sum, section) => sum + section.items.length, 0)} playlists; ${links.length} categories in all; ${next ? 'a page follows' : 'the last page'}`);
    return { sections, ...(next ? { continuation: next } : {}) };
  }

  // One page of the explore page's shelves, in the shape of the `explore` operation's answer.
  // Without `continuation` the page is asked for from its start (the first part of the home
  // feed); with the `continuation` of an answer, the page after that answer's. The home feed
  // names its own further part; after its last part, after each page of LATER_PAGES and after
  // each page of the moods and genres, the next page is named here. The answer of the last page
  // has no `continuation`.
  async function page(continuation) {
    if (!continuation) {
      answered = new Set();
      moods = null;
    }
    // (An answer that arrives after the page was asked for from its start again is of the read before.)
    const own = answered;
    if (continuation === MOODS || continuation?.startsWith(`${MOODS} `)) return moodPage(continuation, own);
    const later = LATER_PAGES.indexOf(continuation);
    const isFurtherPart = Boolean(continuation) && later < 0;
    const browseId = later >= 0 ? continuation : HOME;
    const read = readWebShelves(await browse(isFurtherPart ? { continuation } : { browseId }).catch(error => {
      // One of the pages after the feed that YouTube will not give (only the feed was read with an
      // account, 2026-10-08) is passed over: asked for again under the same name it would be
      // refused again, and the pages after it would never be reached. A sign-in that is no longer
      // taken and a network that fails are not such an answer.
      const { code } = toErrorResult(error).error;
      if (later < 0 || code === 'auth-required' || code === 'network') throw error;
      warn(`[Ytm] Explore page as the web client (${browseId}) could not be read: ${describeError(error)}; it is passed over`);
      return {};
    }));
    // The home feed names a heading of an earlier part again (measured 2026-10-08 with an account:
    // one of the three headings of its second part; whether with the same entries was not
    // measured), and the later pages can hold a shelf of the feed. A shelf with the heading and
    // the entries of one answered before is not answered again.
    const sections = read.sections.filter(section => {
      const key = shelfKey(section);
      if (own.has(key)) return false;
      own.add(key);
      return true;
    });
    const next = later >= 0 ? LATER_PAGES[later + 1] ?? MOODS : read.continuation ?? LATER_PAGES[0];
    log(`[Ytm] Explore page as the web client (${browseId}${isFurtherPart ? ', a further part' : ''}): ${sections.length} shelves, ${sections.reduce((sum, section) => sum + section.items.length, 0)} entries; ${read.sections.length - sections.length} shelves met before left out; ${next ? 'a page follows' : 'the last page'}`);
    return { sections, ...(next ? { continuation: next } : {}) };
  }

  return { page };
}

module.exports = { createWebExplore, exploreItemFromEntry, readMoodLinks, readWebShelves };
