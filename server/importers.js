import { UA } from './util.js';

/* ---------------- Spotify public links (no login) ---------------- */

export function parseSpotifyUrl(input = '') {
  const s = input.trim();
  let m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|track)\/([A-Za-z0-9]{10,})/i);
  if (!m) m = s.match(/^spotify:(playlist|album|track):([A-Za-z0-9]{10,})$/i);
  return m ? { type: m[1].toLowerCase(), id: m[2] } : null;
}

/**
 * Read a public Spotify playlist/album/track through its embed page.
 * Note: Spotify's embed shows at most ~100 tracks; connect your account for bigger playlists.
 */
export async function fetchSpotifyPublic(url) {
  const ref = parseSpotifyUrl(url);
  if (!ref) throw new Error('That does not look like a Spotify playlist, album or track link.');
  const res = await fetch(`https://open.spotify.com/embed/${ref.type}/${ref.id}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`Spotify returned ${res.status}. Is the ${ref.type} public?`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) throw new Error('Could not read that Spotify page (the format may have changed).');
  const entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error('Spotify did not return any data for that link.');

  const images = entity.coverArt?.sources || entity.visualIdentity?.image || [];
  const cover = [...images].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;

  let tracks;
  if (ref.type === 'track') {
    tracks = [{ title: entity.title || entity.name, artist: entity.subtitle || '', album: '', durationMs: entity.duration || 0, spotifyId: ref.id, cover }];
  } else {
    tracks = (entity.trackList || []).map((t) => ({
      title: t.title,
      artist: t.subtitle || '',
      album: ref.type === 'album' ? entity.name : '',
      durationMs: t.duration || 0,
      spotifyId: t.uri?.split(':').pop() || null,
      cover: ref.type === 'album' ? cover : null,
    }));
  }

  return {
    name: entity.name || entity.title || 'Imported playlist',
    description: ref.type === 'album' ? `Album by ${entity.subtitle || ''}`.trim() : entity.subtitle || '',
    cover,
    source: 'spotify',
    sourceUrl: `https://open.spotify.com/${ref.type}/${ref.id}`,
    tracks,
    capped: ref.type === 'playlist' && tracks.length >= 100,
  };
}

/** Album art for one Spotify track (public oEmbed endpoint, no login). */
export async function spotifyTrackCover(spotifyId) {
  const res = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${spotifyId}`, { headers: { 'User-Agent': UA } });
  if (res.status === 404 || res.status === 400) return null; // no such track
  if (res.status === 429) await new Promise((r) => setTimeout(r, 3000));
  if (!res.ok) throw new Error(`Spotify oEmbed ${res.status}`); // rate limit etc: retry later
  const j = await res.json().catch(() => null);
  return j?.thumbnail_url || null;
}

/* ---------------- CSV (Exportify etc.) and plain text ---------------- */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') {
      // only treat ; and tab as separators if no commas on the header line
      if (c !== ',' && rows.length === 0 && text.split('\n')[0].includes(',')) field += c;
      else { row.push(field); field = ''; }
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export function parseCsvTracks(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('The CSV looks empty.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const find = (...names) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const iTitle = find('track name', 'title', 'song', 'name');
  const iArtist = find('artist name', 'artist');
  const iAlbum = find('album name', 'album');
  const iDur = find('duration (ms)', 'duration_ms', 'duration');
  const iUri = find('track uri', 'spotify uri', 'uri');
  if (iTitle < 0) throw new Error('Could not find a track name / title column in the CSV.');

  return rows.slice(1).map((r) => {
    let dur = Number(r[iDur]);
    if (iDur >= 0 && Number.isNaN(dur) && /\d+:\d+/.test(r[iDur])) {
      dur = r[iDur].split(':').map(Number).reduce((a, n) => a * 60 + n, 0) * 1000;
    } else if (dur && dur < 10000) dur *= 1000; // seconds
    const uri = iUri >= 0 ? r[iUri] : '';
    return {
      title: (r[iTitle] || '').trim(),
      artist: iArtist >= 0 ? (r[iArtist] || '').replace(/\s*,\s*/g, ', ').trim() : '',
      album: iAlbum >= 0 ? (r[iAlbum] || '').trim() : '',
      durationMs: dur || 0,
      spotifyId: /^spotify:track:/.test(uri) ? uri.split(':').pop() : null,
    };
  }).filter((t) => t.title);
}

/** One song per line: "Artist - Title", "Title by Artist", or just "Title". */
export function parseTextTracks(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\d+[.)]\s*|[-*•]\s+)/, '').trim())
    .filter(Boolean)
    .map((line) => {
      let m = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      if (m) return { artist: m[1].trim(), title: m[2].trim(), album: '', durationMs: 0 };
      m = line.match(/^(.+?)\s+by\s+(.+)$/i);
      if (m) return { title: m[1].trim(), artist: m[2].trim(), album: '', durationMs: 0 };
      return { title: line, artist: '', album: '', durationMs: 0 };
    });
}
