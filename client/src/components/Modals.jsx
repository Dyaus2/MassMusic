import { useEffect, useState } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { useUI, toast, emitTrack } from '../lib/ui';
import { usePlayer } from '../lib/player';
import { msClock } from '../lib/format';

export function Modal({ title, children, width = 480 }) {
  const close = useUI((s) => s.closeModal);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EditPlaylistModal({ playlist, onSaved }) {
  const close = useUI((s) => s.closeModal);
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description || '');
  const [cover, setCover] = useState(playlist.cover || '');
  const save = async (e) => {
    e.preventDefault();
    try {
      const p = await api.updatePlaylist(playlist.id, { name, description, cover: cover.trim() || null });
      onSaved?.(p);
      close();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <Modal title="Edit details">
      <form className="form" onSubmit={save}>
        <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></label>
        <label>Description<textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add an optional description" /></label>
        <label>Cover image URL<input value={cover} onChange={(e) => setCover(e.target.value)} placeholder="Leave empty to use song covers" /></label>
        <div className="form-actions"><button className="btn primary" type="submit">Save</button></div>
      </form>
    </Modal>
  );
}

export function ConfirmModal({ title, body, confirmLabel = 'Delete', onConfirm }) {
  const close = useUI((s) => s.closeModal);
  return (
    <Modal title={title} width={420}>
      <p className="muted">{body}</p>
      <div className="form-actions">
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn danger" onClick={async () => { await onConfirm(); close(); }}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

/** Pick which YouTube video an imported song should use. */
export function ChooseVersionModal({ track }) {
  const close = useUI((s) => s.closeModal);
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.candidates(track.id).then(setList).catch((e) => setErr(e.message));
  }, [track.id]);

  const choose = async (c) => {
    try {
      const t = await api.setYouTube(track.id, c.videoId);
      emitTrack(t);
      const p = usePlayer.getState();
      const i = p.queue.findIndex((q) => q.id === t.id);
      if (i === p.index) p.playAt(i);
      toast('Version updated');
      close();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <Modal title={`Choose a version of “${track.title}”`} width={640}>
      <p className="muted small">Looking for: {track.artist} — {track.title}{track.durationMs ? ` (${msClock(track.durationMs)})` : ''}</p>
      {err && <p className="error-text">{err}</p>}
      {!list && !err && <div className="center pad"><Loader2 className="spin" /></div>}
      <div className="version-list">
        {list?.map((c) => (
          <button key={c.videoId} className={`version ${c.current ? 'current' : ''}`} onClick={() => choose(c)} disabled={c.blocked}>
            <img src={c.thumb} alt="" />
            <div className="version-text">
              <div className="ellipsis">{c.title}</div>
              <div className="muted small">{c.channel} · {msClock(c.durationMs)}{c.blocked ? ' · only plays on YouTube' : ''}</div>
            </div>
            {c.current && <Check size={18} className="accent" />}
          </button>
        ))}
      </div>
    </Modal>
  );
}
