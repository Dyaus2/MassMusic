import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderPlus, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { toast, useUI } from '../lib/ui';
import { ConfirmModal } from '../components/Modals';
import { timeAgo } from '../lib/format';

const SHORTCUTS = [
  ['Space', 'Play / pause'],
  ['Ctrl + →', 'Next song'],
  ['Ctrl + ←', 'Previous song'],
  ['Ctrl + ↑ / ↓', 'Volume up / down'],
  ['Shift + → / ←', 'Seek 5 seconds'],
  ['Ctrl + K', 'Search'],
  ['M', 'Mute'],
  ['S', 'Shuffle'],
  ['R', 'Repeat'],
];

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [folders, setFolders] = useState([]);
  const [newFolder, setNewFolder] = useState('');
  const poll = useRef(null);
  const openModal = useUI((x) => x.openModal);

  const load = async () => {
    const data = await api.settings();
    setS(data);
    setFolders(data.musicFolders);
    return data;
  };

  const watchScan = () => {
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const scan = await api.scanStatus();
      setS((prev) => ({ ...prev, scan }));
      if (!scan.running) {
        clearInterval(poll.current);
        load();
        toast(`Scan finished: ${scan.added} new, ${scan.removed} removed${scan.errors ? `, ${scan.errors} unreadable` : ''}`);
      }
    }, 800);
  };

  useEffect(() => {
    load().then((d) => d.scan.running && watchScan());
    return () => clearInterval(poll.current);
  }, []);

  const saveFolders = async (list) => {
    try {
      const r = await api.saveSettings({ musicFolders: list });
      setFolders(r.musicFolders);
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };

  const addFolder = async (e) => {
    e.preventDefault();
    const f = newFolder.trim().replace(/^"|"$/g, '');
    if (!f) return;
    if (await saveFolders([...folders, f])) {
      setNewFolder('');
      toast('Folder added. Scanning…');
      scan();
    }
  };

  const scan = async () => {
    const st = await api.scan();
    setS((prev) => ({ ...prev, scan: st }));
    watchScan();
  };

  if (!s) return <div className="page center pad"><Loader2 className="spin" /></div>;
  const st = s.scan;

  return (
    <div className="page settings">
      <h1 className="page-title">Settings</h1>

      <section className="set-section">
        <h2>Music folders</h2>
        <p className="muted">MassMusic plays audio files from these folders (MP3, FLAC, M4A, OGG, OPUS, WAV). Subfolders are included.</p>
        <div className="folder-list">
          {folders.length === 0 && <p className="muted small">No folders yet.</p>}
          {folders.map((f) => (
            <div key={f} className="folder-row">
              <code className="ellipsis">{f}</code>
              <button className="icon-btn subtle" onClick={() => saveFolders(folders.filter((x) => x !== f))} aria-label={`Remove ${f}`}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <form className="inline-form" onSubmit={addFolder}>
          <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Paste a folder path, e.g. D:\Music" />
          <button className="btn ghost"><FolderPlus size={16} /> Add folder</button>
        </form>
        <p className="muted small">Tip: in File Explorer, click the address bar of your music folder and copy the path.</p>
        <div className="row scan-row">
          <button className="btn primary" onClick={scan} disabled={st.running}>
            {st.running ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} {st.running ? 'Scanning…' : 'Scan now'}
          </button>
          {st.running ? (
            <span className="muted small ellipsis">{st.processed} / {st.found} files · {st.current}</span>
          ) : s.lastScan ? (
            <span className="muted small">Last scan {timeAgo(s.lastScan)}</span>
          ) : null}
        </div>
      </section>

      <section className="set-section">
        <h2>Library</h2>
        <div className="stats">
          <div><strong>{s.stats.local}</strong><span>local songs</span></div>
          <div><strong>{s.stats.youtube}</strong><span>saved from YouTube</span></div>
          <div><strong>{s.stats.imported}</strong><span>imported songs</span></div>
          <div><strong>{s.stats.importedLocal}</strong><span>imported songs found on this PC</span></div>
          <div><strong>{s.stats.playlists}</strong><span>playlists</span></div>
          <div><strong>{s.stats.plays}</strong><span>plays</span></div>
        </div>
      </section>

      <section className="set-section">
        <h2>Spotify</h2>
        <p className="muted">Connect your account or import playlists from links on the <Link to="/import?tab=account">Import page</Link>.</p>
      </section>

      <section className="set-section">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, v]) => (<div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>))}
        </dl>
      </section>

      <section className="set-section">
        <h2>Privacy</h2>
        <button
          className="btn ghost"
          onClick={() => openModal(
            <ConfirmModal
              title="Clear listening history?"
              body="Recently played and On repeat will be emptied."
              confirmLabel="Clear"
              onConfirm={async () => { await api.clearHistory(); load(); toast('History cleared'); }}
            />,
          )}
        >
          Clear listening history
        </button>
      </section>
    </div>
  );
}
