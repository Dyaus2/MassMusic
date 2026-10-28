import { useState } from 'react';
import { Play, Heart, MoreHorizontal, Clock3, HardDrive, MonitorPlay, CloudDownload } from 'lucide-react';
import { Cover } from './Cover';
import { usePlayer, toggleLike } from '../lib/player';
import { useUI } from '../lib/ui';
import { msClock, timeAgo } from '../lib/format';
import { trackMenuItems } from './trackMenu';

export function SourceBadge({ track }) {
  if (track.source === 'local' || track.matchedLocal) return <HardDrive size={12} className="src-badge" aria-label="Local file" />;
  if (track.source === 'youtube' || track.youtubeId) return <MonitorPlay size={12} className="src-badge" aria-label="YouTube" />;
  return <CloudDownload size={12} className="src-badge dim" aria-label="Imported, not matched yet" />;
}

export function Equalizer() {
  return <span className="eq" aria-hidden><i /><i /><i /></span>;
}

/**
 * Spotify-style song table.
 * props: tracks, context {name, path}, playlistId, onRemoved(entryId), onMove(entryId, toIndex), showAlbum, showAdded
 */
export function TrackList({ tracks, context, playlistId, onRemoved, onMove, showAlbum = true, showAdded = false, showHeader = true }) {
  const current = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const playTracks = usePlayer((s) => s.playTracks);
  const toggle = usePlayer((s) => s.toggle);
  const openMenu = useUI((s) => s.openMenu);
  const [selected, setSelected] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const isCurrent = (t) => current && (current.id === t.id || (current.virtualOf && current.virtualOf === t.virtualOf));

  const play = (i) => {
    if (isCurrent(tracks[i])) return toggle();
    playTracks(tracks, i, context);
  };
  const menu = (e, t) => openMenu(e, trackMenuItems(t, { playlistId, entryId: t.entryId, onRemoved }));

  if (!tracks.length) return null;

  return (
    <TrackTable {...{ tracks, showHeader, showAdded, cols: `tl-cols ${showAlbum && tracks.some((t) => t.album) ? 'with-album' : ''} ${showAdded ? 'with-added' : ''}`, isCurrent, playing, play, menu, selected, setSelected, dragOver, setDragOver, onMove }} />
  );
}

function TrackTable({ tracks, showHeader, showAdded, cols, isCurrent, playing, play, menu, selected, setSelected, dragOver, setDragOver, onMove }) {
  const showAlbum = cols.includes('with-album');
  return (
    <div className="tracklist" role="grid">
      {showHeader && (
        <div className={`tl-row tl-head ${cols}`}>
          <span className="tl-num">#</span>
          <span>Title</span>
          {showAlbum && <span className="tl-album">Album</span>}
          {showAdded && <span className="tl-added">Date added</span>}
          <span className="tl-dur"><Clock3 size={16} /></span>
        </div>
      )}
      {tracks.map((t, i) => {
        const active = isCurrent(t);
        return (
          <div
            key={t.entryId ?? `${t.id}-${i}`}
            className={`tl-row ${cols} ${active ? 'active' : ''} ${selected === i ? 'selected' : ''} ${dragOver === i ? 'drag-over' : ''} ${t.blocked ? 'blocked' : ''}`}
            title={t.blocked ? 'The owner only allows this video to play on YouTube' : undefined}
            onClick={() => setSelected(i)}
            onDoubleClick={() => play(i)}
            onContextMenu={(e) => menu(e, t)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-mm-track', JSON.stringify(t));
              if (onMove && t.entryId) e.dataTransfer.setData('application/x-mm-entry', String(t.entryId));
              e.dataTransfer.effectAllowed = 'copyMove';
            }}
            onDragOver={(e) => {
              if (onMove && e.dataTransfer.types.includes('application/x-mm-entry')) {
                e.preventDefault();
                setDragOver(i);
              }
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              setDragOver(null);
              const entry = e.dataTransfer.getData('application/x-mm-entry');
              if (onMove && entry) onMove(Number(entry), i);
            }}
          >
            <span className="tl-num">
              <span className="tl-index">{active && playing ? <Equalizer /> : i + 1}</span>
              <button className="tl-play" onClick={(e) => { e.stopPropagation(); play(i); }} aria-label={`Play ${t.title}`}>
                <Play size={16} fill="currentColor" />
              </button>
            </span>
            <span className="tl-title">
              <Cover src={t.cover} size={40} />
              <span className="tl-text">
                <span className="tl-name ellipsis">{t.title}</span>
                <span className="tl-artist ellipsis"><SourceBadge track={t} />{t.artist || 'Unknown artist'}</span>
              </span>
            </span>
            {showAlbum && <span className="tl-album ellipsis muted">{t.album}</span>}
            {showAdded && <span className="tl-added muted">{timeAgo(t.entryAddedAt || t.addedAt)}</span>}
            <span className="tl-dur muted">
              <button
                className={`tl-like ${t.liked ? 'on' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleLike(t); }}
                aria-label={t.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
              >
                <Heart size={16} fill={t.liked ? 'currentColor' : 'none'} />
              </button>
              <span className="tl-time">{t.durationMs ? msClock(t.durationMs) : '–'}</span>
              <button className="tl-more" onClick={(e) => menu(e, t)} aria-label="More options">
                <MoreHorizontal size={18} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
