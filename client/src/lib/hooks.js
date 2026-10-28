import { useEffect, useState, useCallback } from 'react';
import { onTrack } from './ui';

/** Load data with an async fn; re-runs when deps change. */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState({ data: null, error, loading: false }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

/** Keep a list of tracks in sync with likes / resolved sources happening anywhere in the app. */
export function useSyncedTracks(initial) {
  const [tracks, setTracks] = useState(initial || []);
  useEffect(() => setTracks(initial || []), [initial]);
  useEffect(() => onTrack((t) => setTracks((list) => list.map((x) => {
    const same = x.id === t.id || (x.virtual && t.source === 'youtube' && x.virtualOf === t.youtubeId);
    return same ? { ...x, ...t, virtual: false, entryId: x.entryId, entryAddedAt: x.entryAddedAt } : x;
  }))), []);
  return [tracks, setTracks];
}
