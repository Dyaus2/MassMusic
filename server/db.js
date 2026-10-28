import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT_DIR = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = path.resolve(process.env.MASSMUSIC_DATA || path.join(ROOT_DIR, 'data'));
export const COVERS_DIR = path.join(DATA_DIR, 'covers');
fs.mkdirSync(COVERS_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'massmusic.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tracks (
  id             INTEGER PRIMARY KEY,
  source         TEXT NOT NULL,            -- local | youtube | external (imported, resolved on play)
  title          TEXT NOT NULL,
  artist         TEXT NOT NULL DEFAULT '',
  album          TEXT NOT NULL DEFAULT '',
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  file_path      TEXT UNIQUE,
  file_mtime     INTEGER,
  track_no       INTEGER,
  year           INTEGER,
  cover_url      TEXT,
  youtube_id     TEXT,
  spotify_id     TEXT,
  match_track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
  added_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_spotify ON tracks(spotify_id) WHERE spotify_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_yt ON tracks(youtube_id) WHERE source = 'youtube';

CREATE TABLE IF NOT EXISTS playlists (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_url   TEXT,
  source      TEXT,
  source_url  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id          INTEGER PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position    REAL NOT NULL,
  added_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_pt_playlist ON playlist_tracks(playlist_id, position);

CREATE TABLE IF NOT EXISTS likes (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  liked_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS history (
  id        INTEGER PRIMARY KEY,
  track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- YouTube videos whose owners block playback in embedded players (error 101/150)
CREATE TABLE IF NOT EXISTS yt_blocked (
  video_id   TEXT PRIMARY KEY,
  blocked_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

/** node:sqlite rejects undefined/booleans, so clean params first. */
function clean(params) {
  if (params == null || typeof params !== 'object' || Array.isArray(params)) return params;
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return out;
}

export const q = {
  all: (sql, params = {}) => db.prepare(sql).all(clean(params)),
  get: (sql, params = {}) => db.prepare(sql).get(clean(params)),
  run: (sql, params = {}) => db.prepare(sql).run(clean(params)),
};

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting(key, fallback = null) {
  const row = q.get('SELECT value FROM settings WHERE key = :key', { key });
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

export function setSetting(key, value) {
  if (value === null || value === undefined) {
    q.run('DELETE FROM settings WHERE key = :key', { key });
  } else {
    q.run(
      'INSERT INTO settings (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      { key, value: JSON.stringify(value) },
    );
  }
}

/* ---------- tracks ---------- */

export const TRACK_SELECT = `
  SELECT t.*, (l.track_id IS NOT NULL) AS liked, m.cover_url AS match_cover
  FROM tracks t
  LEFT JOIN likes l ON l.track_id = t.id
  LEFT JOIN tracks m ON m.id = t.match_track_id`;

/** Shape a DB row into what the client uses. `play` says how to play it (null = needs resolving). */
export function serializeTrack(t) {
  if (!t) return null;
  let play = null;
  if (t.source === 'local' || t.match_track_id) play = { kind: 'file', url: `/api/stream/${t.id}` };
  else if (t.youtube_id) play = { kind: 'youtube', id: t.youtube_id };

  const cover =
    t.cover_url ||
    t.match_cover ||
    (t.youtube_id ? `https://i.ytimg.com/vi/${t.youtube_id}/mqdefault.jpg` : null);

  return {
    id: t.id,
    source: t.source,
    title: t.title,
    artist: t.artist,
    album: t.album,
    durationMs: t.duration_ms,
    cover,
    play,
    liked: !!t.liked,
    youtubeId: t.youtube_id,
    spotifyId: t.spotify_id,
    matchedLocal: !!t.match_track_id,
    addedAt: t.added_at,
    ...(t.entry_id ? { entryId: t.entry_id, entryAddedAt: t.entry_added_at } : {}),
  };
}

export function getTrack(id) {
  return serializeTrack(q.get(`${TRACK_SELECT} WHERE t.id = :id`, { id: Number(id) }));
}

export function getTracksByIds(ids) {
  if (!ids.length) return [];
  const rows = q.all(`${TRACK_SELECT} WHERE t.id IN (${ids.map(Number).join(',')})`);
  const byId = new Map(rows.map((r) => [r.id, serializeTrack(r)]));
  return ids.map((id) => byId.get(Number(id))).filter(Boolean);
}
