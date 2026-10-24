import { useState } from 'react';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { CAMPUS } from '../../lib/constants.js';
import { fmtDateTime, monthLabel, nextMonth, parsePoints } from '../../lib/format.js';
import { archiveApi } from '../../services/index.js';
import { Badge } from '../../components/ui/Badges.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { ConfirmDialog, Dialog, DialogActions } from '../../components/ui/Dialog.jsx';
import { Field, FilterBar, Select } from '../../components/ui/Form.jsx';
import { Banner, Button, Card, Grid, Note, PageHeader, PointsBadge } from '../../components/ui/Primitives.jsx';
import { Async, EmptyState } from '../../components/ui/States.jsx';

function CorrectionDialog({ archived, members, onDone, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ month: archived.length ? archived[archived.length - 1].id : '', userId: members[0] ? members[0].id : '', value: '', reason: '' });
  const [err, setErr] = useState('');
  const set = (k) => (v) => { setF((s) => ({ ...s, [k]: v })); setErr(''); };
  const save = async () => {
    try {
      await archiveApi.addCorrection({ ...f, value: parsePoints(f.value) });
      toast.success('تم تسجيل التصحيح');
      onDone(); onClose();
    } catch (e) { setErr(e.message); }
  };
  return (
    <Dialog title="تصحيح متأخر" onClose={onClose}>
      <Field label="الشهر المؤرشف">{(id) => <Select id={id} value={f.month} onChange={set('month')} options={archived.map((m) => [m.id, monthLabel(m.id)])} />}</Field>
      <Field label="العضو">{(id) => <Select id={id} value={f.userId} onChange={set('userId')} options={members.map((u) => [u.id, `${u.name} — ${CAMPUS[u.campus]}`])} />}</Field>
      <Field label="النقاط">{(id) => <input id={id} type="text" dir="ltr" style={{ textAlign: 'start' }} inputMode="numeric" placeholder="مثال: 5 أو -5" value={f.value} onChange={(e) => set('value')(e.target.value)} />}</Field>
      <Field label="السبب (إلزامي)">{(id) => <textarea id={id} value={f.reason} onChange={(e) => set('reason')(e.target.value)} />}</Field>
      <p className="hint">لا تتغير لقطة الشهر المؤرشف، ويُسجَّل التصحيح كعملية منفصلة.</p>
      {err && <p className="err" role="alert">{err}</p>}
      <DialogActions><Button variant="primary" onClick={save}>حفظ التصحيح</Button><Button onClick={onClose}>إلغاء</Button></DialogActions>
    </Dialog>
  );
}

function Snapshot({ month }) {
  const { meta } = useAppData();
  const [f, setF] = useState({ campus: '', teamId: '' });
  const state = useAsync(() => archiveApi.getSnapshot(month, f), [month, f]);
  const teamOpts = [['', 'كل الفرق'], ...(meta ? meta.teams : []).filter((t) => !f.campus || t.campus === f.campus).map((t) => [t.id, `${CAMPUS[t.campus]} · ${t.name}`])];
  const columns = [
    { title: '#', sort: (r) => r.rank, render: (r) => r.rank },
    { title: 'العضو', sort: (r) => r.name, render: (r) => r.name },
    { title: 'الفريق', render: (r) => <>{r.teamName} <span className="sub">{CAMPUS[r.campus]}</span></> },
    { title: 'النقاط', sort: (r) => r.total, render: (r) => <><b>{r.total}</b>{r.tie && <> <Badge tone="n">تعادل</Badge></>}</> },
  ];
  return (
    <Card style={{ marginTop: 14 }}>
      <h3>لقطة {monthLabel(month)}</h3>
      <Banner icon="lock">لقطة ثابتة للقراءة فقط، ولا تتأثر بالشهر الحالي أو بالتصحيحات اللاحقة.</Banner>
      <FilterBar>
        <Select label="الحرم" value={f.campus} onChange={(v) => setF({ campus: v, teamId: '' })} options={[['', 'كل الحرمين'], ['jenin', 'جنين'], ['ramallah', 'رام الله']]} />
        <Select label="الفريق" value={f.teamId} onChange={(v) => setF((s) => ({ ...s, teamId: v }))} options={teamOpts} />
      </FilterBar>
      <Async state={state}>{(d) => <DataTable columns={columns} rows={d.rows.map((r) => ({ ...r, id: `${r.userId}-${r.teamId}` }))} searchText={(r) => r.name} emptyTitle="لا توجد نتائج" />}</Async>
    </Card>
  );
}

export default function Archive() {
  const toast = useToast();
  const { reload: reloadMeta } = useAppData();
  const state = useAsync(() => archiveApi.getArchive(), []);
  const [view, setView] = useState(null);
  const [dlg, setDlg] = useState(null);
  const done = () => { state.reload({ silent: true }); reloadMeta().catch(() => {}); };

  return (
    <>
      <PageHeader title="الأرشيف الشهري" subtitle="الأشهر المغلقة محفوظة كلقطات ثابتة ولا يُحذف شيء" crumb="الأرشيف الشهري" />
      <Async state={state}>
        {(d) => (
          <>
            <Grid two>
              <Card>
                <h3>الأشهر</h3>
                {d.months.map((m) => (
                  <div className="le" key={m.id}>
                    <div style={{ flex: 1 }}><b>{monthLabel(m.id)}</b> {m.status === 'open' ? <Badge tone="g">مفتوح</Badge> : <Badge tone="n">مؤرشف</Badge>}</div>
                    {m.status === 'open'
                      ? <Button small variant="primary" onClick={() => setDlg({ type: 'close' })}>إغلاق الشهر</Button>
                      : <Button small onClick={() => setView(m.id)}>عرض اللقطة</Button>}
                  </div>
                ))}
                <Note>الشهر الحالي: {monthLabel(d.curMonth)}. الإغلاق يحفظ اللقطة ويفتح الشهر التالي من الصفر.</Note>
              </Card>
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0 }}>التصحيحات المتأخرة</h3>
                  <Button small icon="plus" onClick={() => setDlg({ type: 'cor' })}>تصحيح</Button>
                </div>
                {d.corrections.length === 0 ? <EmptyState icon="edit-off" title="لا توجد تصحيحات" text="تُسجَّل هنا التعديلات على الأشهر المؤرشفة كعمليات منفصلة." /> : d.corrections.map((c) => (
                  <div className="le" key={c.id}>
                    <PointsBadge value={c.value} />
                    <div style={{ flex: 1 }}><b>{c.userName}</b> · {monthLabel(c.month)}<div>{c.reason}</div><div className="sub">{c.actorName} · {fmtDateTime(c.ts)}</div></div>
                    <Badge tone="y">تصحيح متأخر</Badge>
                  </div>
                ))}
              </Card>
            </Grid>
            {view && d.months.some((m) => m.id === view && m.status === 'archived') && <Snapshot month={view} />}
            {dlg && dlg.type === 'cor' && <CorrectionDialog archived={d.months.filter((m) => m.status === 'archived').reverse()} members={d.members} onDone={done} onClose={() => setDlg(null)} />}
            {dlg && dlg.type === 'close' && (
              <ConfirmDialog
                title={`إغلاق شهر ${monthLabel(d.curMonth)}`} danger confirmLabel="إغلاق الشهر" onClose={() => setDlg(null)}
                message={<>ستُحفظ لقطة ثابتة لترتيب الشهر ولن يُحذف أي سجل. سيبدأ شهر <b>{monthLabel(nextMonth(d.curMonth))}</b> بنقاط من الصفر. التصحيحات اللاحقة تتم عبر «تصحيح متأخر» فقط.</>}
                onConfirm={async () => { await archiveApi.closeMonth(); toast.success('تم إغلاق الشهر وحفظ اللقطة'); done(); }}
              />
            )}
          </>
        )}
      </Async>
    </>
  );
}
