import { Link } from 'react-router-dom';
import { Import, FolderOpen, Search, Play } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { usePlayer } from '../lib/player';
import { greeting, plural } from '../lib/format';
import { PlaylistCover } from '../components/Cover';
import { Shelf, TrackCard, PlaylistCard } from '../components/Header';
import { useLibrary } from '../lib/ui';

function QuickTile({ to, playlist, name, loadTracks }) {
  return (
    <Link to={to} className="quick-tile">
      <PlaylistCover playlist={playlist} size={64} />
      <span className="ellipsis strong">{name}</span>
      <button
        className="quick-play"
        aria-label={`Play ${name}`}
        onClick={async (e) => {
          e.preventDefault();
          const tracks = await loadTracks();
          if (tracks.length) usePlayer.getState().playTracks(tracks, 0, { name, path: to });
        }}
      >
        <Play size={18} fill="currentColor" />
      </button>
    </Link>
  );
}

export default function Home() {
  const { data } = useAsync(() => api.home(), []);
  const playlists = useLibrary((s) => s.playlists);
  const playTracks = usePlayer((s) => s.playTracks);
  const empty = data && !data.counts.local && !data.counts.playlists && !data.counts.liked && !data.recent.length;

  return (
    <div className="page home">
      <h1 className="page-title">{greeting()}</h1>

      {data && !empty && (
        <div className="quick-grid">
          <QuickTile to="/liked" playlist={{ special: 'liked' }} name="Liked Songs" loadTracks={api.likes} />
          {playlists.slice(0, 7).map((p) => (
            <QuickTile key={p.id} to={`/playlist/${p.id}`} playlist={p} name={p.name} loadTracks={async () => (await api.playlist(p.id)).tracks} />
          ))}
        </div>
      )}

      {empty && (
        <div className="onboard">
          <h2>Let's fill your library</h2>
          <p className="muted">MassMusic plays the music files on this PC, and anything else through YouTube. Here are three ways to start.</p>
          <div className="onboard-grid">
            <Link to="/import" className="onboard-card">
              <Import size={28} />
              <strong>Import from Spotify</strong>
              <span className="muted small">Paste a playlist link, or connect your account for private playlists and Liked Songs.</span>
            </Link>
            <Link to="/settings" className="onboard-card">
              <FolderOpen size={28} />
              <strong>Add your music folders</strong>
              <span className="muted small">Point MassMusic at the folders with your MP3, FLAC and M4A files.</span>
            </Link>
            <Link to="/search" className="onboard-card">
              <Search size={28} />
              <strong>Search for any song</strong>
              <span className="muted small">Find songs on YouTube and save them to playlists.</span>
            </Link>
          </div>
        </div>
      )}

      {data?.recent.length > 0 && (
        <Shelf title="Recently played">
          {data.recent.map((t, i) => <TrackCard key={t.id} track={t} onPlay={() => playTracks(data.recent, i, { name: 'Recently played' })} />)}
        </Shelf>
      )}

      {data?.top.length > 2 && (
        <Shelf title="On repeat">
          {data.top.map((t, i) => <TrackCard key={t.id} track={t} onPlay={() => playTracks(data.top, i, { name: 'On repeat' })} />)}
        </Shelf>
      )}

      {playlists.length > 0 && (
        <Shelf title="Your playlists" action={<Link to="/library" className="link-btn">Show all</Link>}>
          {playlists.slice(0, 12).map((p) => (
            <PlaylistCard key={p.id} playlist={p} to={`/playlist/${p.id}`} subtitle={plural(p.count, 'song')} loadTracks={async () => (await api.playlist(p.id)).tracks} />
          ))}
        </Shelf>
      )}

      {data?.recentlyAdded.length > 0 && (
        <Shelf title="Recently added">
          {data.recentlyAdded.map((t, i) => <TrackCard key={t.id} track={t} onPlay={() => playTracks(data.recentlyAdded, i, { name: 'Recently added' })} />)}
        </Shelf>
      )}
    </div>
  );
}
