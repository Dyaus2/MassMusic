import { useEffect, useRef, useState } from 'react';
import { X, Maximize2, Heart, Trash2 } from 'lucide-react';
import { usePlayer, toggleLike } from '../lib/player';
import { useUI } from '../lib/ui';
import { Cover } from './Cover';
import { Equalizer } from './TrackList';
import { trackMenuItems } from './trackMenu';
import { msClock } from '../lib/format';

/**
 * The YouTube player lives in one fixed element for the app's lifetime (moving an iframe reloads it).
 * It floats over the "video slot" in the Now Playing panel, or becomes a mini player when the panel is closed.
 */
export function YouTubeDock() {
  const active = usePlayer((s) => s.ytActive);
  const panel = usePlayer((s) => s.panel);
  const setPanel = usePlayer((s) => s.setPanel);
  const close = usePlayer((s) => s.close);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    let last = '';
    const tick = () => {
      const slot = document.getElementById('yt-slot');
      const r = slot?.getBoundingClientRect();
      const next = r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setRect(next);
      }
    };
    tick();
    const id = setInterval(tick, 150);
    window.addEventListener('resize', tick);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', tick);
    };
  }, [panel]);

  const style = !active
    ? { left: -10000, top: 0, width: 320, height: 180 }
    : rect || undefined;

  return (
    <div className={`yt-dock ${active ? '' : 'off'} ${active && !rect ? 'mini' : ''}`} style={style}>
      <div id="yt-player" />
      {active && !rect && (
        <div className="yt-mini-actions">
          <button onClick={() => setPanel('now')} aria-label="Open Now Playing" title="Open Now Playing">
            <Maximize2 size={14} />
          </button>
          <button onClick={close} aria-label="Close song" title="Close song">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

export function RightPanel() {
  const panel = usePlayer((s) => s.panel);
  const setPanel = usePlayer((s) => s.setPanel);
  if (!panel) return null;
  return (
    <aside className="rightpanel">
      <div className="rp-head">
        <div className="rp-tabs">
          <button className={panel === 'now' ? 'on' : ''} onClick={() => panel !== 'now' && setPanel('now')}>Now playing</button>
          <button className={panel === 'queue' ? 'on' : ''} onClick={() => panel !== 'queue' && setPanel('queue')}>Queue</button>
        </div>
        <button className="icon-btn" onClick={() => setPanel(panel)} aria-label="Close panel"><X size={18} /></button>
      </div>
      {panel === 'now' ? <NowPlayingView /> : <QueueView />}
    </aside>
  );
}

function NowPlayingView() {
  const t = usePlayer((s) => s.queue[s.index]);
  const ytActive = usePlayer((s) => s.ytActive);
  const context = usePlayer((s) => s.context);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playAt = usePlayer((s) => s.playAt);
  const openMenu = useUI((s) => s.openMenu);
  const close = usePlayer((s) => s.close);
  const next = queue[index + 1];

  if (!t) {
    return <div className="rp-empty muted">Nothing playing yet. Pick a song to get started.</div>;
  }

  return (
    <div className="rp-body">
      {context?.name && <div className="rp-context muted small">Playing from <strong>{context.name}</strong></div>}
      {ytActive ? <div id="yt-slot" className="yt-slot" /> : <Cover src={t.cover} className="rp-art" />}
      <div className="rp-track">
        <div className="rp-text">
          <h3 className="ellipsis">{t.title}</h3>
          <p className="muted ellipsis">{t.artist || 'Unknown artist'}</p>
        </div>
        <button className={`icon-btn like ${t.liked ? 'on' : ''}`} onClick={() => toggleLike(t)} aria-label="Like">
          <Heart size={20} fill={t.liked ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="rp-card">
        <div className="rp-card-title">About this song</div>
        <dl className="rp-facts">
          {t.album && (<><dt>Album</dt><dd>{t.album}</dd></>)}
          <dt>Source</dt>
          <dd>
            {t.source === 'local' ? 'Local file' : t.matchedLocal ? 'Matched to a local file' : t.youtubeId ? 'YouTube' : 'Imported'}
            {t.spotifyId ? ' · from Spotify' : ''}
          </dd>
          {t.durationMs ? (<><dt>Length</dt><dd>{msClock(t.durationMs)}</dd></>) : null}
        </dl>
        <div className="row">
          <button className="btn ghost small" onClick={(e) => openMenu(e, trackMenuItems(t))}>More options</button>
          <button className="btn ghost small" onClick={close}><X size={14} /> Close song</button>
        </div>
      </div>
      {next && (
        <div className="rp-card">
          <div className="rp-card-title">Next in queue</div>
          <button className="mini-row" onClick={() => playAt(index + 1)}>
            <Cover src={next.cover} size={44} />
            <span className="mini-text">
              <span className="ellipsis">{next.title}</span>
              <span className="muted small ellipsis">{next.artist}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function QueueView() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const playAt = usePlayer((s) => s.playAt);
  const remove = usePlayer((s) => s.removeFromQueue);
  const clear = usePlayer((s) => s.clearUpcoming);
  const context = usePlayer((s) => s.context);
  const listRef = useRef(null);
  const cur = queue[index];
  const upcoming = queue.slice(index + 1, index + 201);

  return (
    <div className="rp-body" ref={listRef}>
      <div className="rp-section">Now playing</div>
      {cur ? (
        <div className="mini-row active">
          <Cover src={cur.cover} size={44} />
          <span className="mini-text">
            <span className="ellipsis accent">{cur.title}</span>
            <span className="muted small ellipsis">{cur.artist}</span>
          </span>
          {playing && <Equalizer />}
        </div>
      ) : <p className="muted small">Nothing playing</p>}

      {upcoming.length > 0 && (
        <>
          <div className="rp-section row-between">
            <span>Next{context?.name ? ` from ${context.name}` : ''}</span>
            <button className="link-btn" onClick={clear}>Clear</button>
          </div>
          {upcoming.map((t, k) => (
            <div key={`${t.id}-${k}`} className="mini-row hoverable" onDoubleClick={() => playAt(index + 1 + k)}>
              <button className="mini-cover-btn" onClick={() => playAt(index + 1 + k)} aria-label={`Play ${t.title}`}>
                <Cover src={t.cover} size={44} />
              </button>
              <span className="mini-text">
                <span className="ellipsis">{t.title}</span>
                <span className="muted small ellipsis">{t.artist}</span>
              </span>
              <button className="icon-btn subtle" onClick={() => remove(index + 1 + k)} aria-label="Remove from queue"><Trash2 size={15} /></button>
            </div>
          ))}
          {queue.length - index - 1 > upcoming.length && (
            <p className="muted small">+ {queue.length - index - 1 - upcoming.length} more</p>
          )}
        </>
      )}
    </div>
  );
}
