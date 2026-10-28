import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, RefreshCw, FolderOpen } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useSyncedTracks } from '../lib/hooks';
import { onTrack, useLibrary, toast } from '../lib/ui';
import { useEffect } from 'react';
import { SpecialCover } from '../components/Cover';
import { CollectionHeader, BigPlay, ShuffleButton, PlaylistCard } from '../components/Header';
import { TrackList } from '../components/TrackList';
import { longDuration, plural } from '../lib/format';

const total = (tracks) => tracks.reduce((s, t) => s + (t.durationMs || 0), 0);

export function LikedSongs() {
  const { data, loading, reload } = useAsync(() => api.likes(), []);
  const [tracks, setTracks] = useSyncedTracks(data);
  // drop songs that get unliked while on this page; reload when something new is liked
  useEffect(() => onTrack((t) => {
    if (t.liked === false) setTracks((l) => l.filter((x) => x.id !== t.id));
    else if (t.liked) reload();
  }), [setTracks, reload]);
  const context = { name: 'Liked Songs', path: '/liked' };

  return (
    <div className="page collection tint-liked">
      <CollectionHeader
        title="Liked Songs"
        cover={<SpecialCover kind="liked" />}
        meta={<span>{plural(tracks.length, 'song')}{tracks.length ? ` · ${longDuration(total(tracks))}` : ''}</span>}
      />
      <div className="action-bar">
        <BigPlay tracks={tracks} context={context} />
        <ShuffleButton tracks={tracks} context={context} />
      </div>
      {loading && !tracks.length && <div className="center pad"><Loader2 className="spin" /></div>}
      {!loading && !tracks.length && (
        <div className="empty">
          <h3>Songs you like will appear here</h3>
          <p className="muted">Save songs by tapping the heart icon.</p>
          <Link to="/search" className="btn primary">Find songs</Link>
        </div>
      )}
      <TrackList tracks={tracks} context={context} showAdded={false} />
    </div>
  );
}

export function LocalFiles() {
  const { data, loading, reload } = useAsync(() => api.tracks('local'), []);
  const [tracks] = useSyncedTracks(data);
  const context = { name: 'Local Files', path: '/local' };

  const rescan = useCallback(async () => {
    await api.scan();
    toast('Scanning your music folders…');
    const poll = setInterval(async () => {
      const s = await api.scanStatus();
      if (!s.running) {
        clearInterval(poll);
        toast(`Scan finished: ${s.added} new, ${s.removed} removed`);
        reload();
      }
    }, 1000);
  }, [reload]);

  return (
    <div className="page collection tint-local">
      <CollectionHeader
        kind="Library"
        title="Local Files"
        cover={<SpecialCover kind="local" />}
        meta={<span>{plural(tracks.length, 'song')}{tracks.length ? ` · ${longDuration(total(tracks))}` : ''}</span>}
      />
      <div className="action-bar">
        <BigPlay tracks={tracks} context={context} />
        <ShuffleButton tracks={tracks} context={context} />
        <button className="btn ghost" onClick={rescan}><RefreshCw size={16} /> Rescan</button>
        <Link to="/settings" className="btn ghost"><FolderOpen size={16} /> Music folders</Link>
      </div>
      {loading && !tracks.length && <div className="center pad"><Loader2 className="spin" /></div>}
      {!loading && !tracks.length && (
        <div className="empty">
          <h3>No music files found yet</h3>
          <p className="muted">Add the folders where you keep MP3, FLAC, M4A or OGG files, then scan.</p>
          <Link to="/settings" className="btn primary">Choose folders</Link>
        </div>
      )}
      <TrackList tracks={tracks} context={context} />
    </div>
  );
}

export function LibraryPage() {
  const playlists = useLibrary((s) => s.playlists);
  return (
    <div className="page">
      <h1 className="page-title">Your Library</h1>
      <div className="card-grid">
        <PlaylistCard playlist={{ special: 'liked', name: 'Liked Songs' }} to="/liked" subtitle="Your favourites" loadTracks={api.likes} />
        <PlaylistCard playlist={{ special: 'local', name: 'Local Files' }} to="/local" subtitle="Songs on this PC" loadTracks={() => api.tracks('local')} />
        {playlists.map((p) => (
          <PlaylistCard
            key={p.id}
            playlist={p}
            to={`/playlist/${p.id}`}
            subtitle={`${plural(p.count, 'song')}${p.source === 'spotify' ? ' · from Spotify' : ''}`}
            loadTracks={async () => (await api.playlist(p.id)).tracks}
          />
        ))}
      </div>
    </div>
  );
}
