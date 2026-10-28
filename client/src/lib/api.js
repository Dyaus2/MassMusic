async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const get = (u) => request('GET', u);
const post = (u, b = {}) => request('POST', u, b);
const put = (u, b = {}) => request('PUT', u, b);
const patch = (u, b = {}) => request('PATCH', u, b);
const del = (u) => request('DELETE', u);
const qs = (o) => new URLSearchParams(o).toString();

export const api = {
  home: () => get('/api/home'),
  tracks: (source = 'local') => get(`/api/tracks?${qs({ source })}`),
  track: (id) => get(`/api/tracks/${id}`),
  updateTrack: (id, data) => patch(`/api/tracks/${id}`, data),
  resolve: (id, exclude = []) => post(`/api/tracks/${id}/resolve`, { exclude }),
  candidates: (id) => get(`/api/tracks/${id}/candidates`),
  setYouTube: (id, videoId) => put(`/api/tracks/${id}/youtube`, { videoId }),
  addYouTube: (r) => post('/api/tracks/youtube', { videoId: r.videoId, title: r.title, channel: r.channel, durationMs: r.durationMs }),

  searchLocal: (q) => get(`/api/search/local?${qs({ q })}`),
  searchYouTube: (q) => get(`/api/search/youtube?${qs({ q })}`),

  likes: () => get('/api/likes'),
  like: (id) => put(`/api/likes/${id}`),
  unlike: (id) => del(`/api/likes/${id}`),
  played: (id) => post(`/api/history/${id}`),
  clearHistory: () => del('/api/history'),

  playlists: () => get('/api/playlists'),
  playlist: (id) => get(`/api/playlists/${id}`),
  createPlaylist: (data = {}) => post('/api/playlists', data),
  updatePlaylist: (id, data) => patch(`/api/playlists/${id}`, data),
  deletePlaylist: (id) => del(`/api/playlists/${id}`),
  addToPlaylist: (id, trackIds) => post(`/api/playlists/${id}/tracks`, { trackIds }),
  removeEntry: (id, entryId) => del(`/api/playlists/${id}/entries/${entryId}`),
  moveEntry: (id, entryId, toIndex) => put(`/api/playlists/${id}/move`, { entryId, toIndex }),

  importPreview: (data) => post('/api/import/preview', data),
  importCommit: (data) => post('/api/import', data),

  spotifyStatus: () => get('/api/spotify/status'),
  spotifySetClient: (clientId) => put('/api/spotify/client', { clientId }),
  spotifyLogout: () => post('/api/spotify/logout'),
  spotifyPlaylists: () => get('/api/spotify/playlists'),

  settings: () => get('/api/settings'),
  saveSettings: (data) => put('/api/settings', data),
  scan: () => post('/api/library/scan'),
  scanStatus: () => get('/api/library/scan'),
};
