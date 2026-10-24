import { useMemo, useState } from 'react';
import { usePolicies } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { CAMPUS } from '../../lib/constants.js';
import { parsePoints } from '../../lib/format.js';
import { pointsApi } from '../../services/index.js';
import { Dialog, DialogActions } from '../ui/Dialog.jsx';
import { Field } from '../ui/Form.jsx';
import Icon from '../ui/Icon.jsx';
import { Button } from '../ui/Primitives.jsx';

/** Add / subtract points (mandatory reason, live preview of the new total). */
export default function LegacyPointsDialog({ preUserId, onDone, onClose }) {
  const toast = useToast();
  const { maxPointsPerOperation: max } = usePolicies();
  const members = useAsync(() => pointsApi.getAssignableMembers(), []);
  const [userId, setUserId] = useState(preUserId || '');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const list = members.data || [];
  const selId = userId || (list[0] && list[0].id) || '';
  const sel = list.find((m) => m.id === selId);
  const val = parsePoints(value);

  const groups = useMemo(() => {
    const g = new Map();
    list.forEach((m) => {
      const k = `${CAMPUS[m.campus]} · ${m.teamsLabel}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(m);
    });
    return [...g.entries()];
  }, [list]);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await pointsApi.addPoints({ userId: selId, value: val, reason });
      toast.success('تمت إضافة النقاط');
      onDone && onDone();
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Dialog title="إضافة نقاط للسجل القديم" onClose={onClose}>
      {members.error && <p className="err" role="alert">{members.error.message}</p>}
      <Field label="العضو">
        {(id) => (
          <select id={id} value={selId} onChange={(e) => { setUserId(e.target.value); setErr(''); }}>
            {groups.length > 1 || (groups.length === 1 && list.length > 8)
              ? groups.map(([k, ms]) => <optgroup key={k} label={k}>{ms.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>)
              : list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </Field>
      <Field label="النقاط" hint={`الحد الأقصى للعملية: ${max} نقطة`}>
        {(id) => <input id={id} type="text" inputMode="numeric" placeholder="مثال: 10 أو -5" dir="ltr" style={{ textAlign: 'start' }} value={value} onChange={(e) => { setValue(e.target.value); setErr(''); }} />}
      </Field>
      <div className="banner b" style={{ marginBottom: 12 }}>
        <Icon name="calculator" />
        <span>{sel && !Number.isNaN(val) ? `المجموع الحالي ${sel.total} ← المجموع الجديد ${sel.total + val}` : 'أدخل قيمة لمعاينة المجموع الجديد'}</span>
      </div>
      <Field label="السبب (إلزامي)">
        {(id) => <textarea id={id} placeholder="مثال: حضور ورشة Flutter" value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} />}
      </Field>
      {err && <p className="err" role="alert">{err}</p>}
      <DialogActions>
        <Button variant="primary" onClick={save} disabled={busy || members.loading}>تأكيد</Button>
        <Button onClick={onClose}>إلغاء</Button>
      </DialogActions>
    </Dialog>
  );
}
