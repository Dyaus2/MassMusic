import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { parseFile } from 'music-metadata';
import { q, tx, getSetting, COVERS_DIR } from './db.js';
import { matchKey } from './util.js';

export const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.wma', '.webm', '.alac', '.aiff', '.aif']);
const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall'];

export function defaultFolders() {
  const music = path.join(os.homedir(), 'Music');
  return fs.existsSync(music) ? [music] : [];
}

export function musicFolders() {
  return getSetting('musicFolders', null) ?? defaultFolders();
}

export const scanState = { running: false, found: 0, processed: 0, added: 0, removed: 0, errors: 0, startedAt: null, finishedAt: null, current: '' };

async function walk(dir, out) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
}

const dirCoverCache = new Map();
function folderCover(dir) {
  if (dirCoverCache.has(dir)) return dirCoverCache.get(dir);
  let found = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      const ext = path.extname(f).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
      if (!COVER_NAMES.includes(path.basename(f, ext).toLowerCase())) continue;
      const id = crypto.createHash('sha1').update(dir).digest('hex').slice(0, 16) + ext;
      const dest = path.join(COVERS_DIR, id);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(dir, f), dest);
      found = `/covers/${id}`;
      break;
    }
  } catch { /* ignore */ }
  dirCoverCache.set(dir, found);
  return found;
}

function saveEmbeddedCover(picture, key) {
  const ext = picture.format?.includes('png') ? '.png' : '.jpg';
  const id = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16) + ext;
  const dest = path.join(COVERS_DIR, id);
  if (!fs.existsSync(dest)) fs.writeFileSync(dest, picture.data);
  return `/covers/${id}`;
}

async function readTrack(file) {
  const meta = await parseFile(file, { duration: true, skipCovers: false });
  const c = meta.common;
  const base = path.basename(file, path.extname(file));
  let title = c.title;
  let artist = c.artist || c.albumartist || '';
  if (!title) {
    // "Artist - Title" or "01 Title" file names
    const m = base.match(/^(?:\d+[\s.\-_]+)?(.+?)\s+-\s+(.+)$/);
    if (m && !artist) { artist = m[1]; title = m[2]; }
    else title = base.replace(/^\d+[\s.\-_]+/, '');
  }
  const album = c.album || '';
  let cover = null;
  if (c.picture?.length) cover = saveEmbeddedCover(c.picture[0], `${album || file}|${c.albumartist || artist}`);
  if (!cover) cover = folderCover(path.dirname(file));
  return {
    title,
    artist,
    album,
    duration_ms: Math.round((meta.format.duration || 0) * 1000),
    track_no: c.track?.no ?? null,
    year: c.year ?? null,
    cover_url: cover,
  };
}

export async function scanLibrary() {
  if (scanState.running) return scanState;
  Object.assign(scanState, { running: true, found: 0, processed: 0, added: 0, removed: 0, errors: 0, startedAt: Date.now(), finishedAt: null, current: '' });
  dirCoverCache.clear();
  try {
    const files = [];
    for (const folder of musicFolders()) await walk(folder, files);
    scanState.found = files.length;

    const existing = new Map(q.all("SELECT id, file_path, file_mtime FROM tracks WHERE source = 'local'").map((r) => [r.file_path, r]));
    const seen = new Set();

    const queue = [...files];
    const worker = async () => {
      while (queue.length) {
        const file = queue.shift();
        seen.add(file);
        scanState.current = file;
        try {
          const stat = await fs.promises.stat(file);
          const mtime = Math.round(stat.mtimeMs);
          const prev = existing.get(file);
          if (prev && prev.file_mtime === mtime) continue;
          const t = await readTrack(file);
          if (prev) {
            q.run(
              `UPDATE tracks SET title=:title, artist=:artist, album=:album, duration_ms=:duration_ms, track_no=:track_no, year=:year, cover_url=:cover_url, file_mtime=:mtime WHERE id=:id`,
              { ...t, mtime, id: prev.id },
            );
          } else {
            q.run(
              `INSERT INTO tracks (source, title, artist, album, duration_ms, track_no, year, cover_url, file_path, file_mtime)
               VALUES ('local', :title, :artist, :album, :duration_ms, :track_no, :year, :cover_url, :file, :mtime)`,
              { ...t, file, mtime },
            );
            scanState.added++;
          }
        } catch {
          scanState.errors++;
        } finally {
          scanState.processed++;
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));

    // Drop local tracks whose files are gone
    const gone = [...existing.keys()].filter((f) => !seen.has(f));
    tx(() => {
      for (const f of gone) q.run('DELETE FROM tracks WHERE file_path = :f', { f });
    });
    scanState.removed = gone.length;

    linkImportedToLocal();
  } finally {
    scanState.running = false;
    scanState.finishedAt = Date.now();
    scanState.current = '';
  }
  return scanState;
}

/** Point imported (external) tracks at matching local files so they play from disk. */
export function linkImportedToLocal() {
  const local = new Map();
  for (const r of q.all("SELECT id, title, artist FROM tracks WHERE source = 'local'")) {
    const k = matchKey(r.title, r.artist);
    if (!local.has(k)) local.set(k, r.id);
  }
  let linked = 0;
  tx(() => {
    for (const r of q.all("SELECT id, title, artist, match_track_id FROM tracks WHERE source = 'external'")) {
      const m = local.get(matchKey(r.title, r.artist)) ?? null;
      if (m !== r.match_track_id) {
        q.run('UPDATE tracks SET match_track_id = :m WHERE id = :id', { m, id: r.id });
        if (m) linked++;
      }
    }
  });
  return linked;
}

export function localMatchFor(title, artist) {
  const key = matchKey(title, artist);
  // cheap pre-filter on title words, then exact key compare
  const firstWord = key.split('|')[0].split(' ')[0] || '';
  const rows = q.all("SELECT id, title, artist FROM tracks WHERE source = 'local' AND title LIKE :w", { w: `%${firstWord}%` });
  return rows.find((r) => matchKey(r.title, r.artist) === key)?.id ?? null;
}
