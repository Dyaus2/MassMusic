import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MoreHorizontal, Pencil, Trash2, Wand2, ExternalLink, Loader2, Search, Plus, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useSyncedTracks } from '../lib/hooks';
import { useUI, toast, refreshPlaylists, emitTrack } from '../lib/ui';
import { usePlayer, youtubeResultToTrack, ensureTrack } from '../lib/player';
import { PlaylistCover, Cover } from '../components/Cover';
import { CollectionHeader, BigPlay, ShuffleButton } from '../components/Header';
import { TrackList, SourceBadge } from '../components/TrackList';
import { EditPlaylistModal, ConfirmModal } from '../components/Modals';
import { longDuration, plural, msClock } from '../lib/format';

export default function PlaylistPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload, setData } = useAsync(() => api.playlist(id), [id]);
  const [tracks, setTracks] = useSyncedTracks(data?.tracks);
  const openMenu = useUI((s) => s.openMenu);
  const openModal = useUI((s) => s.openModal);
  const [matching, setMatching] = useState(null);
  const [finder, setFinder] = useState(false);
  const stopMatching = useRef(false);

  useEffect(() => () => { stopMatching.current = true; }, []);

  if (error) return <div className="page"><div className="empty"><h3>Playlist not found</h3></div></div>;
  if (!data) return <div className="page center pad">{loading && <Loader2 className="spin" />}</div>;

  const context = { name: data.name, path: `/playlist/${data.id}` };
  const totalMs = tracks.reduce((s, t) => s + (t.durationMs || 0), 0);
  const unmatched = tracks.filter((t) => !t.play);
  const localCount = tracks.filter((t) => t.source === 'local' || t.matchedLocal).length;

  const matchAll = async () => {
    stopMatching.current = false;
    const todo = unmatched;
    setMatching({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length && !stopMatching.current; i++) {
      try {
        const { track } = await api.resolve(todo[i].id);
        emitTrack(track);
      } catch { /* leave it for later */ }
      setMatching({ done: i + 1, total: todo.length });
    }
    setMatching(null);
    toast('Matching finished');
  };

  const menuItems = [
    { icon: Pencil, label: 'Edit details', onClick: () => openModal(<EditPlaylistModal playlist={data} onSaved={(p) => { setData((d) => ({ ...d, ...p })); refreshPlaylists(); }} />) },
    ...(unmatched.length ? [{ icon: Wand2, label: `Find all ${unmatched.length} unmatched songs on YouTube`, onClick: matchAll }] : []),
    ...(data.sourceUrl ? [{ icon: ExternalLink, label: 'Open original on Spotify', onClick: () => window.open(data.sourceUrl, '_blank', 'noopener') }] : []),
    { divider: true },
    {
      icon: Trash2,
      label: 'Delete playlist',
      onClick: () => openModal(
        <ConfirmModal
          title="Delete from Your Library?"
          body={<>This will delete <strong>{data.name}</strong> from Your Library.</>}
          onConfirm={async () => {
            await api.deletePlaylist(data.id);
            await refreshPlaylists();
            navigate('/library');
          }}
        />,
      ),
    },
  ];

  const onMove = async (entryId, toIndex) => {
    const from = tracks.findIndex((t) => t.entryId === entryId);
    if (from < 0 || from === toIndex) return;
    const next = [...tracks];
    const [moved] = next.splice(from, 1);
    next.splice(toIndex, 0, moved);
    setTracks(next);
    try { await api.moveEntry(data.id, entryId, toIndex); } catch (e) { toast(e.message, 'error'); reload(); }
  };

  return (
    <div className="page collection">
      <CollectionHeader
        title={data.name}
        description={data.description}
        cover={<PlaylistCover playlist={{ ...data, covers: data.covers }} />}
        meta={
          <span>
            {plural(tracks.length, 'song')}{totalMs ? `, ${longDuration(totalMs)}` : ''}
            {data.source === 'spotify' && <> · imported from Spotify</>}
            {tracks.length > 0 && <> · {localCount} local, {tracks.length - localCount - unmatched.length} YouTube, {unmatched.length} not matched yet</>}
          </span>
        }
      />
      <div className="action-bar">
        <BigPlay tracks={tracks} context={context} />
        <ShuffleButton tracks={tracks} context={context} />
        <button className="icon-btn big" onClick={(e) => openMenu(e, menuItems)} aria-label="More options for playlist"><MoreHorizontal size={28} /></button>
        {matching && (
          <span className="matching muted small">
            <Loader2 size={14} className="spin" /> Matching {matching.done}/{matching.total}
            <button className="link-btn" onClick={() => { stopMatching.current = true; }}>Stop</button>
          </span>
        )}
      </div>

      <TrackList
        tracks={tracks}
        context={context}
        playlistId={data.id}
        showAdded
        onMove={onMove}
        onRemoved={(entryId) => setTracks((l) => l.filter((t) => t.entryId !== entryId))}
      />

      {!tracks.length && !finder && (
        <div className="empty left">
          <h3>Let's find something for your playlist</h3>
        </div>
      )}
      {(finder || !tracks.length) ? (
        <SongFinder playlist={data} onClose={tracks.length ? () => setFinder(false) : null} onAdded={reload} />
      ) : (
        <button className="link-btn find-more" onClick={() => setFinder(true)}>Find more</button>
      )}
    </div>
  );
}

/** Inline "search and add" box at the bottom of a playlist. */
function SongFinder({ playlist, onClose, onAdded }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const timer = useRef(null);
  const local = useAsync(() => (query ? api.searchLocal(query) : Promise.resolve(null)), [query]);
  const yt = useAsync(() => (query ? api.searchYouTube(query) : Promise.resolve(null)), [query]);
  const results = useMemo(() => [
    ...(local.data?.tracks || []).slice(0, 5),
    ...(yt.data || []).slice(0, 10).map(youtubeResultToTrack),
  ], [local.data, yt.data]);

  const add = async (t) => {
    try {
      const real = await ensureTrack(t);
      await api.addToPlaylist(playlist.id, [real.id]);
      toast(`Added to ${playlist.name}`);
      refreshPlaylists();
      onAdded();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <section className="finder">
      <div className="finder-head">
        <div className="finder-input">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            placeholder="Search for songs"
            onChange={(e) => {
              setQ(e.target.value);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setQuery(e.target.value.trim()), 400);
            }}
          />
        </div>
        {onClose && <button className="icon-btn" onClick={onClose} aria-label="Close search"><X size={20} /></button>}
      </div>
      {(local.loading || yt.loading) && query && <div className="pad"><Loader2 className="spin" /></div>}
      <div className="finder-list">
        {results.map((t) => (
          <div key={t.id} className="finder-row">
            <Cover src={t.cover} size={40} />
            <span className="mini-text">
              <span className="ellipsis">{t.title}</span>
              <span className="muted small ellipsis"><SourceBadge track={t} />{t.artist}</span>
            </span>
            <span className="muted small">{t.durationMs ? msClock(t.durationMs) : ''}</span>
            <button className="btn ghost small" onClick={() => usePlayer.getState().playTracks([t], 0)}>Play</button>
            <button className="btn outline small" onClick={() => add(t)}><Plus size={14} /> Add</button>
          </div>
        ))}
      </div>
    </section>
  );
}
