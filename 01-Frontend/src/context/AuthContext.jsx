import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, devApi, setUnauthorizedHandler } from '../services/index.js';
import { USE_MOCK } from '../config.js';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let alive = true;
    authApi.currentUser()
      .then((u) => { if (alive) setUser(u); })
      .catch(() => {})
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  // Any 401 from the API (real or simulated) opens the "session expired" dialog.
  useEffect(() => setUnauthorizedHandler(() => setExpired(true)), []);

  const login = useCallback(async (email, password) => {
    const u = await authApi.login(email, password);
    setExpired(false);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    if (USE_MOCK) devApi.resetSimulation();
    setExpired(false);
    setUser(null);
  }, []);

  const demoSwitch = useCallback(async (role) => {
    devApi.demoLogin(role);
    setExpired(false);
    setUser(await authApi.currentUser());
  }, []);

  const value = useMemo(
    () => ({ user, ready, expired, login, logout, demoSwitch }),
    [user, ready, expired, login, logout, demoSwitch],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
