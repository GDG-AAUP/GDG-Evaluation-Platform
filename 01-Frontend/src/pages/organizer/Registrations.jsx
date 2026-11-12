import { useState } from 'react';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { CAMPUS, ROLE_LABEL } from '../../lib/constants.js';
import { fmtDateTime } from '../../lib/format.js';
import { registrationsApi } from '../../services/index.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { Dialog, DialogActions } from '../../components/ui/Dialog.jsx';
import { Field, Select } from '../../components/ui/Form.jsx';
import { Avatar, Button, Card, PageHeader } from '../../components/ui/Primitives.jsx';
import { Async } from '../../components/ui/States.jsx';
import { tr } from '../../i18n/index.js';

const announce = () => window.dispatchEvent(new Event(registrationsApi.CHANGED_EVENT));

/** Pending self-registration requests: approve with a role, campus and team, or reject. */
export default function Registrations() {
  const state = useAsync(() => registrationsApi.listPending(), []);
  const [dlg, setDlg] = useState(null);
  const close = () => setDlg(null);
  const done = () => { announce(); state.reload({ silent: true }); };

  const columns = [
    {
      title: tr('الاسم'), sort: (r) => r.name,
      render: (r) => (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Avatar name={r.name} />
          <div>{r.name}<div className="sub" dir="ltr" style={{ textAlign: 'start' }}>{r.email}</div></div>
        </div>
      ),
    },
    { title: tr('تاريخ الطلب'), sort: (r) => r.requestedAt, render: (r) => fmtDateTime(r.requestedAt) },
    {
      title: tr('إجراءات'),
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button small variant="primary" icon="user-check" onClick={() => setDlg({ type: 'approve', r })}>{tr('قبول')}</Button>
          <Button small variant="danger" icon="user-off" onClick={() => setDlg({ type: 'reject', r })}>{tr('رفض')}</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={tr('طلبات الانضمام المعلقة')} subtitle={tr('راجع طلبات التسجيل الجديدة: اقبلها مع تعيين الدور والحرم والفريق، أو ارفضها')} crumb={tr('طلبات الانضمام')} />
      <Card>
        <Async state={state}>
          {(rows) => <DataTable columns={columns} rows={rows} searchText={(r) => `${r.name} ${r.email}`} emptyTitle={tr('لا توجد طلبات انضمام معلقة')} />}
        </Async>
      </Card>
      {dlg?.type === 'approve' && <ApproveDialog request={dlg.r} onDone={done} onClose={close} />}
      {dlg?.type === 'reject' && <RejectDialog request={dlg.r} onDone={done} onClose={close} />}
    </>
  );
}

function ApproveDialog({ request, onDone, onClose }) {
  const { meta } = useAppData();
  const toast = useToast();
  const [f, setF] = useState({ role: 'member', campus: 'jenin', teamId: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => { setF((s) => ({ ...s, [k]: v, ...(k === 'campus' ? { teamId: '' } : {}) })); setErr(''); };
  const needsTeam = f.role !== 'organizer';
  const teams = (meta ? meta.teams : []).filter((t) => t.campus === f.campus && t.status !== 'deleted');

  const save = async () => {
    if (needsTeam && !f.teamId) { setErr(tr('الفريق إلزامي للمدير والعضو.')); return; }
    setBusy(true); setErr('');
    try {
      const res = await registrationsApi.approve(request.id, needsTeam ? f : { role: 'organizer' });
      toast.success(res && res.emailStatus === 'sent' ? tr('تم قبول الطلب وإرسال بريد التأكيد') : tr('تم قبول الطلب؛ تعذّر إرسال البريد'));
      onDone(); onClose();
    } catch (e) {
      setErr(e.message); setBusy(false);
    }
  };

  return (
    <Dialog title={tr('قبول طلب الانضمام')} onClose={onClose}>
      <p className="sub" style={{ marginTop: 0 }}>{request.name} · <span dir="ltr">{request.email}</span></p>
      <Field label={tr('الدور')}>
        {(id) => <Select id={id} value={f.role} onChange={set('role')} options={Object.entries(ROLE_LABEL).map(([v, l]) => [v, tr(l)])} />}
      </Field>
      <div className="row2">
        <Field label={needsTeam ? tr('الحرم') : tr('الحرم (اختياري)')}>
          {(id) => <Select id={id} value={f.campus} onChange={set('campus')} options={Object.entries(CAMPUS).map(([v, l]) => [v, tr(l)])} />}
        </Field>
        <Field label={tr('الفريق')}>
          {(id) => needsTeam
            ? <Select id={id} value={f.teamId} onChange={set('teamId')} options={[['', tr('اختر الفريق')], ...teams.map((t) => [t.id, t.name])]} />
            : <p className="hint" id={id}>{tr('المنظّم لا يتبع فريقًا محددًا.')}</p>}
        </Field>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <DialogActions>
        <Button variant="primary" onClick={save} disabled={busy}>{tr('قبول')}</Button>
        <Button onClick={onClose}>{tr('إلغاء')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function RejectDialog({ request, onDone, onClose }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr('');
    try {
      await registrationsApi.reject(request.id, reason);
      toast.success(tr('تم رفض الطلب'));
      onDone(); onClose();
    } catch (e) {
      setErr(e.message); setBusy(false);
    }
  };
  return (
    <Dialog title={tr('رفض طلب الانضمام')} onClose={onClose}>
      <p className="sub" style={{ marginTop: 0 }}>{request.name} · <span dir="ltr">{request.email}</span></p>
      <div className="f">
        <label htmlFor="rjr">{tr('سبب الرفض (اختياري)')}</label>
        <textarea id="rjr" value={reason} maxLength={1000} placeholder={tr('يُرسل السبب إلى صاحب الطلب في بريد الرفض')} onChange={(e) => { setReason(e.target.value); setErr(''); }} />
        {err && <p className="err" role="alert">{err}</p>}
      </div>
      <DialogActions>
        <Button variant="danger" onClick={go} disabled={busy}>{tr('رفض')}</Button>
        <Button onClick={onClose}>{tr('إلغاء')}</Button>
      </DialogActions>
    </Dialog>
  );
}
