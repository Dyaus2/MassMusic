import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Link2, UserRound, FileText, Loader2, Copy, LogOut, HardDrive, Heart, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { toast, refreshPlaylists } from '../lib/ui';
import { Cover } from '../components/Cover';
import { msClock, plural } from '../lib/format';

const TABS = [
  { id: 'link', label: 'Spotify link', icon: Link2 },
  { id: 'account', label: 'Spotify account', icon: UserRound },
  { id: 'file', label: 'CSV or text list', icon: FileText },
];

export default function ImportPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'link';
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (params.get('spotify') === 'connected') toast('Spotify connected');
    if (params.get('spotify_error')) toast(params.get('spotify_error'), 'error');
  }, [params]);

  return (
    <div className="page import">
      <h1 className="page-title">Import playlists</h1>
      <p className="muted lead">
        Bring playlists over from Spotify. Songs you already have as files play from your PC; everything else is matched on YouTube when you play it.
      </p>
      {!preview && (
        <>
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setParams({ tab: t.id })}>
                <t.icon size={16} /> {t.label}
              </button>
            ))}
          </div>
          {tab === 'link' && <LinkImport onPreview={setPreview} />}
          {tab === 'account' && <AccountImport onPreview={setPreview} />}
          {tab === 'file' && <FileImport onPreview={setPreview} />}
        </>
      )}
      {preview && <Preview preview={preview} onCancel={() => setPreview(null)} />}
    </div>
  );
}

function LinkImport({ onPreview }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      onPreview(await api.importPreview({ kind: 'spotify-url', url }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="import-box" onSubmit={go}>
      <label className="field-label" htmlFor="sp-url">Paste a Spotify playlist, album or song link</label>
      <div className="inline-form">
        <input id="sp-url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://open.spotify.com/playlist/…" />
        <button className="btn primary" disabled={!url.trim() || busy}>{busy ? <Loader2 size={16} className="spin" /> : 'Load'}</button>
      </div>
      <p className="muted small">
        No login needed. Works for public playlists. In Spotify use <em>Share → Copy link to playlist</em>.
        Spotify only shows the first 100 songs this way, so for bigger or private playlists use the <strong>Spotify account</strong> tab.
      </p>
    </form>
  );
}

function AccountImport({ onPreview }) {
  const [status, setStatus] = useState(null);
  const [clientId, setClientId] = useState('');
  const [playlists, setPlaylists] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    const s = await api.spotifyStatus();
    setStatus(s);
    setClientId(s.clientId || '');
    if (s.connected) {
      try {
        setPlaylists(await api.spotifyPlaylists());
      } catch (e) {
        toast(e.message, 'error');
      }
    }
  };
  useEffect(() => { load(); }, []);

  const saveClient = async (e) => {
    e.preventDefault();
    try {
      setStatus(await api.spotifySetClient(clientId));
      toast('Client ID saved');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const pick = async (playlistId) => {
    setBusy(playlistId);
    try {
      onPreview(await api.importPreview({ kind: 'spotify-account', playlistId }));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!status) return <div className="pad"><Loader2 className="spin" /></div>;

  if (!status.connected) {
    return (
      <div className="import-box">
        <h3>Connect your Spotify account</h3>
        <p className="muted">
          Spotify requires a free "developer app" so MassMusic can read your playlists. It takes about two minutes and you only do it once.
        </p>
        <ol className="steps">
          <li>Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com/dashboard</a> and log in.</li>
          <li>Click <strong>Create app</strong>. Any name and description is fine. Tick <strong>Web API</strong>.</li>
          <li>
            Under <strong>Redirect URIs</strong> add exactly:
            <div className="copy-line">
              <code>{status.redirectUri}</code>
              <button type="button" className="icon-btn subtle" onClick={() => { navigator.clipboard?.writeText(status.redirectUri); toast('Copied'); }} aria-label="Copy"><Copy size={16} /></button>
            </div>
          </li>
          <li>Save, open the app's <strong>Settings</strong>, and copy the <strong>Client ID</strong> here:</li>
        </ol>
        <form className="inline-form" onSubmit={saveClient}>
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID (32 characters)" />
          <button className="btn ghost">Save</button>
        </form>
        <button
          className="btn primary spotify-connect"
          disabled={!status.clientId}
          onClick={() => { window.location.href = `/api/spotify/login?return=${encodeURIComponent(window.location.origin)}`; }}
        >
          Connect Spotify
        </button>
        <p className="muted small">The connection stays on this PC. MassMusic only asks to read your playlists and Liked Songs.</p>
      </div>
    );
  }

  return (
    <div className="import-box wide">
      <div className="row-between">
        <div className="row">
          {status.user?.image && <Cover src={status.user.image} size={40} round />}
          <div>
            <div className="strong">{status.user?.name || 'Spotify account'}</div>
            <div className="muted small">Connected</div>
          </div>
        </div>
        <button className="btn ghost small" onClick={async () => { setStatus(await api.spotifyLogout()); setPlaylists(null); }}>
          <LogOut size={14} /> Disconnect
        </button>
      </div>
      <div className="sp-list">
        <button className="sp-item" onClick={() => pick('liked')} disabled={!!busy}>
          <div className="cover special special-liked" style={{ width: 56, height: 56 }}><Heart size={22} fill="currentColor" /></div>
          <span className="mini-text"><span className="strong">Liked Songs</span><span className="muted small">Your saved songs on Spotify</span></span>
          {busy === 'liked' ? <Loader2 size={18} className="spin" /> : <span className="btn outline small">Import</span>}
        </button>
        {!playlists && <div className="pad"><Loader2 className="spin" /></div>}
        {playlists?.map((p) => (
          <button key={p.id} className="sp-item" onClick={() => pick(p.id)} disabled={!!busy}>
            <Cover src={p.cover} size={56} />
            <span className="mini-text">
              <span className="strong ellipsis">{p.name}</span>
              <span className="muted small ellipsis">{p.owner}{p.total != null ? ` · ${plural(p.total, 'song')}` : ''}</span>
            </span>
            {busy === p.id ? <Loader2 size={18} className="spin" /> : <span className="btn outline small">Import</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function FileImport({ onPreview }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('text');
  const [busy, setBusy] = useState(false);

  const readFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result || ''));
      setKind(/\.csv$/i.test(file.name) ? 'csv' : 'text');
      setName(file.name.replace(/\.(csv|txt)$/i, ''));
    };
    reader.readAsText(file);
  };

  const go = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const looksCsv = kind === 'csv' || /^"?(track uri|track name|title|spotify id)/i.test(text.trim());
      onPreview(await api.importPreview({ kind: looksCsv ? 'csv' : 'text', content: text, name: name || undefined }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="import-box"
      onSubmit={go}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); readFile(e.dataTransfer.files?.[0]); }}
    >
      <label className="field-label">Playlist name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Imported playlist" /></label>
      <label className="field-label">
        Songs: one per line as <code>Artist - Title</code>, or a CSV export
        <textarea rows={10} value={text} onChange={(e) => { setText(e.target.value); setKind('text'); }} placeholder={'Daft Punk - Get Lucky\nThe Weeknd - Blinding Lights\nHey Jude by The Beatles'} />
      </label>
      <div className="row-between">
        <label className="btn ghost small file-btn">
          <Upload size={14} /> Open .csv / .txt
          <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => readFile(e.target.files?.[0])} hidden />
        </label>
        <button className="btn primary" disabled={!text.trim() || busy}>{busy ? <Loader2 size={16} className="spin" /> : 'Preview'}</button>
      </div>
      <p className="muted small">
        Tip: <a href="https://exportify.app" target="_blank" rel="noreferrer">Exportify</a> exports any Spotify playlist to CSV, and other services (Apple Music, YouTube Music, Deezer) have similar exporters.
      </p>
    </form>
  );
}

function Preview({ preview, onCancel }) {
  const navigate = useNavigate();
  const [name, setName] = useState(preview.name);
  const [busy, setBusy] = useState(false);
  const local = preview.tracks.filter((t) => t.local).length;

  const commit = async () => {
    setBusy(true);
    try {
      const p = await api.importCommit({ ...preview, name });
      await refreshPlaylists();
      toast(`Imported ${plural(p.count, 'song')}`);
      navigate(`/playlist/${p.id}`);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="preview">
      <div className="preview-head">
        <Cover src={preview.cover || preview.tracks.find((t) => t.cover)?.cover} size={140} />
        <div className="preview-info">
          <label className="field-label">Playlist name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <p className="muted">
            {plural(preview.tracks.length, 'song')}
            {local > 0 && <> · <HardDrive size={12} /> {local} already on this PC</>}
          </p>
          {preview.capped && <p className="warn small">Spotify only shows the first 100 songs of a playlist through a link. Connect your account to import all of them.</p>}
          <div className="row">
            <button className="btn primary" onClick={commit} disabled={busy || !name.trim()}>
              {busy ? <Loader2 size={16} className="spin" /> : `Import ${plural(preview.tracks.length, 'song')}`}
            </button>
            <button className="btn ghost" onClick={onCancel} disabled={busy}>Back</button>
          </div>
        </div>
      </div>
      <div className="preview-list">
        {preview.tracks.slice(0, 300).map((t, i) => (
          <div key={i} className="preview-row">
            <span className="muted tl-num">{i + 1}</span>
            <span className="mini-text">
              <span className="ellipsis">{t.title}</span>
              <span className="muted small ellipsis">{t.artist}{t.album ? ` · ${t.album}` : ''}</span>
            </span>
            {t.local && <span className="pill"><HardDrive size={11} /> On this PC</span>}
            <span className="muted small">{t.durationMs ? msClock(t.durationMs) : ''}</span>
          </div>
        ))}
        {preview.tracks.length > 300 && <p className="muted small pad">…and {preview.tracks.length - 300} more</p>}
      </div>
    </div>
  );
}
