/**
 * Daily recommendations: 3 songs a day that you don't have yet.
 *
 *  1. Taste profile  - artists in your library, weighted by likes, playlists and plays
 *                      (sets the model's starting belief, never counted as ratings)
 *  2. Candidates     - Deezer's related artists of a few of your artists, and their top songs
 *  3. Features       - MusicBrainz genre tags, popularity, year, tempo, closeness to your artists
 *  4. Model          - Bayesian linear bandit (model.js), learned only from your star ratings
 *  5. Picks          - 2 confident picks + 1 wildcard, all different artists
 */
import { db, q, tx, getTrack } from '../db.js';
import { matchKey, norm, primaryArtist } from '../util.js';
import { D, featurize, priorMean, tokenSlot, NUMERIC_NAMES } from './features.js';
import { posterior, chooseDaily, makeRng, STAR_REWARD } from './model.js';
import { deezer, musicbrainz } from './sources.js';

db.exec(`
CREATE TABLE IF NOT EXISTS recommendations (
  id          INTEGER PRIMARY KEY,
  day         TEXT NOT NULL,              -- local date, YYYY-MM-DD
  slot        INTEGER NOT NULL,
  kind        TEXT NOT NULL,              -- safe | wild
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL,
  album       TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  cover_url   TEXT,
  deezer_id   INTEGER,
  track_id    INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
  features    TEXT NOT NULL,              -- the x vector the model saw (JSON)
  tokens      TEXT NOT NULL DEFAULT '[]', -- readable tokens behind the hashed features
  score       REAL,                       -- posterior mean at pick time
  uncertainty REAL,
  propensity  REAL,                       -- P(policy picks this song for this slot), for off-policy evaluation
  reason      TEXT NOT NULL DEFAULT '',
  rating      INTEGER,                    -- 1..5 stars, NULL = not rated (ignored is fine)
  reward      REAL,
  rated_day   TEXT,
  known       INTEGER NOT NULL DEFAULT 0, -- "I already know this": no model update
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_recs_day ON recommendations(day);
`);

export const PICKS_PER_DAY = 3;
export const recState = { status: 'idle', step: '', error: null, day: null };
let coldDay = null; // day whose picks were made from an empty library

/** Redo today's picks once if they were made before you had any music and you haven't rated them. */
function maybeRedoColdDay(day) {
  if (coldDay !== day || recState.status === 'generating') return false;
  const touched = q.get('SELECT COUNT(*) AS n FROM recommendations WHERE day = :day AND (rating IS NOT NULL OR known = 1)', { day }).n;
  if (touched || libraryArtists().length < 3) return false;
  coldDay = null;
  generateDay(day, { force: true }).catch(() => {});
  return true;
}

/* ---------------- dates ---------------- */

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
const dayNumber = (key) => Math.round(Date.parse(`${key}T12:00:00Z`) / 864e5);
const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);

/* ---------------- taste profile from the library ---------------- */

/**
 * Artists you listen to, with a weight. Recommended songs only count here once you rate them
 * (rated 4–5★ adds weight, 1–2★ excludes the artist); unrated recommendations count for nothing.
 */
export function libraryArtists() {
  const rows = q.all(`
    SELECT t.artist, t.source,
           (l.track_id IS NOT NULL) AS liked,
           (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.track_id = t.id) AS lists,
           (SELECT COUNT(*) FROM history h WHERE h.track_id = t.id) AS plays,
           r.id AS rec_id, r.reward AS rec_reward
    FROM tracks t
    LEFT JOIN likes l ON l.track_id = t.id
    LEFT JOIN recommendations r ON r.track_id = t.id`);
  const artists = new Map();
  const banned = new Set();
  for (const r of rows) {
    const name = primaryArtist(r.artist || '').trim();
    const key = norm(name);
    if (!key) continue;
    let w;
    if (r.rec_id) {
      if (r.rec_reward == null) continue;
      if (r.rec_reward < 0) banned.add(key);
      w = Math.max(0, 3 * r.rec_reward);
    } else {
      w = 3 * r.liked + Math.min(3, r.lists) + 2 * Math.log2(1 + r.plays) + (r.source === 'local' ? 1 : 0);
    }
    if (w <= 0) continue;
    const a = artists.get(key) || { key, name, weight: 0 };
    a.weight += w;
    artists.set(key, a);
  }
  return [...artists.values()].filter((a) => !banned.has(a.key)).sort((a, b) => b.weight - a.weight);
}

function sampleSeeds(artists, count, rng) {
  const pool = artists.slice(0, 40).map((a) => ({ a, w: Math.pow(a.weight, 0.7) }));
  const out = [];
  while (pool.length && out.length < count) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = rng.uniform() * total;
    const i = pool.findIndex((p) => (r -= p.w) <= 0);
    out.push(pool.splice(i < 0 ? 0 : i, 1)[0].a);
  }
  return out;
}

/* ---------------- candidates ---------------- */

async function gatherCandidates(seeds, onStep) {
  const maxWeight = seeds[0]?.weight || 1;
  const byArtist = new Map(); // artist key -> { artist, near: [[seedName, w]], affinity }

  onStep('Looking up artists you like');
  const seedHits = await Promise.all(seeds.map(async (s) => ({ s, dz: await deezer.findArtist(s.name).catch(() => null) })));
  onStep('Finding related artists');
  await Promise.all(seedHits.filter((h) => h.dz).map(async ({ s, dz }) => {
    const rel = await deezer.related(dz.id).catch(() => []);
    rel.forEach((a, rank) => {
      const key = norm(a.name);
      const w = (Math.min(s.weight, maxWeight) / maxWeight) * (1 - rank / (rel.length + 1));
      const cur = byArtist.get(key) || { artist: a, near: [], affinity: 0 };
      cur.near.push([s.name, w]);
      cur.affinity = Math.min(1, cur.affinity + w * 0.6);
      byArtist.set(key, cur);
    });
  }));

  let artistList = [...byArtist.values()].sort((a, b) => b.affinity - a.affinity).slice(0, 50);
  const songs = [];
  onStep('Collecting songs');
  await Promise.all(artistList.map(async (c) => {
    const top = await deezer.topTracks(c.artist.id, 4).catch(() => []);
    for (const t of top) songs.push({ ...t, fans: c.artist.fans, near: c.near.sort((a, b) => b[1] - a[1]).slice(0, 3), affinity: c.affinity });
  }));

  // Few or no seeds yet (new library): mix in what is popular right now
  if (songs.length < 60) {
    const chart = await deezer.chart(50).catch(() => []);
    for (const t of chart) songs.push({ ...t, fans: 0, near: [], affinity: 0 });
  }
  return songs;
}

function novelOnly(songs) {
  const known = new Set(q.all('SELECT title, artist FROM tracks').map((r) => matchKey(r.title, r.artist)));
  for (const r of q.all('SELECT title, artist FROM recommendations')) known.add(matchKey(r.title, r.artist));
  const seenDeezer = new Set(q.all('SELECT deezer_id FROM recommendations WHERE deezer_id IS NOT NULL').map((r) => r.deezer_id));
  const out = [];
  const seen = new Set();
  for (const s of songs) {
    const k = matchKey(s.title, s.artist);
    if (!s.title || known.has(k) || seen.has(k) || seenDeezer.has(s.id)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/* ---------------- model input ---------------- */

function ratingsFor(today) {
  return q.all('SELECT features, reward, rated_day FROM recommendations WHERE rating IS NOT NULL AND known = 0').map((r) => ({
    x: Float64Array.from(JSON.parse(r.features)),
    reward: r.reward,
    age: daysBetween(r.rated_day, today),
  }));
}

async function currentModel(today, { withTags = true } = {}) {
  const artists = libraryArtists();
  const profile = withTags
    ? await Promise.all(artists.slice(0, 25).map(async (a) => ({ ...a, tags: await musicbrainz.artistTags(a.name).catch(() => []) })))
    : artists.slice(0, 25).map((a) => ({ ...a, tags: [] }));
  const mu0 = priorMean(profile);
  return { artists, mu0, post: posterior(D, mu0, ratingsFor(today)) };
}

/* ---------------- explanations ---------------- */

function reasonFor(pick, post) {
  const contrib = pick.tokens
    .filter(([t]) => t.startsWith('tag:'))
    .map(([t, w]) => {
      const { index, sign } = tokenSlot(t);
      return { tag: t.slice(4), v: sign * w * post.mean[index] };
    })
    .sort((a, b) => b.v - a.v);
  const tags = contrib.slice(0, 2).map((c) => c.tag);
  const near = pick.near?.[0]?.[0];
  const tagText = tags.length ? tags.join(', ') : '';
  if (pick.kind === 'wild') return ['Something different', tagText].filter(Boolean).join(' · ');
  if (near) return [`Close to ${near}`, tagText].filter(Boolean).join(' · ');
  return ['Popular right now', tagText].filter(Boolean).join(' · ');
}

/* ---------------- generating a day ---------------- */

export async function generateDay(day = dayKey(), { force = false } = {}) {
  if (recState.status === 'generating') return recState;
  const existing = q.get('SELECT COUNT(*) AS n FROM recommendations WHERE day = :day', { day }).n;
  if (existing && !force) return recState;

  Object.assign(recState, { status: 'generating', step: 'Starting', error: null, day });
  const onStep = (step) => { recState.step = step; };
  try {
    const rng = makeRng((Date.now() ^ dayNumber(day)) >>> 0);
    onStep('Reading your library');
    const { artists, post } = await currentModel(day);
    const seeds = sampleSeeds(artists, 10, rng);
    coldDay = seeds.length ? null : day; // picks made without knowing anything about you

    const songs = novelOnly(await gatherCandidates(seeds, onStep));
    if (songs.length < PICKS_PER_DAY) throw new Error('Not enough new songs found. Check your internet connection.');

    onStep('Reading genres and song details');
    const pool = songs.slice(0, 220);
    await Promise.all(pool.map(async (s) => {
      const [tags, details] = await Promise.all([
        musicbrainz.artistTags(s.artist).catch(() => []),
        deezer.track(s.id).catch(() => ({})),
      ]);
      Object.assign(s, { tags, bpm: details.bpm, year: details.year, rank: details.rank || s.rank });
    }));

    onStep('Choosing today\'s songs');
    const cands = pool.map((s) => {
      const f = featurize({ tags: s.tags, nearArtists: s.near, affinity: s.affinity, rank: s.rank, fans: s.fans, year: s.year, durationSec: s.durationSec, bpm: s.bpm, explicit: s.explicit });
      return { ...s, ...f, artistKey: norm(primaryArtist(s.artist)) };
    });
    const picks = chooseDaily(cands, post, rng);

    tx(() => {
      if (force) {
        const old = q.all('SELECT id, track_id FROM recommendations WHERE day = :day AND rating IS NULL', { day });
        for (const r of old) {
          q.run('DELETE FROM recommendations WHERE id = :id', { id: r.id });
          q.run(`DELETE FROM tracks WHERE id = :t AND id NOT IN (SELECT track_id FROM playlist_tracks) AND id NOT IN (SELECT track_id FROM likes)`, { t: r.track_id });
        }
      }
      picks.forEach((p, slot) => {
        const t = q.run(
          `INSERT INTO tracks (source, title, artist, album, duration_ms, cover_url) VALUES ('external', :title, :artist, :album, :dur, :cover)`,
          { title: p.title, artist: p.artist, album: p.album, dur: p.durationSec * 1000, cover: p.cover },
        );
        q.run(
          `INSERT INTO recommendations (day, slot, kind, title, artist, album, duration_ms, cover_url, deezer_id, track_id, features, tokens, score, uncertainty, propensity, reason)
           VALUES (:day, :slot, :kind, :title, :artist, :album, :dur, :cover, :dz, :track, :features, :tokens, :score, :unc, :prop, :reason)`,
          {
            day, slot, kind: p.kind, title: p.title, artist: p.artist, album: p.album, dur: p.durationSec * 1000, cover: p.cover, dz: p.id,
            track: Number(t.lastInsertRowid),
            features: JSON.stringify([...p.x].map((v) => Math.round(v * 1e5) / 1e5)),
            tokens: JSON.stringify(p.tokens.map(([tok, w]) => [tok, Math.round(w * 1e4) / 1e4])),
            score: p.score, unc: p.uncertainty, prop: p.propensity, reason: reasonFor(p, post),
          },
        );
      });
    });
    Object.assign(recState, { status: 'idle', step: '', error: null });
  } catch (e) {
    console.error('Daily recommendations failed:', e.message);
    Object.assign(recState, { status: 'error', step: '', error: e.message });
  }
  return recState;
}

/* ---------------- reading, rating, stats ---------------- */

function serializeRec(r) {
  return {
    id: r.id,
    day: r.day,
    slot: r.slot,
    kind: r.kind,
    title: r.title,
    artist: r.artist,
    album: r.album,
    durationMs: r.duration_ms,
    cover: r.cover_url,
    reason: r.reason,
    rating: r.rating,
    known: !!r.known,
    track: r.track_id ? getTrack(r.track_id) : null,
  };
}

export function todayPicks() {
  const day = dayKey();
  const picks = q.all('SELECT * FROM recommendations WHERE day = :day ORDER BY slot', { day }).map(serializeRec);
  const mine = recState.day === day; // the generator's state is about today
  return { day, picks, status: mine ? recState.status : 'idle', step: mine ? recState.step : '', error: mine ? recState.error : null };
}

export function rate(id, stars) {
  const s = Number(stars);
  if (![1, 2, 3, 4, 5].includes(s)) throw Object.assign(new Error('Rating must be 1 to 5 stars'), { status: 400 });
  q.run('UPDATE recommendations SET rating = :s, reward = :r, rated_day = :d, known = 0 WHERE id = :id', { s, r: STAR_REWARD[s], d: dayKey(), id: Number(id) });
  return serializeRec(q.get('SELECT * FROM recommendations WHERE id = :id', { id: Number(id) }));
}

export function clearRating(id) {
  q.run('UPDATE recommendations SET rating = NULL, reward = NULL, rated_day = NULL WHERE id = :id', { id: Number(id) });
  return serializeRec(q.get('SELECT * FROM recommendations WHERE id = :id', { id: Number(id) }));
}

export function setKnown(id, known) {
  q.run('UPDATE recommendations SET known = :k, rating = CASE WHEN :k THEN NULL ELSE rating END, reward = CASE WHEN :k THEN NULL ELSE reward END WHERE id = :id', { k: known ? 1 : 0, id: Number(id) });
  return serializeRec(q.get('SELECT * FROM recommendations WHERE id = :id', { id: Number(id) }));
}

export function history(limit = 90) {
  return q.all('SELECT * FROM recommendations WHERE day < :today ORDER BY day DESC, slot LIMIT :limit', { today: dayKey(), limit: Number(limit) }).map(serializeRec);
}

export async function stats() {
  const today = dayKey();
  const { post } = await currentModel(today, { withTags: true });
  const rows = q.all('SELECT day, kind, rating, known, tokens FROM recommendations');
  const rated = rows.filter((r) => r.rating != null);
  const avg = (list) => (list.length ? list.reduce((s, r) => s + r.rating, 0) / list.length : null);
  const hit = (list) => (list.length ? list.filter((r) => r.rating >= 4).length / list.length : null);
  const byKind = (k) => rated.filter((r) => r.kind === k);

  // what the model has learned about tags it has seen in rated songs
  const vocab = new Map();
  for (const r of rows.filter((x) => x.rating != null)) {
    for (const [t] of JSON.parse(r.tokens)) if (t.startsWith('tag:')) vocab.set(t, t.slice(4));
  }
  const learned = [...vocab.entries()].map(([t, name]) => {
    const { index, sign } = tokenSlot(t);
    return { tag: name, score: Math.round(sign * post.mean[index] * 1000) / 1000 };
  }).sort((a, b) => b.score - a.score);

  const leanings = [];
  if (rated.length >= 5) {
    const say = (i, pos, neg) => {
      const v = post.mean[i];
      if (Math.abs(v) > 0.08) leanings.push({ feature: NUMERIC_NAMES[i], text: v > 0 ? pos : neg, strength: Math.round(Math.abs(v) * 100) / 100 });
    };
    say(2, 'You like well-known songs', 'You like hidden gems');
    say(4, 'You lean towards newer music', 'You lean towards older music');
    say(6, 'You like faster tempos', 'You like slower tempos');
    say(1, 'You like staying close to your artists', 'You enjoy discovering far from your usual artists');
  }

  const weeks = new Map();
  for (const r of rated) {
    const wk = Math.floor(dayNumber(r.day) / 7);
    const w = weeks.get(wk) || { week: wk, sum: 0, n: 0 };
    w.sum += r.rating;
    w.n++;
    weeks.set(wk, w);
  }
  const weekly = [...weeks.values()].sort((a, b) => a.week - b.week).slice(-12).map((w) => ({
    start: new Date(w.week * 7 * 864e5).toISOString().slice(0, 10),
    avg: Math.round((w.sum / w.n) * 100) / 100,
    n: w.n,
  }));

  const n = rated.length;
  const maturity = n < 5 ? 'Just met you' : n < 30 ? 'Learning your taste' : n < 100 ? 'Knows your taste' : 'Old friend';
  return {
    days: new Set(rows.map((r) => r.day)).size,
    recommended: rows.length,
    rated: n,
    known: rows.filter((r) => r.known).length,
    ignored: rows.filter((r) => r.rating == null && !r.known && r.day < today).length,
    avgStars: avg(rated),
    safe: { avg: avg(byKind('safe')), hitRate: hit(byKind('safe')), n: byKind('safe').length },
    wild: { avg: avg(byKind('wild')), hitRate: hit(byKind('wild')), n: byKind('wild').length },
    effectiveRatings: Math.round(post.effective * 10) / 10,
    maturity,
    likes: learned.filter((l) => l.score > 0.02).slice(0, 8),
    dislikes: learned.filter((l) => l.score < -0.02).slice(-5).reverse(),
    leanings,
    weekly,
    modelSize: { features: D, parametersKB: Math.round((D * D + D) * 8 / 1024) },
  };
}

/* ---------------- schedule ---------------- */

let timer = null;
export function startRecScheduler() {
  if (timer) return;
  const tick = () => {
    const day = dayKey();
    const have = q.get('SELECT COUNT(*) AS n FROM recommendations WHERE day = :day', { day }).n;
    if (!have && recState.status !== 'generating') generateDay(day).catch(() => {});
  };
  setTimeout(tick, 4000);
  timer = setInterval(tick, 20 * 60 * 1000);
  timer.unref?.();
}

export function registerRecRoutes(app, wrap) {
  app.get('/api/recs/today', (req, res) => {
    let t = todayPicks();
    if (maybeRedoColdDay(t.day)) t = { ...t, picks: [], status: 'generating', step: 'Using the music you just added' };
    else if (!t.picks.length && recState.status !== 'generating' && recState.status !== 'error') {
      generateDay(t.day).catch(() => {});
      t.status = 'generating';
    }
    res.json(t);
  });
  app.post('/api/recs/retry', (req, res) => {
    if (recState.status !== 'generating') generateDay(dayKey()).catch(() => {});
    res.json({ ok: true });
  });
  app.put('/api/recs/:id/rating', (req, res) => res.json(rate(req.params.id, req.body?.stars)));
  app.delete('/api/recs/:id/rating', (req, res) => res.json(clearRating(req.params.id)));
  app.put('/api/recs/:id/known', (req, res) => res.json(setKnown(req.params.id, req.body?.known !== false)));
  app.get('/api/recs/history', (req, res) => res.json(history(req.query.limit || 90)));
  app.get('/api/recs/stats', wrap(async (req, res) => res.json(await stats())));
}
