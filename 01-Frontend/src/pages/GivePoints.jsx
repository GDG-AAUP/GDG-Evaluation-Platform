import { useState } from 'react';
import { tr } from '../i18n/index.js';
import { useAsync } from '../hooks/useAsync.js';
import { useToast } from '../context/ToastContext.jsx';
import { pointsApi } from '../services/index.js';
import { CAMPUS } from '../lib/constants.js';
import DataTable from '../components/ui/DataTable.jsx';
import { Dialog, DialogActions } from '../components/ui/Dialog.jsx';
import { Field } from '../components/ui/Form.jsx';
import { Button, Card, PageHeader } from '../components/ui/Primitives.jsx';
import { Async } from '../components/ui/States.jsx';

function PointsForm({ member, onDone, onClose }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [activity, setActivity] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const n = Number(value);
  const valueOk = value !== '' && Number.isInteger(n) && n !== 0 && Math.abs(n) <= 100;
  const ok = valueOk && activity.trim().length > 0 && reason.trim().length > 0;

  const submit = async () => {
    if (!ok) { setErr(tr('أدخل نقاطًا صحيحة (من -100 إلى 100، بدون صفر) واسم النشاط والسبب.')); return; }
    setBusy(true);
    setErr('');
    try {
      await pointsApi.addPoints({ userId: member.id, value: n, reason, activity });
      toast.success(tr('تمت إضافة النقاط'));
      onDone();
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Dialog title={tr('إضافة نقاط: {name}', { name: member.name })} onClose={onClose}>
      <Field label={tr('النقاط (من -100 إلى 100، بدون صفر)')}>
        {(id) => <input id={id} type="number" min="-100" max="100" step="1" dir="ltr" value={value} onChange={(e) => { setValue(e.target.value); setErr(''); }} />}
      </Field>
      <Field label={tr('اسم النشاط')}>
        {(id) => <input id={id} type="text" maxLength={100} placeholder={tr('مثال: ورشة عمل')} value={activity} onChange={(e) => { setActivity(e.target.value); setErr(''); }} />}
      </Field>
      <Field label={tr('السبب')}>
        {(id) => <textarea id={id} rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} />}
      </Field>
      {err && <p className="err" role="alert">{err}</p>}
      <DialogActions>
        <Button variant="primary" disabled={busy} onClick={submit}>{tr('إضافة')}</Button>
        <Button onClick={onClose}>{tr('إلغاء')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Give points with the real backend (POST /api/points). The organizer sees every active member,
 * a manager only the members of their own team (the server enforces the same rule).
 */
export default function GivePoints() {
  const [tick, setTick] = useState(0);
  const [target, setTarget] = useState(null);
  const state = useAsync(() => pointsApi.getAssignableMembers(), [tick]);

  return (
    <>
      <PageHeader title={tr('إضافة نقاط')} subtitle={tr('اختر عضوًا وسجّل نقاطه مع اسم النشاط والسبب. تظهر العملية في سجل التدقيق.')} />
      <Async state={state}>
        {(rows) => (
          <Card>
            <DataTable
              columns={[
                { title: tr('العضو'), sort: (r) => r.name, render: (r) => <b>{r.name}</b> },
                { title: tr('الحرم'), render: (r) => (r.campus ? tr(CAMPUS[r.campus]) : '—') },
                { title: tr('الفريق'), render: (r) => r.teamsLabel || '—' },
                { title: '', render: (r) => <Button small variant="primary" onClick={() => setTarget(r)}>{tr('إضافة نقاط')}</Button> },
              ]}
              rows={rows}
              searchText={(r) => `${r.name} ${r.teamsLabel}`}
              emptyTitle={tr('لا يوجد أعضاء متاحون لك')}
            />
            {target && <PointsForm member={target} onDone={() => setTick((t) => t + 1)} onClose={() => setTarget(null)} />}
          </Card>
        )}
      </Async>
    </>
  );
}
