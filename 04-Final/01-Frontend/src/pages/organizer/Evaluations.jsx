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
import { tr } from '../../i18n/index.js';

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
    if (!valid) { setErr(tr('أدخل درجة صحيحة من 0 إلى 100 لكل معيار.')); return; }
    try {
      await evalApi.saveEvaluation(managerId, nums, approve);
      toast.success(approve ? tr('تم اعتماد التقييم') : tr('تم حفظ المسودة'));
      onDone();
      onClose();
    } catch (e) { setErr(e.message); throw e; }
  };

  return (
    <Dialog title={d ? tr('تقييم {name}', { name: d.manager.name }) : tr('تقييم')} onClose={onClose}>
      {state.error && <p className="err" role="alert">{state.error.message}</p>}
      {d && (
        <>
          {d.criteria.map((c, i) => (
            <Field key={c.n} label={`${tr(c.n)} (${c.w}%)`}>
              {(id) => <input id={id} type="number" min="0" max="100" placeholder={tr("0-100")} disabled={lock} value={cur[i]} onChange={(e) => { const n = [...cur]; n[i] = e.target.value; setVals(n); setErr(''); }} />}
            </Field>
          ))}
          <div className="banner b" style={{ marginBottom: 10 }}><Icon name="calculator" /><span>{tr("النتيجة المرجّحة:")} <b>{valid ? weightedOf(d.criteria, nums) : '—'}</b></span></div>
          {lock && <p className="hint">{tr("التقييم معتمد ومقفل.")}</p>}
          {err && <p className="err" role="alert">{err}</p>}
          <DialogActions>
            {lock ? <Button onClick={onClose}>{tr('إغلاق')}</Button> : (
              <>
                <Button onClick={() => save(false).catch(() => {})}>{tr('حفظ كمسودة')}</Button>
                <Button variant="primary" onClick={() => (valid ? setConfirm(true) : setErr(tr('أدخل درجة صحيحة من 0 إلى 100 لكل معيار.')))}>{tr('اعتماد')}</Button>
                <Button onClick={onClose}>{tr('إلغاء')}</Button>
              </>
            )}
          </DialogActions>
          {confirm && (
            <ConfirmDialog
              title={tr("اعتماد التقييم")} confirmLabel={tr("اعتماد")} onClose={() => setConfirm(false)}
              message={<>{tr('بعد الاعتماد يُقفل تقييم {name} ولا يمكن تعديله.', { name: '\u0000' }).split('\u0000')[0]}<b>{d.manager.name}</b>{tr('بعد الاعتماد يُقفل تقييم {name} ولا يمكن تعديله.', { name: '\u0000' }).split('\u0000')[1]}</>}
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
    try { await evalApi.setCriteria(rows.map((r) => ({ n: r.n, w: Number(r.w) }))); toast.success(tr('تم حفظ المعايير')); onDone(); onClose(); } catch (e) { setErr(e.message); }
  };
  return (
    <Dialog title={tr("معايير التقييم")} onClose={onClose}>
      {rows.map((r, i) => (
        <div className="row2" key={i} style={{ gridTemplateColumns: '2fr 1fr' }}>
          <Field label={tr('المعيار {n}', { n: i + 1 })}>{(id) => <input id={id} type="text" value={r.n} onChange={(e) => upd(i, 'n', e.target.value)} />}</Field>
          <Field label={tr("الوزن %")}>{(id) => <input id={id} type="number" min="0" max="100" value={r.w} onChange={(e) => upd(i, 'w', e.target.value)} />}</Field>
        </div>
      ))}
      <p className="hint">{tr("يجب أن يساوي مجموع الأوزان 100.")}</p>
      {err && <p className="err" role="alert">{err}</p>}
      <DialogActions><Button variant="primary" onClick={save}>{tr("حفظ")}</Button><Button onClick={onClose}>{tr("إلغاء")}</Button></DialogActions>
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
        title={tr("تقييم المديرين الإداري")} crumb={tr("تقييم المديرين")}
        subtitle={state.data ? tr('تقييم شهر {month} منفصل لكل حرم', { month: monthLabel(state.data.period) }) : tr('تقييم شهري منفصل لكل حرم')}
        actions={<Button icon="list" onClick={() => setDlg({ type: 'crit' })}>{tr("تعديل المعايير")}</Button>}
      />
      <Banner icon="info">{tr("تقييم المديرين منفصل عن ترتيب الأعضاء ولا يُخلط به.")}</Banner>
      <Segmented style={{ marginBottom: 12 }} value={campus} onChange={setCampus} options={[['jenin', tr('مديرو جنين')], ['ramallah', tr('مديرو رام الله')]]} />
      <Async state={state}>
        {(d) => (
          <>
            <Grid two>
              <Card>
                <h3>{tr("ترتيب المديرين")}</h3>
                {d.rows.length === 0 ? <EmptyState icon="manager" title={tr("لا يوجد مديرون في هذا الحرم")} text={tr("أضف مديرًا من صفحة المديرين.")} /> : d.rows.map((r, i) => (
                  <div className="le" key={r.managerId}>
                    <span className="rk" style={{ width: 24, fontWeight: 500 }}>{r.score == null ? '—' : i + 1}</span>
                    <div style={{ flex: 1 }}><b>{r.name}</b><div className="sub">{r.teamsLabel}</div></div>
                    <div style={{ textAlign: 'end' }}>
                      <b style={{ fontSize: 18 }}>{r.score == null ? '—' : r.score}</b>
                      <div>{r.status === 'approved' ? <Badge tone="g">{tr('معتمد')}</Badge> : r.status === 'draft' ? <Badge tone="y">{tr('مسودة')}</Badge> : <Badge tone="n">{tr('غير مقيَّم')}</Badge>}</div>
                    </div>
                    <Button small onClick={() => setDlg({ type: 'eval', id: r.managerId })}>{r.status === 'approved' ? tr('عرض') : tr('تقييم')}</Button>
                  </div>
                ))}
              </Card>
              <Card>
                <h3>{tr("المعايير والأوزان")}</h3>
                {d.criteria.map((c) => <div className="le" key={c.n}><span style={{ flex: 1 }}>{tr(c.n)}</span><b>{c.w}%</b></div>)}
                <Note>{tr("المعايير مبدئية إلى أن تعتمد الإدارة المعايير النهائية.")}</Note>
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
