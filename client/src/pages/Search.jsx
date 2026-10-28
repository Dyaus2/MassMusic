import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Play } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useSyncedTracks } from '../lib/hooks';
import { usePlayer, youtubeResultToTrack } from '../lib/player';
import { TrackList } from '../components/TrackList';
import { Cover } from '../components/Cover';
import { PlaylistCard } from '../components/Header';
import { plural } from '../lib/format';

const GENRES = ['Lo-fi beats', 'Top hits 2026', 'Rock classics', 'Hip hop', 'Jazz', 'Rai', 'Arabic pop', 'Chill house', 'Workout', 'Piano', 'Afrobeats', 'Synthwave'];
const TINTS = ['#7c3aed', '#0e7490', '#b45309', '#be123c', '#4d7c0f', '#1d4ed8', '#9d174d', '#047857', '#c2410c', '#475569', '#a16207', '#6d28d9'];

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') || '').trim();
  const local = useAsync(() => (q ? api.searchLocal(q) : Promise.resolve(null)), [q]);
  const yt = useAsync(() => (q ? api.searchYouTube(q) : Promise.resolve(null)), [q]);

  const ytTracks = useMemo(() => (yt.data || []).map(youtubeResultToTrack), [yt.data]);
  const [webTracks] = useSyncedTracks(ytTracks);
  const [localTracks] = useSyncedTracks(local.data?.tracks);
  const playTracks = usePlayer((s) => s.playTracks);

  if (!q) {
    return (
      <div className="page">
        <h2 className="section-title">Browse</h2>
        <div className="genre-grid">
          {GENRES.map((g, i) => (
            <Link key={g} to={`/search?q=${encodeURIComponent(g)}`} className="genre" style={{ background: TINTS[i % TINTS.length] }}>
              {g}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const top = localTracks[0] || webTracks[0];

  return (
    <div className="page">
      {top && (
        <div className="search-top">
          <section>
            <h2 className="section-title">Top result</h2>
            <div className="top-result" onDoubleClick={() => playTracks(localTracks[0] ? localTracks : webTracks, 0, { name: `Search: ${q}` })}>
              <Cover src={top.cover} size={96} />
              <h3 className="ellipsis">{top.title}</h3>
              <p className="muted">{top.artist} <span className="pill">{top.source === 'local' ? 'Local file' : top.source === 'external' ? 'Imported' : 'YouTube'}</span></p>
              <button className="big-play floating" aria-label="Play" onClick={() => playTracks(localTracks[0] ? localTracks : webTracks, 0, { name: `Search: ${q}` })}>
                <Play size={22} fill="currentColor" />
              </button>
            </div>
          </section>
          <section className="search-songs">
            <h2 className="section-title">Songs</h2>
            <TrackList tracks={[...localTracks, ...webTracks].slice(0, 4)} context={{ name: `Search: ${q}` }} showAlbum={false} showHeader={false} />
          </section>
        </div>
      )}

      {local.data?.playlists?.length > 0 && (
        <section className="shelf">
          <h2 className="section-title">Playlists</h2>
          <div className="shelf-row">
            {local.data.playlists.map((p) => <PlaylistCard key={p.id} playlist={p} to={`/playlist/${p.id}`} subtitle={plural(p.count, 'song')} />)}
          </div>
        </section>
      )}

      {localTracks.length > 0 && (
        <section>
          <h2 className="section-title">In your library</h2>
          <TrackList tracks={localTracks} context={{ name: `Search: ${q}` }} />
        </section>
      )}

      <section>
        <h2 className="section-title">From YouTube</h2>
        {yt.loading && <div className="center pad"><Loader2 className="spin" /></div>}
        {yt.error && <p className="error-text">{yt.error.message}</p>}
        {!yt.loading && !yt.error && !webTracks.length && <p className="muted">No results.</p>}
        <TrackList tracks={webTracks} context={{ name: `Search: ${q}` }} showAlbum={false} />
      </section>
    </div>
  );
}
