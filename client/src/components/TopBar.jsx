import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const onSearch = location.pathname === '/search';
  const [q, setQ] = useState(onSearch ? params.get('q') || '' : '');
  const timer = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    if (onSearch) setQ(params.get('q') || '');
  }, [onSearch, params]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const change = (v) => {
    setQ(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      navigate(v.trim() ? `/search?q=${encodeURIComponent(v.trim())}` : '/search', { replace: onSearch });
    }, 350);
  };

  return (
    <header className="topbar">
      <div className="nav-arrows">
        <button className="icon-btn round dark" onClick={() => navigate(-1)} aria-label="Go back"><ChevronLeft size={20} /></button>
        <button className="icon-btn round dark" onClick={() => navigate(1)} aria-label="Go forward"><ChevronRight size={20} /></button>
      </div>
      <form className="searchbox" onSubmit={(e) => { e.preventDefault(); clearTimeout(timer.current); navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}>
        <Search size={20} />
        <input
          ref={input}
          value={q}
          onChange={(e) => change(e.target.value)}
          onFocus={() => !onSearch && !q && navigate('/search')}
          placeholder="What do you want to play?"
          aria-label="Search"
        />
        {q && <button type="button" className="icon-btn subtle" onClick={() => change('')} aria-label="Clear search"><X size={18} /></button>}
        <kbd>Ctrl K</kbd>
      </form>
      <div className="topbar-spacer" />
    </header>
  );
}
