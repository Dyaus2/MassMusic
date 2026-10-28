/**
 * Turns a song into a fixed-size feature vector (d = 64).
 *
 *  0  bias
 *  1  affinity       how close the artist is to artists in your library (0..1)
 *  2  track popularity (log Deezer rank, centred)
 *  3  artist popularity (log fans, centred)
 *  4  release year (centred on 2000)
 *  5  length
 *  6  tempo (BPM)
 *  7  explicit lyrics
 *  8.. 63  hashed "tokens": genre tags, decade, and which of your artists it is near
 *          (feature hashing keeps the size fixed however many tags exist)
 */

export const D = 64;
export const NUMERIC = 8;
export const HASHED = D - NUMERIC;
export const NUMERIC_NAMES = ['bias', 'affinity', 'track popularity', 'artist popularity', 'release year', 'length', 'tempo', 'explicit'];

const clip = (v, lo = -2, hi = 2) => Math.max(lo, Math.min(hi, v));

/** FNV-1a 32-bit */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Where a token lands in the hashed block, and with which sign (signed hashing reduces collision bias). */
export function tokenSlot(token) {
  const h = hash(token);
  return { index: NUMERIC + (h % HASHED), sign: (h >>> 31) & 1 ? -1 : 1 };
}

export const normTag = (t) => String(t).toLowerCase().trim().replace(/\s+/g, ' ');

/** Weighted tokens → unit-length hashed block (length HASHED). */
export function hashedBlock(tokens) {
  const v = new Float64Array(D);
  for (const [token, w] of tokens) {
    const { index, sign } = tokenSlot(token);
    v[index] += sign * w;
  }
  let n = 0;
  for (let i = NUMERIC; i < D; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = NUMERIC; i < D; i++) v[i] /= n;
  return v;
}

/** Genre tags (from MusicBrainz) → [token, weight] using the vote counts. */
export function tagTokens(tags = [], limit = 8) {
  const top = [...tags].filter((t) => t.name).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, limit);
  const total = top.reduce((s, t) => s + Math.max(1, t.count || 0), 0) || 1;
  return top.map((t) => [`tag:${normTag(t.name)}`, Math.max(1, t.count || 0) / total]);
}

/**
 * @param {object} c candidate: { tags, nearArtists: [[name, weight]], affinity, rank, fans, year, durationSec, bpm, explicit }
 * @returns {{ x: Float64Array, tags: Float64Array, tokens: [string, number][] }}
 */
export function featurize(c) {
  const tokens = [...tagTokens(c.tags)];
  if (c.year) tokens.push([`decade:${Math.floor(c.year / 10) * 10}s`, 0.35]);
  for (const [name, w] of c.nearArtists || []) tokens.push([`near:${normTag(name)}`, 0.5 * w]);

  const block = hashedBlock(tokens);
  const tagsOnly = hashedBlock(tagTokens(c.tags)); // used for "too similar" checks between picks
  const x = new Float64Array(D);
  x[0] = 1;
  x[1] = clip(c.affinity || 0, 0, 1);
  x[2] = c.rank ? clip(Math.log10(c.rank + 1) - 5.5) : 0;
  x[3] = c.fans ? clip((Math.log10(c.fans + 1) - 5) / 1.5) : 0;
  x[4] = c.year ? clip((c.year - 2000) / 20) : 0;
  x[5] = c.durationSec ? clip((c.durationSec - 220) / 90) : 0;
  x[6] = c.bpm ? clip((c.bpm - 120) / 40) : 0;
  x[7] = c.explicit ? 1 : 0;
  for (let i = NUMERIC; i < D; i++) x[i] = block[i];
  return { x, tags: tagsOnly, tokens };
}

/**
 * Prior mean from your library: "songs with the genres and neighbours of artists you already
 * play are probably good". Built from weighted artist tag lists.
 */
export function priorMean(libraryArtists) {
  const tokens = [];
  for (const a of libraryArtists) {
    for (const [t, w] of tagTokens(a.tags)) tokens.push([t, w * a.weight]);
    tokens.push([`near:${normTag(a.name)}`, 0.5 * a.weight]);
  }
  const mu = hashedBlock(tokens);
  for (let i = NUMERIC; i < D; i++) mu[i] *= 0.8;
  mu[0] = 0;
  mu[1] = tokens.length ? 0.6 : 0; // closer to your artists = probably better
  // gentle starting lean away from mega-hits you have most likely heard already (ratings can override)
  mu[2] = -0.15;
  mu[3] = -0.1;
  return mu;
}
