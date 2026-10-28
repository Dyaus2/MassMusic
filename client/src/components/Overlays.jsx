import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useUI } from '../lib/ui';

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

export function ModalHost() {
  return useUI((s) => s.modal);
}

function MenuList({ items, x, y, onDone }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [open, setOpen] = useState(null);

  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  return (
    <div className="menu" ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.divider ? <div key={i} className="menu-divider" /> : (
          <div key={i} className="menu-item-wrap" onMouseEnter={() => setOpen(it.submenu ? i : null)}>
            <button
              className="menu-item"
              disabled={it.disabled}
              onClick={() => {
                if (it.submenu) return setOpen(i);
                it.onClick?.();
                onDone();
              }}
            >
              {it.icon ? <it.icon size={16} /> : <span style={{ width: 16 }} />}
              <span className="ellipsis">{it.label}</span>
              {it.submenu && <ChevronRight size={16} className="menu-chevron" />}
            </button>
            {it.submenu && open === i && (
              <SubMenu items={it.submenu} parent={ref} index={i} onDone={onDone} />
            )}
          </div>
        ),
      )}
    </div>
  );
}

function SubMenu({ items, parent, onDone }) {
  const [anchor, setAnchor] = useState(null);
  const self = useRef(null);
  useLayoutEffect(() => {
    const row = self.current.parentElement.getBoundingClientRect();
    const p = parent.current.getBoundingClientRect();
    setAnchor({ x: p.right - 4, y: row.top - 4 });
  }, [parent]);
  return (
    <span ref={self}>
      {anchor && <MenuList items={items} x={anchor.x} y={anchor.y} onDone={onDone} />}
    </span>
  );
}

export function ContextMenu() {
  const menu = useUI((s) => s.menu);
  const close = useUI((s) => s.closeMenu);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e) => !e.target.closest('.menu') && close();
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu, close]);
  if (!menu) return null;
  return <MenuList items={menu.items} x={menu.x} y={menu.y} onDone={close} />;
}
