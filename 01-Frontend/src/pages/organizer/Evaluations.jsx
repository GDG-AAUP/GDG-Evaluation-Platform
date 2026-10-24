import { useState } from 'react';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { monthLabel } from '../../lib/format.js';
import { evalApi } from '../../services/index.js';
import { Badge } from '../../components/ui/Badges.jsx';
import { ConfirmDialog, Dialog, DialogActions } from '../../components/ui/Dialog.jsx';
import { Field, Segmented } from '../../components/ui/Form.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { Banner, Button, Card, Grid, Note, PageHeader } from '../../components/ui/Primitives.jsx';
import { Async, EmptyState } from '../../components/ui/States.jsx';

const weightedOf = (criteria, s) => Math.round(s.reduce((a, v, i) => a + v * (criteria[i] ? criteria[i].w : 0), 0) / 100);

function EvalDialog({ managerId, onDone, onClose }) {
  const toast = useToast();
  const state = useAsync(() => evalApi.getEvaluation(managerId), [managerId]);
  const [vals, setVals] = useState(null);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const d = state.data;
  const cur = vals || (d && d.scores ? d.scores.map(String) : d ? d.criteria.map(() => '') : []);
  const nums = cur.map((v) => (v === '' ? NaN : Number(v)));
  const valid = d && nums.every((v) => Number.isInteger(v) && v >= 0 && v <= 100);
  const lock = d && d.status === 'approved';

  const save = async (approve) => {
    if (!valid) { setErr('أدخل درجة صحيحة من 0 إلى 100 لكل معيار.'); return; }
    try {
      await evalApi.saveEvaluation(managerId, nums, approve);
      toast.success(approve ? 'تم اعتماد التقييم' : 'تم حفظ المسودة');
      onDone();
      onClose();
    } catch (e) { setErr(e.message); throw e; }
  };

  return (
    <Dialog title={d ? `تقييم ${d.manager.name}` : 'تقييم'} onClose={onClose}>
      {state.error && <p className="err" role="alert">{state.error.message}</p>}
      {d && (
        <>
          {d.criteria.map((c, i) => (
            <Field key={c.n} label={`${c.n} (${c.w}%)`}>
              {(id) => <input id={id} type="number" min="0" max="100" placeholder="0-100" disabled={lock} value={cur[i]} onChange={(e) => { const n = [...cur]; n[i] = e.target.value; setVals(n); setErr(''); }} />}
            </Field>
          ))}
          <div className="banner b" style={{ marginBottom: 10 }}><Icon name="calculator" /><span>النتيجة المرجّحة: <b>{valid ? weightedOf(d.criteria, nums) : '—'}</b></span></div>
          {lock && <p className="hint">التقييم معتمد ومقفل.</p>}
          {err && <p className="err" role="alert">{err}</p>}
          <DialogActions>
            {lock ? <Button onClick={onClose}>إغلاق</Button> : (
              <>
                <Button onClick={() => save(false).catch(() => {})}>حفظ كمسودة</Button>
                <Button variant="primary" onClick={() => (valid ? setConfirm(true) : setErr('أدخل درجة صحيحة من 0 إلى 100 لكل معيار.'))}>اعتماد</Button>
                <Button onClick={onClose}>إلغاء</Button>
              </>
            )}
          </DialogActions>
          {confirm && (
            <ConfirmDialog
              title="اعتماد التقييم" confirmLabel="اعتماد" onClose={() => setConfirm(false)}
              message={<>بعد الاعتماد يُقفل تقييم <b>{d.manager.name}</b> ولا يمكن تعديله.</>}
              onConfirm={() => save(true)}
            />
          )}
        </>
      )}
    </Dialog>
  );
}

function CriteriaDialog({ criteria, onDone, onClose }) {
  const toast = useToast();
  const [rows, setRows] = useState(criteria.map((c) => ({ n: c.n, w: String(c.w) })));
  const [err, setErr] = useState('');
  const upd = (i, k, v) => { setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x))); setErr(''); };
  const save = async () => {
    try { await evalApi.setCriteria(rows.map((r) => ({ n: r.n, w: Number(r.w) }))); toast.success('تم حفظ المعايير'); onDone(); onClose(); } catch (e) { setErr(e.message); }
  };
  return (
    <Dialog title="معايير التقييم" onClose={onClose}>
      {rows.map((r, i) => (
        <div className="row2" key={i} style={{ gridTemplateColumns: '2fr 1fr' }}>
          <Field label={`المعيار ${i + 1}`}>{(id) => <input id={id} type="text" value={r.n} onChange={(e) => upd(i, 'n', e.target.value)} />}</Field>
          <Field label="الوزن %">{(id) => <input id={id} type="number" min="0" max="100" value={r.w} onChange={(e) => upd(i, 'w', e.target.value)} />}</Field>
        </div>
      ))}
      <p className="hint">يجب أن يساوي مجموع الأوزان 100.</p>
      {err && <p className="err" role="alert">{err}</p>}
      <DialogActions><Button variant="primary" onClick={save}>حفظ</Button><Button onClick={onClose}>إلغاء</Button></DialogActions>
    </Dialog>
  );
}

export default function Evaluations() {
  const { reload: reloadMeta } = useAppData();
  const [campus, setCampus] = useState('jenin');
  const state = useAsync(() => evalApi.getEvaluations(campus), [campus]);
  const [dlg, setDlg] = useState(null);
  const done = () => { state.reload({ silent: true }); reloadMeta().catch(() => {}); };

  return (
    <>
      <PageHeader
        title="تقييم المديرين الإداري" crumb="تقييم المديرين"
        subtitle={state.data ? `تقييم شهر ${monthLabel(state.data.period)} منفصل لكل حرم` : 'تقييم شهري منفصل لكل حرم'}
        actions={<Button icon="list" onClick={() => setDlg({ type: 'crit' })}>تعديل المعايير</Button>}
      />
      <Banner icon="info">تقييم المديرين منفصل عن ترتيب الأعضاء ولا يُخلط به.</Banner>
      <Segmented style={{ marginBottom: 12 }} value={campus} onChange={setCampus} options={[['jenin', 'مديرو جنين'], ['ramallah', 'مديرو رام الله']]} />
      <Async state={state}>
        {(d) => (
          <>
            <Grid two>
              <Card>
                <h3>ترتيب المديرين</h3>
                {d.rows.length === 0 ? <EmptyState icon="manager" title="لا يوجد مديرون في هذا الحرم" text="أضف مديرًا من صفحة المديرين." /> : d.rows.map((r, i) => (
                  <div className="le" key={r.managerId}>
                    <span className="rk" style={{ width: 24, fontWeight: 500 }}>{r.score == null ? '—' : i + 1}</span>
                    <div style={{ flex: 1 }}><b>{r.name}</b><div className="sub">{r.teamsLabel}</div></div>
                    <div style={{ textAlign: 'end' }}>
                      <b style={{ fontSize: 18 }}>{r.score == null ? '—' : r.score}</b>
                      <div>{r.status === 'approved' ? <Badge tone="g">معتمد</Badge> : r.status === 'draft' ? <Badge tone="y">مسودة</Badge> : <Badge tone="n">غير مقيَّم</Badge>}</div>
                    </div>
                    <Button small onClick={() => setDlg({ type: 'eval', id: r.managerId })}>{r.status === 'approved' ? 'عرض' : 'تقييم'}</Button>
                  </div>
                ))}
              </Card>
              <Card>
                <h3>المعايير والأوزان</h3>
                {d.criteria.map((c) => <div className="le" key={c.n}><span style={{ flex: 1 }}>{c.n}</span><b>{c.w}%</b></div>)}
                <Note>المعايير مبدئية إلى أن تعتمد الإدارة المعايير النهائية.</Note>
              </Card>
            </Grid>
            {dlg && dlg.type === 'crit' && <CriteriaDialog criteria={d.criteria} onDone={done} onClose={() => setDlg(null)} />}
          </>
        )}
      </Async>
      {dlg && dlg.type === 'eval' && <EvalDialog managerId={dlg.id} onDone={done} onClose={() => setDlg(null)} />}
    </>
  );
}
