import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Icon from '../components/ui/Icon.jsx';

const Ctx = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const n = useRef(0);

  const push = useCallback((msg, type = 'ok') => {
    const id = ++n.current;
    setItems((l) => [...l, { id, msg, type }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), 3200);
  }, []);

  const value = useMemo(() => ({
    success: (m) => push(m, 'ok'),
    error: (m) => push(typeof m === 'string' ? m : (m && m.message) || 'حدث خطأ غير متوقع.', 'er'),
  }), [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div id="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} role="status">
            <Icon name={t.type === 'er' ? 'alert' : 'circle-check'} />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
