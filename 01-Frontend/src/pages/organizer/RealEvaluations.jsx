import { useState } from 'react';
import { tr } from '../../i18n/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useToast } from '../../context/ToastContext.jsx';
import { evalApi } from '../../services/index.js';
import { weightedManagerScore } from '../../services/backend/adapters.js';
import { monthLabel } from '../../lib/format.js';
import { CAMPUS } from '../../lib/constants.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { Dialog, DialogActions } from '../../components/ui/Dialog.jsx';
import { Field } from '../../components/ui/Form.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { Banner, Button, Card, PageHeader } from '../../components/ui/Primitives.jsx';
import { Async } from '../../components/ui/States.jsx';

const todayIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function NewEvaluation({ manager, criteria, onDone, onClose }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayIso());
  const [vals, setVals] = useState(criteria.map(() => ''));
  const [comments, setComments] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const nums = vals.map((v) => (v === '' ? NaN : Number(v)));
  const scoresOk = nums.every((v) => Number.isInteger(v) && v >= 0 && v <= 100);
  const nameOk = name.trim().length > 0 && name.trim().length <= 150;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date);

  const submit = async () => {
    if (!nameOk || !dateOk || !scoresOk) { setErr(tr('أكمل الحقول: اسم التقييم، التاريخ، و4 درجات من 0 إلى 100.')); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await evalApi.createManagerEvaluation({ managerId: manager.id, activityName: name, activityDate: date, scores: nums, comments });
      toast.success(tr('تم حفظ التقييم. النتيجة المرجّحة: {n}', { n: res.total }));
      onDone();
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Dialog title={tr('تقييم {name}', { name: manager.name })} onClose={onClose}>
      <Field label={tr('اسم التقييم')}>
        {(id) => <input id={id} type="text" maxLength={150} placeholder={tr('مثال: تقييم أداء تشرين الأول')} value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} />}
      </Field>
      <Field label={tr('تاريخ التقييم')}>
        {(id) => <input id={id} type="date" dir="ltr" value={date} onChange={(e) => { setDate(e.target.value); setErr(''); }} />}
      </Field>
      {criteria.map((c, i) => (
        <Field key={c.id} label={`${tr(c.label)} (${c.weight}%)`}>
          {(id) => <input id={id} type="number" min="0" max="100" step="1" placeholder={tr('0-100')} value={vals[i]} onChange={(e) => { const n = [...vals]; n[i] = e.target.value; setVals(n); setErr(''); }} />}
        </Field>
      ))}
      <Field label={tr('ملاحظات (اختياري)')}>
        {(id) => <textarea id={id} rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />}
      </Field>
      <div className="banner b" style={{ marginBottom: 10 }}>
        <Icon name="calculator" /><span>{tr('النتيجة المرجّحة:')} <b>{scoresOk ? weightedManagerScore(nums) : '—'}</b></span>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <DialogActions>
        <Button variant="primary" disabled={busy} onClick={submit}>{tr('حفظ التقييم')}</Button>
        <Button onClick={onClose}>{tr('إلغاء')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Manager evaluation with the real backend (POST /api/evaluations/managers, GET .../average).
 * The 4 criteria and their weights are fixed by the backend; every evaluation is a new record and
 * the monthly average is computed by the server. Draft/approve and editable criteria exist only in the mock.
 */
export default function RealEvaluations() {
  const [tick, setTick] = useState(0);
  const [target, setTarget] = useState(null);
  const state = useAsync(() => evalApi.getManagerEvaluations(), [tick]);

  return (
    <>
      <PageHeader title={tr('تقييم المدراء')} subtitle={tr('كل تقييم جديد يُسجَّل ولا يُعدَّل، ويُحسب المتوسط الشهري تلقائيًا.')} />
      <Async state={state}>
        {(data) => (
          <>
            <Banner icon="info">
              {tr('المعايير ثابتة من النظام:')} {data.criteria.map((c) => `${tr(c.label)} ${c.weight}%`).join(' · ')}
            </Banner>
            <Card>
              <DataTable
                columns={[
                  { title: tr('المدير'), sort: (r) => r.name, render: (r) => <b>{r.name}</b> },
                  { title: tr('الفريق'), render: (r) => [r.campus ? tr(CAMPUS[r.campus]) : '', r.teamsLabel].filter(Boolean).join(' · ') || '—' },
                  { title: tr('تقييمات {month}', { month: monthLabel(data.month) }), sort: (r) => r.count, render: (r) => (r.error ? <span className="err">{r.error}</span> : r.count) },
                  { title: tr('المتوسط'), sort: (r) => r.average ?? -1, render: (r) => (r.average == null ? '—' : <b dir="ltr">{r.average}</b>) },
                  { title: '', render: (r) => <Button small variant="primary" onClick={() => setTarget(r)}>{tr('تقييم جديد')}</Button> },
                ]}
                rows={data.rows}
                searchText={(r) => `${r.name} ${r.teamsLabel}`}
                emptyTitle={tr('لا يوجد مدراء فعّالون')}
              />
            </Card>
            {target && <NewEvaluation manager={target} criteria={data.criteria} onDone={() => setTick((t) => t + 1)} onClose={() => setTarget(null)} />}
          </>
        )}
      </Async>
    </>
  );
}
