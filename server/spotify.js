import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';

/**
 * Optional Spotify account connection (Authorization Code + PKCE, no client secret).
 * Lets you import private playlists, big playlists and your Liked Songs.
 */

const SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read';
const pending = new Map(); // state -> { verifier, returnTo, createdAt }

export function redirectUri(port) {
  // Spotify only accepts loopback IPs (not "localhost") for http redirect URIs
  return `http://127.0.0.1:${port}/api/spotify/callback`;
}

export function status(port) {
  const tokens = getSetting('spotifyTokens');
  return {
    clientId: getSetting('spotifyClientId', ''),
    connected: !!tokens?.refresh_token,
    user: getSetting('spotifyUser'),
    redirectUri: redirectUri(port),
  };
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function loginUrl(port, returnTo) {
  const clientId = getSetting('spotifyClientId');
  if (!clientId) throw new Error('Add your Spotify Client ID first.');
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  pending.set(state, { verifier, returnTo, createdAt: Date.now() });
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(port),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SCOPES,
  });
  return `https://accounts.spotify.com/authorize?${p}`;
}

async function tokenRequest(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Spotify token error ${res.status}`);
  return json;
}

export async function handleCallback(port, { code, state, error }) {
  const p = pending.get(state);
  pending.delete(state);
  if (!p) throw new Error('Login session expired, please try again.');
  if (error) throw Object.assign(new Error(`Spotify said: ${error}`), { returnTo: p.returnTo });
  const tok = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(port),
    client_id: getSetting('spotifyClientId'),
    code_verifier: p.verifier,
  });
  saveTokens(tok);
  try {
    const me = await api('/me');
    setSetting('spotifyUser', { id: me.id, name: me.display_name || me.id, image: me.images?.[0]?.url || null });
  } catch { /* profile is optional */ }
  return p.returnTo;
}

function saveTokens(tok) {
  const prev = getSetting('spotifyTokens') || {};
  setSetting('spotifyTokens', {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || prev.refresh_token,
    expires_at: Date.now() + (tok.expires_in - 60) * 1000,
  });
}

export function logout() {
  setSetting('spotifyTokens', null);
  setSetting('spotifyUser', null);
}

async function accessToken() {
  const t = getSetting('spotifyTokens');
  if (!t?.refresh_token) throw new Error('Spotify is not connected.');
  if (t.access_token && Date.now() < t.expires_at) return t.access_token;
  const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: getSetting('spotifyClientId') });
  saveTokens(tok);
  return tok.access_token;
}

async function api(pathOrUrl) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.spotify.com/v1${pathOrUrl}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 2) * 1000));
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error?.message || `Spotify API error ${res.status}`), { status: res.status });
    return json;
  }
  throw new Error('Spotify is rate limiting, try again in a minute.');
}

async function paged(firstUrl, max = 10000) {
  const items = [];
  let url = firstUrl;
  while (url && items.length < max) {
    const page = await api(url);
    items.push(...(page.items || []));
    url = page.next;
  }
  return items;
}

const pickImage = (images = [], min = 200) =>
  [...images].sort((a, b) => (a.width || 0) - (b.width || 0)).find((i) => (i.width || 999) >= min)?.url || images[0]?.url || null;

function mapTrack(t) {
  if (!t || (t.type && t.type !== 'track')) return null;
  return {
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    album: t.album?.name || '',
    durationMs: t.duration_ms || 0,
    spotifyId: t.is_local ? null : t.id,
    cover: pickImage(t.album?.images, 64),
  };
}

export async function listPlaylists() {
  const items = await paged('/me/playlists?limit=50');
  return items.filter(Boolean).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description || '',
    cover: pickImage(p.images),
    owner: p.owner?.display_name || '',
    total: p.tracks?.total ?? p.items?.total ?? null,
  }));
}

export async function playlistDetail(id) {
  if (id === 'liked') {
    const items = await paged('/me/tracks?limit=50');
    return {
      name: 'Liked Songs (Spotify)',
      description: 'Imported from your Spotify Liked Songs',
      cover: null,
      source: 'spotify',
      sourceUrl: 'https://open.spotify.com/collection/tracks',
      tracks: items.map((i) => mapTrack(i.track)).filter(Boolean),
    };
  }
  const meta = await api(`/playlists/${id}?fields=name,description,images,external_urls`);
  let items;
  try {
    items = await paged(`/playlists/${id}/items?limit=100`);
  } catch (e) {
    if (e.status !== 404) throw e;
    items = await paged(`/playlists/${id}/tracks?limit=100`);
  }
  return {
    name: meta.name,
    description: (meta.description || '').replace(/<[^>]+>/g, ''),
    cover: pickImage(meta.images, 300),
    source: 'spotify',
    sourceUrl: meta.external_urls?.spotify || null,
    tracks: items.map((i) => mapTrack(i.track || i.item)).filter(Boolean),
  };
}
