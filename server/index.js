import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { q, tx, getSetting, setSetting, serializeTrack, getTrack, TRACK_SELECT, ROOT_DIR, COVERS_DIR } from './db.js';
import { scanLibrary, scanState, musicFolders, linkImportedToLocal, localMatchFor } from './library.js';
import { ytSearch, findOnYouTube } from './youtube.js';
import { fetchSpotifyPublic, parseCsvTracks, parseTextTracks, spotifyTrackCover } from './importers.js';
import * as spotify from './spotify.js';
import { splitYouTubeTitle, matchKey } from './util.js';

const PORT = Number(process.env.PORT) || 4545;
const HOST = process.env.HOST || '127.0.0.1';
const DIST = path.join(ROOT_DIR, 'dist');

const APP_URL = `http://localhost:${PORT}`;

const app = express();
app.use(express.json({ limit: '20mb' }));

// YouTube refuses to play most music in players embedded on raw-IP pages (error 150),
// so the UI must run on "localhost". Only the Spotify login callback needs 127.0.0.1.
app.use((req, res, next) => {
  if (req.method === 'GET' && /^127\.0\.0\.1(:\d+)?$/.test(req.headers.host || '') && !req.path.startsWith('/api/')) {
    return res.redirect(`${APP_URL}${req.originalUrl}`);
  }
  next();
});
app.use('/covers', express.static(COVERS_DIR, { maxAge: '30d', immutable: true }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status });
const tracks = (sql, params) => q.all(sql, params).map(serializeTrack);

/* ---------------- library & tracks ---------------- */

app.get('/api/tracks', (req, res) => {
  const source = req.query.source || 'local';
  res.json(tracks(`${TRACK_SELECT} WHERE t.source = :source ORDER BY t.artist COLLATE NOCASE, t.album COLLATE NOCASE, t.track_no, t.title COLLATE NOCASE`, { source }));
});

app.get('/api/tracks/:id', (req, res) => {
  const t = getTrack(req.params.id);
  if (!t) throw fail(404, 'Track not found');
  res.json(t);
});

app.get('/api/stream/:id', (req, res) => {
  const row = q.get('SELECT source, file_path, match_track_id FROM tracks WHERE id = :id', { id: Number(req.params.id) });
  let file = row?.source === 'local' ? row.file_path : null;
  if (!file && row?.match_track_id) file = q.get('SELECT file_path FROM tracks WHERE id = :id', { id: row.match_track_id })?.file_path;
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file, { acceptRanges: true, dotfiles: 'allow' });
});

/** Add a YouTube search result to the library (so it can be liked / put in playlists). */
app.post('/api/tracks/youtube', (req, res) => {
  const { videoId, title: rawTitle = '', channel = '', durationMs = 0 } = req.body || {};
  if (!/^[\w-]{11}$/.test(videoId || '')) throw fail(400, 'Bad video id');
  const existing = q.get("SELECT id FROM tracks WHERE source = 'youtube' AND youtube_id = :videoId", { videoId });
  if (existing) return res.json(getTrack(existing.id));
  const { title, artist } = splitYouTubeTitle(rawTitle, channel);
  const r = q.run(
    "INSERT INTO tracks (source, title, artist, duration_ms, youtube_id) VALUES ('youtube', :title, :artist, :durationMs, :videoId)",
    { title, artist, durationMs: Math.round(durationMs), videoId },
  );
  res.json(getTrack(r.lastInsertRowid));
});

const isVideoId = (v) => typeof v === 'string' && /^[\w-]{11}$/.test(v);
const blockedIds = () => q.all('SELECT video_id FROM yt_blocked').map((r) => r.video_id);
function markBlocked(ids) {
  for (const v of ids.filter(isVideoId)) q.run('INSERT OR IGNORE INTO yt_blocked (video_id) VALUES (:v)', { v });
}

/**
 * Work out how to play an imported track: local file first, else best YouTube match.
 * body.blocked = video ids the browser could not play (owner blocks embedding); they are remembered for good.
 */
app.post('/api/tracks/:id/resolve', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const row = q.get('SELECT * FROM tracks WHERE id = :id', { id });
  if (!row) throw fail(404, 'Track not found');
  const reported = Array.isArray(req.body?.exclude) ? req.body.exclude.filter(isVideoId) : [];
  markBlocked(reported);
  if (row.source === 'local') return res.json({ track: getTrack(id), candidates: [] });
  if (row.source === 'youtube') {
    if (reported.includes(row.youtube_id)) throw fail(409, `"${row.title}" can only be played on YouTube itself.`);
    return res.json({ track: getTrack(id), candidates: [] });
  }
  const blocked = blockedIds();
  const currentOk = row.youtube_id && !blocked.includes(row.youtube_id);
  if (!reported.length) {
    const local = localMatchFor(row.title, row.artist);
    if (local) {
      q.run('UPDATE tracks SET match_track_id = :local WHERE id = :id', { local, id });
      return res.json({ track: getTrack(id), candidates: [] });
    }
    if (currentOk) return res.json({ track: getTrack(id), candidates: [] });
  }
  const preferEmbeddable = reported.length > 0 || !!row.youtube_id;
  const candidates = await findOnYouTube(
    { title: row.title, artist: row.artist, album: row.album, durationMs: row.duration_ms },
    blocked,
    { preferEmbeddable },
  );
  if (!candidates.length) throw fail(404, `Couldn't find a playable version of "${row.title}".`);
  q.run('UPDATE tracks SET youtube_id = :yt, match_track_id = NULL WHERE id = :id', { yt: candidates[0].videoId, id });
  res.json({ track: getTrack(id), candidates: candidates.slice(0, 8) });
}));

app.get('/api/tracks/:id/candidates', wrap(async (req, res) => {
  const row = q.get('SELECT * FROM tracks WHERE id = :id', { id: Number(req.params.id) });
  if (!row) throw fail(404, 'Track not found');
  const blocked = new Set(blockedIds());
  const [main, alt] = await Promise.all([
    findOnYouTube({ title: row.title, artist: row.artist, album: row.album, durationMs: row.duration_ms }),
    findOnYouTube({ title: row.title, artist: row.artist, album: row.album, durationMs: row.duration_ms }, [], { preferEmbeddable: true }).catch(() => []),
  ]);
  const seen = new Set();
  const list = [...main.slice(0, 6), ...alt.slice(0, 6)].filter((c) => !seen.has(c.videoId) && seen.add(c.videoId));
  res.json(list.map((c) => ({ ...c, current: c.videoId === row.youtube_id, blocked: blocked.has(c.videoId) })));
}));

/** Manually pick which YouTube video an imported track uses. */
app.put('/api/tracks/:id/youtube', (req, res) => {
  const id = Number(req.params.id);
  const { videoId } = req.body || {};
  if (!/^[\w-]{11}$/.test(videoId || '')) throw fail(400, 'Bad video id');
  const row = q.get('SELECT source FROM tracks WHERE id = :id', { id });
  if (row?.source !== 'external') throw fail(400, 'Only imported songs can be re-matched.');
  q.run('UPDATE tracks SET youtube_id = :videoId, match_track_id = NULL WHERE id = :id', { videoId, id });
  res.json(getTrack(id));
});

app.patch('/api/tracks/:id', (req, res) => {
  const id = Number(req.params.id);
  const { title, artist, album } = req.body || {};
  q.run(
    'UPDATE tracks SET title = COALESCE(:title, title), artist = COALESCE(:artist, artist), album = COALESCE(:album, album) WHERE id = :id',
    { title, artist, album, id },
  );
  res.json(getTrack(id));
});

/* ---------------- search ---------------- */

app.get('/api/search/local', (req, res) => {
  const words = String(req.query.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return res.json({ tracks: [], playlists: [] });
  const params = {};
  const where = words.map((w, i) => {
    params[`w${i}`] = `%${w}%`;
    return `(t.title LIKE :w${i} OR t.artist LIKE :w${i} OR t.album LIKE :w${i})`;
  }).join(' AND ');
  const found = tracks(`${TRACK_SELECT} WHERE ${where} ORDER BY (t.source = 'local') DESC, t.title COLLATE NOCASE LIMIT 60`, params);
  const playlists = q.all('SELECT id, name FROM playlists WHERE name LIKE :q LIMIT 12', { q: `%${words.join(' ')}%` });
  res.json({ tracks: found, playlists: playlists.map(withPlaylistMeta) });
});

app.get('/api/search/youtube', wrap(async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.json([]);
  const results = await ytSearch(query, 20);
  const known = new Map(
    q.all(`SELECT t.id, t.youtube_id, (l.track_id IS NOT NULL) AS liked FROM tracks t LEFT JOIN likes l ON l.track_id = t.id WHERE t.source = 'youtube'`)
      .map((r) => [r.youtube_id, r]),
  );
  const blocked = new Set(blockedIds());
  res.json(results.map((r) => {
    const { title, artist } = splitYouTubeTitle(r.title, r.channel);
    const k = known.get(r.videoId);
    return { ...r, songTitle: title, songArtist: artist, trackId: k?.id ?? null, liked: !!k?.liked, blocked: blocked.has(r.videoId) };
  }));
}));

/* ---------------- likes & history ---------------- */

app.get('/api/likes', (req, res) => {
  res.json(tracks(`${TRACK_SELECT} WHERE l.track_id IS NOT NULL ORDER BY l.liked_at DESC`));
});
app.put('/api/likes/:id', (req, res) => {
  q.run('INSERT OR IGNORE INTO likes (track_id) VALUES (:id)', { id: Number(req.params.id) });
  res.json(getTrack(req.params.id));
});
app.delete('/api/likes/:id', (req, res) => {
  q.run('DELETE FROM likes WHERE track_id = :id', { id: Number(req.params.id) });
  res.json(getTrack(req.params.id));
});

app.post('/api/history/:id', (req, res) => {
  q.run('INSERT INTO history (track_id) VALUES (:id)', { id: Number(req.params.id) });
  q.run('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 2000)');
  res.json({ ok: true });
});
app.delete('/api/history', (req, res) => {
  q.run('DELETE FROM history');
  res.json({ ok: true });
});

app.get('/api/home', (req, res) => {
  const recent = q.all('SELECT track_id, MAX(played_at) AS last FROM history GROUP BY track_id ORDER BY last DESC LIMIT 16');
  const recentTracks = recent.length
    ? tracks(`${TRACK_SELECT} WHERE t.id IN (${recent.map((r) => r.track_id).join(',')})`)
    : [];
  const order = new Map(recent.map((r, i) => [r.track_id, i]));
  recentTracks.sort((a, b) => order.get(a.id) - order.get(b.id));
  const top = q.all(`SELECT track_id, COUNT(*) AS n FROM history WHERE played_at > :since GROUP BY track_id ORDER BY n DESC LIMIT 16`, { since: Date.now() - 30 * 864e5 });
  const topTracks = top.length ? tracks(`${TRACK_SELECT} WHERE t.id IN (${top.map((r) => r.track_id).join(',')})`) : [];
  const topOrder = new Map(top.map((r, i) => [r.track_id, i]));
  topTracks.sort((a, b) => topOrder.get(a.id) - topOrder.get(b.id));
  res.json({
    recent: recentTracks,
    top: topTracks,
    recentlyAdded: tracks(`${TRACK_SELECT} WHERE t.source != 'external' ORDER BY t.added_at DESC, t.id DESC LIMIT 16`),
    playlists: listPlaylists().slice(0, 12),
    counts: q.get(`SELECT
      (SELECT COUNT(*) FROM tracks WHERE source = 'local') AS local,
      (SELECT COUNT(*) FROM likes) AS liked,
      (SELECT COUNT(*) FROM playlists) AS playlists`),
  });
});

/* ---------------- playlists ---------------- */

function withPlaylistMeta(p) {
  const stats = q.get('SELECT COUNT(*) AS count, COALESCE(SUM(t.duration_ms), 0) AS duration FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = :id', { id: p.id });
  const covers = p.cover_url ? [] : q.all(
    `SELECT DISTINCT COALESCE(NULLIF(t.cover_url, ''), m.cover_url, CASE WHEN t.youtube_id IS NOT NULL THEN 'https://i.ytimg.com/vi/' || t.youtube_id || '/mqdefault.jpg' END) AS c
     FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id LEFT JOIN tracks m ON m.id = t.match_track_id
     WHERE pt.playlist_id = :id AND c IS NOT NULL ORDER BY pt.position LIMIT 4`, { id: p.id },
  ).map((r) => r.c);
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    cover: p.cover_url ?? null,
    covers,
    source: p.source ?? null,
    sourceUrl: p.source_url ?? null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    count: stats.count,
    durationMs: stats.duration,
  };
}

function listPlaylists() {
  return q.all('SELECT * FROM playlists ORDER BY updated_at DESC').map(withPlaylistMeta);
}

app.get('/api/playlists', (req, res) => res.json(listPlaylists()));

app.post('/api/playlists', (req, res) => {
  const { name, description = '' } = req.body || {};
  const count = q.get('SELECT COUNT(*) AS n FROM playlists').n;
  const r = q.run('INSERT INTO playlists (name, description) VALUES (:name, :description)', {
    name: (name || '').trim() || `My Playlist #${count + 1}`,
    description,
  });
  res.json(withPlaylistMeta(q.get('SELECT * FROM playlists WHERE id = :id', { id: r.lastInsertRowid })));
});

app.get('/api/playlists/:id', (req, res) => {
  const p = q.get('SELECT * FROM playlists WHERE id = :id', { id: Number(req.params.id) });
  if (!p) throw fail(404, 'Playlist not found');
  const list = tracks(
    `SELECT t.*, (l.track_id IS NOT NULL) AS liked, m.cover_url AS match_cover, pt.id AS entry_id, pt.added_at AS entry_added_at
     FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
     LEFT JOIN likes l ON l.track_id = t.id LEFT JOIN tracks m ON m.id = t.match_track_id
     WHERE pt.playlist_id = :id ORDER BY pt.position, pt.id`,
    { id: p.id },
  );
  res.json({ ...withPlaylistMeta(p), tracks: list });
});

app.patch('/api/playlists/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, description, cover } = req.body || {};
  q.run(
    `UPDATE playlists SET name = COALESCE(:name, name), description = COALESCE(:description, description),
     cover_url = CASE WHEN :setCover THEN :cover ELSE cover_url END, updated_at = :now WHERE id = :id`,
    { name: name?.trim() || null, description, setCover: cover !== undefined, cover: cover || null, now: Date.now(), id },
  );
  res.json(withPlaylistMeta(q.get('SELECT * FROM playlists WHERE id = :id', { id })));
});

app.delete('/api/playlists/:id', (req, res) => {
  const id = Number(req.params.id);
  tx(() => {
    q.run('DELETE FROM playlists WHERE id = :id', { id });
    // imported songs that no longer belong anywhere and aren't liked can go
    q.run(`DELETE FROM tracks WHERE source = 'external'
           AND id NOT IN (SELECT track_id FROM playlist_tracks) AND id NOT IN (SELECT track_id FROM likes)`);
  });
  res.json({ ok: true });
});

app.post('/api/playlists/:id/tracks', (req, res) => {
  const id = Number(req.params.id);
  const ids = (req.body?.trackIds || []).map(Number).filter(Boolean);
  let pos = q.get('SELECT COALESCE(MAX(position), 0) AS p FROM playlist_tracks WHERE playlist_id = :id', { id }).p;
  tx(() => {
    for (const trackId of ids) q.run('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (:id, :trackId, :pos)', { id, trackId, pos: ++pos });
    q.run('UPDATE playlists SET updated_at = :now WHERE id = :id', { now: Date.now(), id });
  });
  res.json({ ok: true, added: ids.length });
});

app.delete('/api/playlists/:id/entries/:entryId', (req, res) => {
  q.run('DELETE FROM playlist_tracks WHERE id = :e AND playlist_id = :id', { e: Number(req.params.entryId), id: Number(req.params.id) });
  res.json({ ok: true });
});

/** Move an entry to a new index. */
app.put('/api/playlists/:id/move', (req, res) => {
  const id = Number(req.params.id);
  const { entryId, toIndex } = req.body || {};
  const entries = q.all('SELECT id FROM playlist_tracks WHERE playlist_id = :id ORDER BY position, id', { id }).map((r) => r.id);
  const from = entries.indexOf(Number(entryId));
  if (from < 0) throw fail(404, 'Entry not found');
  entries.splice(from, 1);
  entries.splice(Math.max(0, Math.min(entries.length, Number(toIndex))), 0, Number(entryId));
  tx(() => entries.forEach((e, i) => q.run('UPDATE playlist_tracks SET position = :i WHERE id = :e', { i: i + 1, e })));
  res.json({ ok: true });
});

/* ---------------- importing ---------------- */

app.post('/api/import/preview', wrap(async (req, res) => {
  const { kind, url, content, playlistId, name } = req.body || {};
  let result;
  if (kind === 'spotify-url') result = await fetchSpotifyPublic(url || '');
  else if (kind === 'spotify-account') result = await spotify.playlistDetail(playlistId);
  else if (kind === 'csv') result = { name: name || 'Imported playlist', description: 'Imported from CSV', tracks: parseCsvTracks(content || '') };
  else if (kind === 'text') result = { name: name || 'Imported playlist', description: '', tracks: parseTextTracks(content || '') };
  else throw fail(400, 'Unknown import kind');
  if (!result.tracks.length) throw fail(400, 'No songs found to import.');

  // tell the UI which songs you already have as files
  const localKeys = new Set(q.all("SELECT title, artist FROM tracks WHERE source = 'local'").map((r) => matchKey(r.title, r.artist)));
  result.tracks = result.tracks.map((t) => ({ ...t, local: localKeys.has(matchKey(t.title, t.artist)) }));
  res.json(result);
}));

app.post('/api/import', (req, res) => {
  const { name, description = '', cover = null, source = null, sourceUrl = null, tracks: incoming = [] } = req.body || {};
  if (!incoming.length) throw fail(400, 'Nothing to import');

  const playlistId = tx(() => {
    const p = q.run(
      'INSERT INTO playlists (name, description, cover_url, source, source_url) VALUES (:name, :description, :cover, :source, :sourceUrl)',
      { name: (name || 'Imported playlist').trim(), description, cover, source, sourceUrl },
    );
    const pid = Number(p.lastInsertRowid);
    let pos = 0;
    for (const t of incoming) {
      if (!t?.title) continue;
      let trackId = t.spotifyId ? q.get('SELECT id FROM tracks WHERE spotify_id = :s', { s: t.spotifyId })?.id : null;
      if (!trackId) {
        const r = q.run(
          `INSERT INTO tracks (source, title, artist, album, duration_ms, spotify_id, cover_url)
           VALUES ('external', :title, :artist, :album, :durationMs, :spotifyId, :cover)`,
          { title: String(t.title), artist: String(t.artist || ''), album: String(t.album || ''), durationMs: Math.round(Number(t.durationMs) || 0), spotifyId: t.spotifyId || null, cover: t.cover || null },
        );
        trackId = Number(r.lastInsertRowid);
      }
      q.run('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (:pid, :trackId, :pos)', { pid, trackId, pos: ++pos });
    }
    return pid;
  });
  linkImportedToLocal();
  fillSpotifyCovers();
  res.json(withPlaylistMeta(q.get('SELECT * FROM playlists WHERE id = :id', { id: playlistId })));
});

/** Background job: fetch album art for imported Spotify songs that have none. */
let coversRunning = false;
async function fillSpotifyCovers() {
  if (coversRunning) return;
  coversRunning = true;
  try {
    const failed = new Set();
    // keep going until nothing is left, so playlists imported while this runs are picked up too
    for (;;) {
      const todo = q
        .all("SELECT id, spotify_id FROM tracks WHERE source = 'external' AND spotify_id IS NOT NULL AND cover_url IS NULL LIMIT 200")
        .filter((t) => !failed.has(t.id));
      if (!todo.length) break;
      const worker = async () => {
        while (todo.length) {
          const t = todo.shift();
          try {
            const cover = await spotifyTrackCover(t.spotify_id);
            // empty string = looked up, nothing found (so we don't retry forever)
            q.run('UPDATE tracks SET cover_url = :cover WHERE id = :id', { cover: cover || '', id: t.id });
          } catch {
            // rate limited or offline: back off, retry a few times, then leave it for the next start
            t.tries = (t.tries || 0) + 1;
            if (t.tries < 3) todo.push(t);
            else failed.add(t.id);
            await new Promise((r) => setTimeout(r, 2000 * t.tries));
          }
        }
      };
      await Promise.all(Array.from({ length: 2 }, worker));
    }
  } finally {
    coversRunning = false;
  }
}

/* ---------------- Spotify account ---------------- */

const isLocalOrigin = (o) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o || '');

app.get('/api/spotify/status', (req, res) => res.json(spotify.status(PORT)));
app.put('/api/spotify/client', (req, res) => {
  const clientId = String(req.body?.clientId || '').trim();
  if (clientId && !/^[0-9a-f]{32}$/i.test(clientId)) throw fail(400, 'A Spotify Client ID is 32 letters/numbers.');
  setSetting('spotifyClientId', clientId || null);
  if (!clientId) spotify.logout();
  res.json(spotify.status(PORT));
});
app.get('/api/spotify/login', (req, res) => {
  const ret = isLocalOrigin(req.query.return) ? req.query.return : APP_URL;
  res.redirect(spotify.loginUrl(PORT, ret));
});
app.get('/api/spotify/callback', wrap(async (req, res) => {
  try {
    const ret = await spotify.handleCallback(PORT, req.query);
    res.redirect(`${ret}/import?tab=account&spotify=connected`);
  } catch (e) {
    const ret = e.returnTo || APP_URL;
    res.redirect(`${ret}/import?tab=account&spotify_error=${encodeURIComponent(e.message)}`);
  }
}));
app.post('/api/spotify/logout', (req, res) => {
  spotify.logout();
  res.json(spotify.status(PORT));
});
app.get('/api/spotify/playlists', wrap(async (req, res) => res.json(await spotify.listPlaylists())));

/* ---------------- settings & scanning ---------------- */

app.get('/api/settings', (req, res) => {
  res.json({
    musicFolders: musicFolders(),
    scan: scanState,
    lastScan: getSetting('lastScan'),
    stats: q.get(`SELECT
      (SELECT COUNT(*) FROM tracks WHERE source = 'local') AS local,
      (SELECT COUNT(*) FROM tracks WHERE source = 'youtube') AS youtube,
      (SELECT COUNT(*) FROM tracks WHERE source = 'external') AS imported,
      (SELECT COUNT(*) FROM tracks WHERE source = 'external' AND match_track_id IS NOT NULL) AS importedLocal,
      (SELECT COUNT(*) FROM playlists) AS playlists,
      (SELECT COUNT(*) FROM history) AS plays`),
  });
});

app.put('/api/settings', (req, res) => {
  const { musicFolders: folders } = req.body || {};
  if (Array.isArray(folders)) {
    const cleaned = [...new Set(folders.map((f) => String(f).trim()).filter(Boolean))];
    const missing = cleaned.filter((f) => !fs.existsSync(f) || !fs.statSync(f).isDirectory());
    if (missing.length) throw fail(400, `Folder not found: ${missing.join(', ')}`);
    setSetting('musicFolders', cleaned);
  }
  res.json({ musicFolders: musicFolders() });
});

async function runScan() {
  await scanLibrary();
  setSetting('lastScan', Date.now());
}
app.post('/api/library/scan', (req, res) => {
  if (!scanState.running) runScan().catch((e) => console.error('scan failed', e));
  res.json(scanState);
});
app.get('/api/library/scan', (req, res) => res.json(scanState));

/* ---------------- web app ---------------- */

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { index: false }));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, _next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
});

/** Start listening. Used by `node server/index.js` and by the desktop app (electron/main.js). */
export function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, HOST, () => {
      console.log(`MassMusic running at ${APP_URL}${fs.existsSync(DIST) ? '' : ' (API only — run "npm run dev" for the UI)'}`);
      fillSpotifyCovers().catch(() => {});
      if (!getSetting('lastScan') && musicFolders().length) {
        console.log('First run: scanning', musicFolders().join(', '));
        runScan().catch((e) => console.error('scan failed', e));
      }
      resolve({ server, url: APP_URL });
    });
    server.on('error', reject);
  });
}

const runDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) {
  startServer().then(({ url }) => {
    if (process.argv.includes('--open')) exec(process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`);
  }).catch((e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Is MassMusic already running?` : e);
    process.exit(1);
  });
}
