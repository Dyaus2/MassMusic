import { create } from 'zustand';
import { api } from './api';
import { toast, emitTrack, onTrack } from './ui';
import { shuffled, storage } from './format';

/*
 * One queue, two playback backends:
 *  - "file":    an <audio> element streaming local files from the server
 *  - "youtube": the official YouTube IFrame player (shown in the Now Playing panel)
 * Imported songs have no source yet; they are resolved (local match or YouTube) right before playing.
 */

const audio = new Audio();
audio.preload = 'auto';

let mode = null; // 'file' | 'youtube' | null
let yt = null;
let ytApi = null;
let loadSeq = 0;
let failStreak = 0;
const tried = new Map(); // trackId -> [videoIds that failed]

export const usePlayer = create((set, get) => ({
  queue: storage.get('queue', []),
  original: null, // queue order before shuffle
  index: storage.get('index', -1),
  context: storage.get('context', null), // { name, path }
  playing: false,
  loading: false,
  position: 0,
  duration: 0,
  volume: storage.get('volume', 0.8),
  muted: false,
  shuffle: storage.get('shuffle', false),
  repeat: storage.get('repeat', 'off'), // off | all | one
  ytActive: false,
  panel: storage.get('panel', 'now'), // 'now' | 'queue' | null

  current: () => get().queue[get().index] || null,

  playTracks(tracks, start = 0, context = null) {
    if (!tracks.length) return;
    let queue = [...tracks];
    let index = Math.max(0, Math.min(start, queue.length - 1));
    let original = null;
    if (get().shuffle) {
      original = queue;
      const first = queue[index];
      queue = [first, ...shuffled(queue.filter((_, i) => i !== index))];
      index = 0;
    }
    set({ queue, index, original, context });
    persist();
    loadTrack(queue[index], true);
  },

  playAt(index) {
    const t = get().queue[index];
    if (!t) return;
    set({ index });
    persist();
    loadTrack(t, true);
  },

  next(auto = false) {
    const { queue, index, repeat } = get();
    if (!queue.length) return;
    if (auto && repeat === 'one') {
      seekTo(0);
      resume();
      return;
    }
    let i = index + 1;
    if (i >= queue.length) {
      if (repeat === 'all' || !auto) i = 0;
      else {
        pause();
        set({ position: 0 });
        seekTo(0);
        return;
      }
    }
    get().playAt(i);
  },

  prev() {
    const { index, position } = get();
    if (position > 3 || index <= 0) {
      seekTo(0);
      return;
    }
    get().playAt(index - 1);
  },

  toggle() {
    const t = get().current();
    if (!t) return;
    if (!mode) return loadTrack(t, true);
    if (get().playing) pause();
    else resume();
  },

  seek: (sec) => seekTo(sec),

  setVolume(v) {
    const volume = Math.max(0, Math.min(1, v));
    set({ volume, muted: false });
    storage.set('volume', volume);
    applyVolume();
  },
  toggleMute() {
    set({ muted: !get().muted });
    applyVolume();
  },

  toggleShuffle() {
    const { shuffle, queue, index, original } = get();
    const cur = queue[index];
    if (!shuffle) {
      const rest = queue.filter((_, i) => i !== index);
      set({ shuffle: true, original: queue, queue: cur ? [cur, ...shuffled(rest)] : shuffled(rest), index: cur ? 0 : -1 });
    } else {
      const back = original || queue;
      set({ shuffle: false, original: null, queue: back, index: cur ? Math.max(0, back.findIndex((t) => t.id === cur.id)) : -1 });
    }
    storage.set('shuffle', get().shuffle);
    persist();
  },

  cycleRepeat() {
    const order = ['off', 'all', 'one'];
    const repeat = order[(order.indexOf(get().repeat) + 1) % 3];
    set({ repeat });
    storage.set('repeat', repeat);
  },

  playNext(tracks) {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    const { queue, index } = get();
    if (index < 0) return get().playTracks(list, 0);
    const q = [...queue];
    q.splice(index + 1, 0, ...list);
    set({ queue: q });
    persist();
    toast(list.length > 1 ? `${list.length} songs will play next` : 'Playing next');
  },

  addToQueue(tracks) {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    if (get().index < 0) return get().playTracks(list, 0);
    set({ queue: [...get().queue, ...list] });
    persist();
    toast(list.length > 1 ? `Added ${list.length} songs to queue` : 'Added to queue');
  },

  removeFromQueue(i) {
    const { queue, index } = get();
    if (i === index) return;
    const q = queue.filter((_, k) => k !== i);
    set({ queue: q, index: i < index ? index - 1 : index });
    persist();
  },

  clearUpcoming() {
    const { queue, index } = get();
    set({ queue: queue.slice(0, index + 1) });
    persist();
  },

  setPanel(panel) {
    const next = get().panel === panel ? null : panel;
    set({ panel: next });
    storage.set('panel', next);
  },

  /** Replace a track's data everywhere in the queue (likes, resolved sources...). */
  patchTrack(track) {
    if (!track) return;
    const fix = (list) => list && list.map((t) => (t.id === track.id || (t.virtualOf && t.virtualOf === track.youtubeId && track.source === 'youtube') ? { ...t, ...track, virtual: false, virtualOf: undefined } : t));
    set({ queue: fix(get().queue), original: fix(get().original) });
    persist();
  },
}));

const S = () => usePlayer.getState();
const setP = (p) => usePlayer.setState(p);

function persist() {
  const { queue, index, context } = S();
  // keep it small; only enough to restore the queue after a reload
  storage.set('queue', queue.slice(0, 500));
  storage.set('index', Math.min(index, 499));
  storage.set('context', context);
}

onTrack((t) => usePlayer.getState().patchTrack(t));

/* ---------------- volume / transport ---------------- */

function effectiveVolume() {
  const { volume, muted } = S();
  return muted ? 0 : volume;
}

function applyVolume() {
  const v = effectiveVolume();
  audio.volume = v * v; // perceptual curve
  if (yt?.setVolume) yt.setVolume(Math.round(v * 100));
}

function pause() {
  if (mode === 'file') audio.pause();
  else if (mode === 'youtube') yt?.pauseVideo?.();
  setP({ playing: false });
}

function resume() {
  if (mode === 'file') audio.play().catch(() => setP({ playing: false }));
  else if (mode === 'youtube') yt?.playVideo?.();
}

function seekTo(sec) {
  if (mode === 'file') audio.currentTime = sec;
  else if (mode === 'youtube') yt?.seekTo?.(sec, true);
  setP({ position: sec });
}

/* ---------------- YouTube IFrame player ---------------- */

function loadYouTubeApi() {
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      ytApi = null;
      toast('Could not load the YouTube player. Are you online?', 'error');
    };
    document.head.appendChild(s);
  });
  return ytApi;
}

async function getYouTube() {
  const YT = await loadYouTubeApi();
  if (yt) return yt;
  await new Promise((ready) => {
    yt = new YT.Player('yt-player', {
      width: '100%',
      height: '100%',
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => ready(),
        onStateChange: onYouTubeState,
        onError: onYouTubeError,
      },
    });
  });
  applyVolume();
  return yt;
}

function onYouTubeState(e) {
  if (mode !== 'youtube') return;
  // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
  if (e.data === 0) S().next(true);
  else if (e.data === 1) {
    failStreak = 0;
    setP({ playing: true, loading: false, duration: yt.getDuration() || S().duration });
  } else if (e.data === 2) setP({ playing: false, loading: false });
  else if (e.data === 3) setP({ loading: true });
}

function onYouTubeError() {
  if (mode !== 'youtube') return;
  handleUnplayable();
}

setInterval(() => {
  if (mode === 'youtube' && yt?.getCurrentTime && S().playing) {
    setP({ position: yt.getCurrentTime() || 0, duration: yt.getDuration() || S().duration });
  }
}, 250);

/* ---------------- audio element ---------------- */

audio.addEventListener('timeupdate', () => mode === 'file' && setP({ position: audio.currentTime }));
audio.addEventListener('durationchange', () => mode === 'file' && Number.isFinite(audio.duration) && setP({ duration: audio.duration }));
audio.addEventListener('playing', () => {
  if (mode !== 'file') return;
  failStreak = 0;
  setP({ playing: true, loading: false });
});
audio.addEventListener('pause', () => mode === 'file' && setP({ playing: false }));
audio.addEventListener('waiting', () => mode === 'file' && setP({ loading: true }));
audio.addEventListener('ended', () => mode === 'file' && S().next(true));
audio.addEventListener('error', () => {
  if (mode !== 'file' || !audio.getAttribute('src')) return;
  toast('This file could not be played', 'error');
  skipAfterFailure();
});

/* ---------------- loading tracks ---------------- */

function skipAfterFailure() {
  failStreak++;
  setP({ loading: false, playing: false });
  if (failStreak >= 5) {
    toast('Several songs in a row failed. Stopping playback.', 'error');
    failStreak = 0;
    return;
  }
  const { index, queue } = S();
  if (index < queue.length - 1 || S().repeat === 'all') S().next(false);
}

/** The YouTube video refused to play (usually: owner blocks other websites). Try another version. */
async function handleUnplayable() {
  const t = S().current();
  if (!t) return;
  const seq = loadSeq;
  const list = tried.get(t.id) || [];
  if (t.youtubeId && !list.includes(t.youtubeId)) list.push(t.youtubeId);
  tried.set(t.id, list);
  if (t.source === 'external' && list.length <= 6) {
    setP({ loading: true });
    try {
      const { track } = await api.resolve(t.id, list);
      if (seq !== loadSeq) return;
      emitTrack(track);
      return loadTrack(track, true, { retry: true });
    } catch { /* nothing else found: skip */ }
  } else if (typeof t.id === 'number') {
    api.resolve(t.id, list).catch(() => {}); // lets the server remember this video is blocked
  }
  if (seq !== loadSeq) return;
  toast(`"${t.title}" can only be played on YouTube itself, skipping`, 'error');
  skipAfterFailure();
}

async function loadTrack(track, autoplay, { retry = false } = {}) {
  const seq = ++loadSeq;
  setP({ loading: true, position: 0, duration: (track.durationMs || 0) / 1000 });
  let t = track;

  try {
    if (t.virtual) {
      t = await api.addYouTube(t.ytResult);
      emitTrack(t);
      S().patchTrack({ ...t, youtubeId: t.youtubeId });
    }
    if (!t.play) {
      const r = await api.resolve(t.id);
      t = r.track;
      emitTrack(t);
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    toast(e.message, 'error');
    return skipAfterFailure();
  }
  if (seq !== loadSeq) return;

  if (t.play.kind === 'file') {
    if (mode === 'youtube') yt?.stopVideo?.();
    mode = 'file';
    setP({ ytActive: false });
    audio.src = t.play.url;
    applyVolume();
    if (autoplay) audio.play().catch(() => setP({ playing: false, loading: false }));
    else setP({ loading: false });
  } else {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    mode = 'youtube';
    setP({ ytActive: true });
    const p = await getYouTube();
    if (seq !== loadSeq) return;
    if (autoplay) p.loadVideoById(t.play.id);
    else {
      p.cueVideoById(t.play.id);
      setP({ loading: false });
    }
    applyVolume();
  }

  if (autoplay && !retry && typeof t.id === 'number') api.played(t.id).catch(() => {});
  updateMediaSession(t);
  prefetchNext();
}

/** Resolve the next imported song in the background so it starts instantly. */
function prefetchNext() {
  const { queue, index } = S();
  const n = queue[index + 1];
  if (n && !n.play && !n.virtual && typeof n.id === 'number') {
    api.resolve(n.id).then(({ track }) => emitTrack(track)).catch(() => {});
  }
}

/* ---------------- OS media keys / lock screen ---------------- */

function updateMediaSession(t) {
  document.title = `${t.title}${t.artist ? ` • ${t.artist}` : ''}`;
  if (!('mediaSession' in navigator)) return;
  const art = t.cover ? [{ src: new URL(t.cover, location.href).href, sizes: '300x300' }] : [];
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: art });
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => S().toggle());
  ms.setActionHandler('pause', () => S().toggle());
  ms.setActionHandler('nexttrack', () => S().next());
  ms.setActionHandler('previoustrack', () => S().prev());
  try { ms.setActionHandler('seekto', (d) => seekTo(d.seekTime)); } catch { /* unsupported */ }
}

/* ---------------- helpers used by the UI ---------------- */

/** Make sure a (possibly virtual YouTube search) track exists in the library. */
export async function ensureTrack(t) {
  if (!t.virtual) return t;
  const real = await api.addYouTube(t.ytResult);
  emitTrack(real);
  return real;
}

export async function toggleLike(t) {
  try {
    const real = await ensureTrack(t);
    const updated = real.liked ? await api.unlike(real.id) : await api.like(real.id);
    emitTrack(updated);
    toast(updated.liked ? 'Added to Liked Songs' : 'Removed from Liked Songs');
    return updated;
  } catch (e) {
    toast(e.message, 'error');
  }
}

/** Turn a YouTube search result into a track the queue can play. */
export function youtubeResultToTrack(r) {
  return {
    id: r.trackId ?? `yt:${r.videoId}`,
    virtual: !r.trackId,
    virtualOf: r.videoId,
    ytResult: r,
    source: 'youtube',
    title: r.songTitle || r.title,
    artist: r.songArtist || r.channel,
    album: '',
    durationMs: r.durationMs,
    cover: r.thumb,
    play: { kind: 'youtube', id: r.videoId },
    youtubeId: r.videoId,
    liked: !!r.liked,
    blocked: !!r.blocked,
  };
}
