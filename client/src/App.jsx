import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { PlayerBar } from './components/PlayerBar';
import { RightPanel, YouTubeDock } from './components/NowPlaying';
import { Toasts, ContextMenu, ModalHost } from './components/Overlays';
import { usePlayer } from './lib/player';
import Home from './pages/Home';
import SearchPage from './pages/Search';
import PlaylistPage from './pages/Playlist';
import ImportPage from './pages/Import';
import SettingsPage from './pages/Settings';
import ForYou from './pages/ForYou';
import { LikedSongs, LocalFiles, LibraryPage } from './pages/Collections';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      if (el.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const p = usePlayer.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') { e.preventDefault(); p.toggle(); }
      else if (ctrl && e.key === 'ArrowRight') { e.preventDefault(); p.next(); }
      else if (ctrl && e.key === 'ArrowLeft') { e.preventDefault(); p.prev(); }
      else if (ctrl && e.key === 'ArrowUp') { e.preventDefault(); p.setVolume(p.volume + 0.1); }
      else if (ctrl && e.key === 'ArrowDown') { e.preventDefault(); p.setVolume(p.volume - 0.1); }
      else if (e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); p.seek(Math.min(p.duration, p.position + 5)); }
      else if (e.shiftKey && e.key === 'ArrowLeft') { e.preventDefault(); p.seek(Math.max(0, p.position - 5)); }
      else if (!ctrl && !e.altKey && e.key.toLowerCase() === 'm') p.toggleMute();
      else if (!ctrl && !e.altKey && e.key.toLowerCase() === 's') p.toggleShuffle();
      else if (!ctrl && !e.altKey && e.key.toLowerCase() === 'r') p.cycleRepeat();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const panel = usePlayer((s) => s.panel);
  const location = useLocation();
  useShortcuts();

  useEffect(() => {
    document.querySelector('.main-scroll')?.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className={`app ${panel ? 'with-panel' : ''}`}>
      <Sidebar />
      <main className="main panel">
        <div className="main-scroll">
          <TopBar />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/liked" element={<LikedSongs />} />
            <Route path="/local" element={<LocalFiles />} />
            <Route path="/playlist/:id" element={<PlaylistPage key={location.pathname} />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/for-you" element={<ForYou />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </div>
      </main>
      <RightPanel />
      <PlayerBar />
      <YouTubeDock />
      <ContextMenu />
      <ModalHost />
      <Toasts />
    </div>
  );
}
