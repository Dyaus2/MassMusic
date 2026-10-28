import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Home, Search, Import, Plus, Library, Settings, Volume2 } from 'lucide-react';
import { useLibrary, refreshPlaylists, toast } from '../lib/ui';
import { usePlayer } from '../lib/player';
import { api } from '../lib/api';
import { PlaylistCover } from './Cover';
import { addTracksToPlaylist } from './trackMenu';
import { plural } from '../lib/format';

function LibItem({ to, playlist, title, subtitle, onDropTrack }) {
  const [over, setOver] = useState(false);
  const contextPath = usePlayer((s) => s.context?.path);
  const playing = usePlayer((s) => s.playing);
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `lib-item ${isActive ? 'active' : ''} ${over ? 'drop' : ''}`}
      onDragOver={(e) => {
        if (onDropTrack && e.dataTransfer.types.includes('application/x-mm-track')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const raw = e.dataTransfer.getData('application/x-mm-track');
        if (raw && onDropTrack) onDropTrack(JSON.parse(raw));
      }}
    >
      <PlaylistCover playlist={playlist} size={44} />
      <span className="lib-text">
        <span className="ellipsis">{title}</span>
        <span className="muted small ellipsis">{subtitle}</span>
      </span>
      {contextPath === to && playing && <Volume2 size={16} className="accent" />}
    </NavLink>
  );
}

export function Sidebar() {
  const playlists = useLibrary((s) => s.playlists);
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');

  useEffect(() => { refreshPlaylists(); }, []);

  const create = async () => {
    try {
      const p = await api.createPlaylist();
      await refreshPlaylists();
      navigate(`/playlist/${p.id}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const shown = filter ? playlists.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase())) : playlists;

  return (
    <nav className="sidebar">
      <div className="panel nav-panel">
        <div className="brand">
          <img src="/logo.svg" alt="" width={28} height={28} />
          <span>MassMusic</span>
        </div>
        <NavLink to="/" end className="nav-link"><Home size={22} /> Home</NavLink>
        <NavLink to="/search" className="nav-link"><Search size={22} /> Search</NavLink>
        <NavLink to="/import" className="nav-link"><Import size={22} /> Import playlists</NavLink>
      </div>

      <div className="panel lib-panel">
        <div className="lib-head">
          <NavLink to="/library" className="nav-link tight"><Library size={22} /> Your Library</NavLink>
          <button className="icon-btn round" onClick={create} aria-label="Create playlist" title="Create playlist"><Plus size={18} /></button>
        </div>
        {playlists.length > 6 && (
          <input className="lib-filter" placeholder="Find in your library" value={filter} onChange={(e) => setFilter(e.target.value)} />
        )}
        <div className="lib-list">
          {!filter && (
            <>
              <LibItem to="/liked" playlist={{ special: 'liked' }} title="Liked Songs" subtitle="Playlist" />
              <LibItem to="/local" playlist={{ special: 'local' }} title="Local Files" subtitle="Songs on this PC" />
            </>
          )}
          {shown.map((p) => (
            <LibItem
              key={p.id}
              to={`/playlist/${p.id}`}
              playlist={p}
              title={p.name}
              subtitle={`Playlist · ${plural(p.count, 'song')}`}
              onDropTrack={(t) => addTracksToPlaylist(p.id, [t], p.name)}
            />
          ))}
        </div>
        <NavLink to="/settings" className="nav-link settings-link"><Settings size={18} /> Settings</NavLink>
      </div>
    </nav>
  );
}
