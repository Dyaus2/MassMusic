import { ListPlus, ListEnd, ListStart, Heart, Trash2, Plus, RefreshCw, ExternalLink, Disc3 } from 'lucide-react';
import { api } from '../lib/api';
import { useUI, useLibrary, toast, refreshPlaylists } from '../lib/ui';
import { usePlayer, ensureTrack, toggleLike } from '../lib/player';
import { ChooseVersionModal } from './Modals';

export async function addTracksToPlaylist(playlistId, tracks, name) {
  try {
    const real = await Promise.all(tracks.map(ensureTrack));
    await api.addToPlaylist(playlistId, real.map((t) => t.id));
    toast(`Added to ${name}`);
    refreshPlaylists();
  } catch (e) {
    toast(e.message, 'error');
  }
}

export async function createPlaylistWith(tracks) {
  try {
    const real = await Promise.all(tracks.map(ensureTrack));
    const p = await api.createPlaylist({ name: real.length === 1 ? real[0].title : undefined });
    await api.addToPlaylist(p.id, real.map((t) => t.id));
    toast(`Created ${p.name}`);
    refreshPlaylists();
    return p;
  } catch (e) {
    toast(e.message, 'error');
  }
}

/** Items for a track's right-click / "..." menu. */
export function trackMenuItems(track, { playlistId, entryId, onRemoved } = {}) {
  const player = usePlayer.getState();
  const playlists = useLibrary.getState().playlists;
  const items = [
    { icon: ListStart, label: 'Play next', onClick: () => player.playNext(track) },
    { icon: ListEnd, label: 'Add to queue', onClick: () => player.addToQueue(track) },
    { divider: true },
    {
      icon: ListPlus,
      label: 'Add to playlist',
      submenu: [
        { icon: Plus, label: 'New playlist', onClick: () => createPlaylistWith([track]) },
        ...(playlists.length ? [{ divider: true }] : []),
        ...playlists
          .filter((p) => p.id !== playlistId)
          .map((p) => ({ label: p.name, onClick: () => addTracksToPlaylist(p.id, [track], p.name) })),
      ],
    },
    {
      icon: Heart,
      label: track.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs',
      onClick: () => toggleLike(track),
    },
  ];
  if (playlistId && entryId) {
    items.push({
      icon: Trash2,
      label: 'Remove from this playlist',
      onClick: async () => {
        await api.removeEntry(playlistId, entryId);
        onRemoved?.(entryId);
        refreshPlaylists();
      },
    });
  }
  if (track.source === 'external') {
    items.push({ divider: true });
    items.push({
      icon: RefreshCw,
      label: track.matchedLocal ? 'Play from YouTube instead…' : 'Choose YouTube version…',
      onClick: () => useUI.getState().openModal(<ChooseVersionModal track={track} />),
    });
  }
  if (track.youtubeId) {
    items.push({
      icon: ExternalLink,
      label: 'Open on YouTube',
      onClick: () => window.open(`https://www.youtube.com/watch?v=${track.youtubeId}`, '_blank', 'noopener'),
    });
  }
  if (track.spotifyId) {
    items.push({
      icon: Disc3,
      label: 'Open on Spotify',
      onClick: () => window.open(`https://open.spotify.com/track/${track.spotifyId}`, '_blank', 'noopener'),
    });
  }
  return items;
}
