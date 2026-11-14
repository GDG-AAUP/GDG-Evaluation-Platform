import { subscribeDb } from '../services/mock/db.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_POLICIES } from '../lib/constants.js';
import { metaApi } from '../services/index.js';
import { useAuth } from './AuthContext.jsx';

// Reference data every page needs: policy flags (management decisions),
// months, teams and evaluation criteria. Re-fetched with reload() after changes.
const Ctx = createContext(null);

export function AppDataProvider({ children }) {
  const { user } = useAuth();
  const [policies, setPolicies] = useState(DEFAULT_POLICIES);
  const [meta, setMeta] = useState(null);

  const reload = useCallback(async () => {
    const [p, m] = await Promise.all([metaApi.getPolicies(), metaApi.getMeta()]);
    setPolicies(p);
    setMeta(m);
  }, []);

  useEffect(() => {
    if (!user) { setMeta(null); return; }
    reload().catch(() => {});
  }, [user, reload]);

  useEffect(() => subscribeDb(() => { if (user) reload().catch(() => {}); }), [user, reload]);
  const value = useMemo(() => ({ policies, meta, reload, setPolicies }), [policies, meta, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAppData = () => useContext(Ctx);
export const usePolicies = () => useContext(Ctx).policies;
