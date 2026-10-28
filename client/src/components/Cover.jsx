import { useState } from 'react';
import { Music, Heart, HardDrive } from 'lucide-react';

export function Cover({ src, size, className = '', round = false, alt = '' }) {
  const [broken, setBroken] = useState(false);
  const style = size ? { width: size, height: size } : undefined;
  if (!src || broken) {
    return (
      <div className={`cover cover-empty ${round ? 'round' : ''} ${className}`} style={style}>
        <Music size={size ? Math.max(14, size * 0.38) : 28} />
      </div>
    );
  }
  return (
    <img
      className={`cover ${round ? 'round' : ''} ${className}`}
      style={style}
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}

/** Playlist art: custom cover, a 2x2 mosaic, or the first song's art. */
export function PlaylistCover({ playlist, size, className = '' }) {
  if (!playlist) return <Cover size={size} className={className} />;
  if (playlist.special === 'liked') return <SpecialCover kind="liked" size={size} className={className} />;
  if (playlist.special === 'local') return <SpecialCover kind="local" size={size} className={className} />;
  if (playlist.cover) return <Cover src={playlist.cover} size={size} className={className} />;
  const covers = playlist.covers || [];
  if (covers.length >= 4) {
    return (
      <div className={`cover mosaic ${className}`} style={size ? { width: size, height: size } : undefined}>
        {covers.slice(0, 4).map((c, i) => <img key={i} src={c} alt="" loading="lazy" draggable={false} />)}
      </div>
    );
  }
  return <Cover src={covers[0]} size={size} className={className} />;
}

export function SpecialCover({ kind, size, className = '' }) {
  const Icon = kind === 'liked' ? Heart : HardDrive;
  return (
    <div className={`cover special special-${kind} ${className}`} style={size ? { width: size, height: size } : undefined}>
      <Icon size={size ? Math.max(14, size * 0.4) : 48} fill={kind === 'liked' ? 'currentColor' : 'none'} />
    </div>
  );
}
