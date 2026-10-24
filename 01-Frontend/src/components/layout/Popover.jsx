import { useEffect, useRef, useState } from 'react';

/** Header popover: `trigger(open, toggle)` renders the button; content shown below it. */
export default function Popover({ trigger, children, id }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="pw" ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      <div className={`pop${open ? ' show' : ''}`} id={id}>{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>
    </div>
  );
}
