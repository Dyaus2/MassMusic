import { Link } from 'react-router-dom';
import { Play, Pause, Shuffle } from 'lucide-react';
import { usePlayer } from '../lib/player';
import { Cover, PlaylistCover } from './Cover';

export function CollectionHeader({ kind = 'Playlist', title, cover, description, meta, children }) {
  return (
    <header className="coll-head">
      <div className="coll-cover">{cover}</div>
      <div className="coll-info">
        <span className="small strong">{kind}</span>
        <h1 className={title.length > 28 ? 'long' : ''}>{title}</h1>
        {description && <p className="muted">{description}</p>}
        <div className="coll-meta">{meta}</div>
        {children}
      </div>
    </header>
  );
}

/** Big round play button that plays/pauses a collection. */
export function BigPlay({ tracks, context, size = 56 }) {
  const playing = usePlayer((s) => s.playing);
  const ctxPath = usePlayer((s) => s.context?.path);
  const toggle = usePlayer((s) => s.toggle);
  const playTracks = usePlayer((s) => s.playTracks);
  const isThis = ctxPath && context?.path === ctxPath;
  return (
    <button
      className="big-play"
      style={{ width: size, height: size }}
      disabled={!tracks?.length}
      aria-label={isThis && playing ? 'Pause' : 'Play'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isThis) toggle();
        else playTracks(tracks, 0, context);
      }}
    >
      {isThis && playing ? <Pause size={size * 0.42} fill="currentColor" /> : <Play size={size * 0.42} fill="currentColor" />}
    </button>
  );
}

export function ShuffleButton({ tracks, context }) {
  const shuffle = usePlayer((s) => s.shuffle);
  return (
    <button
      className={`icon-btn toggle big ${shuffle ? 'on' : ''}`}
      disabled={!tracks?.length}
      title="Shuffle play"
      aria-label="Shuffle play"
      onClick={() => {
        const p = usePlayer.getState();
        if (!p.shuffle) p.toggleShuffle();
        p.playTracks(tracks, Math.floor(Math.random() * tracks.length), context);
      }}
    >
      <Shuffle size={26} />
    </button>
  );
}

export function PlaylistCard({ playlist, to, subtitle, loadTracks }) {
  return (
    <Link to={to} className="card">
      <div className="card-art">
        <PlaylistCover playlist={playlist} />
        {loadTracks && <CardPlay loadTracks={loadTracks} context={{ name: playlist.name, path: to }} />}
      </div>
      <div className="card-title ellipsis">{playlist.name}</div>
      <div className="card-sub muted small ellipsis">{subtitle}</div>
    </Link>
  );
}

function CardPlay({ loadTracks, context }) {
  return (
    <button
      className="card-play"
      aria-label={`Play ${context.name}`}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tracks = await loadTracks();
        if (tracks.length) usePlayer.getState().playTracks(tracks, 0, context);
      }}
    >
      <Play size={22} fill="currentColor" />
    </button>
  );
}

export function TrackCard({ track, onPlay }) {
  const current = usePlayer((s) => s.queue[s.index]?.id === track.id);
  const playing = usePlayer((s) => s.playing);
  return (
    <div className={`card ${current ? 'current' : ''}`} onDoubleClick={onPlay}>
      <div className="card-art">
        <Cover src={track.cover} />
        <button className={`card-play ${current && playing ? 'show' : ''}`} aria-label={`Play ${track.title}`} onClick={(e) => { e.stopPropagation(); current ? usePlayer.getState().toggle() : onPlay(); }}>
          {current && playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </button>
      </div>
      <div className="card-title ellipsis">{track.title}</div>
      <div className="card-sub muted small ellipsis">{track.artist || 'Unknown artist'}</div>
    </div>
  );
}

export function Shelf({ title, children, action }) {
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>{title}</h2>
        {action}
      </div>
      <div className="shelf-row">{children}</div>
    </section>
  );
}
