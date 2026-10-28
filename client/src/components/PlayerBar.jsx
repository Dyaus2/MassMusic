import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Heart,
  Volume2, Volume1, VolumeX, ListMusic, PanelRight, Loader2,
} from 'lucide-react';
import { usePlayer, toggleLike } from '../lib/player';
import { Cover } from './Cover';
import { Slider } from './Slider';
import { clock } from '../lib/format';
import { SourceBadge } from './TrackList';

export function PlayerBar() {
  const p = usePlayer();
  const t = p.queue[p.index];
  const [liveVol, setLiveVol] = useState(null);
  const vol = p.muted ? 0 : liveVol ?? p.volume;
  const VolIcon = vol === 0 ? VolumeX : vol < 0.5 ? Volume1 : Volume2;

  return (
    <footer className="playerbar">
      <div className="pb-left">
        {t && (
          <>
            <Cover src={t.cover} size={56} />
            <div className="pb-meta">
              <div className="pb-title ellipsis">
                {p.context?.path ? <Link to={p.context.path}>{t.title}</Link> : t.title}
              </div>
              <div className="pb-artist ellipsis"><SourceBadge track={t} />{t.artist || 'Unknown artist'}</div>
            </div>
            <button className={`icon-btn like ${t.liked ? 'on' : ''}`} onClick={() => toggleLike(t)} aria-label="Like">
              <Heart size={18} fill={t.liked ? 'currentColor' : 'none'} />
            </button>
          </>
        )}
      </div>

      <div className="pb-center">
        <div className="pb-controls">
          <button className={`icon-btn toggle ${p.shuffle ? 'on' : ''}`} onClick={p.toggleShuffle} aria-label="Shuffle" title="Shuffle">
            <Shuffle size={18} />
          </button>
          <button className="icon-btn" onClick={p.prev} aria-label="Previous" title="Previous"><SkipBack size={20} fill="currentColor" /></button>
          <button className="play-btn" onClick={p.toggle} aria-label={p.playing ? 'Pause' : 'Play'} disabled={!t}>
            {p.loading && !p.playing ? <Loader2 size={18} className="spin" /> : p.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={() => p.next()} aria-label="Next" title="Next"><SkipForward size={20} fill="currentColor" /></button>
          <button className={`icon-btn toggle ${p.repeat !== 'off' ? 'on' : ''}`} onClick={p.cycleRepeat} aria-label={`Repeat: ${p.repeat}`} title={`Repeat: ${p.repeat}`}>
            {p.repeat === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
          </button>
        </div>
        <div className="pb-progress">
          <span className="time">{clock(p.position)}</span>
          <Slider value={p.position} max={p.duration || 0} onCommit={p.seek} label="Seek" />
          <span className="time">{clock(p.duration)}</span>
        </div>
      </div>

      <div className="pb-right">
        <button className={`icon-btn toggle ${p.panel === 'now' ? 'on' : ''}`} onClick={() => p.setPanel('now')} aria-label="Now playing view" title="Now playing view">
          <PanelRight size={18} />
        </button>
        <button className={`icon-btn toggle ${p.panel === 'queue' ? 'on' : ''}`} onClick={() => p.setPanel('queue')} aria-label="Queue" title="Queue">
          <ListMusic size={18} />
        </button>
        <button className="icon-btn" onClick={p.toggleMute} aria-label="Mute" title="Mute"><VolIcon size={18} /></button>
        <Slider
          className="vol"
          value={vol}
          max={1}
          label="Volume"
          onLive={(v) => { setLiveVol(v); p.setVolume(v); }}
          onCommit={(v) => { setLiveVol(null); p.setVolume(v); }}
        />
      </div>
    </footer>
  );
}
