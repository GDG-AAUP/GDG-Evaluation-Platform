import { useEffect, useState } from 'react';
import { tr } from '../i18n/index.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { pointsApi } from '../services/index.js';
import { CAMPUS } from '../lib/constants.js';
import { fmtDateTime, monthLabel } from '../lib/format.js';
import { canReversePoint, REVERSAL_REASON_MAX, submitReversal } from '../lib/pointReversal.js';
import { Badge } from '../components/ui/Badges.jsx';
import DataTable from '../components/ui/DataTable.jsx';
import { Dialog, DialogActions } from '../components/ui/Dialog.jsx';
import { Field } from '../components/ui/Form.jsx';
import { Banner, Button, Card, Grid, MetricCard, Note, PageHeader, PointsBadge } from '../components/ui/Primitives.jsx';
import { Async } from '../components/ui/States.jsx';

// The log refreshes itself so entries added by the organizer (or in another tab) appear too.
const REFRESH_MS = 30000;

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
      const res = await pointsApi.addPoints({ userId: member.id, value: n, reason, activity });
      toast.success(tr('تمت إضافة النقاط'));
      onDone({ userId: member.id, name: member.name, value: n, activity: activity.trim(), reason: reason.trim(), entryId: res?.entry?.id });
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

/** Confirms a reversal: who, how many points, which activity, and a required reason (audit trail). */
function ReverseDialog({ entry, onDone, onClose }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await submitReversal(entry, reason, pointsApi.reversePoint);
      toast.success(tr('تم عكس العملية وتحديث المجاميع'));
      onDone(entry, true);
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
      // Already reversed elsewhere (another tab or person): refresh so the log shows it.
      if (e && e.status === 409) onDone(entry, false);
    }
  };

  return (
    <Dialog title={tr('عكس العملية')} onClose={onClose}>
      <p style={{ margin: '0 0 10px' }}>
        {tr('ستُسجَّل عملية جديدة بقيمة معاكسة في نفس شهر العملية الأصلية، وتبقى العملية الأصلية في السجل. لا يمكن عكس العملية أكثر من مرة.')}
      </p>
      <p style={{ margin: '0 0 4px' }}><b>{tr('العضو')}:</b> {entry.userName}</p>
      <p style={{ margin: '0 0 4px' }}><b>{tr('النقاط')}:</b> <PointsBadge value={entry.value} /></p>
      <p style={{ margin: '0 0 10px' }}><b>{tr('النشاط')}:</b> {entry.activity}</p>
      <Field label={tr('سبب العكس')}>
        {(id) => <textarea id={id} rows={3} maxLength={REVERSAL_REASON_MAX} value={reason} placeholder={tr('اكتب سببًا واضحًا للعكس')} onChange={(e) => { setReason(e.target.value); setErr(''); }} />}
      </Field>
      {err && <p className="err" role="alert">{err}</p>}
      <DialogActions>
        <Button variant="danger" disabled={busy} onClick={submit}>{tr('عكس العملية')}</Button>
        <Button onClick={onClose}>{tr('إلغاء')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Confirmation of the last award, with the person's and the team's updated month totals. */
function LastAward({ last, history }) {
  const member = history && history.members.find((m) => m.userId === String(last.userId));
  const sign = last.value > 0 ? '+' : '−';
  return (
    <Banner icon="circle-check">
      <span role="status">
        {tr('تمت إضافة {points} نقطة إلى {name} — النشاط: {activity}.', { points: `${sign}${Math.abs(last.value)}`, name: last.name, activity: last.activity })}
        {history && member && <> {tr('مجموع {name} هذا الشهر: {total} نقطة.', { name: last.name, total: member.total })}</>}
        {history && history.scope === 'team' && <> {tr('مجموع الفريق: {total} نقطة.', { total: history.totals.points })}</>}
      </span>
    </Banner>
  );
}

function HistoryLog({ data, user, onReverse }) {
  const isTeam = data.scope === 'team';
  const columns = [
    { title: tr('التاريخ'), sort: (r) => r.ts, render: (r) => fmtDateTime(r.ts) },
    { title: tr('العضو'), sort: (r) => r.userName, render: (r) => <b>{r.userName}</b> },
    { title: tr('النقاط'), sort: (r) => r.value, render: (r) => <PointsBadge value={r.value} /> },
    { title: tr('النشاط'), render: (r) => r.activity },
    { title: tr('السبب'), render: (r) => r.reason },
    {
      title: tr('بواسطة'),
      render: (r) => (
        <>
          {r.awardedByMe ? tr('أنت') : r.actorName}
          {r.isReversal && <> <Badge tone="y">{tr('عكس عملية')}</Badge></>}
          {r.reversed && <> <Badge tone="n">{tr('معكوسة')}</Badge></>}
        </>
      ),
    },
    {
      title: '',
      render: (r) => (canReversePoint(r, user)
        ? <Button small variant="danger" onClick={() => onReverse(r)}>{tr('عكس العملية')}</Button>
        : null),
    },
  ];
  return (
    <Card style={{ marginTop: 14 }}>
      <h3>
        {isTeam
          ? tr('سجل النقاط المضافة للفريق — {team} ({month})', { team: data.team.name, month: monthLabel(data.month) })
          : tr('سجل النقاط التي أضفتها ({month})', { month: monthLabel(data.month) })}
      </h3>
      <Grid style={{ marginBottom: 14 }}>
        <MetricCard icon="chart" value={data.totals.points} label={isTeam ? tr('مجموع نقاط الفريق هذا الشهر') : tr('مجموع النقاط التي أضفتها')} tone="g" />
        <MetricCard icon="history" value={data.totals.entries} label={tr('عدد العمليات')} />
        {isTeam && <MetricCard icon="star" value={data.totals.awardedByMe} label={tr('نقاط أضفتها أنت ({n} عملية)', { n: data.totals.awardedByMeEntries })} />}
      </Grid>
      {isTeam && data.members.length > 0 && (
        <p className="sub">
          {tr('مجموع كل عضو هذا الشهر:')} {data.members.map((m) => `${m.name} (${m.total})`).join('، ')}
        </p>
      )}
      <DataTable
        columns={columns}
        rows={data.entries}
        searchText={(r) => `${r.userName} ${r.activity} ${r.reason}`}
        emptyTitle={tr('لم تُسجَّل نقاط هذا الشهر بعد')}
      />
      <Note>
        {data.truncated
          ? tr('يُعرض أحدث 200 عملية فقط؛ المجاميع تشمل كل عمليات الشهر. يتحدّث السجل تلقائيًا.')
          : tr('يتحدّث السجل تلقائيًا كل 30 ثانية وبعد كل إضافة.')}
      </Note>
    </Card>
  );
}

/**
 * Give points with the real backend (POST /api/points). The organizer sees every active member and
 * manager, a manager only the members of their own team (the server enforces the same rule).
 * Below the list: a confirmation of the last award and the month's points log (GET /api/points/team-history).
 */
export default function GivePoints() {
  const { user } = useAuth();
  const [tick, setTick] = useState(0);
  const [target, setTarget] = useState(null);
  const [last, setLast] = useState(null);
  const [reversing, setReversing] = useState(null);
  const state = useAsync(() => pointsApi.getAssignableMembers(), [tick]);
  const history = useAsync(() => pointsApi.getTeamHistory(), [tick]);
  const reloadHistory = history.reload;

  useEffect(() => {
    const timer = setInterval(() => reloadHistory({ silent: true }), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reloadHistory]);

  const done = (award) => { setLast(award); setTick((t) => t + 1); };
  // After a reversal: reload the log, its totals and the per-member totals; drop a stale award banner.
  const reversed = (entry, succeeded) => {
    if (succeeded) setLast((l) => (l && String(l.entryId) === String(entry.id) ? null : l));
    setTick((t) => t + 1);
  };

  return (
    <>
      <PageHeader title={tr('إضافة نقاط')} subtitle={tr('اختر عضوًا وسجّل نقاطه مع اسم النشاط والسبب. تظهر العملية في السجل أدناه وفي سجل التدقيق.')} />
      {last && <LastAward last={last} history={history.data} />}
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
            {target && <PointsForm member={target} onDone={done} onClose={() => setTarget(null)} />}
          </Card>
        )}
      </Async>
      <Async state={history}>{(data) => <HistoryLog data={data} user={user} onReverse={setReversing} />}</Async>
      {reversing && <ReverseDialog entry={reversing} onDone={reversed} onClose={() => setReversing(null)} />}
    </>
  );
}
