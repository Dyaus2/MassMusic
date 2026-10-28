/**
 * Music data for recommendations. Both services are free and need no API key:
 *  - Deezer: related artists, their top tracks, popularity, tempo, release dates
 *  - MusicBrainz: community genre tags per artist
 * Everything is cached in SQLite, so after the first day only a handful of requests are made.
 */
import { db, q } from '../db.js';
import { norm } from '../util.js';

const UA = 'MassMusic/0.1 (https://github.com/Dyaus2/MassMusic)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

db.exec(`CREATE TABLE IF NOT EXISTS recs_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
)`);

/** Serialises calls so a service sees at most one request per `gapMs`. */
function gate(gapMs) {
  let last = 0;
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(async () => {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  };
}
const deezerGate = gate(120); // Deezer allows 50 requests / 5 s
const mbGate = gate(1100); // MusicBrainz asks for 1 request / s

const inFlight = new Map(); // key -> promise, so parallel asks for the same thing share one request

function cached(key, ttlDays, fetcher) {
  const row = q.get('SELECT value, fetched_at FROM recs_cache WHERE key = :key', { key });
  if (row && Date.now() - row.fetched_at < ttlDays * 864e5) return Promise.resolve(JSON.parse(row.value));
  if (inFlight.has(key)) return inFlight.get(key);
  const p = refresh(key, row, fetcher).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function refresh(key, row, fetcher) {
  try {
    const value = await fetcher();
    q.run(
      'INSERT INTO recs_cache (key, value, fetched_at) VALUES (:key, :value, :now) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at',
      { key, value: JSON.stringify(value), now: Date.now() },
    );
    return value;
  } catch (e) {
    if (row) return JSON.parse(row.value); // stale beats nothing when offline
    throw e;
  }
}

async function getJson(url, gateFn) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await gateFn(() => fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }));
    if (res.status === 429 || res.status === 503) {
      await sleep(1500 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
    const json = await res.json();
    if (json?.error?.code === 4) { // Deezer "quota exceeded"
      await sleep(2000 * attempt);
      continue;
    }
    if (json?.error) throw new Error(`Deezer: ${json.error.message || 'error'}`);
    return json;
  }
  throw new Error(`${new URL(url).host} is rate limiting, try again later`);
}

const DZ = 'https://api.deezer.com';
const mapArtist = (a) => ({ id: a.id, name: a.name, fans: a.nb_fan || 0 });

export const deezer = {
  async findArtist(name) {
    const key = norm(name);
    if (!key) return null;
    return cached(`dz:artist:${key}`, 60, async () => {
      const r = await getJson(`${DZ}/search/artist?q=${encodeURIComponent(name)}&limit=5`, deezerGate);
      const list = r.data || [];
      const hit = list.find((a) => norm(a.name) === key) || list[0];
      return hit ? mapArtist(hit) : null;
    });
  },
  related(artistId) {
    return cached(`dz:related:${artistId}`, 14, async () => {
      const r = await getJson(`${DZ}/artist/${artistId}/related?limit=12`, deezerGate);
      return (r.data || []).map(mapArtist);
    });
  },
  topTracks(artistId, limit = 4) {
    return cached(`dz:top:${artistId}:${limit}`, 14, async () => {
      const r = await getJson(`${DZ}/artist/${artistId}/top?limit=${limit}`, deezerGate);
      return (r.data || []).map(mapTrack);
    });
  },
  track(id) {
    return cached(`dz:track:${id}`, 180, async () => {
      const t = await getJson(`${DZ}/track/${id}`, deezerGate);
      const year = Number(String(t.release_date || t.album?.release_date || '').slice(0, 4)) || null;
      return { bpm: t.bpm || 0, year, rank: t.rank || 0 };
    });
  },
  chart(limit = 50) {
    return cached(`dz:chart:${limit}`, 1, async () => {
      const r = await getJson(`${DZ}/chart/0/tracks?limit=${limit}`, deezerGate);
      return (r.data || []).map(mapTrack);
    });
  },
};

function mapTrack(t) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist?.name || '',
    artistId: t.artist?.id || null,
    album: t.album?.title || '',
    cover: t.album?.cover_big || t.album?.cover_medium || null,
    durationSec: t.duration || 0,
    rank: t.rank || 0,
    explicit: !!t.explicit_lyrics,
  };
}

export const musicbrainz = {
  /** Community tags for an artist, e.g. [{ name: 'psychedelic pop', count: 5 }] */
  artistTags(name) {
    const key = norm(name);
    if (!key) return Promise.resolve([]);
    return cached(`mb:tags:${key}`, 90, async () => {
      const r = await getJson(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${name}"`)}&limit=5&fmt=json`, mbGate);
      const list = r.artists || [];
      const hit = list.find((a) => norm(a.name) === key && (a.tags?.length || 0) > 0) || list.find((a) => norm(a.name) === key) || (list[0]?.score >= 95 ? list[0] : null);
      return (hit?.tags || []).map((t) => ({ name: t.name, count: t.count || 0 }));
    });
  },
};
