import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Play, Pause, Star, Sparkles, Shuffle, Eye, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { usePlayer } from '../lib/player';
import { onTrack, toast } from '../lib/ui';
import { Cover } from './Cover';
import { storage } from '../lib/format';

export function StarRating({ value, onChange, size = 18, label = 'Rate this song' }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  return (
    <div className="stars" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={n <= shown ? 'on' : ''}
          onMouseEnter={() => setHover(n)}
          onClick={(e) => { e.stopPropagation(); onChange(value === n ? null : n); }}
        >
          <Star size={size} fill={n <= shown ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

/** Rate / un-rate / mark-known a pick, with optimistic UI. */
export function useRecActions(setPicks) {
  const replace = (p) => setPicks((list) => list.map((x) => (x.id === p.id ? p : x)));
  const rate = async (pick, stars) => {
    replace({ ...pick, rating: stars, known: false });
    try {
      const p = stars ? await api.recsRate(pick.id, stars) : await api.recsClearRating(pick.id);
      replace(p);
      if (stars && !storage.get('ratedOnce', false)) {
        storage.set('ratedOnce', true);
        toast('Thanks! The model learns only from ratings like this one');
      }
    } catch (e) {
      replace(pick);
      toast(e.message, 'error');
    }
  };
  const known = async (pick) => {
    replace({ ...pick, known: !pick.known, rating: null });
    try {
      replace(await api.recsKnown(pick.id, !pick.known));
    } catch (e) {
      replace(pick);
      toast(e.message, 'error');
    }
  };
  return { rate, known };
}

function PickCard({ pick, index, picks, actions }) {
  const current = usePlayer((s) => s.queue[s.index]?.id === pick.track?.id);
  const playing = usePlayer((s) => s.playing);
  const play = () => {
    if (current) return usePlayer.getState().toggle();
    const tracks = picks.map((p) => p.track).filter(Boolean);
    usePlayer.getState().playTracks(tracks, tracks.findIndex((t) => t.id === pick.track?.id), { name: 'Your daily 3', path: '/for-you' });
  };
  return (
    <article className={`pick ${pick.kind === 'wild' ? 'wild' : ''} ${current ? 'current' : ''}`}>
      <div className="pick-art">
        <Cover src={pick.cover || pick.track?.cover} />
        {pick.kind === 'wild' && <span className="pick-badge"><Shuffle size={12} /> Wildcard</span>}
        <button className={`card-play ${current && playing ? 'show' : ''}`} onClick={play} aria-label={`Play ${pick.title}`} disabled={!pick.track}>
          {current && playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </button>
      </div>
      <div className="pick-body">
        <div className="pick-title ellipsis" title={pick.title}>{index + 1}. {pick.title}</div>
        <div className="muted small ellipsis">{pick.artist}</div>
        <div className="pick-reason small ellipsis" title={pick.reason}>{pick.reason}</div>
        <div className="pick-actions">
          {pick.known ? (
            <span className="muted small">You already know it</span>
          ) : (
            <StarRating value={pick.rating} onChange={(n) => actions.rate(pick, n)} label={`Rate ${pick.title}`} />
          )}
          <button className={`link-btn small ${pick.known ? 'on' : ''}`} onClick={() => actions.known(pick)} title="Not a rating: just tells the model you've heard it before">
            <Eye size={13} /> {pick.known ? 'Undo' : 'I know this'}
          </button>
        </div>
      </div>
    </article>
  );
}

/** Today's 3 picks. `compact` = the Home version. */
export function DailyPicks({ compact = false }) {
  const [state, setState] = useState(null);
  const [picks, setPicks] = useState([]);
  const actions = useRecActions(setPicks);

  const load = useCallback(async () => {
    try {
      const s = await api.recsToday();
      setState(s);
      setPicks(s.picks);
      return s;
    } catch (e) {
      setState({ status: 'error', error: e.message, picks: [] });
    }
  }, []);

  useEffect(() => {
    let timer;
    const loop = async () => {
      const s = await load();
      if (s?.status === 'generating' || (!s?.picks?.length && s?.status !== 'error')) timer = setTimeout(loop, 3000);
    };
    loop();
    return () => clearTimeout(timer);
  }, [load]);

  // keep like/match state of the songs in sync
  useEffect(() => onTrack((t) => setPicks((l) => l.map((p) => (p.track?.id === t.id ? { ...p, track: { ...p.track, ...t } } : p)))), []);

  const head = (
    <div className="shelf-head">
      <div>
        <h2><Sparkles size={20} className="accent" /> Your daily 3</h2>
        <p className="muted small">New songs picked for you each day. Rate them to teach the model; skipping them is fine.</p>
      </div>
      {compact && <Link to="/for-you" className="link-btn">How it learns</Link>}
    </div>
  );

  if (!state) return null;
  if (!picks.length) {
    return (
      <section className={`daily ${compact ? 'compact' : ''}`}>
        {head}
        <div className="daily-wait">
          {state.status === 'error' ? (
            <>
              <span className="muted">Couldn't pick today's songs: {state.error}</span>
              <button className="btn ghost small" onClick={async () => { await api.recsRetry(); setTimeout(load, 800); }}><RefreshCw size={14} /> Try again</button>
            </>
          ) : (
            <>
              <Loader2 className="spin" size={18} />
              <span className="muted">{state.step || 'Picking today\'s songs'}… The first time takes a minute or two.</span>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={`daily ${compact ? 'compact' : ''}`}>
      {head}
      <div className="picks">
        {picks.map((p, i) => <PickCard key={p.id} pick={p} index={i} picks={picks} actions={actions} />)}
      </div>
    </section>
  );
}
