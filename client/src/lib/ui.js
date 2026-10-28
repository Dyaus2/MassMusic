import { create } from 'zustand';
import { api } from './api';

/* ---------- toasts, context menu, modal ---------- */

export const useUI = create((set, get) => ({
  toasts: [],
  menu: null, // { x, y, items }
  modal: null, // React node
  showToast(text, kind = 'info') {
    const id = Math.random().toString(36).slice(2);
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3200);
  },
  openMenu(e, items) {
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX ?? e.currentTarget.getBoundingClientRect().left;
    const y = e.clientY ?? e.currentTarget.getBoundingClientRect().bottom;
    set({ menu: { x, y, items } });
  },
  closeMenu: () => set({ menu: null }),
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
}));

export const toast = (text, kind) => useUI.getState().showToast(text, kind);

/* ---------- playlists shown in the sidebar ---------- */

export const useLibrary = create((set) => ({
  playlists: [],
  loaded: false,
  async refresh() {
    try {
      set({ playlists: await api.playlists(), loaded: true });
    } catch (e) {
      toast(e.message, 'error');
    }
  },
}));
export const refreshPlaylists = () => useLibrary.getState().refresh();

/* ---------- track change bus: keeps every list in sync (likes, matches) ---------- */

const bus = new EventTarget();
export function emitTrack(track) {
  bus.dispatchEvent(new CustomEvent('track', { detail: track }));
}
export function onTrack(fn) {
  const h = (e) => fn(e.detail);
  bus.addEventListener('track', h);
  return () => bus.removeEventListener('track', h);
}
