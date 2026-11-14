import { subscribeDb } from '../services/mock/db.js';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data with loading / error state and safe handling of stale responses.
 *   const s = useAsync(() => api.get(x), [x]);
 *   s.data, s.loading, s.error, s.reload({silent}), s.setData
 */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const token = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(({ silent = false } = {}) => {
    const my = ++token.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    return fnRef.current().then(
      (data) => { if (my === token.current) setState({ data, error: null, loading: false }); },
      (error) => { if (my === token.current) setState((s) => ({ data: silent ? s.data : null, error, loading: false })); },
    );
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); return () => { token.current += 1; }; }, deps);

  useEffect(() => subscribeDb(() => run({ silent: true })), [run]);

  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);
  return { ...state, reload: run, setData };
}
