import { useState } from 'react';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { CAMPUS, ROLE_LABEL } from '../../lib/constants.js';
import { archivedVisible, assignableCampuses, canManageAccount, canRestoreAccount, restorableRoles, restoreProblem } from '../../lib/governance.js';
import { usersApi } from '../../services/index.js';
import UserDialog from '../../components/domain/UserDialog.jsx';
import { Badge, CampusBadge, RoleBadge, UserStatusBadge } from '../../components/ui/Badges.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { Dialog, DialogActions, ReasonDialog } from '../../components/ui/Dialog.jsx';
import { Field, FilterBar, Segmented, Select } from '../../components/ui/Form.jsx';
import { Avatar, Button, Card, IconButton, PageHeader } from '../../components/ui/Primitives.jsx';
import { Async } from '../../components/ui/States.jsx';
import { tr } from '../../i18n/index.js';
import { navigate } from '../../router/router.jsx';

/**
 * Restore & Assign: the archived account returns active with an explicitly confirmed role, campus
 * and team. A regular Organizer is locked to its own campus and to Member/Manager; a Super Admin
 * chooses freely. A team that already has a Manager cannot take a restored Manager.
 */
function RestoreDialog({ user: u, onDone, onClose }) {
  const { meta } = useAppData();
  const { user: me } = useAuth();
  const toast = useToast();
  const teams = meta ? meta.teams : [];
  const roleOptions = restorableRoles(me, Object.entries(ROLE_LABEL).map(([v, l]) => [v, tr(l)]));
  const campusOptions = assignableCampuses(me, Object.entries(CAMPUS).map(([v, l]) => [v, tr(l)]));
  const [f, setF] = useState(() => {
    const campus = campusOptions.some(([v]) => v === u.campus) ? u.campus : (campusOptions[0] ? campusOptions[0][0] : 'jenin');
    const team = u.teams.find((id) => teams.some((t) => t.id === id && t.campus === campus)) || '';
    return { role: 'member', campus, teamId: team, reason: '' };
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => { setF((s) => ({ ...s, [k]: v, ...(k === 'campus' ? { teamId: '' } : {}) })); setErr(''); };
  const campusTeams = teams.filter((t) => t.campus === f.campus);
  const problem = restoreProblem(f, teams, u.id);

  const save = async () => {
    if (problem) { setErr(tr(problem)); return; }
    if (!f.reason.trim()) { setErr(tr('السبب إلزامي لهذه العملية.')); return; }
    setBusy(true); setErr('');
    try {
      await usersApi.restoreUser(u.id, f);
      toast.success(tr('تمت الاستعادة والتعيين؛ الحساب نشط الآن'));
      onDone(); onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Dialog title={tr('استعادة وتعيين')} onClose={onClose}>
      <p className="sub" style={{ marginTop: 0 }}>
        {u.name} · <span dir="ltr">{u.email}</span>
        {u.teamsLabel && <> · {tr('آخر تعيين: {role} في {team}', { role: tr(ROLE_LABEL[u.role] || u.role), team: u.teamsLabel })}</>}
      </p>
      <div className="row2">
        <Field label={tr('الدور')}>
          {(id) => <Select id={id} value={f.role} onChange={set('role')} options={roleOptions} />}
        </Field>
        <Field label={tr('الحرم')}>
          {(id) => <Select id={id} value={f.campus} onChange={set('campus')} options={campusOptions} disabled={campusOptions.length < 2} />}
        </Field>
      </div>
      <Field label={tr('الفريق')}>
        {(id) => (f.role === 'organizer'
          ? <p className="hint" id={id}>{tr('المنظّم لا يتبع فريقًا محددًا.')}</p>
          : <Select id={id} value={f.teamId} onChange={set('teamId')} options={[['', tr('اختر الفريق')],
            ...campusTeams.map((t) => [t.id, t.managerId && t.managerId !== u.id ? `${t.name} (${tr('لديه مدير')})` : t.name])]} />)}
      </Field>
      <Field label={tr('السبب (إلزامي)')}>
        {(id) => <textarea id={id} rows={2} maxLength={1000} value={f.reason} placeholder={tr('مثال: عاد بعد إجازة')} onChange={(e) => set('reason')(e.target.value)} />}
      </Field>
      {problem && problem.startsWith('هذا الفريق') && <p className="err" role="alert">{tr(problem)}</p>}
      {err && err !== tr(problem) && <p className="err" role="alert">{err}</p>}
      <p className="hint">{tr('يعود الحساب نشطًا بالدور والحرم والفريق المختارة، ولا يُستعاد أي منصب قيادي سابق تلقائيًا. يُسجَّل التعيين السابق والجديد في سجل التدقيق.')}</p>
      <DialogActions>
        <Button variant="primary" onClick={save} disabled={busy}>{tr('استعادة وتعيين')}</Button>
        <Button onClick={onClose}>{tr('إلغاء')}</Button>
      </DialogActions>
    </Dialog>
  );
}

const boldName = (key, name) => {
  const [a, b] = tr(key, { name: '\u0000' }).split('\u0000');
  return <>{a}<b>{name}</b>{b}</>;
};

export default function Members() {
  const { user: me } = useAuth();
  const { meta } = useAppData();
  const toast = useToast();
  const [f, setF] = useState({ tab: 'active', campus: '', teamId: '', role: 'member', status: '' });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v, ...(k === 'campus' ? { teamId: '' } : {}) }));
  const deleted = f.tab === 'deleted';
  const organizersTab = f.tab === 'organizers';
  // The organizers tab lists every Organizer account (active and inactive) so a mistaken promotion can be undone.
  const role = organizersTab ? 'organizer' : f.role;
  const state = useAsync(() => usersApi.listUsers({ role, campus: organizersTab ? '' : f.campus, teamId: organizersTab ? '' : f.teamId, status: f.status, deleted }), [f]);
  const [dlg, setDlg] = useState(null);
  const close = () => setDlg(null);
  const done = () => state.reload({ silent: true });

  const teamOpts = [['', tr('كل الفرق')], ...(meta ? meta.teams : []).filter((t) => !f.campus || t.campus === f.campus).map((t) => [t.id, `${tr(CAMPUS[t.campus])} · ${t.name}`])];

  const columns = [
    {
      title: tr('الاسم'), sort: (u) => u.name,
      render: (u) => (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Avatar name={u.name} />
          <div>{u.name}{u.id === me.id && <> <Badge tone="b">{tr('أنت')}</Badge></>}{u.isSuperAdmin && <> <Badge tone="g">{tr('مشرف عام')}</Badge></>}<div className="sub" dir="ltr" style={{ textAlign: 'start' }}>{u.email}</div></div>
        </div>
      ),
    },
    { title: tr('الحرم'), sort: (u) => u.campus, render: (u) => <CampusBadge campus={u.campus} /> },
    { title: tr('الفريق'), sort: (u) => u.teamsLabel, render: (u) => u.teamsLabel },
    { title: tr('الدور'), sort: (u) => u.role, render: (u) => <RoleBadge role={u.role} /> },
    { title: tr('الحالة'), render: (u) => <UserStatusBadge status={u.status} /> },
    {
      title: tr('إجراءات'),
      // Organizer accounts: Super Admins only; Super Admin accounts: never from the UI (enforced on the server).
      render: (u) => (u.status === 'deleted'
        ? (canRestoreAccount(me, u)
          ? <Button small variant="primary" icon="user-check" onClick={() => setDlg({ type: 'restore', u })}>{tr('استعادة وتعيين')}</Button>
          : <span className="sub">{tr('للمشرف العام فقط')}</span>)
        : !canManageAccount(me, u) ? <span className="sub">{u.isSuperAdmin ? tr('حساب محمي') : u.role === 'organizer' ? tr('للمشرف العام فقط') : tr('للعرض فقط')}</span> : (
        <div className="ia">
          <IconButton icon="edit" label={tr('تعديل')} onClick={() => setDlg({ type: 'edit', u })} />
          {/* Your own account: no deactivate / delete, so you can never lock yourself out. */}
          {u.id !== me.id && <IconButton icon={u.status === 'active' ? 'user-off' : 'user-check'} label={u.status === 'active' ? tr('تعطيل') : tr('تفعيل')} onClick={() => setDlg({ type: 'toggle', u })} />}
          {u.id !== me.id && <IconButton icon="trash" label={tr('حذف ناعم')} onClick={() => setDlg({ type: 'delete', u })} />}
        </div>
      )),
    },
  ];

  return (
    <>
      <PageHeader title={tr('الأعضاء')} subtitle={tr('إدارة المستخدمين، التعطيل، الحذف الناعم والاسترجاع')} crumb={tr('الأعضاء')} actions={<Button variant="primary" icon="user-plus" onClick={() => navigate('/organizer/registrations')}>{tr('طلبات الانضمام')}</Button>} />
      <p className="hint">{tr('تُنشأ الحسابات الجديدة فقط عبر طلبات الانضمام: يسجّل الشخص ويرسل طلبًا، ثم «موافقة وتعيين».')}</p>
      <Segmented style={{ marginBottom: 10 }} value={f.tab} onChange={set('tab')} options={[['active', tr('القائمة')], ['organizers', tr('المنظّمون')], ...(me.role === 'organizer' ? [['deleted', tr('المحذوفون / المؤرشفون')]] : [])]} />
      <FilterBar>
        {!organizersTab && <Select label={tr('الحرم')} value={f.campus} onChange={set('campus')} options={[['', tr('كل الحرمين')], ['jenin', tr('جنين')], ['ramallah', tr('رام الله')]]} />}
        {!organizersTab && <Select label={tr('الفريق')} value={f.teamId} onChange={set('teamId')} options={teamOpts} />}
        {!organizersTab && <Select label={tr('الدور')} value={f.role} onChange={set('role')} options={[['', tr('كل الأدوار')], ['member', 'Member'], ['manager', 'Manager'], ['organizer', 'Organizer']]} />}
        {!deleted && <Select label={tr('الحالة')} value={f.status} onChange={set('status')} options={[['', tr('كل الحالات')], ['active', tr('نشط')], ['disabled', tr('معطّل')]]} />}
      </FilterBar>
      <Card>
        <Async state={state}>
          {(rows) => <DataTable columns={columns} rows={deleted ? rows.filter((u) => archivedVisible(me, u)) : rows} searchText={(u) => `${u.name} ${u.email}`} emptyTitle={deleted ? tr('لا يوجد محذوفون') : tr('لا يوجد أعضاء بهذه التصفية')} />}
        </Async>
      </Card>

      {dlg && dlg.type === 'edit' && <UserDialog user={dlg.u} kind={dlg.u.role === 'manager' ? 'manager' : 'user'} onDone={done} onClose={close} />}

      {dlg && dlg.type === 'toggle' && (
        <ReasonDialog
          title={dlg.u.status === 'active' ? tr('تعطيل الحساب') : tr('إعادة تفعيل الحساب')} danger={dlg.u.status === 'active'}
          confirmLabel={dlg.u.status === 'active' ? tr('تعطيل') : tr('تفعيل')} description={<b>{dlg.u.name}</b>} onClose={close}
          onConfirm={async (r) => { await usersApi.toggleUserStatus(dlg.u.id, r); toast.success(dlg.u.status === 'active' ? tr('تم تعطيل الحساب') : tr('تمت إعادة التفعيل')); done(); }}
        />
      )}
      {dlg && dlg.type === 'delete' && (
        <ReasonDialog
          title={tr('حذف ناعم')} danger confirmLabel={tr('حذف')} onClose={close}
          description={boldName('سيختفي {name} من القوائم وتبقى سجلاته محفوظة، ويمكن استرجاعه لاحقًا.', dlg.u.name)}
          onConfirm={async (r) => { await usersApi.deleteUser(dlg.u.id, r); toast.success(tr('تم الحذف الناعم')); done(); }}
        />
      )}
      {dlg && dlg.type === 'restore' && <RestoreDialog user={dlg.u} onDone={done} onClose={close} />}
    </>
  );
}
