import { UA, norm, parseClock, primaryArtist } from './util.js';

/**
 * Search YouTube by reading the results page (no API key needed).
 * Returns [{ videoId, title, channel, durationMs, thumb }]
 */
export async function ytSearch(query, limit = 20) {
  // sp=EgIQAQ%3D%3D -> filter: videos only
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D&hl=en`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      // skip the EU cookie-consent redirect loop
      Cookie: 'CONSENT=YES+cb; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',
    },
  });
  if (!res.ok) throw new Error(`YouTube search failed (${res.status})`);
  const html = await res.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) throw new Error('Could not read YouTube results');
  const data = JSON.parse(m[1]);

  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object' || out.length >= limit) return;
    if (node.videoRenderer) {
      const v = node.videoRenderer;
      const durationMs = parseClock(v.lengthText?.simpleText);
      if (v.videoId && durationMs) {
        out.push({
          videoId: v.videoId,
          title: v.title?.runs?.map((r) => r.text).join('') ?? '',
          channel: v.ownerText?.runs?.[0]?.text ?? '',
          durationMs,
          thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        });
      }
      return;
    }
    for (const k in node) walk(node[k]);
  };
  walk(data.contents);
  return out;
}

const BAD = ['live', 'cover', 'remix', 'karaoke', 'instrumental', '8d', 'slowed', 'sped up', 'reverb', 'nightcore', 'hour', 'loop', 'reaction', 'tutorial', 'lesson', 'piano version', 'acoustic', 'mashup', 'bass boosted', 'concert'];

function score(c, want, preferEmbeddable) {
  const ct = norm(c.title);
  const ch = norm(c.channel);
  const wt = norm(want.title);
  const wa = norm(primaryArtist(want.artist));
  const wantRaw = `${want.title} ${want.album || ''}`.toLowerCase();
  let s = 0;

  if (wt && ct.includes(wt)) s += 35;
  else if (wt) {
    const words = wt.split(' ').filter(Boolean);
    const hit = words.filter((w) => ct.includes(w)).length;
    s += Math.round((hit / words.length) * 25) - 10;
  }
  if (wa && (ct.includes(wa) || ch.includes(wa))) s += 20;
  if (preferEmbeddable) {
    // label / auto-generated uploads are the ones that usually block embedding
    if (/ - topic$|vevo$/i.test(c.channel) || (wa && ch === wa)) s -= 15;
    if (/lyric/i.test(c.title)) s += 15;
  } else {
    if (/ - topic$/i.test(c.channel)) s += 15;
    if (/vevo$/i.test(c.channel)) s += 8;
    if (/official audio|\baudio\b/i.test(c.title)) s += 6;
  }

  const rawTitle = c.title.toLowerCase();
  for (const b of BAD) {
    if (rawTitle.includes(b) && !wantRaw.includes(b)) s -= 25;
  }

  if (want.durationMs && c.durationMs) {
    const diff = Math.abs(want.durationMs - c.durationMs);
    if (diff < 4000) s += 25;
    else if (diff < 12000) s += 12;
    else if (diff > 45000) s -= 30;
  } else if (c.durationMs > 15 * 60 * 1000) {
    s -= 30;
  }
  return s;
}

/**
 * Find the YouTube videos most likely to be this song, best first.
 * `preferEmbeddable` is set after a version refused to play: then lyric uploads are favoured,
 * since official label uploads are the ones that usually block other websites.
 */
export async function findOnYouTube(want, exclude = [], { preferEmbeddable = false } = {}) {
  const query = `${primaryArtist(want.artist)} ${want.title}`.trim();
  const searches = [ytSearch(`${query} ${preferEmbeddable ? 'lyrics' : 'audio'}`, 15)];
  if (preferEmbeddable) searches.push(ytSearch(`${query} audio`, 15).catch(() => []));
  const seen = new Set(exclude);
  const results = (await Promise.all(searches)).flat().filter((r) => !seen.has(r.videoId) && seen.add(r.videoId));
  return results
    .map((r) => ({ ...r, score: score(r, want, preferEmbeddable) }))
    .sort((a, b) => b.score - a.score);
}
