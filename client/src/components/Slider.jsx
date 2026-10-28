import { useState } from 'react';

/** Range input that only commits on release (good for seeking). */
export function Slider({ value, max, onCommit, onLive, label, className = '' }) {
  const [drag, setDrag] = useState(null);
  const v = drag ?? value;
  const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0;
  const commit = () => {
    if (drag != null) onCommit(drag);
    setDrag(null);
  };
  return (
    <input
      type="range"
      className={`slider ${className}`}
      min={0}
      max={max || 0}
      step="any"
      value={v}
      aria-label={label}
      style={{ '--pct': `${pct}%` }}
      onChange={(e) => {
        const n = Number(e.target.value);
        setDrag(n);
        onLive?.(n);
      }}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
    />
  );
}
