import { useState } from 'react';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { CAMPUS } from '../../lib/constants.js';
import { usersApi } from '../../services/index.js';
import UserDialog from '../../components/domain/UserDialog.jsx';
import { Badge, CampusBadge, RoleBadge, UserStatusBadge } from '../../components/ui/Badges.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { ConfirmDialog, ReasonDialog } from '../../components/ui/Dialog.jsx';
import { FilterBar, Segmented, Select } from '../../components/ui/Form.jsx';
import { Avatar, Button, Card, IconButton, PageHeader } from '../../components/ui/Primitives.jsx';
import { Async } from '../../components/ui/States.jsx';
import { tr } from '../../i18n/index.js';

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
  const state = useAsync(() => usersApi.listUsers({ role: f.role, campus: f.campus, teamId: f.teamId, status: f.status, deleted }), [f]);
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
          <div>{u.name}{u.id === me.id && <> <Badge tone="b">{tr('أنت')}</Badge></>}<div className="sub" dir="ltr" style={{ textAlign: 'start' }}>{u.email}</div></div>
        </div>
      ),
    },
    { title: tr('الحرم'), sort: (u) => u.campus, render: (u) => <CampusBadge campus={u.campus} /> },
    { title: tr('الفريق'), sort: (u) => u.teamsLabel, render: (u) => u.teamsLabel },
    { title: tr('الدور'), sort: (u) => u.role, render: (u) => <RoleBadge role={u.role} /> },
    { title: tr('الحالة'), render: (u) => <UserStatusBadge status={u.status} /> },
    {
      title: tr('إجراءات'),
      render: (u) => (u.status === 'deleted' ? <Button small onClick={() => setDlg({ type: 'restore', u })}>{tr('استرجاع')}</Button> : (
        <div className="ia">
          <IconButton icon="edit" label={tr('تعديل')} onClick={() => setDlg({ type: 'edit', u })} />
          <IconButton icon={u.status === 'active' ? 'user-off' : 'user-check'} label={u.status === 'active' ? tr('تعطيل') : tr('تفعيل')} onClick={() => setDlg({ type: 'toggle', u })} />
          <IconButton icon="trash" label={tr('حذف ناعم')} onClick={() => setDlg({ type: 'delete', u })} />
        </div>
      )),
    },
  ];

  return (
    <>
      <PageHeader title={tr('الأعضاء')} subtitle={tr('إدارة المستخدمين، التعطيل، الحذف الناعم والاسترجاع')} crumb={tr('الأعضاء')} actions={<Button variant="primary" icon="user-plus" onClick={() => setDlg({ type: 'add' })}>{tr('إضافة مستخدم')}</Button>} />
      <Segmented style={{ marginBottom: 10 }} value={f.tab} onChange={set('tab')} options={[['active', tr('القائمة')], ['deleted', tr('المحذوفون')]]} />
      <FilterBar>
        <Select label={tr('الحرم')} value={f.campus} onChange={set('campus')} options={[['', tr('كل الحرمين')], ['jenin', tr('جنين')], ['ramallah', tr('رام الله')]]} />
        <Select label={tr('الفريق')} value={f.teamId} onChange={set('teamId')} options={teamOpts} />
        <Select label={tr('الدور')} value={f.role} onChange={set('role')} options={[['', tr('كل الأدوار')], ['member', 'Member'], ['manager', 'Manager'], ['organizer', 'Organizer']]} />
        {!deleted && <Select label={tr('الحالة')} value={f.status} onChange={set('status')} options={[['', tr('كل الحالات')], ['active', tr('نشط')], ['disabled', tr('معطّل')]]} />}
      </FilterBar>
      <Card>
        <Async state={state}>
          {(rows) => <DataTable columns={columns} rows={rows} searchText={(u) => `${u.name} ${u.email}`} emptyTitle={deleted ? tr('لا يوجد محذوفون') : tr('لا يوجد أعضاء بهذه التصفية')} />}
        </Async>
      </Card>

      {dlg && dlg.type === 'add' && <UserDialog kind="user" onDone={done} onClose={close} />}
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
      {dlg && dlg.type === 'restore' && (
        <ConfirmDialog
          title={tr('استرجاع الحساب')} confirmLabel={tr('استرجاع')} onClose={close}
          message={boldName('سيعود {name} إلى القوائم بحالة معطّل حتى تفعّله.', dlg.u.name)}
          onConfirm={async () => { await usersApi.restoreUser(dlg.u.id); toast.success(tr('تم الاسترجاع')); done(); }}
        />
      )}
    </>
  );
}
