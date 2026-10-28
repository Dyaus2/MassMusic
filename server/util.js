/** Lowercase, drop accents, "feat." parts, bracketed extras and punctuation — for fuzzy matching. */
export function norm(s = '') {
  return String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, ' ')
    .replace(/\b(feat|ft|featuring)\.?\s.*$/g, ' ')
    .replace(/\s+-\s+(remaster(ed)?|\d{4} remaster|radio edit|single version|mono|stereo).*$/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9Ѐ-ӿ؀-ۿ぀-ヿ一-鿿]+/g, ' ')
    .trim();
}

export function primaryArtist(artist = '') {
  return String(artist).split(/\s*(?:,|;|&| x | feat\.? | ft\.? | and )\s*/i)[0] || '';
}

export function matchKey(title, artist) {
  return `${norm(title)}|${norm(primaryArtist(artist))}`;
}

export function parseClock(text) {
  if (!text) return 0;
  const parts = String(text).split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
}

const NOISE = /\s*[([](official\s*)?(music\s*)?(video|audio|lyric(s)?(\s*video)?|visuali[sz]er|hd|hq|4k|explicit|clean|audio only|color coded lyrics)[)\]]\s*/gi;

/** Turn "Artist - Song (Official Video)" + channel into { title, artist }. */
export function splitYouTubeTitle(rawTitle = '', channel = '') {
  let title = rawTitle.replace(NOISE, ' ').replace(/\s{2,}/g, ' ').trim();
  let artist = channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const m = title.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
  if (m) {
    artist = m[1].trim();
    title = m[2].trim();
  }
  title = title.replace(/^["'“]|["'”]$/g, '').trim();
  return { title: title || rawTitle, artist };
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
