import { useEffect, useState } from 'react';
import { Sparkles, Brain, ThumbsUp, ThumbsDown, Cpu, Play } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { usePlayer } from '../lib/player';
import { DailyPicks, StarRating, useRecActions } from '../components/DailyPicks';
import { Cover } from '../components/Cover';

const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const stars = (v) => (v == null ? '–' : `${v.toFixed(1)}★`);

function Tile({ label, value, hint }) {
  return (
    <div className="stat-tile">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

/** Average rating per week. Single series, so the title names it and no legend is needed. */
function WeeklyChart({ weeks }) {
  const [hover, setHover] = useState(null);
  if (!weeks.length) return <p className="muted small">Your weekly average appears here once you start rating.</p>;
  return (
    <figure className="wchart">
      <figcaption className="wchart-title">Average rating per week</figcaption>
      <div className="wchart-plot" role="img" aria-label={`Average rating per week: ${weeks.map((w) => `${w.start} ${w.avg} stars`).join(', ')}`}>
        <div className="wchart-grid"><span>5★</span><span>3★</span><span>1★</span></div>
        <div className="wchart-bars">
          {weeks.map((w, i) => (
            <div key={w.start} className="wchart-slot" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <div className="wchart-bar" style={{ height: `${((w.avg - 1) / 4) * 100}%` }} />
              {hover === i && (
                <div className="wchart-tip">
                  <strong>{w.avg.toFixed(1)}★</strong>
                  <span>week of {new Date(`${w.start}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  <span>{w.n} rating{w.n === 1 ? '' : 's'}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <details className="wchart-table">
        <summary>Show as table</summary>
        <table>
          <thead><tr><th>Week of</th><th>Average</th><th>Ratings</th></tr></thead>
          <tbody>{weeks.map((w) => <tr key={w.start}><td>{w.start}</td><td>{w.avg.toFixed(2)}★</td><td>{w.n}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

function History() {
  const { data } = useAsync(() => api.recsHistory(), []);
  const [picks, setPicks] = useState([]);
  useEffect(() => setPicks(data || []), [data]);
  const actions = useRecActions(setPicks);
  if (!picks.length) return <p className="muted small">Earlier picks show up here. You can still rate them any time.</p>;
  const byDay = picks.reduce((m, p) => ((m[p.day] ||= []).push(p), m), {});
  return (
    <div className="rec-history">
      {Object.entries(byDay).map(([day, list]) => (
        <div key={day} className="rec-day">
          <div className="rec-day-label muted small">{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          {list.map((p) => (
            <div key={p.id} className="rec-row">
              <button className="mini-cover-btn" onClick={() => p.track && usePlayer.getState().playTracks([p.track], 0, { name: 'Your daily 3', path: '/for-you' })} aria-label={`Play ${p.title}`}>
                <Cover src={p.cover} size={44} />
              </button>
              <span className="mini-text">
                <span className="ellipsis">{p.title} {p.kind === 'wild' && <span className="pill tiny">Wildcard</span>}</span>
                <span className="muted small ellipsis">{p.artist} · {p.reason}</span>
              </span>
              {p.known ? <span className="muted small">Known</span> : <StarRating value={p.rating} onChange={(n) => actions.rate(p, n)} size={15} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ForYou() {
  const { data: s, reload } = useAsync(() => api.recsStats(), []);
  // refresh the numbers when you come back to the tab after rating
  useEffect(() => {
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <div className="page collection tint-foryou">
      <header className="coll-head">
        <div className="coll-cover"><div className="cover special special-foryou"><Sparkles size={64} /></div></div>
        <div className="coll-info">
          <span className="small strong">Made for you</span>
          <h1>For You</h1>
          <p className="muted">A small model that learns your taste from your star ratings, and only from them. Ignoring a pick never counts against it.</p>
        </div>
      </header>

      <div className="foryou-body">
        <DailyPicks />

        <section className="shelf">
          <div className="shelf-head"><h2><Brain size={20} className="accent" /> How well it knows you</h2></div>
          {!s ? <p className="muted small">Loading…</p> : (
            <>
              <div className="stat-grid">
                <Tile label="Stage" value={s.maturity} hint={`${s.rated} rating${s.rated === 1 ? '' : 's'} so far`} />
                <Tile label="Average rating" value={stars(s.avgStars)} hint={`${s.recommended} songs picked over ${s.days} day${s.days === 1 ? '' : 's'}`} />
                <Tile label="Hits on confident picks" value={pct(s.safe.hitRate)} hint={`4★ or more · ${s.safe.n} rated`} />
                <Tile label="Hits on wildcards" value={pct(s.wild.hitRate)} hint={`4★ or more · ${s.wild.n} rated`} />
              </div>
              <div className="learn-grid">
                <div className="learn-card">
                  <h3><ThumbsUp size={16} /> Leaning towards</h3>
                  <div className="chips">{s.likes.length ? s.likes.map((l) => <span key={l.tag} className="chip good">{l.tag}</span>) : <span className="muted small">Rate a few songs to see this</span>}</div>
                  <h3><ThumbsDown size={16} /> Leaning away from</h3>
                  <div className="chips">{s.dislikes.length ? s.dislikes.map((l) => <span key={l.tag} className="chip bad">{l.tag}</span>) : <span className="muted small">Nothing yet</span>}</div>
                  {s.leanings.length > 0 && <ul className="leanings">{s.leanings.map((l) => <li key={l.feature}>{l.text}</li>)}</ul>}
                </div>
                <div className="learn-card">
                  <WeeklyChart weeks={s.weekly} />
                </div>
              </div>
              <p className="muted small model-note">
                <Cpu size={13} /> Model: Bayesian linear bandit with Thompson sampling, {s.modelSize.features} features, about {s.modelSize.parametersKB} KB of state, runs on the CPU in milliseconds.
                Older ratings slowly fade so it can follow your taste as it changes.
              </p>
            </>
          )}
        </section>

        <section className="shelf">
          <div className="shelf-head"><h2><Play size={20} className="accent" /> Earlier picks</h2></div>
          <History />
        </section>
      </div>
    </div>
  );
}
