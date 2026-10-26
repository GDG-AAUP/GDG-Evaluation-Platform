import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { Button } from './Primitives.jsx';
import { tr } from '../../i18n/index.js';

/** Modal dialog: Escape + backdrop close, focus moved inside, focus restored on close. */
export function Dialog({ title, onClose, children, wide, sticky }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const first = ref.current && ref.current.querySelector('input:not([type=hidden]),select,textarea,button.btn-p');
    const t = setTimeout(() => { try { first && first.focus(); } catch { /* ignore */ } }, 30);
    const onKey = (e) => { if (e.key === 'Escape' && !sticky) onClose();
      if(e.key==='Tab'&&ref.current){const nodes=[...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary')].filter(el=>el.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}
    };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); try { prev && prev.focus && prev.focus(); } catch { /* ignore */ } };
  }, [onClose, sticky]);

  return createPortal(
    <div className="ov" onMouseDown={(e) => { if (e.target === e.currentTarget && !sticky) onClose(); }}>
      <div className={`dlg${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="dh">
          <h3>{title}</h3>
          {!sticky && <button type="button" className="ib" aria-label={tr('إغلاق')} onClick={onClose}><Icon name="x" /></button>}
        </div>
        <div className="db">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export const DialogActions = ({ children }) => <div className="da">{children}</div>;

/** Confirmation. onConfirm may be async; an error is shown inline. */
export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await onConfirm(); onClose(); } catch (e) { setErr(tr(e.message)); setBusy(false); }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <p style={{ margin: '0 0 4px' }}>{message}</p>
      {err && <p className="err" role="alert">{err}</p>}
      <DialogActions>
        <Button variant={danger ? 'danger' : 'primary'} onClick={go} disabled={busy}>{confirmLabel}</Button>
        <Button onClick={onClose}>{tr('إلغاء')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Confirmation that also requires a written reason (audit trail). */
export function ReasonDialog({ title, description, confirmLabel, danger, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    if (!reason.trim()) { setErr(tr('السبب إلزامي لهذه العملية.')); return; }
    setBusy(true); setErr('');
    try { await onConfirm(reason.trim()); onClose(); } catch (e) { setErr(tr(e.message)); setBusy(false); }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      {description && <div style={{ margin: '0 0 10px', color: 'var(--tx2)' }}>{description}</div>}
      <div className="f">
        <label htmlFor="rsn">{tr('السبب (إلزامي)')}</label>
        <textarea id="rsn" value={reason} placeholder={tr('اكتب سببًا واضحًا للعملية')} onChange={(e) => { setReason(e.target.value); setErr(''); }} />
        {err && <p className="err" role="alert">{err}</p>}
      </div>
      <DialogActions>
        <Button variant={danger ? 'danger' : 'primary'} onClick={go} disabled={busy}>{confirmLabel}</Button>
        <Button onClick={onClose}>{tr('إلغاء')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Info dialog with a single OK button. */
export function MessageDialog({ title, children, onClose, label = tr('حسنًا') }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div style={{ margin: 0 }}>{children}</div>
      <DialogActions><Button variant="primary" onClick={onClose}>{label}</Button></DialogActions>
    </Dialog>
  );
}
